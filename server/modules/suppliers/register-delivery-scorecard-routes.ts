import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "../../db";
import { sendError, sendOk, resolveRequestId } from "../../api-response";
import { getTenantContext } from "../../organization-context";
import { recordServerDiagnosticEvent } from "../../diagnostics/server-diagnostics-store";
import type { AuthBundle } from "../procurement/types";
import { readSupplierDeliveryScorecard, supplierDeliveryQuery, supplierObservationFilters, supplierObservationPage, SUPPLIER_OBSERVATION_LIMIT } from "./delivery-scorecard";
import { hasCompanySupplierObservationScope } from "./observation-access";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";

export function registerSupplierDeliveryScorecardRoutes(app: Express, auth: AuthBundle) {
  const read = [auth.ensureAuthenticated, auth.ensurePermission("suppliers", "read"), auth.ensurePermission("purchases", "read"), auth.ensurePermission("inventory", "read")];
  const root = "/api/v2/suppliers/:id/delivery-observations";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  type Outcome = { data: unknown; status?: number } | { error: string; message: string; status: number };
  function scoped(write: boolean, run: (client: PoolClient, req: Request, actor: ReturnType<typeof getTenantContext>, supplier: number) => Promise<Outcome>) {
    return async (req: Request, res: Response) => {
      const supplier = Number(req.params.id);
      if (!Number.isSafeInteger(supplier) || supplier < 1 || supplier > 2147483647) return sendError(res, 400, "SUPPLIER_ID_INVALID", "Choose a valid supplier.");
      let client: PoolClient | undefined;
      try {
        const actor = getTenantContext();
        client = await pool.connect();
        await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ${write ? "" : " READ ONLY"}`);
        await client.query("SET LOCAL statement_timeout='5s'");
        let result: Outcome;
        if (!await hasCompanySupplierObservationScope(client, actor)) result = { error: "SUPPLIER_SCORECARD_SCOPE_DENIED", message: "Current organization-wide source access is required.", status: 403 };
        else if (!(await client.query("SELECT 1 FROM suppliers WHERE organization_id=$1 AND id=$2", [actor.organizationId, supplier])).rowCount) result = { error: "SUPPLIER_NOT_FOUND", message: "This supplier is not available in your organization.", status: 404 };
        else if (!(await client.query("SELECT to_regclass('supplier_delivery_observations') AS ready")).rows[0].ready) result = { error: "SUPPLIER_OBSERVATIONS_NOT_INSTALLED", message: "Saved delivery observations are not installed.", status: 503 };
        else result = await run(client, req, actor, supplier);
        await client.query("COMMIT");
        res.setHeader("Cache-Control", "private, no-store");
        return "error" in result ? sendError(res, result.status, result.error, result.message) : sendOk(res, result.data, result.status ?? 200);
      } catch {
        await client?.query("ROLLBACK").catch(() => undefined);
        return sendError(res, 503, "SUPPLIER_OBSERVATION_UNAVAILABLE", "Saved delivery observations are unavailable. Retry or contact your administrator.");
      } finally { client?.release(); }
    };
  }

  app.post(root, ...read, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("suppliers", "update"), scoped(true, async (client, req, actor, supplier) => {
    const key = req.get("Idempotency-Key")?.toLowerCase() ?? "";
    const filters = supplierObservationFilters.safeParse(req.body);
    if (!uuid.test(key) || !filters.success) return { error: "SUPPLIER_OBSERVATION_INPUT_INVALID", message: "Choose valid dates and a valid capture key.", status: 400 };
    const existing = await client.query("SELECT id,summary->'filters'=$5::jsonb AS matches FROM supplier_delivery_observations WHERE organization_id=$1 AND supplier_id=$2 AND actor_user_id=$3 AND id=$4",
      [actor.organizationId, supplier, actor.userId, key, filters.data]);
    if (existing.rowCount) return existing.rows[0].matches ? { data: { id: key } } : { error: "SUPPLIER_OBSERVATION_KEY_USED", message: "This capture key already has different dates.", status: 409 };
    const result = await readSupplierDeliveryScorecard(client, actor.organizationId, supplier, { ...filters.data, page: 1, pageSize: 25 }, true);
    if (result.total > SUPPLIER_OBSERVATION_LIMIT) return { error: "SUPPLIER_OBSERVATION_TOO_LARGE", message: "Choose a narrower date range to save all source rows.", status: 409 };
    if (result.items.length !== result.total) throw new Error("Incomplete supplier observation");
    const { items, page: _page, pageSize: _pageSize, ...summary } = result;
    const inserted = await client.query("INSERT INTO supplier_delivery_observations(id,organization_id,supplier_id,actor_user_id,observed_at,summary,evidence) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [key, actor.organizationId, supplier, actor.userId, result.observedAt, { ...summary, limitation: "Saved observation. Subsequent changes to orders and receipts do not alter this result. First accepted receipt does not prove complete delivery or quality compliance." }, JSON.stringify(items)]);
    if (!inserted.rowCount) return { error: "SUPPLIER_OBSERVATION_KEY_USED", message: "This capture key has already been used.", status: 409 };
    await appendAuditEventWithClient(client, { organizationId: actor.organizationId, actor: { userId: actor.userId }, action: "SUPPLIER_DELIVERY_OBSERVATION_SAVED", resourceType: "supplier", resourceId: supplier, requestId: actor.correlationId, details: { observationId: key, methodVersion: summary.methodVersion } });
    return { data: { id: key }, status: 201 };
  }));

  app.get(root, ...read, scoped(false, async (client, req, actor, supplier) => {
    const parsed = supplierObservationPage.safeParse(req.query);
    if (!parsed.success) return { error: "SUPPLIER_OBSERVATION_PAGE_INVALID", message: "Choose a valid observation page.", status: 400 };
    const { page, pageSize } = parsed.data;
    const rows = await client.query("SELECT id,observed_at AS \"observedAt\" FROM supplier_delivery_observations WHERE organization_id=$1 AND supplier_id=$2 ORDER BY observed_at DESC,id DESC LIMIT $3 OFFSET $4", [actor.organizationId, supplier, pageSize + 1, (page - 1) * pageSize]);
    return { data: { items: rows.rows.slice(0, pageSize), hasNext: rows.rows.length > pageSize } };
  }));

  app.get(`${root}/:observationId`, ...read, scoped(false, async (client, req, actor, supplier) => {
    const parsed = supplierObservationPage.safeParse(req.query);
    if (!parsed.success || !uuid.test(req.params.observationId)) return { error: "SUPPLIER_OBSERVATION_INPUT_INVALID", message: "Choose a valid observation and page.", status: 400 };
    const { page, pageSize } = parsed.data;
    const [row] = (await client.query(`SELECT summary,
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.evidence) e WHERE NOT EXISTS(
        SELECT 1 FROM purchase_orders p WHERE p.organization_id=o.organization_id AND p.supplier_id=o.supplier_id AND p.id=(e->>'purchaseOrderId')::int
      ) OR (e->>'receiptId' IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM ap_receipts r WHERE r.organization_id=o.organization_id AND r.supplier_id=o.supplier_id AND r.purchase_order_id=(e->>'purchaseOrderId')::int AND r.id=(e->>'receiptId')::int
      ))) AS allowed,
      (SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM (
        SELECT value,ordinality FROM jsonb_array_elements(o.evidence) WITH ORDINALITY LIMIT $4 OFFSET $5
      ) page_rows) AS items FROM supplier_delivery_observations o WHERE organization_id=$1 AND supplier_id=$2 AND id=$3`,
      [actor.organizationId, supplier, req.params.observationId, pageSize, (page - 1) * pageSize])).rows;
    if (!row) return { error: "SUPPLIER_OBSERVATION_NOT_FOUND", message: "Saved observation not found.", status: 404 };
    if (!row.allowed) return { error: "SUPPLIER_OBSERVATION_SOURCE_DENIED", message: "Current access to all saved source records could not be verified.", status: 403 };
    return { data: { ...row.summary, items: row.items, page, pageSize } };
  }));

  app.get("/api/v2/suppliers/:id/delivery-scorecard", auth.ensureAuthenticated,
    auth.ensurePermission("suppliers", "read"), auth.ensurePermission("purchases", "read"),
    auth.ensurePermission("inventory", "read"), async (req, res) => {
      const supplierId = Number(req.params.id), parsed = supplierDeliveryQuery.safeParse(req.query);
      if (!Number.isSafeInteger(supplierId) || supplierId < 1 || supplierId > 2147483647 || !parsed.success)
        return sendError(res, 400, "SUPPLIER_SCORECARD_FILTERS_INVALID", "Choose a valid supplier, date range and 25, 50 or 100 rows. Unsupported filters cannot be used.");
      const actor = getTenantContext();
      let client;
      try {
        client = await pool.connect();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL statement_timeout='5s'");
        if (!await hasCompanySupplierObservationScope(client, actor)) {
          await client.query("ROLLBACK");
          return sendError(res, 403, "SUPPLIER_SCORECARD_SCOPE_DENIED", "An active membership with organization-wide warehouse access is required for this delivery observation.",
            { hint: "Ask an authorized procurement colleague to review the organization-wide evidence. No partial company score was calculated." });
        }
        const supplier = await client.query("SELECT id FROM suppliers WHERE organization_id=$1 AND id=$2", [actor.organizationId, supplierId]);
        if (!supplier.rowCount) {
          await client.query("ROLLBACK");
          return sendError(res, 404, "SUPPLIER_NOT_FOUND", "This supplier is not available in your organization.");
        }
        const result = await readSupplierDeliveryScorecard(client, actor.organizationId, supplierId, parsed.data);
        await client.query("COMMIT");
        res.setHeader("Cache-Control", "private, no-store");
        return sendOk(res, result);
      } catch {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        const requestId = resolveRequestId(res);
        recordServerDiagnosticEvent({ severity: "error", source: "request", title: "Supplier delivery evidence unavailable",
          message: "The supplier delivery observation could not be read. Retry and check supplier reporting dependencies.",
          route: "/api/v2/suppliers/:id/delivery-scorecard", method: "GET", status: 503,
          details: { organizationId: actor.organizationId, requestId, supplierId } });
        return sendError(res, 503, "SUPPLIER_SCORECARD_UNAVAILABLE", "Supplier delivery evidence could not be loaded.",
          { hint: "Retry. If the problem continues, give your administrator the request ID." });
      } finally { client?.release(); }
    });
}
