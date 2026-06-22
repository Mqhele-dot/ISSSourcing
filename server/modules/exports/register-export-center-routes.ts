import fs from "node:fs";
import path from "node:path";
import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { getExportDatasetRegistry } from "../../services/export-registry";
import { sendError, sendOk } from "../../api-response";
import { createExportJob, getScopedExportJob, listExportJobs, requeueExportJob } from "./export-jobs";
import { removeExportFile } from "./export-file-store";
import { exportRateLimiter } from "../../services/security-service";

const createSavedReportSchema = z.object({
  reportName: z.string().trim().min(1),
  dataset: z.string().trim().min(1),
  filters: z.record(z.unknown()).default({}),
  visibleColumns: z.array(z.string()).default([]),
  defaultFormat: z.enum(["csv", "excel", "pdf", "docx"]).default("csv"),
  sourcePage: z.string().trim().optional(),
});

const createExportJobSchema = z.object({
  dataset: z.string().trim().min(1),
  format: z.enum(["csv", "excel", "pdf", "docx"]),
  filters: z.record(z.unknown()).default({}),
  sourcePage: z.string().trim().optional(),
  reason: z.string().trim().max(200).optional(),
});

function currentUserId(req: Request): number | null {
  const userId = Number((req as Request & { user?: { id?: number } }).user?.id);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

function withDownloadUrl(row: Awaited<ReturnType<typeof listExportJobs>>[number]) {
  return {
    ...row,
    createdBy: row.createdBy ? `User #${row.createdBy}` : null,
    downloadUrl:
      row.status === "succeeded" && row.downloadToken
        ? `/api/export/download/${row.id}?token=${encodeURIComponent(row.downloadToken)}`
        : null,
    canRetry: row.status === "failed",
  };
}

export function registerExportCenterRoutes(
  app: Express,
  auth: {
    ensureAuthenticated: RequestHandler;
    ensurePermission: (resource: string, permissionType: string) => RequestHandler;
  },
): void {
  const exportAccess = [auth.ensureAuthenticated, auth.ensurePermission("reports", "export")];

  app.get("/api/export-center/datasets", ...exportAccess, (_req: Request, res: Response) => {
    sendOk(res, getExportDatasetRegistry());
  });

  app.get("/api/export-center/history", ...exportAccess, async (_req: Request, res: Response) => {
    const rows = await listExportJobs();
    sendOk(res, rows.map(withDownloadUrl));
  });

  app.get("/api/export-center/saved-reports", ...exportAccess, async (_req: Request, res: Response) => {
    const result = await pool.query(
      `
        SELECT
          id,
          report_name AS "reportName",
          dataset,
          default_format AS "defaultFormat",
          visible_columns AS "visibleColumns",
          source_page AS "sourcePage",
          created_at AS "createdAt"
        FROM saved_reports
        WHERE organization_id = $1
        ORDER BY created_at DESC
      `,
      [getActiveOrganizationId()],
    );
    sendOk(res, result.rows);
  });

  app.post("/api/export-center/saved-reports", ...exportAccess, async (req: Request, res: Response) => {
    const parsed = createSavedReportSchema.parse(req.body);
    const result = await pool.query(
      `
        INSERT INTO saved_reports (
          organization_id,
          created_by,
          report_name,
          dataset,
          filters,
          visible_columns,
          default_format,
          source_page
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
        RETURNING
          id,
          report_name AS "reportName",
          dataset,
          default_format AS "defaultFormat",
          visible_columns AS "visibleColumns",
          source_page AS "sourcePage",
          created_at AS "createdAt"
      `,
      [
        getActiveOrganizationId(),
        currentUserId(req),
        parsed.reportName,
        parsed.dataset,
        JSON.stringify(parsed.filters ?? {}),
        JSON.stringify(parsed.visibleColumns ?? []),
        parsed.defaultFormat,
        parsed.sourcePage ?? null,
      ],
    );
    sendOk(res, result.rows[0], 201);
  });

  app.post("/api/export-jobs", ...exportAccess, exportRateLimiter, async (req: Request, res: Response) => {
    const parsed = createExportJobSchema.parse(req.body);
    const job = await createExportJob({
      userId: currentUserId(req),
      dataset: parsed.dataset,
      format: parsed.format,
      filters: parsed.filters ?? {},
      sourcePage: parsed.sourcePage ?? null,
      reason: parsed.reason ?? null,
    });
    sendOk(res, withDownloadUrl(job), 202);
  });

  app.get("/api/export-jobs/:id", ...exportAccess, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return sendError(res, 400, "INVALID_EXPORT_JOB_ID", "Invalid export job id.");
    }
    const job = await getScopedExportJob(id);
    if (!job) {
      return sendError(res, 404, "EXPORT_JOB_NOT_FOUND", "Export job not found.");
    }
    sendOk(res, withDownloadUrl(job));
  });

  app.post("/api/export-jobs/:id/retry", ...exportAccess, exportRateLimiter, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return sendError(res, 400, "INVALID_EXPORT_JOB_ID", "Invalid export job id.");
    }
    const job = await getScopedExportJob(id);
    if (!job) {
      return sendError(res, 404, "EXPORT_JOB_NOT_FOUND", "Export job not found.");
    }
    if (job.filePath) {
      removeExportFile(job.filePath);
    }
    await requeueExportJob(id);
    const refreshed = await getScopedExportJob(id);
    sendOk(res, refreshed ? withDownloadUrl(refreshed) : null);
  });

  app.get("/api/export/download/:id", ...exportAccess, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!Number.isFinite(id) || !token) {
      return sendError(res, 400, "INVALID_EXPORT_DOWNLOAD_REQUEST", "Invalid export download request.");
    }
    const job = await getScopedExportJob(id);
    if (!job || job.status !== "succeeded" || !job.filePath || !job.downloadToken) {
      return sendError(res, 404, "EXPORT_FILE_NOT_FOUND", "Export file is not available.");
    }
    if (job.downloadToken !== token) {
      return sendError(res, 403, "EXPORT_DOWNLOAD_TOKEN_INVALID", "Export download token is invalid.");
    }
    if (job.downloadTokenExpiresAt && new Date(job.downloadTokenExpiresAt).getTime() < Date.now()) {
      return sendError(res, 410, "EXPORT_DOWNLOAD_TOKEN_EXPIRED", "Export download token has expired.");
    }
    const absolutePath = path.isAbsolute(job.filePath) ? job.filePath : path.join(process.cwd(), job.filePath);
    if (!fs.existsSync(absolutePath)) {
      return sendError(res, 404, "EXPORT_FILE_MISSING", "Export file could not be found.");
    }
    res.setHeader("Content-Type", job.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${job.fileName ?? `export-${job.id}`}"`);
    res.sendFile(absolutePath);
  });
}
