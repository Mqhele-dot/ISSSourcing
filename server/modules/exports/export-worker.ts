import fs from "node:fs";
import { gzipSync } from "node:zlib";
import { appEnv } from "../../config/env";
import { logger } from "../../lib/logger";
import { incrementMetric } from "../../observability/metrics";
import {
  claimNextQueuedExportJob,
  clearExpiredExportJobFile,
  listExpiredExportJobs,
  markExportJobFailed,
  markExportJobSucceeded,
} from "./export-jobs";
import { buildExportFilePath, removeExportFile } from "./export-file-store";

let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;
let cleanupRunning = false;

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

  try {
    const job = await claimNextQueuedExportJob();
    if (!job) return;
    claimedJobId = job.id;

    incrementMetric("exports.jobs.running");
    const response = await fetch(buildExportUrl(job.dataset, job.format, job.filters), {
      method: "GET",
      headers: {
        "X-Internal-Export-Key": appEnv.internalExportToken,
        "X-Internal-Export-Organization-Id": String(job.organizationId),
        "X-Internal-Export-User-Id": String(job.createdBy ?? 0),
        "X-Request-Id": `export-job-${job.id}`,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      incrementMetric("exports.jobs.failed");
      await markExportJobFailed(
        job.id,
        structuredExportFailure(response.status, detail, response.headers.get("x-request-id")),
      );
      return;
    }

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const rawFileName =
      response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
      `${job.dataset}.${job.format === "excel" ? "xlsx" : job.format}`;
    const packaged = packageExportBuffer({
      buffer: rawBuffer,
      fileName: rawFileName,
      format: job.format,
      contentType: response.headers.get("content-type"),
    });
    const rowCount = Number(response.headers.get("x-export-row-count") ?? 0);
    const { absolutePath, relativePath } = buildExportFilePath(job.organizationId, job.id, packaged.fileName);
    fs.writeFileSync(absolutePath, packaged.buffer);

    await markExportJobSucceeded({
      id: job.id,
      fileName: packaged.fileName,
      filePath: relativePath,
      fileSize: packaged.buffer.length,
      mimeType: packaged.mimeType,
      rowCount: Number.isFinite(rowCount) ? rowCount : 0,
    });
    incrementMetric("exports.jobs.succeeded");
  } catch (error) {
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
    workerRunning = false;
  }
}

async function cleanupExpiredJobs(): Promise<void> {
  if (cleanupRunning) return;
  cleanupRunning = true;
  const expiredJobs = await listExpiredExportJobs();
  try {
    for (const job of expiredJobs) {
      try {
        removeExportFile(job.filePath);
        await clearExpiredExportJobFile(job.id);
      } catch (error) {
        logger.warn("Failed to clean up expired export job file", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    cleanupRunning = false;
  }
}

export function startExportWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void processOneJob();
    void cleanupExpiredJobs().catch((error) => {
      logger.warn("Export cleanup loop failed", {
        error: error instanceof Error ? error.message : String(error),
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
