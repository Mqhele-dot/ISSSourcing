import type { Express, Request, RequestHandler, Response } from "express";
import { z, ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import {
  insertApInvoiceCaptureSchema,
  insertApReceiptItemSchema,
  insertApReceiptSchema,
  insertPaymentSchema,
} from "@shared/schema";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId } from "../../organization-context";
import { generateGenericPdf } from "../../services/document-generator-service";
import { pool } from "../../db";
import { incrementMetric } from "../../observability/metrics";
import { storage } from "../../storage";
import { resolveRequestActor } from "../../auth/request-user";
import { parseApprovalContext, parseInvoiceFilters } from "./ap-route-adapters";
import {
  addInvoiceItemRecord,
  ApStructuredError,
  approveInvoice,
  approvePaymentBatch,
  createCapture,
  createInvoiceRecord,
  createPaymentBatchRecord,
  createPaymentRecord,
  createReceiptRecord,
  deleteInvoiceItemRecord,
  deleteInvoiceRecord,
  deletePaymentRecord,
  evaluateInvoiceMatch,
  getInvoiceDetail,
  getOverview,
  listApprovalQueue,
  listCaptures,
  listExceptions,
  listInvoiceItems,
  listInvoices,
  listPaymentBatches,
  listPayments,
  listReceipts,
  previewInvoiceApprovers,
  promoteCapture,
  rejectInvoice,
  releasePaymentBatch,
  submitInvoiceForApproval,
  updateInvoiceItemRecord,
  updateInvoiceRecord,
  updateInvoiceStatus,
  updatePaymentRecord,
  withdrawInvoiceFromApproval,
} from "./service";
import { trySendDbConstraintError } from "./ap-db-errors";
import {
  apApprovalActionBodySchema,
  apInvoiceMatchBodySchema,
  apPaymentBatchCreateSchema,
  apPromoteCaptureBodySchema,
  legacyInvoiceItemCreateSchema,
  legacyInvoiceItemPatchSchema,
  parseRouteId,
} from "./ap-route-validation";

function sendApStructuredError(res: Response, error: unknown) {
  if (error instanceof ApStructuredError) {
    return sendError(res, error.status, error.code, error.message, {
      hint: error.hint,
      details: error.details,
    });
  }
  return null;
}

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
  ensureTwoFactorAuthenticated: RequestHandler;
};

function requestActor(req: Request) {
  return resolveRequestActor(req);
}

function recordApprovalFailure() {
  incrementMetric("ap.approval.failures");
}

function recordReleaseFailure() {
  incrementMetric("ap.release.failures");
}

function logApFinanceEvent(event: string, payload: Record<string, unknown>) {
  console.info(JSON.stringify({ event, organizationId: getActiveOrganizationId(), ...payload }));
}

const apPageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value), "pageSize must be 25, 50, or 100").default(25),
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const paymentBatchPageSchema = apPageSchema.extend({
  sort: z.enum(["created_desc", "created_asc", "number_asc", "number_desc", "amount_desc", "amount_asc"]).default("created_desc"),
});

const invoicePageSchema = apPageSchema.extend({
  supplierId: z.coerce.number().int().positive().optional(),
  eligibility: z.enum(["all", "payable"]).default("all"),
  sort: z.enum(["created_desc", "created_asc", "number_asc", "number_desc", "due_asc", "due_desc", "amount_desc", "amount_asc"]).default("created_desc"),
});

const capturePageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value), "pageSize must be 25, 50, or 100").default(25),
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  sort: z.enum(["created_desc", "created_asc", "number_asc", "number_desc"]).default("created_desc"),
});

type DbRow = Record<string, unknown>;

function finiteNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function apInvoiceListDto(row: DbRow) {
  const id = positiveInteger(row.id);
  if (id === null) throw new Error("Invalid AP invoice identifier returned by the database");
  const total = finiteNumber(row.total);
  return {
    id,
    invoiceNumber: typeof row.invoice_number === "string" && row.invoice_number.trim() ? row.invoice_number : null,
    supplierId: positiveInteger(row.supplier_id),
    supplierName: typeof row.supplierName === "string" ? row.supplierName : null,
    status: typeof row.status === "string" ? row.status : "UNKNOWN",
    issueDate: isoDate(row.issue_date),
    dueDate: isoDate(row.due_date),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    total,
    totalAmount: total,
    dueAmount: finiteNumber(row.due_amount),
    purchaseOrderId: positiveInteger(row.purchase_order_id),
    latestMatchResult: row.latestMatchResult && typeof row.latestMatchResult === "object" ? row.latestMatchResult : null,
  };
}

function apPaymentBatchDto(row: DbRow) {
  const id = positiveInteger(row.id);
  if (id === null) throw new Error("Invalid AP payment batch identifier returned by the database");
  return {
    id,
    batchNumber: typeof row.batch_number === "string" && row.batch_number.trim() ? row.batch_number : `Batch #${id}`,
    status: typeof row.status === "string" ? row.status : "UNKNOWN",
    scheduledDate: isoDate(row.scheduled_date),
    approvedAt: isoDate(row.approved_at),
    releasedAt: isoDate(row.released_at),
    totalAmount: finiteNumber(row.total_amount, 0) ?? 0,
    paymentMethod: typeof row.payment_method === "string" ? row.payment_method : null,
    itemCount: Math.max(0, Math.trunc(finiteNumber(row.itemCount, 0) ?? 0)),
    createdBy: positiveInteger(row.created_by),
    approvedBy: positiveInteger(row.approved_by),
    releasedBy: positiveInteger(row.released_by),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

function apCaptureDto(row: DbRow) {
  const id = positiveInteger(row.id);
  if (id === null) throw new Error("Invalid AP capture identifier returned by the database");
  return {
    id,
    source: typeof row.source === "string" ? row.source : "unknown",
    status: typeof row.status === "string" ? row.status : "UNKNOWN",
    supplierId: positiveInteger(row.supplier_id),
    supplierName: typeof row.supplierName === "string" ? row.supplierName : null,
    invoiceNumber: typeof row.invoice_number === "string" && row.invoice_number.trim() ? row.invoice_number : null,
    totalAmount: finiteNumber(row.total_amount),
    confidenceScore: finiteNumber(row.confidence_score),
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((entry): entry is string => typeof entry === "string") : [],
    promotedInvoiceId: positiveInteger(row.promoted_invoice_id),
    createdAt: isoDate(row.created_at),
  };
}

function invalidApQuery(res: Response, error: z.ZodError) {
  return sendError(res, 400, "INVALID_QUERY", "Invalid pagination, filter, or sort value", {
    details: error.flatten(),
  });
}

/** Maps enforceApprovalPolicy / segregation errors to client-facing HTTP status (not 500). */
function apPolicyHttpStatus(message: string): { status: 400 | 403; code: string } | null {
  if (/Approval policy references an invalid approver user/i.test(message)) {
    return { status: 403, code: "AP_APPROVAL_POLICY_INVALID_APPROVER" };
  }
  if (/No active approval policy found/i.test(message)) {
    return { status: 400, code: "AP_APPROVAL_POLICY_NOT_FOUND" };
  }
  if (/This action requires the configured approver user/i.test(message)) {
    return { status: 403, code: "AP_APPROVAL_WRONG_USER" };
  }
  if (/Your role is not allowed by the active approval policy/i.test(message)) {
    return { status: 403, code: "AP_APPROVAL_ROLE_BLOCKED" };
  }
  if (/Approver user is not valid/i.test(message)) {
    return { status: 403, code: "AP_APPROVAL_ACTOR_INVALID" };
  }
  return null;
}

function paymentBatchReleaseHttpStatus(message: string): { status: 400 | 403 | 409; code: string } | null {
  const policyErr = apPolicyHttpStatus(message);
  if (policyErr) return policyErr;
  if (/Batch creator cannot approve or release their own batch/i.test(message)) {
    return { status: 403, code: "PAYMENT_BATCH_SELF_APPROVAL_BLOCKED" };
  }
  if (/Batch releaser cannot release a batch containing only invoices they approved/i.test(message)) {
    return { status: 403, code: "PAYMENT_BATCH_RELEASE_SEGREGATION_BLOCKED" };
  }
  if (/Illegal payment batch transition from .* to RELEASED\./i.test(message)) {
    return { status: 409, code: "PAYMENT_BATCH_RELEASE_INVALID_STATE" };
  }
  if (/no due balance remaining|exceeds remaining due|is no longer payable|no longer exists in active organization/i.test(message)) {
    return { status: 400, code: "PAYMENT_BATCH_RELEASE_INVOICE_INVALID" };
  }
  return null;
}

export function registerApRoutes(app: Express, auth: AuthBundle): void {
  const apRead = [auth.ensureAuthenticated];
  const apWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];
  const apHighRiskWrite = [auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensureRole(["admin"])];
  const apHighRiskManagerWrite = [auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensureRole(["manager", "admin"])];

  app.get("/api/ap/overview", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await getOverview());
    } catch (error) {
      console.error("Error fetching AP overview:", error);
      return sendError(res, 500, "AP_OVERVIEW_FAILED", "Failed to fetch AP overview");
    }
  });

  app.get("/api/ap/approval-queue", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listApprovalQueue());
    } catch (error) {
      console.error("Error fetching AP approval queue:", error);
      return sendError(res, 500, "AP_APPROVAL_QUEUE_FAILED", "Failed to fetch AP approval queue");
    }
  });

  app.get("/api/ap/exceptions", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listExceptions());
    } catch (error) {
      console.error("Error fetching AP exceptions:", error);
      return sendError(res, 500, "AP_EXCEPTIONS_FAILED", "Failed to fetch AP exceptions");
    }
  });

  app.get("/api/ap/captures", ...apRead, async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      return sendOk(res, await listCaptures(status));
    } catch (error) {
      console.error("Error fetching AP captures:", error);
      return sendError(res, 500, "AP_CAPTURES_FAILED", "Failed to fetch AP captures");
    }
  });

  app.post("/api/ap/captures", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const payload = insertApInvoiceCaptureSchema.parse(req.body);
      return sendOk(res, await createCapture(payload, actor.userId), 201);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
          details: error.flatten(),
        });
      }
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to create AP capture");
      }
      console.error("Error creating AP capture:", error);
      return sendError(res, 500, "AP_CAPTURE_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create AP capture");
    }
  });

  /**
   * Promote a staged capture to a ledger invoice.
   * Response `data` is a full invoice (ledger) row or the existing promoted invoice — not an AP capture row.
   */
  app.post("/api/ap/captures/:id/promote", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "capture ID");
      if (id === null) return;
      let body: z.infer<typeof apPromoteCaptureBodySchema>;
      try {
        body = apPromoteCaptureBodySchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", fromZodError(err).message, { details: err.flatten() });
        }
        throw err;
      }
      const promoted = await promoteCapture(id, actor.userId, {
        overrideReason: body.overrideReason,
      });
      if (!promoted) return sendError(res, 404, "AP_CAPTURE_NOT_FOUND", "AP capture not found");
      return sendOk(res, promoted);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to promote AP capture");
      }
      console.error("Error promoting AP capture:", error);
      return sendError(res, 500, "AP_CAPTURE_PROMOTE_FAILED", error instanceof Error ? error.message : "Failed to promote AP capture");
    }
  });

  app.get("/api/v2/ap/captures", ...apRead, async (req: Request, res: Response) => {
    const parsed = capturePageSchema.safeParse(req.query);
    if (!parsed.success) return invalidApQuery(res, parsed.error);
    const query = parsed.data;
    const values: unknown[] = [getActiveOrganizationId()];
    const conditions = ["capture.organization_id = $1"];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };
    if (query.q) {
      values.push(query.q);
      conditions.push(`(capture.invoice_number ILIKE '%' || $${values.length} || '%' OR supplier.name ILIKE '%' || $${values.length} || '%' OR capture.source ILIKE '%' || $${values.length} || '%')`);
    }
    if (query.status && query.status.toLowerCase() !== "all") add("capture.status::text = ?", query.status.toUpperCase());
    if (query.supplierId) add("capture.supplier_id = ?", query.supplierId);
    const order = ({
      created_desc: "capture.created_at DESC, capture.id DESC",
      created_asc: "capture.created_at ASC, capture.id ASC",
      number_asc: "capture.invoice_number ASC NULLS LAST, capture.id ASC",
      number_desc: "capture.invoice_number DESC NULLS LAST, capture.id DESC",
    } as const)[query.sort];
    const where = conditions.join(" AND ");
    try {
      const totals = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM ap_invoice_captures capture
         LEFT JOIN suppliers supplier ON supplier.id = capture.supplier_id AND supplier.organization_id = capture.organization_id
         WHERE ${where}`,
        values,
      );
      const rows = await pool.query(
        `SELECT capture.*, supplier.name AS "supplierName"
         FROM ap_invoice_captures capture
         LEFT JOIN suppliers supplier ON supplier.id = capture.supplier_id AND supplier.organization_id = capture.organization_id
         WHERE ${where} ORDER BY ${order}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const total = Number(totals.rows[0]?.total ?? 0);
      return sendOk(res, {
        items: rows.rows.map(apCaptureDto),
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasNext: query.page * query.pageSize < total,
      });
    } catch (error) {
      return sendError(res, 500, "AP_CAPTURES_FETCH_FAILED", "Failed to fetch paginated captures", { details: String(error) });
    }
  });

  app.get("/api/ap/receipts", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listReceipts());
    } catch (error) {
      console.error("Error fetching AP receipts:", error);
      return sendError(res, 500, "AP_RECEIPTS_FAILED", "Failed to fetch AP receipts");
    }
  });

  app.post("/api/ap/receipts", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      const receipt = insertApReceiptSchema.parse(payload);
      const items = Array.isArray((payload as { items?: unknown[] }).items)
        ? (payload as { items: unknown[] }).items.map((item) => insertApReceiptItemSchema.parse(item))
        : [];
      const warehouseIdRaw = (payload as { warehouseId?: unknown; warehouse_id?: unknown }).warehouseId ??
        (payload as { warehouse_id?: unknown }).warehouse_id;
      const warehouseId =
        warehouseIdRaw != null && Number.isFinite(Number(warehouseIdRaw)) && Number(warehouseIdRaw) > 0
          ? Number(warehouseIdRaw)
          : null;
      const warehouseLocationRaw =
        (payload as { warehouseLocation?: unknown; warehouse_location?: unknown }).warehouseLocation ??
        (payload as { warehouse_location?: unknown }).warehouse_location;
      const warehouseLocation =
        typeof warehouseLocationRaw === "string" && warehouseLocationRaw.trim()
          ? warehouseLocationRaw.trim()
          : null;
      return sendOk(
        res,
        await createReceiptRecord(receipt, items, actor.userId, { warehouseId, warehouseLocation }),
        201,
      );
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
          details: error.flatten(),
        });
      }
      console.error("Error creating AP receipt:", error);
      return sendError(res, 500, "AP_RECEIPT_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create AP receipt");
    }
  });

  app.get("/api/v2/ap/invoices", ...apRead, async (req: Request, res: Response) => {
    const parsed = invoicePageSchema.safeParse(req.query);
    if (!parsed.success) return invalidApQuery(res, parsed.error);
    const query = parsed.data;
    if (query.from && query.to && query.from > query.to) {
      return sendError(res, 400, "INVALID_QUERY", "from must be earlier than or equal to to");
    }
    const values: unknown[] = [getActiveOrganizationId()];
    const conditions = ["invoice.organization_id = $1"];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };
    if (query.q) {
      values.push(query.q);
      conditions.push(`(invoice.invoice_number ILIKE '%' || $${values.length} || '%' OR supplier.name ILIKE '%' || $${values.length} || '%')`);
    }
    if (query.status && query.status.toLowerCase() !== "all") add("invoice.status::text = ?", query.status.toUpperCase());
    if (query.supplierId) add("invoice.supplier_id = ?", query.supplierId);
    if (query.from) add("invoice.created_at >= ?", query.from);
    if (query.to) add("invoice.created_at <= ?", query.to);
    if (query.eligibility === "payable") {
      conditions.push("invoice.status::text IN ('APPROVED','PARTIALLY_PAID','OVERDUE')");
      conditions.push("COALESCE(invoice.due_amount, invoice.total, 0) > 0");
      conditions.push("(invoice.purchase_order_id IS NULL OR latest_match.status::text = 'MATCHED')");
    }
    const order = ({
      created_desc: "invoice.created_at DESC, invoice.id DESC",
      created_asc: "invoice.created_at ASC, invoice.id ASC",
      number_asc: "invoice.invoice_number ASC, invoice.id ASC",
      number_desc: "invoice.invoice_number DESC, invoice.id DESC",
      due_asc: "invoice.due_date ASC, invoice.id ASC",
      due_desc: "invoice.due_date DESC, invoice.id DESC",
      amount_desc: "COALESCE(invoice.due_amount, invoice.total, 0) DESC, invoice.id DESC",
      amount_asc: "COALESCE(invoice.due_amount, invoice.total, 0) ASC, invoice.id ASC",
    } as const)[query.sort];
    const where = conditions.join(" AND ");
    const offset = (query.page - 1) * query.pageSize;
    try {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(COALESCE(invoice.due_amount, invoice.total, 0)), 0)::float8 AS outstanding
         FROM invoices invoice
         LEFT JOIN suppliers supplier ON supplier.id = invoice.supplier_id AND supplier.organization_id = invoice.organization_id
         LEFT JOIN LATERAL (
           SELECT match.status FROM ap_invoice_match_results match
           WHERE match.organization_id = invoice.organization_id AND match.invoice_id = invoice.id
           ORDER BY match.created_at DESC, match.id DESC LIMIT 1
         ) latest_match ON true
         WHERE ${where}`,
        values,
      );
      const pageValues = [...values, query.pageSize, offset];
      const rows = await pool.query(
        `SELECT invoice.*,
                supplier.name AS "supplierName",
                CASE WHEN latest_match.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id', latest_match.id, 'status', latest_match.status, 'mismatchSummary', latest_match.mismatch_summary,
                  'updatedAt', latest_match.updated_at, 'createdAt', latest_match.created_at
                ) END AS "latestMatchResult"
         FROM invoices invoice
         LEFT JOIN suppliers supplier ON supplier.id = invoice.supplier_id AND supplier.organization_id = invoice.organization_id
         LEFT JOIN LATERAL (
           SELECT match.* FROM ap_invoice_match_results match
           WHERE match.organization_id = invoice.organization_id AND match.invoice_id = invoice.id
           ORDER BY match.created_at DESC, match.id DESC LIMIT 1
         ) latest_match ON true
         WHERE ${where}
         ORDER BY ${order}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        pageValues,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);
      return sendOk(res, {
        items: rows.rows.map(apInvoiceListDto),
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasNext: query.page * query.pageSize < total,
        summary: { outstandingAmount: Number(countResult.rows[0]?.outstanding ?? 0) },
      });
    } catch (error) {
      return sendError(res, 500, "AP_INVOICES_FETCH_FAILED", "Failed to fetch paginated invoices", { details: String(error) });
    }
  });

  app.get("/api/v2/ap/payment-batches", ...apRead, async (req: Request, res: Response) => {
    const parsed = paymentBatchPageSchema.safeParse(req.query);
    if (!parsed.success) return invalidApQuery(res, parsed.error);
    const query = parsed.data;
    if (query.from && query.to && query.from > query.to) return sendError(res, 400, "INVALID_QUERY", "from must be earlier than or equal to to");
    const values: unknown[] = [getActiveOrganizationId()];
    const conditions = ["batch.organization_id = $1"];
    const add = (sql: string, value: unknown) => { values.push(value); conditions.push(sql.replace("?", `$${values.length}`)); };
    if (query.q) add("batch.batch_number ILIKE '%' || ? || '%'", query.q);
    if (query.status && query.status.toLowerCase() !== "all") add("batch.status::text = ?", query.status.toUpperCase());
    if (query.from) add("batch.created_at >= ?", query.from);
    if (query.to) add("batch.created_at <= ?", query.to);
    const order = ({ created_desc: "batch.created_at DESC, batch.id DESC", created_asc: "batch.created_at ASC, batch.id ASC", number_asc: "batch.batch_number ASC, batch.id ASC", number_desc: "batch.batch_number DESC, batch.id DESC", amount_desc: "batch.total_amount DESC, batch.id DESC", amount_asc: "batch.total_amount ASC, batch.id ASC" } as const)[query.sort];
    const where = conditions.join(" AND ");
    try {
      const totals = await pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(batch.total_amount), 0)::float8 AS amount FROM ap_payment_batches batch WHERE ${where}`, values);
      const rows = await pool.query(
        `SELECT batch.*, COALESCE(items.item_count, 0)::int AS "itemCount"
         FROM ap_payment_batches batch
         LEFT JOIN LATERAL (SELECT COUNT(*)::int AS item_count FROM ap_payment_batch_items item WHERE item.batch_id = batch.id) items ON true
         WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const total = Number(totals.rows[0]?.total ?? 0);
      return sendOk(res, { items: rows.rows.map(apPaymentBatchDto), total, page: query.page, pageSize: query.pageSize, hasNext: query.page * query.pageSize < total, summary: { totalAmount: Number(totals.rows[0]?.amount ?? 0) } });
    } catch (error) {
      return sendError(res, 500, "PAYMENT_BATCHES_FETCH_FAILED", "Failed to fetch paginated payment batches", { details: String(error) });
    }
  });

  app.get("/api/v2/ap/payment-batches/:id", ...apRead, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_PAYMENT_BATCH_ID", "Payment batch ID must be a positive integer");
    const result = await pool.query(
      `SELECT batch.*, COALESCE(jsonb_agg(item ORDER BY item.id) FILTER (WHERE item.id IS NOT NULL), '[]'::jsonb) AS items
       FROM ap_payment_batches batch LEFT JOIN ap_payment_batch_items item ON item.batch_id = batch.id
       WHERE batch.id = $1 AND batch.organization_id = $2 GROUP BY batch.id`,
      [id, getActiveOrganizationId()],
    );
    if (!result.rows[0]) return sendError(res, 404, "PAYMENT_BATCH_NOT_FOUND", "Payment batch not found");
    const row = result.rows[0] as DbRow;
    return sendOk(res, {
      ...apPaymentBatchDto({ ...row, itemCount: Array.isArray(row.items) ? row.items.length : 0 }),
      items: Array.isArray(row.items)
        ? row.items.map((item) => {
            const entry = item as DbRow;
            return {
              id: positiveInteger(entry.id),
              invoiceId: positiveInteger(entry.invoice_id),
              amount: finiteNumber(entry.amount, 0) ?? 0,
              status: typeof entry.status === "string" ? entry.status : "UNKNOWN",
            };
          })
        : [],
    });
  });

  app.get("/api/ap/invoices", ...apRead, async (req: Request, res: Response) => {
    try {
      return sendOk(res, await listInvoices(parseInvoiceFilters(req)));
    } catch (error) {
      console.error("Error fetching AP invoices:", error);
      return sendError(res, 500, "FETCH_INVOICES_FAILED", "Failed to fetch invoices");
    }
  });

  app.get("/api/ap/invoices/:id", ...apRead, async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const invoice = await getInvoiceDetail(id);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      console.error("Error fetching AP invoice:", error);
      return sendError(res, 500, "FETCH_INVOICE_FAILED", "Failed to fetch invoice");
    }
  });

  app.post("/api/ap/invoices", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      return sendOk(res, await createInvoiceRecord(req.body, actor.userId), 201);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to create invoice");
      }
      console.error("Error creating AP invoice:", error);
      return sendError(res, 400, "CREATE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to create invoice");
    }
  });

  app.patch("/api/ap/invoices/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const invoice = await updateInvoiceRecord(id, req.body, actor.userId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to update invoice");
      }
      console.error("Error updating AP invoice:", error);
      return sendError(res, 500, "UPDATE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to update invoice");
    }
  });

  app.delete("/api/ap/invoices/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const deleted = await deleteInvoiceRecord(id);
      if (!deleted) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, { success: true });
    } catch (error) {
      if (trySendDbConstraintError(res, error)) return;
      console.error("Error deleting AP invoice:", error);
      return sendError(res, 400, "DELETE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to delete invoice");
    }
  });

  app.post("/api/ap/invoices/:id/match", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      let matchOpts: z.infer<typeof apInvoiceMatchBodySchema>;
      try {
        matchOpts = apInvoiceMatchBodySchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", fromZodError(err).message, { details: err.flatten() });
        }
        throw err;
      }
      const result = await evaluateInvoiceMatch(id, matchOpts, actor.userId);
      if (!result) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, result);
    } catch (error) {
      console.error("Error matching AP invoice:", error);
      const structured = sendApStructuredError(res, error);
      if (structured) return structured;
      return sendError(res, 400, "INVOICE_MATCH_FAILED", error instanceof Error ? error.message : "Failed to run invoice match");
    }
  });

  app.get("/api/ap/invoices/:id/approval-preview", ...apRead, async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const preview = await previewInvoiceApprovers(id);
      if (!preview) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, preview);
    } catch (error) {
      console.error("Error previewing invoice approvers:", error);
      return sendError(res, 500, "INVOICE_APPROVAL_PREVIEW_FAILED", "Failed to preview invoice approvers");
    }
  });

  app.post("/api/ap/invoices/:id/submit-approval", ...apHighRiskWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const invoice = await submitInvoiceForApproval(id, actor.userId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      console.error("Error submitting invoice for approval:", error);
      const structured = sendApStructuredError(res, error);
      if (structured) return structured;
      const message = error instanceof Error ? error.message : "Failed to submit invoice for approval";
      const clientError =
        /must be matched|unresolved matching exceptions|not linked to a purchase order|Linked purchase order not found|Invoice is not linked/i.test(
          message,
        );
      return sendError(res, clientError ? 400 : 500, "INVOICE_SUBMIT_APPROVAL_FAILED", message);
    }
  });

  app.post("/api/ap/invoices/:id/approve", ...apHighRiskWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const body = apApprovalActionBodySchema.parse(req.body ?? {});
      req.body = body;
      const invoice = await approveInvoice(
        id,
        actor.userId,
        body.comment,
        parseApprovalContext(req, actor.role),
      );
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      recordApprovalFailure();
      console.error("Error approving invoice:", error);
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, { details: error.flatten() });
      }
      const message = error instanceof Error ? error.message : "Failed to approve invoice";
      const policyErr = apPolicyHttpStatus(message);
      if (policyErr) {
        return sendError(res, policyErr.status, policyErr.code, message);
      }
      if (/Invoice creator cannot approve their own invoice/i.test(message)) {
        return sendError(res, 403, "INVOICE_SELF_APPROVAL_BLOCKED", message);
      }
      if (/Invoice must be PENDING_APPROVAL/i.test(message)) {
        return sendError(res, 400, "INVOICE_APPROVE_INVALID_STATE", message);
      }
      return sendError(res, 500, "INVOICE_APPROVE_FAILED", message);
    }
  });

  app.post("/api/ap/invoices/:id/reject", ...apHighRiskWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const body = apApprovalActionBodySchema.parse(req.body ?? {});
      req.body = body;
      const invoice = await rejectInvoice(
        id,
        actor.userId,
        body.comment,
        parseApprovalContext(req, actor.role),
      );
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      recordApprovalFailure();
      console.error("Error rejecting invoice:", error);
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, { details: error.flatten() });
      }
      const message = error instanceof Error ? error.message : "Failed to reject invoice";
      const policyErr = apPolicyHttpStatus(message);
      if (policyErr) {
        return sendError(res, policyErr.status, policyErr.code, message);
      }
      if (/Invoice must be PENDING_APPROVAL/i.test(message)) {
        return sendError(res, 400, "INVOICE_REJECT_INVALID_STATE", message);
      }
      return sendError(res, 500, "INVOICE_REJECT_FAILED", message);
    }
  });

  app.post("/api/ap/invoices/:id/withdraw-approval", ...apHighRiskWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const comment = typeof req.body?.comment === "string" ? req.body.comment : undefined;
      const invoice = await withdrawInvoiceFromApproval(id, actor.userId, comment);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      console.error("Error withdrawing invoice from approval:", error);
      const message = error instanceof Error ? error.message : "Failed to withdraw invoice";
      if (/must be PENDING_APPROVAL/i.test(message)) {
        return sendError(res, 400, "INVOICE_WITHDRAW_INVALID_STATE", message);
      }
      return sendError(res, 500, "INVOICE_WITHDRAW_FAILED", message);
    }
  });

  app.get("/api/ap/payment-batches", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listPaymentBatches());
    } catch (error) {
      console.error("Error fetching payment batches:", error);
      return sendError(res, 500, "PAYMENT_BATCHES_FAILED", "Failed to fetch payment batches");
    }
  });

  app.post("/api/ap/payment-batches", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      let validated: z.infer<typeof apPaymentBatchCreateSchema>;
      try {
        validated = apPaymentBatchCreateSchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", fromZodError(err).message, { details: err.flatten() });
        }
        throw err;
      }
      let scheduledDate: Date | undefined;
      if (validated.scheduledDate) {
        const d = new Date(validated.scheduledDate);
        if (Number.isNaN(d.getTime())) {
          return sendError(res, 400, "VALIDATION_ERROR", "scheduledDate must be a valid date or ISO string.");
        }
        scheduledDate = d;
      }
      const exportMetadata =
        validated.exportMetadata != null && typeof validated.exportMetadata === "object" && !Array.isArray(validated.exportMetadata)
          ? (validated.exportMetadata as Record<string, unknown>)
          : undefined;
      const batch = await createPaymentBatchRecord(
        {
          batchNumber: validated.batchNumber,
          status: validated.status as never,
          scheduledDate,
          paymentMethod: validated.paymentMethod,
          exportMetadata,
          notes: validated.notes,
          invoiceIds: validated.invoiceIds,
        },
        actor.userId,
      );
      logApFinanceEvent("ap.payment_batch.created", {
        batchId: batch.id,
        userId: actor.userId,
        invoiceCount: validated.invoiceIds.length,
      });
      return sendOk(res, batch, 201);
    } catch (error) {
      console.error("Error creating payment batch:", error);
      return sendError(res, 400, "PAYMENT_BATCH_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create payment batch");
    }
  });

  app.post("/api/ap/payment-batches/:id/approve", ...apHighRiskManagerWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "batch ID");
      if (id === null) return;
      const body = apApprovalActionBodySchema.parse(req.body ?? {});
      req.body = body;
      const batch = await approvePaymentBatch(
        id,
        actor.userId,
        body.comment,
        parseApprovalContext(req, actor.role),
      );
      if (!batch) return sendError(res, 404, "PAYMENT_BATCH_NOT_FOUND", "Payment batch not found");
      logApFinanceEvent("ap.payment_batch.approved", { batchId: batch.id, userId: actor.userId });
      return sendOk(res, batch);
    } catch (error) {
      recordApprovalFailure();
      console.error("Error approving payment batch:", error);
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, { details: error.flatten() });
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Batch creator cannot approve or release their own batch")) {
        return sendError(res, 403, "PAYMENT_BATCH_SELF_APPROVAL_BLOCKED", msg, {
          hint: "Use another approver or submit an admin override with overrideReason on this request.",
        });
      }
      const policyErr = apPolicyHttpStatus(msg);
      if (policyErr) {
        return sendError(res, policyErr.status, policyErr.code, msg);
      }
      return sendError(
        res,
        500,
        "PAYMENT_BATCH_APPROVE_FAILED",
        error instanceof Error ? error.message : "Failed to approve payment batch",
      );
    }
  });

  app.post("/api/ap/payment-batches/:id/release", ...apHighRiskManagerWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const id = parseRouteId(res, req.params.id, "batch ID");
      if (id === null) return;
      const body = apApprovalActionBodySchema.parse(req.body ?? {});
      req.body = body;
      const batch = await releasePaymentBatch(id, actor.userId, parseApprovalContext(req, actor.role));
      if (!batch) return sendError(res, 404, "PAYMENT_BATCH_NOT_FOUND", "Payment batch not found");
      logApFinanceEvent("ap.payment_batch.released", { batchId: batch.id, userId: actor.userId });
      return sendOk(res, batch);
    } catch (error) {
      recordReleaseFailure();
      console.error("Error releasing payment batch:", error);
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, { details: error.flatten() });
      }
      const msg = error instanceof Error ? error.message : String(error);
      const mapped = paymentBatchReleaseHttpStatus(msg);
      if (mapped) {
        const hint =
          mapped.code === "PAYMENT_BATCH_SELF_APPROVAL_BLOCKED"
            ? "Use another approver or submit an admin override with overrideReason on this request."
            : mapped.code === "PAYMENT_BATCH_RELEASE_SEGREGATION_BLOCKED"
              ? "Segregation of duties requires a different releaser or an explicit admin override."
              : undefined;
        return sendError(res, mapped.status, mapped.code, msg, hint ? { hint } : undefined);
      }
      return sendError(res, 400, "PAYMENT_BATCH_RELEASE_FAILED", msg || "Failed to release payment batch");
    }
  });

  // Legacy compatibility routes
  app.get("/api/invoices", ...apRead, async (req: Request, res: Response) => {
    req.url = `/api/ap/invoices?${new URLSearchParams(req.query as Record<string, string>).toString()}`;
    return sendOk(res, await listInvoices(parseInvoiceFilters(req)));
  });

  app.get("/api/invoices/:id", ...apRead, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseRouteId(res, req.params.id, "invoice ID");
      if (invoiceId === null) return;
      const invoice = await getInvoiceDetail(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, invoice);
    } catch (error) {
      return sendError(res, 500, "FETCH_INVOICE_FAILED", "Failed to fetch invoice");
    }
  });

  app.post("/api/invoices", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      return sendOk(res, await createInvoiceRecord(req.body, actor.userId), 201);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to create invoice");
      }
      return sendError(res, 400, "CREATE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to create invoice");
    }
  });

  app.patch("/api/invoices/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseRouteId(res, req.params.id, "invoice ID");
      if (invoiceId === null) return;
      const updated = await updateInvoiceRecord(invoiceId, req.body, actor.userId);
      if (!updated) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, updated);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string };
      if (e?.code && e?.status) {
        return sendError(res, e.status, e.code, e.message || "Failed to update invoice");
      }
      return sendError(res, 500, "UPDATE_INVOICE_FAILED", error instanceof Error ? error.message : "Failed to update invoice");
    }
  });

  app.get("/api/ap/invoices/:id/voucher.pdf", ...apRead, async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(res, req.params.id, "invoice ID");
      if (id === null) return;
      const invoice = await getInvoiceDetail(id);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      const organization = await pool.query("SELECT name FROM organizations WHERE id = $1", [getActiveOrganizationId()]);
      const match = invoice.latestMatchResult as Record<string, unknown> | null;
      const rows = (invoice.items ?? []).map((line: Record<string, unknown>, index: number) => ({
        line: index + 1,
        description: line.description ?? `Item ${line.itemId ?? ""}`,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        tax: line.taxAmount ?? 0,
        total: Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0),
      }));
      const pdf = await generateGenericPdf(rows, `Supplier Invoice Voucher ${invoice.invoiceNumber}`, [
        { header: "Line", key: "line", width: 45 },
        { header: "Description", key: "description", width: 210 },
        { header: "Qty", key: "quantity", width: 55 },
        { header: "Unit price", key: "unitPrice", width: 80 },
        { header: "Tax", key: "tax", width: 65 },
        { header: "Total", key: "total", width: 80 },
      ], { metadataLines: [
        `${organization.rows[0]?.name ?? "Organization"} · AP supplier invoice voucher`,
        `Status: ${invoice.status} · Currency: ${invoice.currencyCode ?? "ZAR"} · Total: ${invoice.total}`,
        `PO: ${invoice.purchaseOrderId ?? "Not linked"} · Match: ${String(match?.status ?? "Not evaluated")}`,
      ] });
      const filename = `${String(invoice.invoiceNumber).replace(/[^A-Za-z0-9_-]/g, "-")}-voucher.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${filename}"`);
      return res.status(200).send(pdf);
    } catch (error) {
      console.error("Invoice voucher PDF failed", error);
      return sendError(res, 500, "INVOICE_VOUCHER_FAILED", "Failed to generate the supplier invoice voucher.");
    }
  });

  app.get("/api/ap/payment-batches/:id/remittance.pdf", ...apRead, async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(res, req.params.id, "batch ID");
      if (id === null) return;
      const batches = await listPaymentBatches();
      const batch = batches.find((candidate) => candidate.id === id);
      if (!batch) return sendError(res, 404, "PAYMENT_BATCH_NOT_FOUND", "Payment batch not found");
      if (batch.status !== "RELEASED") return sendError(res, 409, "PAYMENT_BATCH_NOT_RELEASED", "Remittance advice is available only after payment release.");
      const organization = await pool.query("SELECT name FROM organizations WHERE id = $1", [getActiveOrganizationId()]);
      const invoiceIds = batch.items.map((item) => item.invoiceId);
      const invoices = invoiceIds.length
        ? await pool.query(
            `SELECT invoice.id, invoice.invoice_number AS "invoiceNumber", supplier.name AS "supplierName",
              invoice.currency_code AS currency, item.amount, item.status
             FROM ap_payment_batch_items item
             JOIN invoices invoice ON invoice.id = item.invoice_id AND invoice.organization_id = $1
             JOIN suppliers supplier ON supplier.id = invoice.supplier_id AND supplier.organization_id = $1
             WHERE item.batch_id = $2 ORDER BY supplier.name, invoice.invoice_number`,
            [getActiveOrganizationId(), id],
          )
        : { rows: [] };
      const pdf = await generateGenericPdf(invoices.rows, `Remittance Advice ${batch.batchNumber}`, [
        { header: "Supplier", key: "supplierName", width: 180 },
        { header: "Invoice", key: "invoiceNumber", width: 130 },
        { header: "Currency", key: "currency", width: 70 },
        { header: "Amount", key: "amount", width: 90 },
        { header: "Evidence", key: "status", width: 90 },
      ], { metadataLines: [
        `${organization.rows[0]?.name ?? "Organization"} · Released payment remittance`,
        `Method: ${batch.paymentMethod ?? "Not specified"} · Total: ${batch.totalAmount}`,
        `Released: ${batch.releasedAt ? new Date(batch.releasedAt).toISOString() : "Recorded"}`,
      ] });
      const filename = `${String(batch.batchNumber).replace(/[^A-Za-z0-9_-]/g, "-")}-remittance.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${filename}"`);
      return res.status(200).send(pdf);
    } catch (error) {
      console.error("Remittance PDF failed", error);
      return sendError(res, 500, "PAYMENT_REMITTANCE_FAILED", "Failed to generate remittance advice.");
    }
  });

  app.delete("/api/invoices/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseRouteId(res, req.params.id, "invoice ID");
      if (invoiceId === null) return;
      const deleted = await deleteInvoiceRecord(invoiceId);
      if (!deleted) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, { success: true });
    } catch (error) {
      if (trySendDbConstraintError(res, error)) return;
      return sendError(
        res,
        400,
        "DELETE_INVOICE_FAILED",
        error instanceof Error ? error.message : "Failed to delete invoice",
      );
    }
  });

  app.post("/api/invoices/:id/match", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseRouteId(res, req.params.id, "invoice ID");
      if (invoiceId === null) return;
      let matchOpts: z.infer<typeof apInvoiceMatchBodySchema>;
      try {
        matchOpts = apInvoiceMatchBodySchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", fromZodError(err).message, { details: err.flatten() });
        }
        throw err;
      }
      const result = await evaluateInvoiceMatch(invoiceId, matchOpts, actor.userId);
      if (!result) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, result);
    } catch (error) {
      const structured = sendApStructuredError(res, error);
      if (structured) return structured;
      return sendError(res, 400, "INVOICE_MATCH_FAILED", error instanceof Error ? error.message : "Failed to run invoice match");
    }
  });

  app.post("/api/invoices/:id/send", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseRouteId(res, req.params.id, "invoice ID");
      if (invoiceId === null) return;
      const existing = await storage.getInvoice(invoiceId);
      if (!existing) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (existing.status !== "DRAFT") {
        return sendError(res, 400, "INVOICE_SEND_NOT_ALLOWED", "Only invoices in DRAFT status can be sent");
      }
      const updated = await updateInvoiceStatus(invoiceId, "SENT", actor.userId);
      return sendOk(res, updated);
    } catch (error) {
      return sendError(res, 500, "SEND_INVOICE_FAILED", "Failed to send invoice");
    }
  });

  app.post("/api/invoices/:id/cancel", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseRouteId(res, req.params.id, "invoice ID");
      if (invoiceId === null) return;
      const existing = await storage.getInvoice(invoiceId);
      if (!existing) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (["PAID", "CANCELLED", "VOID"].includes(existing.status)) {
        return sendError(res, 400, "INVOICE_CANCEL_NOT_ALLOWED", "Cannot cancel an invoice that is already paid, cancelled, or void");
      }
      return sendOk(res, await updateInvoiceStatus(invoiceId, "CANCELLED", actor.userId));
    } catch (error) {
      return sendError(res, 500, "CANCEL_INVOICE_FAILED", "Failed to cancel invoice");
    }
  });

  app.post("/api/invoices/:id/void", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseRouteId(res, req.params.id, "invoice ID");
      if (invoiceId === null) return;
      const existing = await storage.getInvoice(invoiceId);
      if (!existing) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (existing.status === "VOID") {
        return sendError(res, 400, "INVOICE_ALREADY_VOID", "Invoice is already void");
      }
      return sendOk(res, await updateInvoiceStatus(invoiceId, "VOID", actor.userId));
    } catch (error) {
      return sendError(res, 500, "VOID_INVOICE_FAILED", "Failed to void invoice");
    }
  });

  app.get("/api/invoices/:invoiceId/items", ...apRead, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseRouteId(res, req.params.invoiceId, "invoice ID");
      if (invoiceId === null) return;
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, await listInvoiceItems(invoiceId));
    } catch (error) {
      return sendError(res, 500, "FETCH_INVOICE_ITEMS_FAILED", "Failed to fetch invoice items");
    }
  });

  app.post("/api/invoices/:invoiceId/items", ...apWrite, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseRouteId(res, req.params.invoiceId, "invoice ID");
      if (invoiceId === null) return;
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (["PAID", "CANCELLED", "VOID"].includes(invoice.status)) {
        return sendError(res, 400, "INVOICE_MODIFY_NOT_ALLOWED", "Cannot modify a paid, cancelled, or void invoice");
      }
      let line: z.infer<typeof legacyInvoiceItemCreateSchema>;
      try {
        line = legacyInvoiceItemCreateSchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", fromZodError(err).message, { details: err.flatten() });
        }
        throw err;
      }
      return sendOk(res, await addInvoiceItemRecord({ ...line, invoiceId }), 201);
    } catch (error) {
      const structured = sendApStructuredError(res, error);
      if (structured) return structured;
      if (trySendDbConstraintError(res, error)) return;
      return sendError(res, 500, "CREATE_INVOICE_ITEM_FAILED", error instanceof Error ? error.message : "Failed to create invoice item");
    }
  });

  app.patch("/api/invoices/:invoiceId/items/:itemId", ...apWrite, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseRouteId(res, req.params.invoiceId, "invoice ID");
      if (invoiceId === null) return;
      const itemId = parseRouteId(res, req.params.itemId, "invoice item ID");
      if (itemId === null) return;
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (["PAID", "CANCELLED", "VOID"].includes(invoice.status)) {
        return sendError(res, 400, "INVOICE_MODIFY_NOT_ALLOWED", "Cannot modify a paid, cancelled, or void invoice");
      }
      const item = await storage.getInvoiceItem(itemId);
      if (!item || item.invoiceId !== invoiceId) {
        return sendError(res, 404, "INVOICE_ITEM_NOT_FOUND", "Invoice item not found");
      }
      let patch: z.infer<typeof legacyInvoiceItemPatchSchema>;
      try {
        patch = legacyInvoiceItemPatchSchema.parse(req.body ?? {});
      } catch (err) {
        if (err instanceof ZodError) {
          return sendError(res, 400, "VALIDATION_ERROR", fromZodError(err).message, { details: err.flatten() });
        }
        throw err;
      }
      return sendOk(res, await updateInvoiceItemRecord(itemId, patch));
    } catch (error) {
      return sendError(res, 500, "UPDATE_INVOICE_ITEM_FAILED", "Failed to update invoice item");
    }
  });

  app.delete("/api/invoices/:invoiceId/items/:itemId", ...apWrite, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseRouteId(res, req.params.invoiceId, "invoice ID");
      if (invoiceId === null) return;
      const itemId = parseRouteId(res, req.params.itemId, "invoice item ID");
      if (itemId === null) return;
      const item = await storage.getInvoiceItem(itemId);
      if (!item || item.invoiceId !== invoiceId) {
        return sendError(res, 404, "INVOICE_ITEM_NOT_FOUND", "Invoice item not found");
      }
      await deleteInvoiceItemRecord(itemId);
      return sendOk(res, { success: true });
    } catch (error) {
      if (trySendDbConstraintError(res, error)) return;
      return sendError(res, 500, "DELETE_INVOICE_ITEM_FAILED", "Failed to delete invoice item");
    }
  });

  app.get("/api/payments", ...apRead, async (_req: Request, res: Response) => {
    try {
      return sendOk(res, await listPayments());
    } catch (error) {
      return sendError(res, 500, "FETCH_PAYMENTS_FAILED", "Failed to fetch payments");
    }
  });

  app.get("/api/invoices/:invoiceId/payments", ...apRead, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseRouteId(res, req.params.invoiceId, "invoice ID");
      if (invoiceId === null) return;
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      return sendOk(res, await listPayments(invoiceId));
    } catch (error) {
      return sendError(res, 500, "FETCH_INVOICE_PAYMENTS_FAILED", "Failed to fetch invoice payments");
    }
  });

  app.post("/api/invoices/:invoiceId/payments", ...apWrite, async (req: Request, res: Response) => {
    try {
      const actor = requestActor(req);
      const invoiceId = parseRouteId(res, req.params.invoiceId, "invoice ID");
      if (invoiceId === null) return;
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return sendError(res, 404, "INVOICE_NOT_FOUND", "Invoice not found");
      if (["CANCELLED", "VOID"].includes(invoice.status)) {
        return sendError(res, 400, "CREATE_PAYMENT_FAILED", "Cannot add payments to a cancelled or void invoice");
      }
      const payload = insertPaymentSchema.parse({
        ...req.body,
        invoiceId,
        receivedBy: req.body?.receivedBy ?? actor.userId,
      });
      return sendOk(res, await createPaymentRecord(payload), 201);
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, "VALIDATION_ERROR", fromZodError(error).message, {
          details: error.flatten(),
        });
      }
      return sendError(res, 500, "CREATE_PAYMENT_FAILED", error instanceof Error ? error.message : "Failed to create payment");
    }
  });

  app.patch("/api/payments/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(res, req.params.id, "payment ID");
      if (id === null) return;
      const payment = await updatePaymentRecord(id, req.body);
      if (!payment) return sendError(res, 404, "PAYMENT_NOT_FOUND", "Payment not found");
      return sendOk(res, payment);
    } catch (error) {
      return sendError(res, 500, "UPDATE_PAYMENT_FAILED", "Failed to update payment");
    }
  });

  app.delete("/api/payments/:id", ...apWrite, async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(res, req.params.id, "payment ID");
      if (id === null) return;
      const deleted = await deletePaymentRecord(id);
      if (!deleted) return sendError(res, 404, "PAYMENT_NOT_FOUND", "Payment not found");
      return sendOk(res, { success: true });
    } catch (error) {
      return sendError(res, 500, "DELETE_PAYMENT_FAILED", "Failed to delete payment");
    }
  });
}
