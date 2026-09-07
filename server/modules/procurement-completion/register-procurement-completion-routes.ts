import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId, getOptionalTenantContext } from "../../organization-context";
import type { AuthBundle } from "../procurement/types";
import { createSourcingEvent, SourcingError, type SourcingActor } from "../sourcing/service";

type DbClient = PoolClient;

const confirmationStatuses = ["AWAITING", "CONFIRMED", "REJECTED", "CLARIFICATION_REQUESTED"] as const;
const requisitionTransitions: Record<string, { from: string[]; to: string; reasonRequired?: boolean }> = {
  submit: { from: ["DRAFT", "NEEDS_INFO"], to: "PENDING_APPROVAL" },
  "request-info": { from: ["SUBMITTED", "PENDING_APPROVAL"], to: "NEEDS_INFO", reasonRequired: true },
  approve: { from: ["SUBMITTED", "PENDING_APPROVAL"], to: "APPROVED" },
  reject: { from: ["SUBMITTED", "PENDING_APPROVAL"], to: "REJECTED", reasonRequired: true },
  cancel: { from: ["DRAFT", "SUBMITTED", "PENDING_APPROVAL", "APPROVED", "NEEDS_INFO", "REJECTED"], to: "CANCELLED", reasonRequired: true },
  close: { from: ["APPROVED", "REJECTED", "CANCELLED", "CONVERTED_TO_RFQ", "CONVERTED_TO_PO"], to: "CLOSED", reasonRequired: true },
};

function actor(req: Request, res: Response): SourcingActor {
  return {
    organizationId: getActiveOrganizationId(),
    userId: Number((req as Request & { user?: { id?: number } }).user?.id ?? 0),
    requestId: String(res.locals.requestId ?? "unknown-request-id"),
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  };
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pagination(req: Request) {
  const page = positiveInt(req.query.page, 1);
  const pageSize = positiveInt(req.query.pageSize, 25);
  if (![25, 50, 100].includes(pageSize)) throw new Error("INVALID_PAGE_SIZE");
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertPhaseEnabled(organizationId: number, phase: 1 | 2 | 3 | 4, client: Pick<DbClient, "query"> = pool) {
  const column = `phase${phase}_enabled`;
  const result = await client.query(`SELECT ${column} AS enabled FROM procurement_feature_settings WHERE organization_id=$1`, [organizationId]);
  if (!result.rows[0]?.enabled) throw new Error(`FEATURE_PROCUREMENT_PHASE_${phase}_DISABLED`);
}

async function recordActivity(client: DbClient, organizationId: number, entityType: string, entityId: number, action: string, summary: Record<string, unknown>) {
  await client.query(
    `INSERT INTO ops_activity (organization_id, actor, entity_type, entity_id, action, summary_json)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [organizationId, String(summary.actorUserId ?? "system"), entityType, String(entityId), action, JSON.stringify(summary)],
  );
}

async function createProcurementException(client: DbClient, organizationId: number, input: {
  type: string; severity?: string; title: string; description: string; refs: Record<string, unknown>;
}) {
  const existing = await client.query(
    `SELECT id FROM operational_exceptions
      WHERE organization_id=$1 AND type=$2 AND status IN ('open','in_progress')
        AND related_refs @> $3::jsonb LIMIT 1`,
    [organizationId, input.type, JSON.stringify(input.refs)],
  );
  if (existing.rows[0]) return existing.rows[0].id as number;
  const created = await client.query(
    `INSERT INTO operational_exceptions
      (organization_id,type,severity,status,title,description,related_refs,sla_hours)
     VALUES ($1,$2,$3,'open',$4,$5,$6::jsonb,24) RETURNING id`,
    [organizationId, input.type, input.severity ?? "medium", input.title, input.description, JSON.stringify({ area: "procurement", ...input.refs })],
  );
  return created.rows[0].id as number;
}

function handleError(res: Response, error: unknown) {
  if (error instanceof SourcingError) return sendError(res, error.status, error.code, error.message, { hint: error.hint, details: error.details });
  if (error instanceof z.ZodError) return sendError(res, 400, "INVALID_REQUEST", "The procurement request is invalid.", { details: error.flatten() });
  const message = error instanceof Error ? error.message : String(error);
  if (message === "INVALID_PAGE_SIZE") return sendError(res, 400, "INVALID_PAGE_SIZE", "pageSize must be 25, 50, or 100");
  if (message === "NOT_FOUND") return sendError(res, 404, "NOT_FOUND", "The requested procurement record was not found.");
  if (message.startsWith("FORBIDDEN")) return sendError(res, 403, message, message.replaceAll("_", " ").toLowerCase());
  if (message.startsWith("INVALID_")) return sendError(res, 400, message, message.replaceAll("_", " ").toLowerCase());
  const known = /^(NOT_FOUND|INVALID_|STATE_|FORBIDDEN|INSUFFICIENT_|ALREADY_|FEATURE_|BUDGET_)/.test(message);
  return sendError(res, known ? 409 : 500, known ? message : "PROCUREMENT_COMPLETION_FAILED", known ? message.replaceAll("_", " ").toLowerCase() : "The procurement operation failed.", {
    details: process.env.NODE_ENV === "production" ? undefined : { message },
  });
}

async function reserveRequisitionBudget(client: DbClient, organizationId: number, requisition: Record<string, any>) {
  const settings = await client.query(
    `SELECT budget_control_mode FROM procurement_feature_settings WHERE organization_id=$1`,
    [organizationId],
  );
  const mode = String(settings.rows[0]?.budget_control_mode ?? "WARN_APPROVAL");
  const costCentre = await client.query(
    `SELECT cost_centre_id FROM purchase_requisition_items WHERE requisition_id=$1 AND cost_centre_id IS NOT NULL ORDER BY id LIMIT 1`,
    [requisition.id],
  );
  const budget = await client.query(
    `SELECT b.*,
       COALESCE((SELECT sum(c.amount) FROM budget_commitments c WHERE c.organization_id=$1 AND c.budget_id=b.id AND c.status='ACTIVE'),0) AS committed
     FROM finance_budgets b
     WHERE b.organization_id=$1 AND b.status='ACTIVE' AND b.fiscal_year=EXTRACT(YEAR FROM now())::int
       AND upper(b.currency_code)=upper($2)
       AND (b.department_id IS NULL OR b.department_id=$3)
       AND (b.cost_centre_id IS NULL OR b.cost_centre_id=$4)
       AND (b.project_id IS NULL OR b.project_id=$5)
     ORDER BY (b.department_id IS NOT NULL)::int+(b.cost_centre_id IS NOT NULL)::int+(b.project_id IS NOT NULL)::int DESC,b.id
     LIMIT 1 FOR UPDATE`,
    [organizationId, requisition.currency_code ?? "ZAR", requisition.department_id ?? null, costCentre.rows[0]?.cost_centre_id ?? null, requisition.project_id ?? null],
  );
  const selected = budget.rows[0];
  if (!selected) {
    if (mode === "HARD_BLOCK") throw new Error("BUDGET_NOT_CONFIGURED");
    await createProcurementException(client, organizationId, {
      type: "procurement_budget_missing", severity: "medium",
      title: `No budget configured for ${requisition.requisition_number}`,
      description: "The requisition was approved with elevated authority, but no matching active budget exists.",
      refs: { requisitionId: requisition.id },
    });
    return;
  }
  const amount = Number(requisition.total_amount ?? 0);
  const available = Number(selected.approved_amount) - Number(selected.committed);
  if (amount > available) {
    if (mode === "HARD_BLOCK") throw new Error("BUDGET_HARD_BLOCK");
    await createProcurementException(client, organizationId, {
      type: "procurement_budget_override", severity: "high",
      title: `Budget override for ${requisition.requisition_number}`,
      description: `The requisition exceeds the available budget by ${(amount - available).toFixed(2)} ${selected.currency_code}.`,
      refs: { requisitionId: requisition.id, budgetId: selected.id },
    });
  }
  await client.query(
    `INSERT INTO budget_commitments (organization_id,budget_id,source_type,source_id,amount,currency_code,status)
     VALUES ($1,$2,'REQUISITION',$3,$4,$5,'ACTIVE')
     ON CONFLICT (organization_id,source_type,source_id) DO NOTHING`,
    [organizationId, selected.id, requisition.id, amount, requisition.currency_code ?? selected.currency_code],
  );
}

export function registerProcurementCompletionRoutes(app: Express, auth: AuthBundle): void {
  const read = [auth.ensureAuthenticated, auth.ensurePermission("purchases", "read")];
  const manage = [auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("purchases", "manage")];
  const approve = [auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("purchases", "approve")];
  const admin = [auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensureRole(["admin"])];

  app.get("/api/v2/procurement/settings", ...read, async (_req, res) => {
    try {
      const org = getActiveOrganizationId();
      const result = await pool.query(
        `INSERT INTO procurement_feature_settings (organization_id) VALUES ($1)
         ON CONFLICT (organization_id) DO UPDATE SET organization_id=EXCLUDED.organization_id
         RETURNING phase1_enabled AS "phase1Enabled", phase2_enabled AS "phase2Enabled",
           phase3_enabled AS "phase3Enabled", phase4_enabled AS "phase4Enabled",
           confirmation_due_days AS "confirmationDueDays", budget_control_mode AS "budgetControlMode",
           receipt_over_tolerance_pct::text AS "receiptOverTolerancePct",
           price_variance_tolerance_pct::text AS "priceVarianceTolerancePct",
           quantity_variance_tolerance_pct::text AS "quantityVarianceTolerancePct", updated_at AS "updatedAt"`,
        [org],
      );
      return sendOk(res, result.rows[0]);
    } catch (error) { return handleError(res, error); }
  });

  app.patch("/api/v2/procurement/settings", ...admin, async (req, res) => {
    const schema = z.object({
      phase1Enabled: z.boolean(), phase2Enabled: z.boolean(), phase3Enabled: z.boolean(), phase4Enabled: z.boolean(),
      confirmationDueDays: z.coerce.number().int().min(1).max(90),
      budgetControlMode: z.enum(["WARNING_ONLY", "WARN_APPROVAL", "HARD_BLOCK"]),
      receiptOverTolerancePct: z.coerce.number().min(0).max(100),
      priceVarianceTolerancePct: z.coerce.number().min(0).max(100),
      quantityVarianceTolerancePct: z.coerce.number().min(0).max(100),
    });
    try {
      const body = schema.parse(req.body);
      const org = getActiveOrganizationId();
      const userId = Number((req as any).user?.id ?? 0) || null;
      const result = await pool.query(
        `INSERT INTO procurement_feature_settings
          (organization_id,phase1_enabled,phase2_enabled,phase3_enabled,phase4_enabled,confirmation_due_days,budget_control_mode,receipt_over_tolerance_pct,price_variance_tolerance_pct,quantity_variance_tolerance_pct,updated_by,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         ON CONFLICT (organization_id) DO UPDATE SET
          phase1_enabled=EXCLUDED.phase1_enabled,phase2_enabled=EXCLUDED.phase2_enabled,
          phase3_enabled=EXCLUDED.phase3_enabled,phase4_enabled=EXCLUDED.phase4_enabled,
          confirmation_due_days=EXCLUDED.confirmation_due_days,budget_control_mode=EXCLUDED.budget_control_mode,
          receipt_over_tolerance_pct=EXCLUDED.receipt_over_tolerance_pct,
          price_variance_tolerance_pct=EXCLUDED.price_variance_tolerance_pct,
          quantity_variance_tolerance_pct=EXCLUDED.quantity_variance_tolerance_pct,
          updated_by=EXCLUDED.updated_by,updated_at=now()
         RETURNING *`,
        [org, body.phase1Enabled, body.phase2Enabled, body.phase3Enabled, body.phase4Enabled, body.confirmationDueDays, body.budgetControlMode, body.receiptOverTolerancePct, body.priceVarianceTolerancePct, body.quantityVarianceTolerancePct, userId],
      );
      return sendOk(res, result.rows[0]);
    } catch (error) { return handleError(res, error); }
  });

  app.get("/api/v2/procurement/overview", ...read, async (req, res) => {
    try {
      const org = getActiveOrganizationId();
      const supplierId = req.query.supplierId ? positiveInt(req.query.supplierId, 0) : null;
      const departmentId = req.query.departmentId ? positiveInt(req.query.departmentId, 0) : null;
      const from = req.query.from ? String(req.query.from) : null;
      const to = req.query.to ? String(req.query.to) : null;
      const result = await pool.query(
        `WITH
         req AS (SELECT * FROM purchase_requisitions WHERE organization_id=$1 AND ($2::int IS NULL OR supplier_id=$2) AND ($3::int IS NULL OR department_id=$3)),
         po AS (SELECT * FROM purchase_orders WHERE organization_id=$1 AND ($2::int IS NULL OR supplier_id=$2) AND ($3::int IS NULL OR department_id=$3)
           AND ($4::date IS NULL OR order_date::date >= $4::date) AND ($5::date IS NULL OR order_date::date <= $5::date)),
         latest_confirmation AS (
           SELECT DISTINCT ON (purchase_order_id) purchase_order_id,status,created_at
           FROM po_supplier_confirmations WHERE organization_id=$1 ORDER BY purchase_order_id,created_at DESC,id DESC
         ),
         kpis AS (SELECT
           (SELECT count(*) FROM req WHERE upper(status) NOT IN ('CLOSED','CANCELLED','CONVERTED_TO_PO','CONVERTED_TO_RFQ'))::int AS "openRequisitions",
           (SELECT count(*) FROM req WHERE upper(status) IN ('SUBMITTED','PENDING_APPROVAL'))::int AS "pendingApprovals",
           (SELECT count(*) FROM sourcing_events WHERE organization_id=$1 AND status IN ('PUBLISHED','OPEN','EVALUATING'))::int AS "openRfqs",
           (SELECT count(*) FROM po WHERE upper(status::text) NOT IN ('RECEIVED','COMPLETED','CLOSED','CANCELLED'))::int AS "openPurchaseOrders",
           (SELECT count(*) FROM po LEFT JOIN latest_confirmation c ON c.purchase_order_id=po.id WHERE upper(po.status::text) IN ('SENT','ACKNOWLEDGED') AND COALESCE(c.status,'AWAITING')='AWAITING')::int AS "awaitingConfirmation",
           (SELECT count(*) FROM po WHERE upper(status::text)='PARTIALLY_RECEIVED')::int AS "partiallyReceived",
           (SELECT count(*) FROM po WHERE expected_delivery_date < now() AND upper(status::text) NOT IN ('RECEIVED','COMPLETED','CLOSED','CANCELLED'))::int AS "lateDeliveries",
           (SELECT count(*) FROM operational_exceptions WHERE organization_id=$1 AND status IN ('open','in_progress') AND (related_refs->>'area'='procurement' OR type ILIKE ANY(ARRAY['%purchase%','%supplier%','%invoice%','%receipt%','%rfq%'])))::int AS "exceptions",
           COALESCE((SELECT sum(total_amount) FROM po WHERE date_trunc('month',order_date)=date_trunc('month',now())),0)::numeric::text AS "spendThisPeriod",
           (SELECT count(*) FROM invoices i WHERE i.organization_id=$1 AND i.purchase_order_id IS NOT NULL AND upper(i.status::text) IN ('DRAFT','DISPUTED','PENDING_APPROVAL'))::int AS "unmatchedInvoices")
         SELECT row_to_json(kpis.*) AS kpis,
           (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT id,requisition_number AS number,status,total_amount::numeric::text AS amount,updated_at AS "updatedAt" FROM req WHERE upper(status) IN ('SUBMITTED','PENDING_APPROVAL','NEEDS_INFO') ORDER BY updated_at DESC,id DESC LIMIT 10) x) AS "needsAttention",
           (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT id,order_number AS number,status,expected_delivery_date AS "expectedDeliveryDate",total_amount::numeric::text AS amount FROM po WHERE expected_delivery_date < now() AND upper(status::text) NOT IN ('RECEIVED','COMPLETED','CLOSED','CANCELLED') ORDER BY expected_delivery_date,id LIMIT 10) x) AS "lateOrders",
           (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT status AS label,count(*)::int AS value FROM po GROUP BY status ORDER BY status) x) AS "poStatus",
           (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT s.name AS label,sum(po.total_amount)::numeric::text AS value FROM po JOIN suppliers s ON s.id=po.supplier_id AND s.organization_id=$1 GROUP BY s.id,s.name ORDER BY sum(po.total_amount) DESC LIMIT 8) x) AS "spendBySupplier"
         FROM kpis`,
        [org, supplierId, departmentId, from, to],
      );
      return sendOk(res, { ...result.rows[0], generatedAt: new Date().toISOString(), filters: { supplierId, departmentId, from, to } });
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/procurement/exceptions/reconcile", ...manage, async (req, res) => {
    try {
      const org = getActiveOrganizationId();
      const result = await withTransaction(async (client) => {
        const settings = await client.query(`SELECT confirmation_due_days FROM procurement_feature_settings WHERE organization_id=$1`, [org]);
        const dueDays = Number(settings.rows[0]?.confirmation_due_days ?? 3);
        const missing = await client.query(
          `SELECT po.id,po.order_number,po.supplier_id FROM purchase_orders po
           LEFT JOIN LATERAL (SELECT status FROM po_supplier_confirmations c WHERE c.organization_id=$1 AND c.purchase_order_id=po.id ORDER BY c.created_at DESC,c.id DESC LIMIT 1) c ON true
           WHERE po.organization_id=$1 AND upper(po.status::text) IN ('SENT','ACKNOWLEDGED')
             AND po.updated_at < now()-($2::text||' days')::interval AND COALESCE(c.status,'AWAITING')='AWAITING'`,
          [org, String(dueDays)],
        );
        for (const row of missing.rows) await createProcurementException(client, org, { type: "supplier_confirmation_overdue", severity: "high", title: `Supplier confirmation overdue for ${row.order_number}`, description: `No supplier confirmation was recorded within ${dueDays} day(s).`, refs: { purchaseOrderId: row.id, supplierId: row.supplier_id } });
        const late = await client.query(`SELECT id,order_number,supplier_id FROM purchase_orders WHERE organization_id=$1 AND expected_delivery_date<now() AND upper(status::text) NOT IN ('RECEIVED','COMPLETED','CLOSED','CANCELLED')`, [org]);
        for (const row of late.rows) await createProcurementException(client, org, { type: "purchase_order_late", severity: "high", title: `Late delivery for ${row.order_number}`, description: "The expected delivery date has passed and the order is not complete.", refs: { purchaseOrderId: row.id, supplierId: row.supplier_id } });
        const noQuotes = await client.query(`SELECT e.id,e.event_number FROM sourcing_events e WHERE e.organization_id=$1 AND e.status IN ('PUBLISHED','OPEN') AND e.deadline<now() AND NOT EXISTS (SELECT 1 FROM supplier_quotes q WHERE q.organization_id=$1 AND q.event_id=e.id AND q.status='SUBMITTED')`, [org]);
        for (const row of noQuotes.rows) await createProcurementException(client, org, { type: "rfq_no_quotes", severity: "medium", title: `No quotes received for ${row.event_number}`, description: "The RFQ deadline passed without a submitted supplier quote.", refs: { sourcingEventId: row.id } });
        const resolved = await client.query(
          `UPDATE operational_exceptions e SET status='resolved',resolved_at=now(),updated_at=now()
           WHERE e.organization_id=$1 AND e.status IN ('open','in_progress') AND e.related_refs->>'area'='procurement'
             AND ((e.type='supplier_confirmation_overdue' AND NOT EXISTS (SELECT 1 FROM purchase_orders po LEFT JOIN LATERAL (SELECT status FROM po_supplier_confirmations c WHERE c.organization_id=$1 AND c.purchase_order_id=po.id ORDER BY c.created_at DESC,c.id DESC LIMIT 1) c ON true WHERE po.id=(e.related_refs->>'purchaseOrderId')::int AND po.organization_id=$1 AND upper(po.status::text) IN ('SENT','ACKNOWLEDGED') AND COALESCE(c.status,'AWAITING')='AWAITING'))
               OR (e.type='purchase_order_late' AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id=(e.related_refs->>'purchaseOrderId')::int AND po.organization_id=$1 AND po.expected_delivery_date<now() AND upper(po.status::text) NOT IN ('RECEIVED','COMPLETED','CLOSED','CANCELLED'))
               OR (e.type='rfq_no_quotes' AND EXISTS (SELECT 1 FROM supplier_quotes q WHERE q.organization_id=$1 AND q.event_id=(e.related_refs->>'sourcingEventId')::int AND q.status='SUBMITTED')))` ,
          [org],
        );
        const overdueConfirmation = missing.rowCount ?? 0;
        const latePurchaseOrder = late.rowCount ?? 0;
        const rfqNoQuotes = noQuotes.rowCount ?? 0;
        return { createdOrRetained: overdueConfirmation + latePurchaseOrder + rfqNoQuotes, resolved: resolved.rowCount ?? 0, rules: { overdueConfirmation, latePurchaseOrder, rfqNoQuotes } };
      });
      return sendOk(res, result);
    } catch (error) { return handleError(res, error); }
  });

  for (const action of Object.keys(requisitionTransitions)) {
    app.post(`/api/v2/procurement/requisitions/:id/${action}`, ...(action === "approve" || action === "reject" ? approve : manage), async (req, res) => {
      try {
        const transition = requisitionTransitions[action];
        const org = getActiveOrganizationId();
        const id = positiveInt(req.params.id, 0);
        const userId = Number((req as any).user?.id ?? 0);
        const reason = String(req.body?.reason ?? "").trim();
        if (!id) return sendError(res, 400, "INVALID_REQUISITION_ID", "A valid requisition ID is required.");
        if (transition.reasonRequired && reason.length < 5) return sendError(res, 400, "REASON_REQUIRED", "Provide a reason of at least 5 characters.");
        const updated = await withTransaction(async (client) => {
          const locked = await client.query(`SELECT * FROM purchase_requisitions WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, org]);
          const record = locked.rows[0];
          if (!record) throw new Error("NOT_FOUND");
          const current = String(record.status).toUpperCase() === "PENDING" ? "PENDING_APPROVAL" : String(record.status).toUpperCase();
          if (!transition.from.includes(current)) throw new Error("STATE_TRANSITION_NOT_ALLOWED");
          if (action === "approve" && Number(record.requestor_id) === userId) throw new Error("FORBIDDEN_SELF_APPROVAL");
          if (action === "approve") await reserveRequisitionBudget(client, org, record);
          const result = await client.query(
            `UPDATE purchase_requisitions SET status=$1,
              approver_id=CASE WHEN $2='APPROVED' THEN $3 ELSE approver_id END,
              approval_date=CASE WHEN $2='APPROVED' THEN now() ELSE approval_date END,
              rejection_reason=CASE WHEN $2 IN ('REJECTED','NEEDS_INFO','CANCELLED','CLOSED') THEN $4 ELSE rejection_reason END,
              updated_at=now() WHERE id=$5 AND organization_id=$6 RETURNING *`,
            [transition.to, transition.to, userId || null, reason || null, id, org],
          );
          await recordActivity(client, org, "purchase_requisition", id, `REQUISITION_${transition.to}`, { actorUserId: userId, reason, beforeStatus: current, afterStatus: transition.to });
          return result.rows[0];
        });
        return sendOk(res, updated);
      } catch (error) { return handleError(res, error); }
    });
  }

  app.post("/api/v2/procurement/requisitions/:id/convert-to-po", ...manage, (req, res) => {
    res.redirect(307, `/api/purchase-requisitions/${encodeURIComponent(req.params.id)}/convert`);
  });

  app.post("/api/v2/procurement/requisitions/:id/convert-to-rfq", ...manage, async (req, res) => {
    try {
      const org = getActiveOrganizationId();
      const id = positiveInt(req.params.id, 0);
      const requisition = await pool.query(`SELECT * FROM purchase_requisitions WHERE id=$1 AND organization_id=$2`, [id, org]);
      if (!requisition.rows[0]) return sendError(res, 404, "REQUISITION_NOT_FOUND", "Requisition not found.");
      if (String(requisition.rows[0].status).toUpperCase() !== "APPROVED") return sendError(res, 409, "REQUISITION_NOT_APPROVED", "Only an approved requisition can be converted to an RFQ.");
      const lines = await pool.query(`SELECT * FROM purchase_requisition_items WHERE requisition_id=$1 ORDER BY line_number,id`, [id]);
      const supplierIds = z.array(z.coerce.number().int().positive()).min(1).parse(req.body?.supplierIds);
      const created = await createSourcingEvent(actor(req, res), {
        title: String(req.body?.title ?? `RFQ for ${requisition.rows[0].requisition_number}`),
        description: requisition.rows[0].justification ?? requisition.rows[0].notes,
        deadline: new Date(String(req.body?.deadline)), requisitionId: id,
        reportingCurrencyCode: String(requisition.rows[0].currency_code ?? "ZAR"),
        minimumResponses: Math.min(Number(req.body?.minimumResponses ?? Math.min(2, supplierIds.length)), supplierIds.length),
        competitionRequired: req.body?.competitionRequired !== false,
        terms: req.body?.terms ?? null, supplierIds,
        lines: lines.rows.map((line) => ({ itemId: line.item_id, description: line.description ?? line.item_description_snapshot ?? `Line ${line.line_number}`, quantity: Number(line.quantity), unitOfMeasureId: line.unit_of_measure_id, taxCodeId: line.tax_code_id, costCentreId: line.cost_centre_id, glAccountCode: line.gl_account_code, requiredDate: requisition.rows[0].required_date, targetUnitPrice: Number(line.unit_price), targetCurrencyCode: requisition.rows[0].currency_code })),
        criteria: req.body?.criteria ?? [{ name: "Landed cost", criterionType: "commercial", weight: 50 }, { name: "Delivery", criterionType: "delivery", weight: 25 }, { name: "Compliance and risk", criterionType: "risk", weight: 25 }],
      });
      await pool.query(`UPDATE purchase_requisitions SET status='CONVERTED_TO_RFQ',updated_at=now() WHERE id=$1 AND organization_id=$2`, [id, org]);
      return sendOk(res, created, 201);
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/procurement/sourcing-events/:id/close", ...manage, (req, res) => res.redirect(307, `/api/sourcing/events/${encodeURIComponent(req.params.id)}/close`));
  app.post("/api/v2/procurement/sourcing-awards/:id/approve", ...approve, (req, res) => res.redirect(307, `/api/sourcing/awards/${encodeURIComponent(req.params.id)}/approve`));
  app.post("/api/v2/procurement/sourcing-awards/:id/convert-to-po", ...approve, (req, res) => res.redirect(307, `/api/sourcing/awards/${encodeURIComponent(req.params.id)}/convert-to-po`));

  app.get("/api/v2/procurement/purchase-orders/:id/supplier-confirmations", ...read, async (req, res) => {
    try {
      const rows = await pool.query(
        `SELECT id,purchase_order_id AS "purchaseOrderId",supplier_id AS "supplierId",status,reason,
          promised_delivery_date AS "promisedDeliveryDate",source,actor_user_id AS "actorUserId",created_at AS "createdAt"
         FROM po_supplier_confirmations WHERE organization_id=$1 AND purchase_order_id=$2 ORDER BY created_at DESC,id DESC`,
        [getActiveOrganizationId(), positiveInt(req.params.id, 0)],
      );
      return sendOk(res, rows.rows);
    } catch (error) { return handleError(res, error); }
  });

  const confirmationAction = z.object({ reason: z.string().trim().max(2000).optional().nullable(), promisedDeliveryDate: z.coerce.date().optional().nullable() });
  for (const [path, status] of [["supplier-confirm", "CONFIRMED"], ["supplier-reject", "REJECTED"], ["request-clarification", "CLARIFICATION_REQUESTED"]] as const) {
    app.post(`/api/v2/procurement/purchase-orders/:id/${path}`, auth.ensureAuthenticated, async (req, res) => {
      try {
        const body = confirmationAction.parse(req.body ?? {});
        if ((status === "REJECTED" || status === "CLARIFICATION_REQUESTED") && !body.reason?.trim()) return sendError(res, 400, "REASON_REQUIRED", "A reason is required.");
        const org = getActiveOrganizationId();
        const poId = positiveInt(req.params.id, 0);
        const userId = Number((req as any).user?.id ?? 0);
        const role = String(getOptionalTenantContext()?.userRole ?? (req as any).user?.role ?? "");
        const result = await withTransaction(async (client) => {
          const po = await client.query(`SELECT * FROM purchase_orders WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [poId, org]);
          if (!po.rows[0]) throw new Error("NOT_FOUND");
          if (!["SENT", "ACKNOWLEDGED", "PARTIALLY_RECEIVED"].includes(String(po.rows[0].status).toUpperCase())) throw new Error("STATE_CONFIRMATION_NOT_ALLOWED");
          if (role === "supplier") {
            const mapping = await client.query(`SELECT 1 FROM supplier_portal_mappings WHERE organization_id=$1 AND user_id=$2 AND supplier_id=$3 AND active=true`, [org, userId, po.rows[0].supplier_id]);
            if (!mapping.rows[0]) throw new Error("FORBIDDEN_SUPPLIER_SCOPE");
          } else if (!["admin", "manager", "planner"].includes(role.toLowerCase())) {
            throw new Error("FORBIDDEN_CONFIRMATION_ACTION");
          }
          await client.query(`DELETE FROM po_supplier_confirmations WHERE organization_id=$1 AND purchase_order_id=$2 AND status='AWAITING'`, [org, poId]);
          const inserted = await client.query(
            `INSERT INTO po_supplier_confirmations (organization_id,purchase_order_id,supplier_id,status,reason,promised_delivery_date,source,actor_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [org, poId, po.rows[0].supplier_id, status, body.reason ?? null, body.promisedDeliveryDate ?? null, role === "supplier" ? "SUPPLIER_PORTAL" : "INTERNAL", userId || null],
          );
          if (status === "REJECTED" || status === "CLARIFICATION_REQUESTED") await createProcurementException(client, org, { type: status === "REJECTED" ? "supplier_rejected_po" : "supplier_po_clarification", severity: status === "REJECTED" ? "high" : "medium", title: `${status === "REJECTED" ? "Supplier rejected" : "Supplier clarification requested for"} PO ${po.rows[0].order_number}`, description: body.reason ?? status, refs: { purchaseOrderId: poId, supplierId: po.rows[0].supplier_id } });
          await recordActivity(client, org, "purchase_order", poId, `PO_CONFIRMATION_${status}`, { actorUserId: userId, reason: body.reason });
          return inserted.rows[0];
        });
        return sendOk(res, result, 201);
      } catch (error) { return handleError(res, error); }
    });
  }

  app.get("/api/v2/procurement/purchase-orders/:id/workflow", ...read, async (req, res) => {
    try {
      const org = getActiveOrganizationId();
      const id = positiveInt(req.params.id, 0);
      const result = await pool.query(
        `SELECT po.id,po.order_number AS "number",po.status,po.approval_status AS "approvalStatus",
          CASE WHEN upper(po.approval_status) NOT IN ('APPROVED') THEN 'Complete approval'
               WHEN upper(po.status::text) IN ('DRAFT','OPEN') THEN 'Send to supplier'
               WHEN upper(po.status::text) IN ('SENT','ACKNOWLEDGED') AND COALESCE(c.status,'AWAITING')='AWAITING' THEN 'Await supplier confirmation'
               WHEN upper(po.status::text) IN ('SENT','ACKNOWLEDGED','PARTIALLY_RECEIVED') THEN 'Receive goods or services'
               WHEN upper(po.status::text)='RECEIVED' THEN 'Close purchase order' ELSE 'No action' END AS "nextAction",
          c.status AS "confirmationStatus",c.reason AS "confirmationReason",
          jsonb_build_object('requisitionId',po.requisition_id,'sourcingAwardId',po.sourcing_award_id,'contractId',po.contract_id) AS "linkedRecords",
          (SELECT count(*)::int FROM ap_receipts r WHERE r.organization_id=$1 AND r.purchase_order_id=po.id) AS "receiptCount",
          (SELECT count(*)::int FROM invoices i WHERE i.organization_id=$1 AND i.purchase_order_id=po.id) AS "invoiceCount",
          (SELECT count(*)::int FROM operational_exceptions e WHERE e.organization_id=$1 AND e.status IN ('open','in_progress') AND e.related_refs @> jsonb_build_object('purchaseOrderId',po.id)) AS "exceptionCount"
         FROM purchase_orders po
         LEFT JOIN LATERAL (SELECT status,reason FROM po_supplier_confirmations WHERE organization_id=$1 AND purchase_order_id=po.id ORDER BY created_at DESC,id DESC LIMIT 1) c ON true
         WHERE po.organization_id=$1 AND po.id=$2`,
        [org, id],
      );
      if (!result.rows[0]) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found.");
      return sendOk(res, result.rows[0]);
    } catch (error) { return handleError(res, error); }
  });

  app.get("/api/v2/procurement/receipts", ...read, async (req, res) => {
    try {
      const { page, pageSize, offset } = pagination(req);
      const org = getActiveOrganizationId();
      const q = String(req.query.q ?? "").trim();
      const status = String(req.query.status ?? "all").toUpperCase();
      const supplierId = req.query.supplierId ? positiveInt(req.query.supplierId, 0) : null;
      const warehouseId = req.query.warehouseId ? positiveInt(req.query.warehouseId, 0) : null;
      const params = [org, q || null, status === "ALL" ? null : status, supplierId, warehouseId, pageSize, offset];
      const where = `r.organization_id=$1 AND ($2::text IS NULL OR r.receipt_number ILIKE '%'||$2||'%' OR po.order_number ILIKE '%'||$2||'%') AND ($3::text IS NULL OR r.status::text=$3) AND ($4::int IS NULL OR COALESCE(r.supplier_id,po.supplier_id)=$4) AND ($5::int IS NULL OR EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.organization_id=$1 AND sm.reference_type='ap_receipt' AND sm.reference_id=r.id AND sm.warehouse_id=$5))`;
      const [rows, count] = await Promise.all([
        pool.query(`SELECT r.id,r.receipt_number AS "receiptNumber",r.purchase_order_id AS "purchaseOrderId",po.order_number AS "purchaseOrderNumber",COALESCE(r.supplier_id,po.supplier_id) AS "supplierId",s.name AS "supplierName",r.status,r.received_date AS "receivedDate",r.received_by AS "receivedBy",r.notes,(SELECT count(*)::int FROM ap_receipt_items ri WHERE ri.receipt_id=r.id) AS "lineCount",COALESCE((SELECT sum(accepted_quantity) FROM ap_receipt_items ri WHERE ri.receipt_id=r.id),0)::numeric::text AS "acceptedQuantity",COALESCE((SELECT sum(rejected_quantity) FROM ap_receipt_items ri WHERE ri.receipt_id=r.id),0)::numeric::text AS "rejectedQuantity",EXISTS(SELECT 1 FROM goods_receipt_reversals gr WHERE gr.organization_id=$1 AND gr.receipt_id=r.id) AS reversed FROM ap_receipts r JOIN purchase_orders po ON po.id=r.purchase_order_id AND po.organization_id=$1 LEFT JOIN suppliers s ON s.id=COALESCE(r.supplier_id,po.supplier_id) AND s.organization_id=$1 WHERE ${where} ORDER BY r.received_date DESC,r.id DESC LIMIT $6 OFFSET $7`, params),
        pool.query(`SELECT count(*)::int AS total FROM ap_receipts r JOIN purchase_orders po ON po.id=r.purchase_order_id AND po.organization_id=$1 WHERE ${where}`, params.slice(0, 5)),
      ]);
      const total = Number(count.rows[0]?.total ?? 0);
      return sendOk(res, { items: rows.rows, total, page, pageSize, hasNext: page * pageSize < total });
    } catch (error) { return handleError(res, error); }
  });

  app.get("/api/v2/procurement/receipts/:id", ...read, async (req, res) => {
    try {
      const org = getActiveOrganizationId();
      const id = positiveInt(req.params.id, 0);
      const [receipt, lines, reversals] = await Promise.all([
        pool.query(`SELECT r.*,po.order_number,COALESCE(r.supplier_id,po.supplier_id) AS supplier_id,s.name AS supplier_name FROM ap_receipts r JOIN purchase_orders po ON po.id=r.purchase_order_id AND po.organization_id=$1 LEFT JOIN suppliers s ON s.id=COALESCE(r.supplier_id,po.supplier_id) AND s.organization_id=$1 WHERE r.organization_id=$1 AND r.id=$2`, [org, id]),
        pool.query(`SELECT ri.*,COALESCE(ii.sku,poi.item_code_snapshot,'ITEM-'||ri.item_id::text) AS sku,COALESCE(ii.name,poi.item_description_snapshot,poi.description,'Historical item') AS item_name,poi.quantity AS ordered_quantity,poi.received_quantity FROM ap_receipt_items ri JOIN ap_receipts r ON r.id=ri.receipt_id AND r.organization_id=$1 LEFT JOIN inventory_items ii ON ii.id=ri.item_id AND ii.organization_id=$1 LEFT JOIN purchase_order_items poi ON poi.id=ri.purchase_order_item_id AND poi.order_id=r.purchase_order_id WHERE ri.receipt_id=$2 ORDER BY ri.id`, [org, id]),
        pool.query(`SELECT * FROM goods_receipt_reversals WHERE organization_id=$1 AND receipt_id=$2 ORDER BY created_at DESC`, [org, id]),
      ]);
      if (!receipt.rows[0]) return sendError(res, 404, "RECEIPT_NOT_FOUND", "Goods receipt not found.");
      return sendOk(res, { receipt: receipt.rows[0], lines: lines.rows, reversals: reversals.rows });
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/procurement/purchase-orders/:id/receive", ...manage, async (req, res) => {
    try {
      const found = await pool.query(
        `SELECT order_number FROM purchase_orders WHERE id=$1 AND organization_id=$2`,
        [positiveInt(req.params.id, 0), getActiveOrganizationId()],
      );
      if (!found.rows[0]) return sendError(res, 404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found.");
      return res.redirect(307, `/api/ops/purchase-orders/${encodeURIComponent(found.rows[0].order_number)}/receive`);
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/procurement/receipts/:id/reverse", ...approve, async (req, res) => {
    try {
      const reason = z.string().trim().min(5).max(2000).parse(req.body?.reason);
      const key = String(req.get("Idempotency-Key") ?? "").trim();
      if (!key) return sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.");
      const org = getActiveOrganizationId(), receiptId = positiveInt(req.params.id, 0), userId = Number((req as any).user?.id ?? 0);
      await assertPhaseEnabled(org, 2);
      const result = await withTransaction(async (client) => {
        const existing = await client.query(`SELECT * FROM goods_receipt_reversals WHERE organization_id=$1 AND idempotency_key=$2`, [org, key]);
        if (existing.rows[0]) return existing.rows[0];
        const receipt = await client.query(`SELECT * FROM ap_receipts WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [org, receiptId]);
        if (!receipt.rows[0]) throw new Error("NOT_FOUND");
        if (String(receipt.rows[0].status) !== "POSTED") throw new Error("STATE_RECEIPT_NOT_POSTED");
        const items = await client.query(`SELECT * FROM ap_receipt_items WHERE receipt_id=$1 ORDER BY id FOR UPDATE`, [receiptId]);
        for (const line of items.rows) {
          const quantity = Math.round(Number(line.accepted_quantity ?? 0));
          const movement = await client.query(`SELECT warehouse_id FROM stock_movements WHERE organization_id=$1 AND reference_type='ap_receipt' AND reference_id=$2 AND item_id=$3 ORDER BY id DESC LIMIT 1`, [org, receiptId, line.item_id]);
          const warehouseId = movement.rows[0]?.warehouse_id;
          if (warehouseId && quantity > 0) {
            const stock = await client.query(`SELECT id,quantity FROM warehouse_inventory WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 FOR UPDATE`, [org, warehouseId, line.item_id]);
            if (!stock.rows[0] || Number(stock.rows[0].quantity) < quantity) throw new Error("INSUFFICIENT_STOCK_FOR_REVERSAL");
            await client.query(`UPDATE warehouse_inventory SET quantity=quantity-$1,updated_at=now() WHERE id=$2`, [quantity, stock.rows[0].id]);
            await client.query(`UPDATE inventory_items SET quantity=quantity-$1,updated_at=now() WHERE id=$2 AND organization_id=$3`, [quantity, line.item_id, org]);
            await client.query(`INSERT INTO stock_movements (organization_id,item_id,warehouse_id,type,quantity,reference_id,reference_type,notes,user_id,previous_quantity,new_quantity,timestamp) VALUES ($1,$2,$3,'RECEIPT_REVERSAL',$4,$5,'ap_receipt_reversal',$6,$7,$8,$9,now())`, [org, line.item_id, warehouseId, -quantity, receiptId, reason, userId || null, Number(stock.rows[0].quantity), Number(stock.rows[0].quantity) - quantity]);
          }
          if (line.purchase_order_item_id) await client.query(`UPDATE purchase_order_items SET received_quantity=GREATEST(COALESCE(received_quantity,0)-$1,0) WHERE id=$2`, [Number(line.accepted_quantity ?? 0), line.purchase_order_item_id]);
        }
        await client.query(`UPDATE ap_receipts SET status='CANCELLED',updated_at=now() WHERE id=$1 AND organization_id=$2`, [receiptId, org]);
        await client.query(
          `UPDATE purchase_orders po SET status=CASE
             WHEN COALESCE(x.received,0) <= 0 THEN 'SENT'::purchase_order_status
             WHEN COALESCE(x.received,0) < COALESCE(x.ordered,0) THEN 'PARTIALLY_RECEIVED'::purchase_order_status
             ELSE 'RECEIVED'::purchase_order_status END, updated_at=now()
           FROM (SELECT purchase_order_id,sum(quantity)::numeric AS ordered,sum(COALESCE(received_quantity,0))::numeric AS received
                 FROM purchase_order_items WHERE purchase_order_id=$1 GROUP BY purchase_order_id) x
           WHERE po.id=x.purchase_order_id AND po.organization_id=$2`,
          [receipt.rows[0].purchase_order_id, org],
        );
        const inserted = await client.query(`INSERT INTO goods_receipt_reversals (organization_id,receipt_id,reason,reversed_by,idempotency_key) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [org, receiptId, reason, userId || null, key]);
        await recordActivity(client, org, "goods_receipt", receiptId, "GOODS_RECEIPT_REVERSED", { actorUserId: userId, reason });
        return inserted.rows[0];
      });
      return sendOk(res, result, 201);
    } catch (error) { return handleError(res, error); }
  });

  app.get("/api/v2/procurement/contracts", ...read, async (req, res) => {
    try {
      const { page, pageSize, offset } = pagination(req); const org = getActiveOrganizationId(); const q = String(req.query.q ?? "").trim();
      const [rows, count] = await Promise.all([
        pool.query(`SELECT c.id,c.contract_number AS "contractNumber",c.title,c.contract_type AS "contractType",c.supplier_id AS "supplierId",s.name AS "supplierName",c.status,c.approval_status AS "approvalStatus",c.start_date AS "startDate",c.end_date AS "endDate",c.maximum_value::text AS "maximumValue",c.committed_value::text AS "committedValue",CASE WHEN c.maximum_value IS NULL THEN NULL ELSE (c.maximum_value-c.committed_value)::text END AS "remainingValue",c.currency,c.version FROM supplier_contracts c JOIN suppliers s ON s.id=c.supplier_id AND s.organization_id=$1 WHERE c.organization_id=$1 AND ($2='' OR c.title ILIKE '%'||$2||'%' OR c.contract_number ILIKE '%'||$2||'%' OR s.name ILIKE '%'||$2||'%') ORDER BY c.updated_at DESC,c.id DESC LIMIT $3 OFFSET $4`, [org, q, pageSize, offset]),
        pool.query(`SELECT count(*)::int AS total FROM supplier_contracts c JOIN suppliers s ON s.id=c.supplier_id AND s.organization_id=$1 WHERE c.organization_id=$1 AND ($2='' OR c.title ILIKE '%'||$2||'%' OR c.contract_number ILIKE '%'||$2||'%' OR s.name ILIKE '%'||$2||'%')`, [org, q]),
      ]); const total = Number(count.rows[0]?.total ?? 0); return sendOk(res, { items: rows.rows, total, page, pageSize, hasNext: page * pageSize < total });
    } catch (error) { return handleError(res, error); }
  });

  app.get("/api/v2/procurement/contracts/:id", ...read, async (req, res) => {
    try {
      const org = getActiveOrganizationId(), id = positiveInt(req.params.id, 0);
      const [contract, lines, releases] = await Promise.all([
        pool.query(`SELECT c.*,s.name AS supplier_name,u.username AS owner_name FROM supplier_contracts c JOIN suppliers s ON s.id=c.supplier_id AND s.organization_id=$1 LEFT JOIN users u ON u.id=c.owner_user_id WHERE c.id=$2 AND c.organization_id=$1`, [org, id]),
        pool.query(`SELECT l.id,l.line_number AS "lineNumber",l.item_id AS "itemId",i.sku,i.name AS "itemName",l.description,l.unit_of_measure_id AS "unitOfMeasureId",uom.code AS "unitOfMeasure",l.currency_code AS "currencyCode",l.unit_price::text AS "unitPrice",l.minimum_quantity::text AS "minimumQuantity",l.maximum_quantity::text AS "maximumQuantity",l.tax_code_id AS "taxCodeId",l.valid_from AS "validFrom",l.valid_to AS "validTo",l.active FROM supplier_contract_lines l LEFT JOIN inventory_items i ON i.id=l.item_id AND i.organization_id=$1 LEFT JOIN units_of_measure uom ON uom.id=l.unit_of_measure_id WHERE l.organization_id=$1 AND l.contract_id=$2 ORDER BY l.line_number,l.id`, [org, id]),
        pool.query(`SELECT r.id,r.requisition_id AS "requisitionId",r.purchase_order_id AS "purchaseOrderId",po.order_number AS "purchaseOrderNumber",r.release_amount::text AS "releaseAmount",r.created_at AS "createdAt" FROM supplier_contract_releases r JOIN purchase_orders po ON po.id=r.purchase_order_id AND po.organization_id=$1 WHERE r.organization_id=$1 AND r.contract_id=$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 100`, [org, id]),
      ]);
      if (!contract.rows[0]) return sendError(res, 404, "CONTRACT_NOT_FOUND", "Contract not found.");
      return sendOk(res, { contract: contract.rows[0], lines: lines.rows, releases: releases.rows });
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/procurement/contracts/:id/lines", ...manage, async (req, res) => {
    try {
      const body = z.object({ itemId: z.coerce.number().int().positive().optional().nullable(), description: z.string().trim().min(2), unitOfMeasureId: z.coerce.number().int().positive().optional().nullable(), currencyCode: z.string().trim().length(3), unitPrice: z.coerce.number().nonnegative(), minimumQuantity: z.coerce.number().nonnegative().default(0), maximumQuantity: z.coerce.number().positive().optional().nullable(), taxCodeId: z.coerce.number().int().positive().optional().nullable(), validFrom: z.coerce.date(), validTo: z.coerce.date().optional().nullable() }).parse(req.body);
      const org = getActiveOrganizationId(), id = positiveInt(req.params.id, 0);
      await assertPhaseEnabled(org, 2);
      const created = await withTransaction(async (client) => {
        const contract = await client.query(`SELECT id,approval_status FROM supplier_contracts WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, org]);
        if (!contract.rows[0]) throw new Error("NOT_FOUND");
        if (contract.rows[0].approval_status === "APPROVED") throw new Error("STATE_APPROVED_CONTRACT_IMMUTABLE");
        if (body.itemId) { const owned = await client.query(`SELECT 1 FROM inventory_items WHERE id=$1 AND organization_id=$2`, [body.itemId, org]); if (!owned.rows[0]) throw new Error("INVALID_ITEM"); }
        const lineNo = await client.query(`SELECT COALESCE(max(line_number),0)+1 AS next FROM supplier_contract_lines WHERE contract_id=$1`, [id]);
        const line = await client.query(`INSERT INTO supplier_contract_lines (organization_id,contract_id,line_number,item_id,description,unit_of_measure_id,currency_code,unit_price,minimum_quantity,maximum_quantity,tax_code_id,valid_from,valid_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [org,id,lineNo.rows[0].next,body.itemId??null,body.description,body.unitOfMeasureId??null,body.currencyCode.toUpperCase(),body.unitPrice,body.minimumQuantity,body.maximumQuantity??null,body.taxCodeId??null,body.validFrom,body.validTo??null]);
        await client.query(`UPDATE supplier_contracts SET version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2`, [id, org]);
        return line.rows[0];
      });
      return sendOk(res, created, 201);
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/procurement/contracts/:id/approve", ...approve, async (req, res) => {
    try {
      const org=getActiveOrganizationId(),id=positiveInt(req.params.id,0),userId=Number((req as any).user?.id??0);
      await assertPhaseEnabled(org, 2);
      const result=await pool.query(`UPDATE supplier_contracts SET approval_status='APPROVED',status='active',version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND approval_status IN ('DRAFT','PENDING_APPROVAL') AND start_date<=now() AND (end_date IS NULL OR end_date>=now()) AND (owner_user_id IS NULL OR owner_user_id<>$3) RETURNING *`,[id,org,userId]);
      if(!result.rows[0]) return sendError(res,409,"CONTRACT_APPROVAL_BLOCKED","Contract must be current, pending approval, and approved by someone other than its owner."); return sendOk(res,result.rows[0]);
    } catch(error){return handleError(res,error);}
  });

  app.post("/api/v2/procurement/contracts/:id/release-po", ...manage, async (req,res)=>{
    try{
      const body=z.object({purchaseOrderId:z.coerce.number().int().positive(),requisitionId:z.coerce.number().int().positive().optional().nullable()}).parse(req.body);
      const key=String(req.get("Idempotency-Key")??"").trim();if(!key)return sendError(res,400,"IDEMPOTENCY_KEY_REQUIRED","Idempotency-Key is required.");
      const org=getActiveOrganizationId(),id=positiveInt(req.params.id,0),userId=Number((req as any).user?.id??0);
      await assertPhaseEnabled(org, 2);
      const released=await withTransaction(async(client)=>{
        const previous=await client.query(`SELECT * FROM supplier_contract_releases WHERE organization_id=$1 AND idempotency_key=$2`,[org,key]);
        if(previous.rows[0]) return previous.rows[0];
        const c=await client.query(`SELECT * FROM supplier_contracts WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,org]);
        if(!c.rows[0])throw new Error("NOT_FOUND");
        if(c.rows[0].approval_status!=="APPROVED"||c.rows[0].status!=="active"||new Date(c.rows[0].start_date)>new Date()||(c.rows[0].end_date&&new Date(c.rows[0].end_date)<new Date()))throw new Error("STATE_CONTRACT_NOT_AVAILABLE");
        const po=await client.query(`SELECT * FROM purchase_orders WHERE id=$1 AND organization_id=$2 AND supplier_id=$3 FOR UPDATE`,[body.purchaseOrderId,org,c.rows[0].supplier_id]);
        if(!po.rows[0])throw new Error("INVALID_PURCHASE_ORDER");
        const amount=Number(po.rows[0].total_amount);
        if(c.rows[0].maximum_value!=null&&Number(c.rows[0].committed_value)+amount>Number(c.rows[0].maximum_value))throw new Error("INSUFFICIENT_CONTRACT_VALUE");
        const ins=await client.query(`INSERT INTO supplier_contract_releases (organization_id,contract_id,requisition_id,purchase_order_id,release_amount,released_by,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[org,id,body.requisitionId??null,body.purchaseOrderId,amount,userId||null,key]);
        await client.query(`UPDATE supplier_contracts SET committed_value=committed_value+$1,version=version+1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[amount,id,org]);
        await client.query(`UPDATE purchase_orders SET contract_id=$1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[id,body.purchaseOrderId,org]);
        return ins.rows[0];
      });return sendOk(res,released,201);
    }catch(error){return handleError(res,error);}
  });

  app.get("/api/v2/procurement/supplier-price-lists",...read,async(req,res)=>{try{const {page,pageSize,offset}=pagination(req),org=getActiveOrganizationId(),supplierId=req.query.supplierId?positiveInt(req.query.supplierId,0):null;const [rows,count]=await Promise.all([pool.query(`SELECT p.id,p.code,p.name,p.supplier_id AS "supplierId",s.name AS "supplierName",p.currency_code AS "currencyCode",p.valid_from AS "validFrom",p.valid_to AS "validTo",p.status,(SELECT count(*)::int FROM supplier_price_list_lines l WHERE l.price_list_id=p.id) AS "lineCount" FROM supplier_price_lists p JOIN suppliers s ON s.id=p.supplier_id AND s.organization_id=$1 WHERE p.organization_id=$1 AND ($2::int IS NULL OR p.supplier_id=$2) ORDER BY p.updated_at DESC,p.id DESC LIMIT $3 OFFSET $4`,[org,supplierId,pageSize,offset]),pool.query(`SELECT count(*)::int total FROM supplier_price_lists WHERE organization_id=$1 AND ($2::int IS NULL OR supplier_id=$2)`,[org,supplierId])]);const total=Number(count.rows[0]?.total??0);return sendOk(res,{items:rows.rows,total,page,pageSize,hasNext:page*pageSize<total});}catch(error){return handleError(res,error);}});

  app.post("/api/v2/procurement/supplier-price-lists",...manage,async(req,res)=>{try{const body=z.object({supplierId:z.coerce.number().int().positive(),code:z.string().trim().min(2),name:z.string().trim().min(2),currencyCode:z.string().trim().length(3),validFrom:z.coerce.date(),validTo:z.coerce.date().optional().nullable(),lines:z.array(z.object({itemId:z.coerce.number().int().positive().optional().nullable(),description:z.string().trim().min(2),unitOfMeasureId:z.coerce.number().int().positive().optional().nullable(),minimumQuantity:z.coerce.number().nonnegative().default(0),unitPrice:z.coerce.number().nonnegative(),leadTimeDays:z.coerce.number().int().nonnegative().optional().nullable()})).min(1)}).parse(req.body);const org=getActiveOrganizationId();await assertPhaseEnabled(org,3);const created=await withTransaction(async(client)=>{const supplier=await client.query(`SELECT id FROM suppliers WHERE id=$1 AND organization_id=$2 AND status='active'`,[body.supplierId,org]);if(!supplier.rows[0])throw new Error("INVALID_SUPPLIER");const header=await client.query(`INSERT INTO supplier_price_lists (organization_id,supplier_id,code,name,currency_code,valid_from,valid_to) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[org,body.supplierId,body.code,body.name,body.currencyCode.toUpperCase(),body.validFrom,body.validTo??null]);for(const line of body.lines)await client.query(`INSERT INTO supplier_price_list_lines (organization_id,price_list_id,item_id,description,unit_of_measure_id,minimum_quantity,unit_price,lead_time_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[org,header.rows[0].id,line.itemId??null,line.description,line.unitOfMeasureId??null,line.minimumQuantity,line.unitPrice,line.leadTimeDays??null]);return header.rows[0];});return sendOk(res,created,201);}catch(error){return handleError(res,error);}});

  app.post("/api/v2/procurement/supplier-price-lists/:id/approve",...approve,async(req,res)=>{try{const org=getActiveOrganizationId(),id=positiveInt(req.params.id,0),userId=Number((req as any).user?.id??0);await assertPhaseEnabled(org,3);const result=await pool.query(`UPDATE supplier_price_lists SET status='ACTIVE',approved_by=$1,approved_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 AND status='DRAFT' AND valid_from<=now() AND (valid_to IS NULL OR valid_to>=now()) RETURNING *`,[userId||null,id,org]);if(!result.rows[0])return sendError(res,409,"PRICE_LIST_APPROVAL_BLOCKED","Price list must be a current draft.");return sendOk(res,result.rows[0]);}catch(error){return handleError(res,error);}});

  app.get("/api/v2/procurement/pricing/resolve", ...read, async (req, res) => {
    try {
      const input = z.object({ supplierId: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive(), quantity: z.coerce.number().positive(), contractId: z.coerce.number().int().positive().optional(), sourcingAwardId: z.coerce.number().int().positive().optional() }).parse(req.query);
      const org = getActiveOrganizationId();
      const contract = await pool.query(`SELECT l.id AS "lineId",l.contract_id AS "contractId",c.contract_number AS "reference",l.unit_price::text AS "unitPrice",l.currency_code AS "currencyCode",'CONTRACT'::text AS source FROM supplier_contract_lines l JOIN supplier_contracts c ON c.id=l.contract_id AND c.organization_id=$1 WHERE l.organization_id=$1 AND c.supplier_id=$2 AND l.item_id=$3 AND l.active=true AND c.approval_status='APPROVED' AND c.status='active' AND ($4::int IS NULL OR c.id=$4) AND l.minimum_quantity<=$5 AND (l.maximum_quantity IS NULL OR l.maximum_quantity>=$5) AND l.valid_from<=now() AND (l.valid_to IS NULL OR l.valid_to>=now()) AND c.start_date<=now() AND (c.end_date IS NULL OR c.end_date>=now()) ORDER BY l.minimum_quantity DESC,l.id DESC LIMIT 1`, [org,input.supplierId,input.itemId,input.contractId??null,input.quantity]);
      if (contract.rows[0]) return sendOk(res, { resolved: true, ...contract.rows[0], manualOverrideRequiresReason: false });
      const priceList = await pool.query(`SELECT l.id AS "lineId",l.price_list_id AS "priceListId",p.code AS "reference",l.unit_price::text AS "unitPrice",p.currency_code AS "currencyCode",l.lead_time_days AS "leadTimeDays",'PRICE_LIST'::text AS source FROM supplier_price_list_lines l JOIN supplier_price_lists p ON p.id=l.price_list_id AND p.organization_id=$1 WHERE l.organization_id=$1 AND p.supplier_id=$2 AND l.item_id=$3 AND l.active=true AND p.status='ACTIVE' AND l.minimum_quantity<=$4 AND p.valid_from<=now() AND (p.valid_to IS NULL OR p.valid_to>=now()) ORDER BY l.minimum_quantity DESC,p.valid_from DESC,l.id DESC LIMIT 1`, [org,input.supplierId,input.itemId,input.quantity]);
      if (priceList.rows[0]) return sendOk(res, { resolved: true, ...priceList.rows[0], manualOverrideRequiresReason: false });
      if (input.sourcingAwardId) {
        const award = await pool.query(`SELECT al.id AS "lineId",al.award_id AS "sourcingAwardId",('Award #'||al.award_id)::text AS reference,al.awarded_unit_price::text AS "unitPrice",al.currency_code AS "currencyCode",'SOURCING_AWARD'::text AS source FROM sourcing_award_lines al JOIN sourcing_awards a ON a.id=al.award_id AND a.organization_id=$1 JOIN sourcing_event_lines el ON el.id=al.event_line_id AND el.organization_id=$1 WHERE al.organization_id=$1 AND al.supplier_id=$2 AND el.item_id=$3 AND al.award_id=$4 AND a.status IN ('APPROVED','CONVERTED') ORDER BY al.id DESC LIMIT 1`, [org,input.supplierId,input.itemId,input.sourcingAwardId]);
        if (award.rows[0]) return sendOk(res, { resolved: true, ...award.rows[0], manualOverrideRequiresReason: false });
      }
      return sendOk(res, { resolved: false, source: "MANUAL", unitPrice: null, currencyCode: null, reference: null, manualOverrideRequiresReason: true });
    } catch (error) { return handleError(res, error); }
  });

  app.get("/api/v2/finance/budgets",...read,async(req,res)=>{try{
    const {page,pageSize,offset}=pagination(req),org=getActiveOrganizationId(),year=positiveInt(req.query.fiscalYear,new Date().getFullYear());
    const [rows,count]=await Promise.all([
      pool.query(`SELECT b.id,b.fiscal_year AS "fiscalYear",b.currency_code AS "currencyCode",b.department_id AS "departmentId",d.name AS "departmentName",b.cost_centre_id AS "costCentreId",cc.name AS "costCentreName",b.project_id AS "projectId",b.gl_account_code AS "glAccountCode",b.approved_amount::text AS "approvedAmount",b.status,COALESCE(sum(CASE WHEN c.status='ACTIVE' THEN c.amount ELSE 0 END),0)::text AS committed,(b.approved_amount-COALESCE(sum(CASE WHEN c.status='ACTIVE' THEN c.amount ELSE 0 END),0))::text AS available FROM finance_budgets b LEFT JOIN departments d ON d.id=b.department_id AND d.organization_id=$1 LEFT JOIN mdm_cost_centres cc ON cc.id=b.cost_centre_id AND cc.organization_id=$1 LEFT JOIN budget_commitments c ON c.budget_id=b.id AND c.organization_id=$1 WHERE b.organization_id=$1 AND b.fiscal_year=$2 GROUP BY b.id,d.name,cc.name ORDER BY b.updated_at DESC,b.id DESC LIMIT $3 OFFSET $4`,[org,year,pageSize,offset]),
      pool.query(`SELECT count(*)::int total FROM finance_budgets WHERE organization_id=$1 AND fiscal_year=$2`,[org,year]),
    ]);
    const total=Number(count.rows[0]?.total??0);return sendOk(res,{items:rows.rows,total,page,pageSize,hasNext:page*pageSize<total});
  }catch(error){return handleError(res,error);}});

  app.post("/api/v2/finance/budgets",...admin,async(req,res)=>{try{
    const body=z.object({fiscalYear:z.coerce.number().int().min(2000).max(2200),currencyCode:z.string().trim().length(3),departmentId:z.coerce.number().int().positive().optional().nullable(),costCentreId:z.coerce.number().int().positive().optional().nullable(),projectId:z.coerce.number().int().positive().optional().nullable(),glAccountCode:z.string().trim().max(80).optional().nullable(),approvedAmount:z.coerce.number().nonnegative(),status:z.enum(["DRAFT","ACTIVE"]).default("DRAFT")}).parse(req.body);
    const org=getActiveOrganizationId();
    await assertPhaseEnabled(org,3);
    if(body.departmentId){const owned=await pool.query(`SELECT 1 FROM departments WHERE id=$1 AND organization_id=$2`,[body.departmentId,org]);if(!owned.rows[0])throw new Error("INVALID_DEPARTMENT");}
    if(body.costCentreId){const owned=await pool.query(`SELECT 1 FROM mdm_cost_centres WHERE id=$1 AND organization_id=$2`,[body.costCentreId,org]);if(!owned.rows[0])throw new Error("INVALID_COST_CENTRE");}
    const result=await pool.query(`INSERT INTO finance_budgets (organization_id,fiscal_year,currency_code,department_id,cost_centre_id,project_id,gl_account_code,approved_amount,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[org,body.fiscalYear,body.currencyCode.toUpperCase(),body.departmentId??null,body.costCentreId??null,body.projectId??null,body.glAccountCode??null,body.approvedAmount,body.status]);
    return sendOk(res,result.rows[0],201);
  }catch(error){return handleError(res,error);}});

  app.post("/api/v2/finance/budgets/:id/activate",...admin,async(req,res)=>{try{const org=getActiveOrganizationId();await assertPhaseEnabled(org,3);const result=await pool.query(`UPDATE finance_budgets SET status='ACTIVE',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='DRAFT' RETURNING *`,[positiveInt(req.params.id,0),org]);if(!result.rows[0])return sendError(res,409,"BUDGET_ACTIVATION_BLOCKED","Only a tenant-owned draft budget can be activated.");return sendOk(res,result.rows[0]);}catch(error){return handleError(res,error);}});

  app.get("/api/v2/procurement/budgets/availability",...read,async(req,res)=>{try{const org=getActiveOrganizationId(),departmentId=req.query.departmentId?positiveInt(req.query.departmentId,0):null,costCentreId=req.query.costCentreId?positiveInt(req.query.costCentreId,0):null,year=positiveInt(req.query.fiscalYear,new Date().getFullYear());const rows=await pool.query(`SELECT b.id,b.currency_code AS "currencyCode",b.approved_amount::text AS "approvedAmount",COALESCE(sum(CASE WHEN c.status='ACTIVE' THEN c.amount ELSE 0 END),0)::text AS committed,(b.approved_amount-COALESCE(sum(CASE WHEN c.status='ACTIVE' THEN c.amount ELSE 0 END),0))::text AS available FROM finance_budgets b LEFT JOIN budget_commitments c ON c.budget_id=b.id AND c.organization_id=$1 WHERE b.organization_id=$1 AND b.fiscal_year=$2 AND b.status='ACTIVE' AND ($3::int IS NULL OR b.department_id=$3) AND ($4::int IS NULL OR b.cost_centre_id=$4) GROUP BY b.id ORDER BY b.id`,[org,year,departmentId,costCentreId]);return sendOk(res,rows.rows);}catch(error){return handleError(res,error);}});

  app.get("/api/v2/procurement/returns",...read,async(req,res)=>{try{const {page,pageSize,offset}=pagination(req),org=getActiveOrganizationId(),status=String(req.query.status??"all").toUpperCase();const [rows,count]=await Promise.all([pool.query(`SELECT r.id,r.return_number AS "returnNumber",r.purchase_order_id AS "purchaseOrderId",po.order_number AS "purchaseOrderNumber",r.receipt_id AS "receiptId",r.supplier_id AS "supplierId",s.name AS "supplierName",r.warehouse_id AS "warehouseId",w.name AS "warehouseName",r.status,r.reason,r.created_at AS "createdAt",COALESCE((SELECT sum(quantity) FROM purchase_return_lines l WHERE l.return_id=r.id),0)::numeric::text AS quantity FROM purchase_returns r JOIN purchase_orders po ON po.id=r.purchase_order_id AND po.organization_id=$1 JOIN suppliers s ON s.id=r.supplier_id AND s.organization_id=$1 JOIN warehouses w ON w.id=r.warehouse_id AND w.organization_id=$1 WHERE r.organization_id=$1 AND ($2='ALL' OR r.status=$2) ORDER BY r.updated_at DESC,r.id DESC LIMIT $3 OFFSET $4`,[org,status,pageSize,offset]),pool.query(`SELECT count(*)::int total FROM purchase_returns WHERE organization_id=$1 AND ($2='ALL' OR status=$2)`,[org,status])]);const total=Number(count.rows[0]?.total??0);return sendOk(res,{items:rows.rows,total,page,pageSize,hasNext:page*pageSize<total});}catch(error){return handleError(res,error);}});

  app.post("/api/v2/procurement/returns",...manage,async(req,res)=>{try{const body=z.object({receiptId:z.coerce.number().int().positive(),warehouseId:z.coerce.number().int().positive(),reason:z.string().trim().min(5),lines:z.array(z.object({receiptItemId:z.coerce.number().int().positive(),quantity:z.coerce.number().positive(),reason:z.string().trim().min(3),unitPrice:z.coerce.number().nonnegative().default(0),taxAmount:z.coerce.number().nonnegative().default(0),batchNumber:z.string().optional().nullable(),serialNumbers:z.array(z.string()).default([])})).min(1)}).parse(req.body);const org=getActiveOrganizationId(),userId=Number((req as any).user?.id??0);await assertPhaseEnabled(org,4);const created=await withTransaction(async(client)=>{const receipt=await client.query(`SELECT r.*,po.supplier_id FROM ap_receipts r JOIN purchase_orders po ON po.id=r.purchase_order_id AND po.organization_id=$1 WHERE r.id=$2 AND r.organization_id=$1 AND r.status='POSTED' FOR UPDATE`,[org,body.receiptId]);if(!receipt.rows[0])throw new Error("INVALID_RECEIPT");const warehouse=await client.query(`SELECT id FROM warehouses WHERE id=$1 AND organization_id=$2 AND active=true`,[body.warehouseId,org]);if(!warehouse.rows[0])throw new Error("INVALID_WAREHOUSE");const number=`RTN-${new Date().getUTCFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`;const header=await client.query(`INSERT INTO purchase_returns (organization_id,return_number,purchase_order_id,receipt_id,supplier_id,warehouse_id,reason,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[org,number,receipt.rows[0].purchase_order_id,body.receiptId,receipt.rows[0].supplier_id,body.warehouseId,body.reason,userId||null]);for(const line of body.lines){
        const ri=await client.query(
          `SELECT ri.*,
             COALESCE((SELECT sum(prl.quantity) FROM purchase_return_lines prl
               JOIN purchase_returns pr ON pr.id=prl.return_id AND pr.organization_id=$3
               WHERE prl.receipt_item_id=ri.id AND pr.status<>'CANCELLED'),0) AS already_returned
           FROM ap_receipt_items ri WHERE ri.id=$1 AND ri.receipt_id=$2 FOR UPDATE`,
          [line.receiptItemId,body.receiptId,org],
        );
        const remaining=Number(ri.rows[0]?.accepted_quantity??0)-Number(ri.rows[0]?.already_returned??0);
        if(!ri.rows[0]||Number(line.quantity)>remaining)throw new Error("INVALID_RETURN_QUANTITY");
        await client.query(`INSERT INTO purchase_return_lines (organization_id,return_id,receipt_item_id,item_id,quantity,unit_price,tax_amount,batch_number,serial_numbers,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[org,header.rows[0].id,line.receiptItemId,ri.rows[0].item_id,line.quantity,line.unitPrice,line.taxAmount,line.batchNumber??null,JSON.stringify(line.serialNumbers),line.reason]);
      }return header.rows[0];});return sendOk(res,created,201);}catch(error){return handleError(res,error);}});

  for(const action of ["submit","approve","cancel"] as const){app.post(`/api/v2/procurement/returns/:id/${action}`,...(action==="approve"?approve:manage),async(req,res)=>{try{const org=getActiveOrganizationId(),id=positiveInt(req.params.id,0),userId=Number((req as any).user?.id??0),reason=String(req.body?.reason??"").trim();await assertPhaseEnabled(org,4);if(action==="cancel"&&reason.length<5)return sendError(res,400,"CANCELLATION_REASON_REQUIRED","A meaningful cancellation reason is required.");const from=action==="submit"?["DRAFT"]:action==="approve"?["PENDING_APPROVAL"]:["DRAFT","PENDING_APPROVAL","APPROVED"];const to=action==="submit"?"PENDING_APPROVAL":action==="approve"?"APPROVED":"CANCELLED";const result=await pool.query(`UPDATE purchase_returns SET status=$1,approved_by=CASE WHEN $1='APPROVED' THEN $2 ELSE approved_by END,approved_at=CASE WHEN $1='APPROVED' THEN now() ELSE approved_at END,reason=CASE WHEN $1='CANCELLED' AND $3<>'' THEN $3 ELSE reason END,updated_at=now() WHERE id=$4 AND organization_id=$5 AND status=ANY($6::text[]) AND ($1<>'APPROVED' OR created_by IS NULL OR created_by<>$2) RETURNING *`,[to,userId||null,reason,id,org,from]);if(!result.rows[0])return sendError(res,409,"RETURN_TRANSITION_BLOCKED","The transition is invalid or the creator attempted to approve their own return.");return sendOk(res,result.rows[0]);}catch(error){return handleError(res,error);}});}

  app.post("/api/v2/procurement/returns/:id/dispatch",...manage,async(req,res)=>{try{const key=String(req.get("Idempotency-Key")??"").trim();if(!key)return sendError(res,400,"IDEMPOTENCY_KEY_REQUIRED","Idempotency-Key is required.");const org=getActiveOrganizationId(),id=positiveInt(req.params.id,0),userId=Number((req as any).user?.id??0);await assertPhaseEnabled(org,4);const result=await withTransaction(async(client)=>{const header=await client.query(`SELECT * FROM purchase_returns WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,org]);if(!header.rows[0])throw new Error("NOT_FOUND");if(header.rows[0].status==="DISPATCHED")return header.rows[0];if(header.rows[0].status!=="APPROVED")throw new Error("STATE_RETURN_NOT_APPROVED");const lines=await client.query(`SELECT * FROM purchase_return_lines WHERE return_id=$1 AND organization_id=$2 ORDER BY id FOR UPDATE`,[id,org]);for(const line of lines.rows){const qty=Math.round(Number(line.quantity));const stock=await client.query(`SELECT id,quantity FROM warehouse_inventory WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 FOR UPDATE`,[org,header.rows[0].warehouse_id,line.item_id]);if(!stock.rows[0]||Number(stock.rows[0].quantity)<qty)throw new Error("INSUFFICIENT_STOCK_FOR_RETURN");await client.query(`UPDATE warehouse_inventory SET quantity=quantity-$1,updated_at=now() WHERE id=$2`,[qty,stock.rows[0].id]);await client.query(`UPDATE inventory_items SET quantity=quantity-$1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[qty,line.item_id,org]);await client.query(`INSERT INTO stock_movements (organization_id,item_id,warehouse_id,type,quantity,reference_id,reference_type,notes,user_id,previous_quantity,new_quantity,timestamp) VALUES ($1,$2,$3,'PURCHASE_RETURN',$4,$5,'purchase_return',$6,$7,$8,$9,now())`,[org,line.item_id,header.rows[0].warehouse_id,-qty,id,header.rows[0].reason,userId||null,Number(stock.rows[0].quantity),Number(stock.rows[0].quantity)-qty]);}const totals=await client.query(`SELECT COALESCE(sum(quantity*unit_price),0) subtotal,COALESCE(sum(tax_amount),0) tax FROM purchase_return_lines WHERE return_id=$1`,[id]);const subtotal=Number(totals.rows[0].subtotal),tax=Number(totals.rows[0].tax);await client.query(`INSERT INTO supplier_debit_notes (organization_id,debit_note_number,return_id,supplier_id,currency_code,subtotal,tax_amount,total_amount) SELECT $1,$2,$3,$4,COALESCE(po.currency_code,'ZAR'),$5,$6,$7 FROM purchase_orders po WHERE po.id=$8 AND po.organization_id=$1 ON CONFLICT (organization_id,return_id) DO NOTHING`,[org,`DN-${new Date().getUTCFullYear()}-${id}`,id,header.rows[0].supplier_id,subtotal,tax,subtotal+tax,header.rows[0].purchase_order_id]);const updated=await client.query(`UPDATE purchase_returns SET status='DISPATCHED',dispatched_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,[id,org]);await recordActivity(client,org,"purchase_return",id,"PURCHASE_RETURN_DISPATCHED",{actorUserId:userId,idempotencyKey:key});return updated.rows[0];});return sendOk(res,result);}catch(error){return handleError(res,error);}});

  app.get("/api/v2/procurement/debit-notes", ...read, async (req, res) => {
    try {
      const { page, pageSize, offset } = pagination(req), org = getActiveOrganizationId();
      const status = String(req.query.status ?? "all").toUpperCase(), q = String(req.query.q ?? "").trim();
      const where = `d.organization_id=$1 AND ($2='ALL' OR d.status=$2) AND ($3='' OR d.debit_note_number ILIKE '%'||$3||'%' OR r.return_number ILIKE '%'||$3||'%' OR s.name ILIKE '%'||$3||'%')`;
      const [rows, count] = await Promise.all([
        pool.query(`SELECT d.id,d.debit_note_number AS "debitNoteNumber",d.return_id AS "returnId",r.return_number AS "returnNumber",d.supplier_id AS "supplierId",s.name AS "supplierName",d.currency_code AS "currencyCode",d.subtotal::text,d.tax_amount::text AS "taxAmount",d.total_amount::text AS "totalAmount",d.status,d.created_at AS "createdAt" FROM supplier_debit_notes d JOIN purchase_returns r ON r.id=d.return_id AND r.organization_id=$1 JOIN suppliers s ON s.id=d.supplier_id AND s.organization_id=$1 WHERE ${where} ORDER BY d.created_at DESC,d.id DESC LIMIT $4 OFFSET $5`, [org,status,q,pageSize,offset]),
        pool.query(`SELECT count(*)::int total FROM supplier_debit_notes d JOIN purchase_returns r ON r.id=d.return_id AND r.organization_id=$1 JOIN suppliers s ON s.id=d.supplier_id AND s.organization_id=$1 WHERE ${where}`, [org,status,q]),
      ]);
      const total = Number(count.rows[0]?.total ?? 0);
      return sendOk(res, { items: rows.rows, total, page, pageSize, hasNext: page * pageSize < total });
    } catch (error) { return handleError(res, error); }
  });
}
