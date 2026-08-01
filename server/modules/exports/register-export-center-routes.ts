import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { getExportDatasetRegistry } from "../../services/export-registry";
import { sendError, sendOk } from "../../api-response";
import { storage } from "../../storage";
import { createExportJob, getScopedExportJob, listExportJobs, refreshScopedExportDownloadToken, requeueExportJob } from "./export-jobs";
import { removeExportFile } from "./export-file-store";
import { exportRateLimiter } from "../../services/security-service";
import {
  getProcurementLineReportRows,
  type ProcurementLineReportFilters,
} from "../../services/procurement-line-report-service";
import { recordServerDiagnosticEvent } from "../../diagnostics/server-diagnostics-store";

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

const customPreviewSchema = z.object({
  dataset: z.string().trim().min(1),
  columns: z.array(z.string().trim().min(1)).max(30).optional(),
  filters: z.record(z.unknown()).default({}),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const customExportSchema = customPreviewSchema.extend({
  reportName: z.string().trim().min(1).max(120).default("custom-report"),
  format: z.enum(["csv"]).default("csv"),
});

const reportsPreviewSchema = customPreviewSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: z.string().trim().max(80).optional(),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
});

function currentUserId(req: Request): number | null {
  const userId = Number((req as Request & { user?: { id?: number } }).user?.id);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

function withDownloadUrl(row: Awaited<ReturnType<typeof listExportJobs>>[number]) {
  let error: { code: string; message: string; hint?: string; requestId?: string | null } | null = null;
  if (row.lastError) {
    try {
      const parsed = JSON.parse(row.lastError) as Record<string, unknown>;
      error = {
        code: typeof parsed.code === "string" ? parsed.code : "EXPORT_GENERATION_FAILED",
        message: typeof parsed.message === "string" ? parsed.message : row.lastError,
        hint: typeof parsed.hint === "string" ? parsed.hint : undefined,
        requestId: typeof parsed.requestId === "string" ? parsed.requestId : null,
      };
    } catch {
      error = {
        code: "EXPORT_GENERATION_FAILED",
        message: row.lastError,
        hint: "Retry the export. If it fails again, review System Diagnostics.",
      };
    }
  }
  return {
    ...row,
    error,
    createdBy: row.createdBy ? `User #${row.createdBy}` : null,
    downloadUrl:
      row.status === "succeeded" && row.downloadToken && (!row.downloadTokenExpiresAt || new Date(row.downloadTokenExpiresAt).getTime() > Date.now())
        ? `/api/export/download/${row.id}?token=${encodeURIComponent(row.downloadToken)}`
        : null,
    canRetry: row.status === "failed",
  };
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toCsv(columns: string[], rows: Array<Record<string, unknown>>): Buffer {
  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ];
  return Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
}

function safeFileStem(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

function zodFieldIssues(error: unknown): Record<string, string[]> | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  return Object.fromEntries(
    Object.entries(error.flatten().fieldErrors).filter(
      (entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0,
    ),
  );
}

function procurementFilters(filters: Record<string, unknown> = {}): ProcurementLineReportFilters {
  const numberOrNull = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const stringOrNull = (value: unknown) => {
    const parsed = typeof value === "string" ? value.trim() : "";
    return parsed && parsed.toLowerCase() !== "all" ? parsed : null;
  };
  return {
    documentNumber: stringOrNull(filters.documentNumber ?? filters.q),
    supplierId: numberOrNull(filters.supplierId),
    projectId: numberOrNull(filters.projectId),
    status: stringOrNull(filters.status),
    startDate: stringOrNull(filters.startDate ?? filters.fromDate),
    endDate: stringOrNull(filters.endDate ?? filters.toDate),
  };
}

async function buildCustomDatasetRows(
  dataset: string,
  limit: number,
  offset = 0,
  filters: Record<string, unknown> = {},
): Promise<Array<Record<string, unknown>>> {
  const orgId = getActiveOrganizationId();
  if (dataset === "inventory") {
    const categories = await storage.getAllCategories();
    const categoryById = new Map(categories.map((category) => [category.id, category.name]));
    return (await storage.getAllInventoryItems()).slice(offset, offset + limit).map((item) => ({
      ...item,
      categoryName: item.categoryId != null ? categoryById.get(item.categoryId) ?? "" : "",
    }));
  }
  if (dataset === "suppliers") {
    return (await storage.getAllSuppliers()).slice(offset, offset + limit);
  }
  if (dataset === "purchase_orders") {
    return getProcurementLineReportRows({
      organizationId: orgId,
      dataset,
      filters: procurementFilters(filters),
      limit,
      offset,
    });
  }
  if (dataset === "purchase_requisitions") {
    return getProcurementLineReportRows({
      organizationId: orgId,
      dataset,
      filters: procurementFilters(filters),
      limit,
      offset,
    });
  }
  if (dataset === "reorder_requests") {
    const items = await storage.getAllInventoryItems();
    const itemById = new Map(items.map((item) => [item.id, item.name]));
    const suppliers = await storage.getAllSuppliers();
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
    const warehouses = await storage.getAllWarehouses();
    const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));
    return (await storage.getAllReorderRequests()).slice(offset, offset + limit).map((request) => ({
      ...request,
      itemName: itemById.get(request.itemId) ?? "",
      supplierName: request.supplierId != null ? supplierById.get(request.supplierId) ?? "" : "",
      warehouseName: request.warehouseId != null ? warehouseById.get(request.warehouseId) ?? "" : "",
    }));
  }
  if (dataset === "invoices") {
    const suppliers = await storage.getAllSuppliers();
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
    return (await storage.getAllInvoices()).slice(offset, offset + limit).map((invoice) => ({
      ...invoice,
      supplierName: invoice.supplierId != null ? supplierById.get(invoice.supplierId) ?? "" : "",
    }));
  }
  if (dataset === "activity_logs") {
    const users = await storage.getAllUsers();
    const userById = new Map(users.map((user) => [user.id, user.fullName || user.username || `User #${user.id}`]));
    return (await storage.getAllActivityLogs()).slice(offset, offset + limit).map((log) => ({
      ...log,
      userName: log.userId != null ? userById.get(log.userId) ?? "" : "",
    }));
  }
  if (dataset === "shipments") {
    const result = await pool.query(
      `
        SELECT
          shipment.po_number AS "poNumber",
          shipment.carrier AS "carrier",
          shipment.status AS "status",
          shipment.eta AS "eta",
          COALESCE(shipment.tracking_number, '') AS "trackingNumber",
          CASE WHEN shipment.eta IS NOT NULL AND shipment.eta < NOW() AND shipment.status NOT IN ('delivered', 'received') THEN 'Yes' ELSE 'No' END AS "lateRisk"
        FROM shipments shipment
        LEFT JOIN purchase_orders po
          ON po.order_number = shipment.po_number
        WHERE po.organization_id = $1
        ORDER BY shipment.updated_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
      `,
      [orgId, limit, offset],
    );
    return result.rows;
  }
  if (dataset === "po_delivery_comparison") {
    const result = await pool.query(
      `
        SELECT
          po.order_number AS "poNumber",
          COALESCE(supplier.name, '') AS "supplierName",
          po.status AS "poStatus",
          COALESCE(shipment.status, 'NO_DELIVERY') AS "shipmentStatus",
          shipment.eta AS "eta",
          COALESCE(shipment.tracking_number, '') AS "trackingNumber",
          CASE
            WHEN shipment.id IS NULL THEN 'No delivery record'
            WHEN shipment.status IN ('delivered', 'received') THEN 'Delivered'
            WHEN shipment.eta IS NULL THEN 'Delivery has no ETA'
            WHEN shipment.eta < NOW() THEN 'Delivery late'
            ELSE 'Delivery pending'
          END AS "deliveryGap"
        FROM purchase_orders po
        LEFT JOIN suppliers supplier
          ON supplier.id = po.supplier_id
         AND supplier.organization_id = po.organization_id
        LEFT JOIN shipments shipment
          ON shipment.po_number = po.order_number
        WHERE po.organization_id = $1
        ORDER BY po.created_at DESC, shipment.updated_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
      `,
      [orgId, limit, offset],
    );
    return result.rows;
  }
  throw new Error(`Unsupported custom preview dataset: ${dataset}`);
}

export function registerExportCenterRoutes(
  app: Express,
  auth: {
    ensureAuthenticated: RequestHandler;
    ensurePermission: (resource: string, permissionType: string) => RequestHandler;
  },
): void {
  const exportAccess = [auth.ensureAuthenticated, auth.ensurePermission("reports", "export")];
  const reportPreviewAccess = [auth.ensureAuthenticated, auth.ensurePermission("reports", "read")];

  app.get("/api/export-center/datasets", ...reportPreviewAccess, (_req: Request, res: Response) => {
    sendOk(res, getExportDatasetRegistry());
  });

  app.post("/api/export-center/custom-preview", ...reportPreviewAccess, async (req: Request, res: Response) => {
    try {
      const parsed = customPreviewSchema.parse(req.body);
      const registry = getExportDatasetRegistry();
      const entry = registry.find((item) => item.key === parsed.dataset);
      if (!entry?.previewable) {
        return sendError(res, 400, "REPORT_DATASET_NOT_PREVIEWABLE", "This dataset cannot be previewed.");
      }
      const defaultColumns = entry.columns.map((column) => column.key);
      const requestedColumns = parsed.columns?.length ? parsed.columns : defaultColumns;
      const allowed = new Set(defaultColumns);
      const columns = requestedColumns.filter((column) => allowed.has(column));
      if (columns.length === 0) {
        return sendError(res, 400, "REPORT_COLUMNS_INVALID", "Select at least one valid column.");
      }
      const rows = await buildCustomDatasetRows(parsed.dataset, parsed.limit, 0, parsed.filters);
      sendOk(res, {
        dataset: parsed.dataset,
        label: entry.label,
        columns: entry.columns.filter((column) => columns.includes(column.key)),
        rows: rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""]))),
        rowCount: rows.length,
        previewLimit: parsed.limit,
      });
    } catch (error) {
      const fieldIssues = zodFieldIssues(error);
      sendError(res, 400, "CUSTOM_REPORT_PREVIEW_FAILED", "The custom report preview could not be generated.", {
        hint: "Review the selected dataset and columns, then retry.",
        fieldIssues,
      });
    }
  });

  app.post("/api/reports/preview", ...reportPreviewAccess, async (req: Request, res: Response) => {
    try {
      const parsed = reportsPreviewSchema.parse(req.body);
      const entry = getExportDatasetRegistry().find((item) => item.key === parsed.dataset);
      if (!entry?.previewable) {
        return sendError(res, 400, "REPORT_DATASET_NOT_PREVIEWABLE", "This dataset cannot be previewed.");
      }
      const allowedColumns = new Map(entry.columns.map((column) => [column.key, column]));
      const selectedKeys = (parsed.columns?.length ? parsed.columns : entry.columns.map((column) => column.key)).filter(
        (column) => allowedColumns.has(column),
      );
      if (selectedKeys.length === 0) {
        return sendError(res, 400, "REPORT_COLUMNS_INVALID", "Select at least one valid column.");
      }
      const offset = (parsed.page - 1) * parsed.pageSize;
      const shouldSortBeforePaging = Boolean(parsed.sortBy && selectedKeys.includes(parsed.sortBy));
      const fetched = await buildCustomDatasetRows(
        parsed.dataset,
        shouldSortBeforePaging ? 10_000 : parsed.pageSize + 1,
        shouldSortBeforePaging ? 0 : offset,
        parsed.filters,
      );
      const sorted = [...fetched];
      if (shouldSortBeforePaging && parsed.sortBy) {
        sorted.sort((left, right) => {
          const leftMissingLines = left.dataQualityStatus === "DOCUMENT_HAS_NO_LINES";
          const rightMissingLines = right.dataQualityStatus === "DOCUMENT_HAS_NO_LINES";
          if (leftMissingLines !== rightMissingLines) {
            return leftMissingLines ? -1 : 1;
          }
          const result = String(left[parsed.sortBy!] ?? "").localeCompare(String(right[parsed.sortBy!] ?? ""), undefined, {
            numeric: true,
          });
          return parsed.sortDirection === "desc" ? -result : result;
        });
      }
      const windowed = shouldSortBeforePaging ? sorted.slice(offset, offset + parsed.pageSize + 1) : sorted;
      const hasNext = windowed.length > parsed.pageSize;
      const rows = windowed.slice(0, parsed.pageSize);
      return sendOk(res, {
        dataset: parsed.dataset,
        label: entry.label,
        columns: selectedKeys.map((key) => allowedColumns.get(key)),
        rows: rows.map((row) => ({
          ...row,
          ...Object.fromEntries(selectedKeys.map((key) => [key, row[key] ?? ""])),
        })),
        page: parsed.page,
        pageSize: parsed.pageSize,
        hasNext,
        resultCount: rows.length,
        appliedFilters: parsed.filters,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const fieldIssues = zodFieldIssues(error);
      return sendError(res, 400, "REPORT_PREVIEW_FAILED", "The report preview could not be generated.", {
        hint: "Review the selected dataset, columns, filters, and sort options, then retry.",
        fieldIssues,
      });
    }
  });

  app.post("/api/export-center/custom-export", ...exportAccess, exportRateLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = customExportSchema.parse(req.body);
      const registry = getExportDatasetRegistry();
      const entry = registry.find((item) => item.key === parsed.dataset);
      if (!entry?.previewable) {
        return sendError(res, 400, "REPORT_DATASET_NOT_EXPORTABLE", "This dataset cannot be exported.");
      }
      const defaultColumns = entry.columns.map((column) => column.key);
      const requestedColumns = parsed.columns?.length ? parsed.columns : defaultColumns;
      const allowed = new Set(defaultColumns);
      const columns = requestedColumns.filter((column) => allowed.has(column));
      if (columns.length === 0) {
        return sendError(res, 400, "REPORT_COLUMNS_INVALID", "Select at least one valid column.");
      }
      const rows = await buildCustomDatasetRows(parsed.dataset, 10_000, 0, parsed.filters);
      const visibleRows = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])));
      const csv = toCsv(columns, visibleRows);
      const compressed = gzipSync(csv, { level: 9 });
      const fileName = `${safeFileStem(parsed.reportName)}.csv.gz`;
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("X-Export-Format", "csv.gz");
      res.setHeader("X-Export-Row-Count", String(visibleRows.length));
      res.setHeader("X-Export-Uncompressed-Bytes", String(csv.length));
      res.setHeader("X-Export-Compressed-Bytes", String(compressed.length));
      res.send(compressed);
    } catch (error) {
      const fieldIssues = zodFieldIssues(error);
      sendError(res, 400, "CUSTOM_REPORT_EXPORT_FAILED", "The custom report could not be exported.", {
        hint: "Review the report definition and retry. If it fails again, use the request ID in System Diagnostics.",
        fieldIssues,
      });
    }
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

  app.post("/api/export-jobs/:id/download-token", ...exportAccess, exportRateLimiter, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return sendError(res, 400, "INVALID_EXPORT_JOB_ID", "Invalid export job id.");
    const refreshed = await refreshScopedExportDownloadToken(id);
    if (!refreshed?.downloadToken) {
      return sendError(res, 410, "EXPORT_FILE_RETENTION_EXPIRED", "The retained export is no longer available.", {
        hint: "Run the export again from Reports or Export Center.",
      });
    }
    return sendOk(res, {
      jobId: refreshed.id,
      fileName: refreshed.fileName,
      downloadUrl: `/api/export/download/${refreshed.id}?token=${encodeURIComponent(refreshed.downloadToken)}`,
      expiresAt: refreshed.downloadTokenExpiresAt,
    });
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
      recordServerDiagnosticEvent({
        source: "integration",
        severity: "warning",
        title: "Export download token expired",
        message: `Export download token expired for job ${job.id}`,
        route: req.originalUrl,
        details: { jobId: job.id, dataset: job.dataset, format: job.format, remediation: "Issue a fresh scoped token from Export Center." },
      });
      if (req.accepts(["html", "json"]) === "html") {
        return res.redirect(303, `/analytics/export-center?download=expired&job=${job.id}`);
      }
      return sendError(res, 410, "EXPORT_DOWNLOAD_TOKEN_EXPIRED", "Export download token has expired.", {
        hint: "Request a new download token from Export Center.",
      });
    }
    const absolutePath = path.isAbsolute(job.filePath) ? job.filePath : path.join(process.cwd(), job.filePath);
    if (!fs.existsSync(absolutePath)) {
      return sendError(res, 404, "EXPORT_FILE_MISSING", "Export file could not be found.");
    }
    res.setHeader("Content-Type", job.mimeType ?? "application/octet-stream");
    if (job.fileName?.endsWith(".gz") || job.mimeType === "application/gzip") {
      res.setHeader("X-Export-Compressed", "true");
    }
    res.setHeader("Content-Disposition", `attachment; filename="${job.fileName ?? `export-${job.id}`}"`);
    res.sendFile(absolutePath);
  });
}
