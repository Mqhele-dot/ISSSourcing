import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { randomUUID } from "node:crypto";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";
import { INVENTORY_BASE_SQL } from "../inventory/operational-stock-query";

type Auth = { ensureAuthenticated: RequestHandler; ensurePermission: (resource: string, action: string) => RequestHandler };
const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().refine((value) => [25, 50, 100].includes(value)).default(25),
  lookbackDays: z.coerce.number().int().min(30).max(365).default(90),
}).strict();

/** Read-only planning estimates. Stock commands remain the sole mutation authority. */
export function registerPlanningRoutes(app: Express, auth: Auth): void {
  const access = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "read")];
  app.post("/api/v2/inventory/reorder-suggestions/:itemId/request", auth.ensureAuthenticated, auth.ensurePermission("inventory", "update"), async (req, res) => {
    const itemId = Number(req.params.itemId);
    const lookbackDays = Number(req.body?.lookbackDays ?? 90);
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isInteger(lookbackDays) || lookbackDays < 30 || lookbackDays > 365)
      return sendError(res, 400, "REORDER_SUGGESTION_INVALID", "Choose a valid item and lookback period.");
    const org = getActiveOrganizationId();
    const userId = Number(req.user?.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const scope = await client.query(`SELECT 1 FROM users u JOIN organization_members m ON m.user_id=u.id
        WHERE u.id=$1 AND u.warehouse_id IS NULL AND m.organization_id=$2 AND m.active=true AND m.status='active'`, [userId, org]);
      if (!scope.rowCount) { await client.query("ROLLBACK"); return sendError(res, 403, "PLANNING_SCOPE_REQUIRED", "Organization-wide planning needs all-warehouse access."); }
      const item = await client.query(`SELECT id,sku,lead_time,reorder_point,low_stock_threshold,safety_hold
        FROM inventory_items WHERE organization_id=$1 AND id=$2 AND lower(coalesce(status,'active'))='active' FOR UPDATE`, [org, itemId]);
      if (!item.rowCount || item.rows[0].safety_hold) { await client.query("ROLLBACK"); return sendError(res, 409, "REORDER_ITEM_UNAVAILABLE", "This item is inactive or on hold. Refresh its stock details before requesting it."); }
      const existing = await client.query(`SELECT id,request_number FROM reorder_requests WHERE organization_id=$1 AND item_id=$2 AND upper(status)='PENDING' ORDER BY id DESC LIMIT 1`, [org, itemId]);
      if (existing.rowCount) { await client.query("ROLLBACK"); return sendError(res, 409, "REORDER_REQUEST_EXISTS", "A reorder request for this item is already pending. Open Reorder Requests to review it."); }
      const totals = await client.query(`${INVENTORY_BASE_SQL}, totals AS (SELECT
        b.on_hand AS stock,b.allocated AS reserved,b.available,
        (SELECT coalesce(sum(abs(quantity)),0) FROM stock_movements WHERE organization_id=$1 AND item_id=$2
          AND type IN ('SALE','ISSUE') AND timestamp >= now()-($3::int*interval '1 day')
          AND coalesce(reference_type,'') !~* '(test|return|transfer|reversal|damage|expir)')::numeric AS demand,
        (SELECT coalesce(sum(l.quantity-coalesce(l.received_quantity,0)),0) FROM purchase_order_items l
          JOIN purchase_orders p ON p.id=l.order_id WHERE p.organization_id=$1 AND l.item_id=$2 AND l.line_type='CATALOG'
          AND upper(p.approval_status)='APPROVED' AND upper(p.status) IN ('APPROVED','SENT','ACKNOWLEDGED','PARTIALLY_RECEIVED')
          AND l.quantity>coalesce(l.received_quantity,0))::numeric AS inbound
        FROM base b WHERE b.id=$2)
        SELECT t.*,(b.low_stock_threshold+ceil(t.demand/$3::numeric*greatest(0,coalesce(i.lead_time,0))))::text AS target_quantity,
          ceil(greatest(0,b.low_stock_threshold
          +ceil(t.demand/$3::numeric*greatest(0,coalesce(i.lead_time,0)))
          -(t.available+t.inbound)))::text AS suggested_quantity
        FROM totals t JOIN base b ON b.id=$2 JOIN inventory_items i ON i.organization_id=$1 AND i.id=b.id`, [org, itemId, lookbackDays]);
      // Reorder requests use whole units; decimal source arithmetic stays in PostgreSQL.
      const quantity = Number(totals.rows[0].suggested_quantity);
      const counts = totals.rows[0];
      const target = counts.target_quantity;
      if (!Number.isSafeInteger(quantity) || quantity <= 0) { await client.query("ROLLBACK"); return sendError(res, 409, "REORDER_SUGGESTION_CHANGED", "The stock or incoming supply changed. Refresh the suggestion before creating a request."); }
      const requestNumber = `RO-PLAN-${randomUUID().slice(0, 12).toUpperCase()}`;
      const created = await client.query(`INSERT INTO reorder_requests
        (organization_id,request_number,item_id,quantity,requestor_id,status,notes,request_date)
        VALUES($1,$2,$3,$4,$5,'PENDING',$6,now()) RETURNING id,request_number,quantity`,
        [org, requestNumber, itemId, quantity, userId,
          `Planning review: ${lookbackDays}-day demand ${counts.demand}; stock ${counts.stock}; reserved ${counts.reserved}; approved inbound ${counts.inbound}; target ${target}. Review before approval.`]);
      await appendAuditEventWithClient(client, { organizationId: org, actor: { userId }, action: "REORDER_REQUEST_FROM_SUGGESTION",
        resourceType: "reorder_request", resourceId: created.rows[0].id, details: { itemId, lookbackDays, quantity, target } });
      await client.query("COMMIT");
      return sendOk(res, { id: created.rows[0].id, requestNumber, quantity }, 201);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error("Reorder suggestion conversion failed:", error);
      return sendError(res, 500, "REORDER_REQUEST_FAILED", "Could not create the reorder request. Refresh stock and try again.");
    } finally { client.release(); }
  });
  for (const kind of ["reorder-suggestions", "slow-moving"] as const) {
    app.get(`/api/v2/inventory/${kind}`, ...access, async (req, res) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return sendError(res, 400, "PLANNING_QUERY_INVALID", "Choose a valid page, page size, and lookback period.");
      const { page, pageSize, lookbackDays } = parsed.data;
      const org = getActiveOrganizationId();
      const userId = Number(req.user?.id);
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL statement_timeout='10s'");
        const scope = await client.query(`SELECT 1 FROM users u JOIN organization_members m ON m.user_id=u.id
          WHERE u.id=$1 AND u.warehouse_id IS NULL AND m.organization_id=$2 AND m.active=true AND m.status='active'`, [userId, org]);
        if (!scope.rowCount) { await client.query("ROLLBACK"); return sendError(res, 403, "PLANNING_SCOPE_REQUIRED", "Organization-wide planning needs all-warehouse access."); }
        const base = `${INVENTORY_BASE_SQL}, movements AS (
          SELECT item_id,COALESCE(sum(abs(quantity)) FILTER(WHERE timestamp >= now()-($2::int * interval '1 day')),0)::numeric AS demand,
            max(timestamp) AS last_issue
          FROM stock_movements WHERE organization_id=$1 AND type IN ('SALE','ISSUE')
            AND coalesce(reference_type,'') !~* '(test|return|transfer|reversal|damage|expir)'
          GROUP BY item_id
        ), supply AS (
          SELECT l.item_id,sum(l.quantity-coalesce(l.received_quantity,0))::numeric AS inbound
          FROM purchase_order_items l JOIN purchase_orders p ON p.id=l.order_id
          WHERE p.organization_id=$1 AND l.line_type='CATALOG' AND upper(p.approval_status)='APPROVED'
            AND upper(p.status) IN ('APPROVED','SENT','ACKNOWLEDGED','PARTIALLY_RECEIVED')
            AND l.quantity>coalesce(l.received_quantity,0)
          GROUP BY l.item_id
        ), basis AS (
          SELECT i.id,i.sku,i.name,i.created_at,i.cost,i.price,i.safety_hold,
            b.on_hand,b.allocated AS reserved,b.available,b.unassigned_quantity,b.has_quantity_mismatch,
            coalesce(supply.inbound,0) AS inbound,coalesce(movements.demand,0) AS demand,
            movements.last_issue,greatest(0,coalesce(i.lead_time,0)) AS lead_days,
            b.low_stock_threshold AS safety_stock
          FROM base b JOIN inventory_items i ON i.id=b.id AND i.organization_id=$1
            LEFT JOIN movements ON movements.item_id=i.id
            LEFT JOIN supply ON supply.item_id=i.id
          WHERE i.organization_id=$1 AND lower(coalesce(i.status,'active'))='active'
        )`;
        const condition = kind === "slow-moving"
          ? `on_hand>0 AND created_at<now()-($2::int * interval '1 day') AND (last_issue IS NULL OR last_issue<now()-($2::int * interval '1 day'))`
          : `available+inbound < safety_stock+ceil(demand/$2::numeric*lead_days) AND safety_hold IS NOT TRUE AND created_at<now()-interval '14 days'`;
        const totalResult = await client.query(`${base} SELECT count(*)::int AS total FROM basis WHERE ${condition}`, [org, lookbackDays]);
        const rows = await client.query(`${base} SELECT id,sku,name,on_hand::text AS "onHand",reserved::text AS reserved,
          inbound::text AS "approvedInbound",demand::text AS "observedDemand",last_issue AS "lastEligibleIssue",
          lead_days AS "leadDays",safety_stock::text AS "safetyStock",available::text AS "availableNow",
          unassigned_quantity::text AS "unassignedQuantity",has_quantity_mismatch AS "requiresReconciliation",
          (demand/$2::numeric)::text AS "dailyDemand",(safety_stock+ceil(demand/$2::numeric*lead_days))::text AS "targetQuantity",
          greatest(0,safety_stock+ceil(demand/$2::numeric*lead_days)-(available+inbound))::text AS "suggestedQuantity",
          CASE WHEN cost IS NOT NULL AND cost>=0 THEN (on_hand*cost)::text ELSE NULL END AS "estimatedValue",
          CASE WHEN created_at>now()-interval '14 days' THEN 'insufficient_history' ELSE 'observed' END AS "historyState"
          FROM basis WHERE ${condition} ORDER BY id LIMIT $3 OFFSET $4`, [org, lookbackDays, pageSize, (page - 1) * pageSize]);
        const total = Number(totalResult.rows[0]?.total ?? 0);
        await client.query("COMMIT");
        return sendOk(res, { items: rows.rows, total, page, pageSize, hasNext: page * pageSize < total,
          lookbackDays, calculatedAt: new Date().toISOString(),
          notice: "Planning estimate only. PO lines are counted once as inbound; quality and receipt checks still govern usable stock. No purchasing is automatic." });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error("Inventory planning query failed:", error);
        return sendError(res, 500, "PLANNING_QUERY_FAILED", "Could not calculate inventory planning. Check stock reconciliation and retry.");
      } finally { client.release(); }
    });
  }
}
