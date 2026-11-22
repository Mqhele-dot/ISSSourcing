import { gzipSync } from "node:zlib";
import { appEnv } from "../../config/env";
import { logger } from "../../lib/logger";
import { incrementMetric } from "../../observability/metrics";
import {
  claimNextQueuedExportJob,
  listExpiredExportJobs,
  markExportJobFailed,
  markExportJobSucceeded,
} from "./export-jobs";
import { buildExportFilePath, removeExportFile } from "./export-file-store";
import { pool } from "../../db";
import { storage } from "../../storage";
import { runWithTenantContext } from "../../organization-context";
import { streamFrozenFinancialCsv } from "../reports/frozen-financial-export";
import {financialMeasureKeys,financialMeasureResource,type FinancialMeasure} from "../../../shared/financial-measures";
import {streamExportFile} from "./stream-export-file";
import {assertCurrentExportActor} from "./export-source-access";
import {createExportRetentionTask} from "./export-retention-task";
import {expireObservedExportFile} from "./expire-export-file";

async function frozenFinancialResponse(job:{organizationId:number;createdBy:number|null;filters:Record<string,unknown>}):Promise<Response> {
  const measure=String(job.filters.measure);
  const runId=String(job.filters.runId);
  if(!(financialMeasureKeys as readonly string[]).includes(measure)||!/^[a-f0-9-]{36}$/i.test(runId)) throw new Error("Invalid frozen reporting reference");
  const member=await pool.query(`SELECT id,application_role,role FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND active=true AND status='active'`,[job.organizationId,job.createdBy]);
  if(!member.rowCount) throw new Error("The requesting user no longer has active organization access");
  const membership=member.rows[0];
  const role=membership.application_role;
  return runWithTenantContext({organizationId:job.organizationId,membershipId:Number(membership.id),userId:Number(job.createdBy),userRole:role,membershipRole:membership.role,effectivePermissions:[],correlationId:`financial-export-${runId}`},async()=>{
    for(const [resource,action] of [["reports","read"],["reports","export"],[financialMeasureResource(measure as FinancialMeasure),"read"]]) {
      if(role==="admin") continue;
      let allowed=await storage.checkPermission(role,resource,action);
      if(!allowed&&role==="custom") {
        const customRole=await storage.getUserCustomRoleId(Number(job.createdBy));
        allowed=!!customRole&&await storage.checkCustomRolePermission(customRole,resource as Parameters<typeof storage.checkCustomRolePermission>[1],action as Parameters<typeof storage.checkCustomRolePermission>[2]);
      }
      if(!allowed) throw new Error("The requesting user no longer has access to this financial export");
    }
    const client=await pool.connect();
    let handedOff=false;
    try {
      const result=await streamFrozenFinancialCsv(client,job.organizationId,runId,measure);
      if(!result) throw new Error("The saved reporting evidence is not available in this organization");
      let released=false;
      const release=()=>{if(!released){released=true;client.release();}};
      const encoder=new TextEncoder();
      const body=new ReadableStream<Uint8Array>({
        async pull(controller){
          try{const next=await result.chunks.next();if(next.done){release();controller.close();}else controller.enqueue(encoder.encode(next.value));}
          catch(error){release();controller.error(error);}
        },
        async cancel(){try{await result.chunks.return();}finally{release();}},
      });
      const response=new Response(body,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="financial-${measure}-${runId}.csv"`,"x-export-row-count":String(result.rowCount)}});
      handedOff=true;
      return response;
    } finally {if(!handedOff)client.release();}
  });
}

let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

export type PackagedExport = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

export function packageExportBuffer(input: {
  buffer: Buffer;
  fileName: string;
  format: string;
  contentType?: string | null;
}): PackagedExport {
  const fileName = input.fileName.toLowerCase();
  const shouldGzipCsv = input.format === "csv" && !fileName.endsWith(".gz");
  if (shouldGzipCsv) {
    return {
      buffer: gzipSync(input.buffer, { level: 9 }),
      fileName: `${input.fileName}.gz`,
      mimeType: "application/gzip",
    };
  }

  return {
    buffer: input.buffer,
    fileName: input.fileName,
    mimeType: input.contentType?.split(";")[0]?.trim() || "application/octet-stream",
  };
}

function structuredExportFailure(status: number, body: string, requestId: string | null): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return JSON.stringify({
    code: typeof parsed.code === "string" ? parsed.code : "EXPORT_GENERATION_FAILED",
    message:
      typeof parsed.message === "string"
        ? parsed.message
        : `The export service returned HTTP ${status}.`,
    hint:
      typeof parsed.hint === "string"
        ? parsed.hint
        : "Retry the export. If it fails again, review System Diagnostics with the request ID.",
    requestId:
      typeof parsed.requestId === "string" ? parsed.requestId : requestId,
    status,
  });
}

function buildExportUrl(dataset: string, format: string, filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return `http://127.0.0.1:${appEnv.port}/api/export/${encodeURIComponent(dataset)}/${encodeURIComponent(format)}${query ? `?${query}` : ""}`;
}

async function processOneJob(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  let claimedJobId: number | null = null;
  let generatedFile: string | null = null;
  let exportResponse: Response | null = null;

  try {
    const job = await claimNextQueuedExportJob();
    if (!job) return;
    claimedJobId = job.id;
    await assertCurrentExportActor(job.organizationId,Number(job.createdBy),job.dataset,job.filters);

    incrementMetric("exports.jobs.running");
    const response = job.dataset==="financial_measure" ? await frozenFinancialResponse(job) : await fetch(buildExportUrl(job.dataset, job.format, job.filters), {
      method: "GET",
      headers: {
        "X-Internal-Export-Key": appEnv.internalExportToken,
        "X-Internal-Export-Organization-Id": String(job.organizationId),
        "X-Internal-Export-User-Id": String(job.createdBy ?? 0),
        "X-Request-Id": `export-job-${job.id}`,
      },
    });
    exportResponse=response;

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      incrementMetric("exports.jobs.failed");
      await markExportJobFailed(
        job.id,
        structuredExportFailure(response.status, detail, response.headers.get("x-request-id")),
      );
      return;
    }

    const rawFileName =
      response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
      `${job.dataset}.${job.format === "excel" ? "xlsx" : job.format}`;
    if(!response.body)throw new Error("The export service returned no downloadable content.");
    const gzip=job.format==="csv"&&!rawFileName.toLowerCase().endsWith(".gz");
    const packaged={fileName:gzip?`${rawFileName}.gz`:rawFileName,
      mimeType:gzip?"application/gzip":response.headers.get("content-type")?.split(";")[0]?.trim()||"application/octet-stream"};
    const rowCount = Number(response.headers.get("x-export-row-count") ?? 0);
    const { absolutePath, relativePath } = buildExportFilePath(job.organizationId, job.id, packaged.fileName);
    const fileSize=await streamExportFile({body:response.body,destination:absolutePath,gzip});
    generatedFile=relativePath;

    await markExportJobSucceeded({
      id: job.id,
      organizationId: job.organizationId,
      dataset: job.dataset,
      supplierPolicyVersion: response.headers.get("x-supplier-disclosure-policy"),
      fileName: packaged.fileName,
      filePath: relativePath,
      fileSize,
      mimeType: packaged.mimeType,
      rowCount: Number.isFinite(rowCount) ? rowCount : 0,
    });
    generatedFile=null;
    incrementMetric("exports.jobs.succeeded");
  } catch (error) {
    if(generatedFile){
      try{removeExportFile(generatedFile);}catch{
        logger.warn("Export artifact cleanup failed",{jobId:claimedJobId});
      }
    }
    incrementMetric("exports.jobs.failed");
    if (claimedJobId != null) {
      await markExportJobFailed(
        claimedJobId,
        JSON.stringify({
          code: "EXPORT_WORKER_FAILED",
          message: error instanceof Error ? error.message : String(error),
          hint: "Retry the export. If it fails again, review System Diagnostics.",
          requestId: `export-job-${claimedJobId}`,
        }),
      ).catch(() => undefined);
    }
    logger.error("Export worker failed to process job", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Also release a frozen stream's database client if destination setup failed
    // before a consumer could acquire the body reader.
    await exportResponse?.body?.cancel().catch(()=>undefined);
    workerRunning = false;
  }
}

const cleanupExpiredJobs=createExportRetentionTask({
  list:listExpiredExportJobs,expire:job=>expireObservedExportFile(pool,job),
  onFailure:jobId=>logger.warn("Failed to clean up expired export job file",{jobId,errorCode:"EXPORT_RETENTION_ITEM_FAILED"}),
});

export function startExportWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void processOneJob();
    void cleanupExpiredJobs().catch(() => {
      logger.warn("Export cleanup loop failed", {
        errorCode:"EXPORT_RETENTION_CHECK_FAILED",
      });
    });
  }, 15000);
  logger.info("Export worker started");
}

export function stopExportWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
