import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { getExportDatasetRegistry } from "../../services/export-registry";

const createSavedReportSchema = z.object({
  reportName: z.string().trim().min(1),
  dataset: z.string().trim().min(1),
  filters: z.record(z.unknown()).default({}),
  visibleColumns: z.array(z.string()).default([]),
  defaultFormat: z.enum(["csv", "excel", "pdf", "docx"]).default("csv"),
  sourcePage: z.string().trim().optional(),
});

function currentUserId(req: Request): number | null {
  const userId = Number((req as Request & { user?: { id?: number } }).user?.id);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

export function registerExportCenterRoutes(
  app: Express,
  auth: {
    ensureAuthenticated: RequestHandler;
  },
): void {
  app.get("/api/export-center/datasets", auth.ensureAuthenticated, (_req: Request, res: Response) => {
    res.json(getExportDatasetRegistry());
  });

  app.get("/api/export-center/history", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    const result = await pool.query(
      `
        SELECT
          id,
          dataset,
          format,
          status,
          file_name AS "fileName",
          file_size AS "fileSize",
          source_page AS "sourcePage",
          request_url AS "requestUrl",
          CASE WHEN user_id IS NULL THEN NULL ELSE CONCAT('User #', user_id) END AS "createdBy",
          created_at AS "createdAt"
        FROM export_history
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [getActiveOrganizationId()],
    );
    res.json(result.rows);
  });

  app.get("/api/export-center/saved-reports", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
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
    res.json(result.rows);
  });

  app.post("/api/export-center/saved-reports", auth.ensureAuthenticated, async (req: Request, res: Response) => {
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
    res.status(201).json(result.rows[0]);
  });
}
