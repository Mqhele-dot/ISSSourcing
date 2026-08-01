import { randomBytes } from "node:crypto";
import { pool } from "../../db";
import { appEnv } from "../../config/env";
import { getActiveOrganizationId, getTenantContext } from "../../organization-context";
import { incrementMetric } from "../../observability/metrics";
import { recordServerDiagnosticEvent } from "../../diagnostics/server-diagnostics-store";

export type ExportJobStatus = "queued" | "running" | "succeeded" | "failed";

export type CreateExportJobInput = {
  userId: number | null;
  dataset: string;
  format: string;
  filters: Record<string, unknown>;
  sourcePage?: string | null;
  reason?: string | null;
};

export type ExportJobRow = {
  id: number;
  organizationId: number;
  createdBy: number | null;
  dataset: string;
  format: string;
  filters: Record<string, unknown>;
  status: ExportJobStatus;
  sourcePage: string | null;
  reason: string | null;
  fileName: string | null;
  filePath: string | null;
  fileSize: number | null;
  mimeType: string | null;
  rowCount: number | null;
  attempts: number;
  lastError: string | null;
  downloadToken: string | null;
  downloadTokenExpiresAt: string | null;
  retentionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

function mapExportJobRow(row: any): ExportJobRow {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    createdBy: row.created_by == null ? null : Number(row.created_by),
    dataset: String(row.dataset),
    format: String(row.format),
    filters: (row.filters ?? {}) as Record<string, unknown>,
    status: row.status as ExportJobStatus,
    sourcePage: row.source_page ?? null,
    reason: row.reason ?? null,
    fileName: row.file_name ?? null,
    filePath: row.file_path ?? null,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    mimeType: row.mime_type ?? null,
    rowCount: row.row_count == null ? null : Number(row.row_count),
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error ?? null,
    downloadToken: row.download_token ?? null,
    downloadTokenExpiresAt: row.download_token_expires_at?.toISOString?.() ?? row.download_token_expires_at ?? null,
    retentionExpiresAt: row.retention_expires_at?.toISOString?.() ?? row.retention_expires_at ?? null,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    startedAt: row.started_at?.toISOString?.() ?? row.started_at ?? null,
    completedAt: row.completed_at?.toISOString?.() ?? row.completed_at ?? null,
  };
}

export async function createExportJob(input: CreateExportJobInput): Promise<ExportJobRow> {
  const result = await pool.query(
    `
      INSERT INTO export_jobs (
        organization_id,
        created_by,
        dataset,
        format,
        filters,
        status,
        source_page,
        reason
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', $6, $7)
      RETURNING *
    `,
    [
      getActiveOrganizationId(),
      input.userId,
      input.dataset,
      input.format,
      JSON.stringify(input.filters ?? {}),
      input.sourcePage ?? null,
      input.reason ?? null,
    ],
  );
  incrementMetric("exports.jobs.queued");
  return mapExportJobRow(result.rows[0]);
}

export async function listExportJobs(limit = 50): Promise<ExportJobRow[]> {
  const tenant = getTenantContext();
  const result = await pool.query(
    `
      SELECT *
      FROM export_jobs
      WHERE organization_id = $1
        AND created_by = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [tenant.organizationId, tenant.userId, limit],
  );
  return result.rows.map(mapExportJobRow);
}

export async function getScopedExportJob(id: number): Promise<ExportJobRow | null> {
  const tenant = getTenantContext();
  const result = await pool.query(
    `
      SELECT *
      FROM export_jobs
      WHERE id = $1
        AND organization_id = $2
        AND created_by = $3
      LIMIT 1
    `,
    [id, tenant.organizationId, tenant.userId],
  );
  return result.rows[0] ? mapExportJobRow(result.rows[0]) : null;
}

export async function refreshScopedExportDownloadToken(id: number): Promise<ExportJobRow | null> {
  const tenant = getTenantContext();
  const token = randomBytes(24).toString("hex");
  const tokenTtlMinutes = Math.min(appEnv.exportDownloadTokenTtlMinutes, 55);
  const tokenExpiry = new Date(Date.now() + tokenTtlMinutes * 60_000);
  const result = await pool.query(
    `UPDATE export_jobs
     SET download_token = $3,
         download_token_expires_at = $4,
         updated_at = NOW()
     WHERE id = $1
       AND organization_id = $2
       AND created_by = $5
       AND status = 'succeeded'
       AND file_path IS NOT NULL
       AND (retention_expires_at IS NULL OR retention_expires_at > NOW())
     RETURNING *`,
    [id, tenant.organizationId, token, tokenExpiry, tenant.userId],
  );
  return result.rows[0] ? mapExportJobRow(result.rows[0]) : null;
}

export async function claimNextQueuedExportJob(): Promise<ExportJobRow | null> {
  const result = await pool.query(
    `
      UPDATE export_jobs
      SET status = 'running',
          started_at = NOW(),
          updated_at = NOW(),
          attempts = attempts + 1
      WHERE id = (
        SELECT id
        FROM export_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      )
      RETURNING *
    `,
  );
  return result.rows[0] ? mapExportJobRow(result.rows[0]) : null;
}

export async function markExportJobSucceeded(input: {
  id: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  rowCount: number;
}): Promise<void> {
  const downloadToken = randomBytes(24).toString("hex");
  const tokenTtlMinutes = Math.min(appEnv.exportDownloadTokenTtlMinutes, 55);
  const tokenExpiry = new Date(Date.now() + tokenTtlMinutes * 60_000);
  const retentionExpiry = new Date(Date.now() + appEnv.exportRetentionDays * 24 * 60 * 60_000);
  await pool.query(
    `
      UPDATE export_jobs
      SET status = 'succeeded',
          file_name = $2,
          file_path = $3,
          file_size = $4,
          mime_type = $5,
          row_count = $6,
          download_token = $7,
          download_token_expires_at = $8,
          retention_expires_at = $9,
          completed_at = NOW(),
          updated_at = NOW(),
          last_error = NULL
      WHERE id = $1
    `,
    [input.id, input.fileName, input.filePath, input.fileSize, input.mimeType, input.rowCount, downloadToken, tokenExpiry, retentionExpiry],
  );
}

export async function markExportJobFailed(id: number, message: string): Promise<void> {
  const result = await pool.query(
    `
      UPDATE export_jobs
      SET status = 'failed',
          last_error = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING organization_id, dataset, format
    `,
    [id, message.slice(0, 2000)],
  );
  const row = result.rows[0];
  if (row) {
    let failure: Record<string, unknown> = {};
    try {
      failure = JSON.parse(message) as Record<string, unknown>;
    } catch {
      failure = {};
    }
    recordServerDiagnosticEvent({
      severity: "error",
      source: "integration",
      title: "Export generation failed",
      message:
        typeof failure.message === "string"
          ? failure.message
          : "The export worker could not generate the requested file.",
      route: "/api/export-jobs",
      method: "WORKER",
      details: {
        organizationId: Number(row.organization_id),
        jobId: id,
        dataset: row.dataset,
        format: row.format,
        code: typeof failure.code === "string" ? failure.code : "EXPORT_GENERATION_FAILED",
        requestId: typeof failure.requestId === "string" ? failure.requestId : `export-job-${id}`,
        remediation: "Retry the job from Export Center. If it fails again, use this request ID in System Diagnostics.",
      },
    });
  }
}

export async function requeueExportJob(id: number): Promise<void> {
  const tenant = getTenantContext();
  await pool.query(
    `
      UPDATE export_jobs
      SET status = 'queued',
          last_error = NULL,
          file_name = NULL,
          file_path = NULL,
          file_size = NULL,
          mime_type = NULL,
          row_count = NULL,
          download_token = NULL,
          download_token_expires_at = NULL,
          retention_expires_at = NULL,
          started_at = NULL,
          completed_at = NULL,
          updated_at = NOW()
      WHERE id = $1
        AND organization_id = $2
        AND created_by = $3
    `,
    [id, tenant.organizationId, tenant.userId],
  );
  incrementMetric("exports.jobs.queued");
}

export async function listExpiredExportJobs(): Promise<Array<{ id: number; filePath: string | null }>> {
  const result = await pool.query(
    `
      SELECT id, file_path
      FROM export_jobs
      WHERE retention_expires_at IS NOT NULL
        AND retention_expires_at < NOW()
        AND file_path IS NOT NULL
    `,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    filePath: row.file_path ?? null,
  }));
}

export async function clearExpiredExportJobFile(id: number): Promise<void> {
  await pool.query(
    `
      UPDATE export_jobs
      SET file_path = NULL,
          download_token = NULL,
          download_token_expires_at = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
    [id],
  );
}

export async function getLatestFailedExportJobForOrg(organizationId: number): Promise<{
  id: number;
  lastError: string;
  updatedAt: string;
} | null> {
  const result = await pool.query(
    `
      SELECT id, last_error, updated_at
      FROM export_jobs
      WHERE organization_id = $1
        AND status = 'failed'
        AND last_error IS NOT NULL
        AND last_error <> ''
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [organizationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    lastError: String(row.last_error),
    updatedAt: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}
