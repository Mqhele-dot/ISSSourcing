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

  try {
    const job = await claimNextQueuedExportJob();
    if (!job) return;

    incrementMetric("exports.jobs.running");
    const response = await fetch(buildExportUrl(job.dataset, job.format, job.filters), {
      method: "GET",
      headers: {
        "X-Internal-Export-Key": appEnv.internalExportToken,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => `HTTP ${response.status}`);
      incrementMetric("exports.jobs.failed");
      await markExportJobFailed(job.id, detail || `HTTP ${response.status}`);
      return;
    }

    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const rawFileName =
      response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
      `${job.dataset}.${job.format === "excel" ? "xlsx" : job.format}`;
    const buffer = gzipSync(rawBuffer, { level: 9 });
    const fileName = rawFileName.endsWith(".gz") ? rawFileName : `${rawFileName}.gz`;
    const mimeType = "application/gzip";
    const rowCount = Number(response.headers.get("x-export-row-count") ?? 0);
    const { absolutePath, relativePath } = buildExportFilePath(job.organizationId, job.id, fileName);
    fs.writeFileSync(absolutePath, buffer);

    await markExportJobSucceeded({
      id: job.id,
      fileName,
      filePath: relativePath,
      fileSize: buffer.length,
      mimeType,
      rowCount: Number.isFinite(rowCount) ? rowCount : 0,
    });
    incrementMetric("exports.jobs.succeeded");
  } catch (error) {
    incrementMetric("exports.jobs.failed");
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
