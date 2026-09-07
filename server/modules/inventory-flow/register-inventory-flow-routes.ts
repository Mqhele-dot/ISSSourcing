import type { Express, Request, RequestHandler, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId } from "../../organization-context";

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

const taskMutationSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  toBin: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(5).max(1000).optional(),
});

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function handleError(res: Response, error: unknown): Response {
  if (error instanceof z.ZodError) return sendError(res, 400, "INVALID_REQUEST", "The put-away request is invalid.", { details: error.flatten() });
  const code = error instanceof Error ? error.message : String(error);
  if (code === "NOT_FOUND") return sendError(res, 404, "PUTAWAY_TASK_NOT_FOUND", "The put-away task was not found.");
  if (code.startsWith("INVALID_") || code.startsWith("STATE_")) return sendError(res, 409, code, code.replaceAll("_", " ").toLowerCase());
  return sendError(res, 500, "PUTAWAY_OPERATION_FAILED", "The put-away operation failed.", {
    details: process.env.NODE_ENV === "production" ? undefined : { message: code },
  });
}

const taskSelect = `
  SELECT t.id,t.task_number AS "taskNumber",t.receipt_id AS "receiptId",r.receipt_number AS "receiptNumber",
    t.receipt_item_id AS "receiptItemId",t.warehouse_id AS "warehouseId",w.name AS "warehouseName",
    t.item_id AS "itemId",i.sku,i.name AS "itemName",t.quantity::text,t.from_location AS "fromLocation",
    t.to_bin AS "toBin",t.assigned_user_id AS "assignedUserId",u.full_name AS "assignedUserName",
    t.priority,t.status,t.due_at AS "dueAt",t.completed_at AS "completedAt",t.exception_reason AS "exceptionReason",
    t.created_at AS "createdAt",t.updated_at AS "updatedAt"
  FROM inventory_putaway_tasks t
  JOIN ap_receipts r ON r.id=t.receipt_id AND r.organization_id=t.organization_id
  JOIN warehouses w ON w.id=t.warehouse_id AND w.organization_id=t.organization_id
  JOIN inventory_items i ON i.id=t.item_id AND i.organization_id=t.organization_id
  LEFT JOIN users u ON u.id=t.assigned_user_id`;

export function registerInventoryFlowRoutes(app: Express, auth: AuthBundle): void {
  const read = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "read")];
  const execute = [auth.ensureAuthenticated, auth.ensurePermission("stock_movements", "execute")];

  app.get("/api/v2/inventory/put-away", ...read, async (req: Request, res: Response) => {
    try {
      const organizationId = getActiveOrganizationId();
      const page = positiveInt(req.query.page, 1);
      const pageSize = positiveInt(req.query.pageSize, 25);
      if (![25, 50, 100].includes(pageSize)) return sendError(res, 400, "INVALID_PAGE_SIZE", "pageSize must be 25, 50, or 100.");
      const status = String(req.query.status ?? "").trim().toUpperCase() || null;
      const priority = String(req.query.priority ?? "").trim().toUpperCase() || null;
      const q = String(req.query.q ?? "").trim() || null;
      const warehouseId = req.query.warehouseId ? positiveInt(req.query.warehouseId, 0) : null;
      const allowedStatuses = ["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "EXCEPTION", "CANCELLED"];
      const allowedPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
      if (status && !allowedStatuses.includes(status)) return sendError(res, 400, "INVALID_STATUS", "Unknown put-away status.");
      if (priority && !allowedPriorities.includes(priority)) return sendError(res, 400, "INVALID_PRIORITY", "Unknown put-away priority.");
      const where = `t.organization_id=$1 AND ($2::text IS NULL OR t.status=$2) AND ($3::text IS NULL OR t.priority=$3)
        AND ($4::int IS NULL OR t.warehouse_id=$4) AND ($5::text IS NULL OR t.task_number ILIKE '%'||$5||'%' OR r.receipt_number ILIKE '%'||$5||'%' OR i.sku ILIKE '%'||$5||'%' OR i.name ILIKE '%'||$5||'%')`;
      const params = [organizationId, status, priority, warehouseId, q];
      const [rows, count, summary] = await Promise.all([
        pool.query(`${taskSelect} WHERE ${where} ORDER BY CASE t.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END,t.due_at NULLS LAST,t.id DESC LIMIT $6 OFFSET $7`, [...params, pageSize, (page - 1) * pageSize]),
        pool.query(`SELECT count(*)::int AS total FROM inventory_putaway_tasks t JOIN ap_receipts r ON r.id=t.receipt_id AND r.organization_id=t.organization_id JOIN inventory_items i ON i.id=t.item_id AND i.organization_id=t.organization_id WHERE ${where}`, params),
        pool.query(`SELECT count(*) FILTER (WHERE status='PENDING')::int pending,count(*) FILTER (WHERE status='ASSIGNED')::int assigned,count(*) FILTER (WHERE status='IN_PROGRESS')::int AS "inProgress",count(*) FILTER (WHERE status='EXCEPTION')::int exception,count(*) FILTER (WHERE status NOT IN ('COMPLETED','CANCELLED') AND due_at<now())::int overdue,count(*) FILTER (WHERE status='COMPLETED' AND completed_at::date=current_date)::int AS "completedToday" FROM inventory_putaway_tasks WHERE organization_id=$1`, [organizationId]),
      ]);
      const total = count.rows[0]?.total ?? 0;
      return sendOk(res, { items: rows.rows, total, page, pageSize, hasNext: page * pageSize < total, summary: summary.rows[0], appliedFilters: { q, status, priority, warehouseId }, generatedAt: new Date().toISOString() });
    } catch (error) { return handleError(res, error); }
  });

  app.get("/api/v2/inventory/put-away/:id", ...read, async (req: Request, res: Response) => {
    try {
      const result = await pool.query(`${taskSelect} WHERE t.organization_id=$1 AND t.id=$2`, [getActiveOrganizationId(), positiveInt(req.params.id, 0)]);
      if (!result.rows[0]) return sendError(res, 404, "PUTAWAY_TASK_NOT_FOUND", "The put-away task was not found.");
      return sendOk(res, result.rows[0]);
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/inventory/put-away/reconcile", ...execute, async (req: Request, res: Response) => {
    try {
      const organizationId = getActiveOrganizationId();
      const userId = Number((req as Request & { user?: { id?: number } }).user?.id ?? 0) || null;
      const result = await transaction(async (client) => {
        const candidates = await client.query(`
          SELECT ri.id AS receipt_item_id,ri.receipt_id,ri.item_id,ri.accepted_quantity,
            (SELECT sm.warehouse_id FROM stock_movements sm WHERE sm.organization_id=r.organization_id AND sm.reference_type='ap_receipt' AND sm.reference_id=r.id AND sm.item_id=ri.item_id AND sm.warehouse_id IS NOT NULL ORDER BY sm.id DESC LIMIT 1) AS warehouse_id
          FROM ap_receipt_items ri
          JOIN ap_receipts r ON r.id=ri.receipt_id AND r.organization_id=$1 AND r.status='POSTED'
          JOIN inventory_items i ON i.id=ri.item_id AND i.organization_id=$1
          WHERE ri.accepted_quantity>0 AND NOT EXISTS (SELECT 1 FROM inventory_putaway_tasks t WHERE t.organization_id=$1 AND t.receipt_item_id=ri.id)
          ORDER BY ri.id FOR UPDATE OF ri`, [organizationId]);
        let created = 0;
        let blocked = 0;
        for (const row of candidates.rows) {
          if (!row.warehouse_id) { blocked += 1; continue; }
          const inserted = await client.query(`INSERT INTO inventory_putaway_tasks
            (organization_id,task_number,receipt_id,receipt_item_id,warehouse_id,item_id,quantity,due_at,created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '1 day',$8)
            ON CONFLICT (organization_id,receipt_item_id) DO NOTHING RETURNING id`,
            [organizationId, `PUT-${row.receipt_id}-${row.receipt_item_id}`, row.receipt_id, row.receipt_item_id, row.warehouse_id, row.item_id, row.accepted_quantity, userId]);
          created += inserted.rowCount ?? 0;
        }
        await client.query(`INSERT INTO ops_activity (organization_id,actor,entity_type,entity_id,action,summary_json) VALUES ($1,$2,'inventory_putaway','reconcile','PUTAWAY_RECONCILED',$3::jsonb)`, [organizationId, String(userId ?? "system"), JSON.stringify({ created, blocked, requestId: res.locals.requestId ?? null })]);
        return { created, blocked, scanned: candidates.rowCount ?? 0 };
      });
      return sendOk(res, result);
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/inventory/put-away/:id/assign", ...execute, async (req: Request, res: Response) => {
    try {
      const body = taskMutationSchema.parse(req.body);
      if (!body.userId) return sendError(res, 400, "INVALID_ASSIGNEE", "A user is required.");
      const organizationId = getActiveOrganizationId();
      const member = await pool.query(`SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND active=true AND status='active'`, [organizationId, body.userId]);
      if (!member.rows[0]) return sendError(res, 400, "INVALID_ASSIGNEE", "The selected user is not an active organization member.");
      const updated = await pool.query(`UPDATE inventory_putaway_tasks SET assigned_user_id=$3,priority=COALESCE($4,priority),due_at=COALESCE($5,due_at),status='ASSIGNED',updated_at=now() WHERE organization_id=$1 AND id=$2 AND status IN ('PENDING','ASSIGNED','EXCEPTION') RETURNING *`, [organizationId, positiveInt(req.params.id, 0), body.userId, body.priority ?? null, body.dueAt ?? null]);
      if (!updated.rows[0]) return sendError(res, 409, "STATE_TASK_NOT_ASSIGNABLE", "The task cannot be assigned in its current state.");
      return sendOk(res, updated.rows[0]);
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/inventory/put-away/:id/start", ...execute, async (req: Request, res: Response) => {
    try {
      const updated = await pool.query(`UPDATE inventory_putaway_tasks SET status='IN_PROGRESS',updated_at=now() WHERE organization_id=$1 AND id=$2 AND status IN ('PENDING','ASSIGNED','EXCEPTION') RETURNING *`, [getActiveOrganizationId(), positiveInt(req.params.id, 0)]);
      if (!updated.rows[0]) return sendError(res, 409, "STATE_TASK_NOT_STARTABLE", "The task cannot be started in its current state.");
      return sendOk(res, updated.rows[0]);
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/inventory/put-away/:id/complete", ...execute, async (req: Request, res: Response) => {
    try {
      const body = taskMutationSchema.parse(req.body);
      const organizationId = getActiveOrganizationId();
      const actorId = Number((req as Request & { user?: { id?: number } }).user?.id ?? 0) || null;
      const completed = await transaction(async (client) => {
        const task = await client.query(`SELECT t.*,w.bins FROM inventory_putaway_tasks t JOIN warehouses w ON w.id=t.warehouse_id AND w.organization_id=t.organization_id WHERE t.organization_id=$1 AND t.id=$2 FOR UPDATE OF t`, [organizationId, positiveInt(req.params.id, 0)]);
        const row = task.rows[0];
        if (!row) throw new Error("NOT_FOUND");
        if (!["PENDING", "ASSIGNED", "IN_PROGRESS", "EXCEPTION"].includes(row.status)) throw new Error("STATE_TASK_NOT_COMPLETABLE");
        const bins = Array.isArray(row.bins) ? row.bins : [];
        const requestedBin = body.toBin?.trim() || null;
        const matchedBin = requestedBin ? bins.find((bin: { code?: string }) => String(bin.code).toLowerCase() === requestedBin.toLowerCase()) : null;
        if (bins.length > 0 && !requestedBin) throw new Error("INVALID_DESTINATION_BIN_REQUIRED");
        if (bins.length > 0 && !matchedBin) throw new Error("INVALID_DESTINATION_BIN");
        const stock = await client.query(`SELECT id,quantity FROM warehouse_inventory WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 FOR UPDATE`, [organizationId, row.warehouse_id, row.item_id]);
        if (!stock.rows[0]) throw new Error("INVALID_WAREHOUSE_STOCK");
        await client.query(`UPDATE warehouse_inventory SET location=$1,bin=$1,aisle=$2,updated_at=now() WHERE id=$3 AND organization_id=$4`, [requestedBin ?? "Warehouse stock", matchedBin?.aisle ?? null, stock.rows[0].id, organizationId]);
        const movement = await client.query(`INSERT INTO stock_movements (organization_id,item_id,warehouse_id,type,quantity,reference_id,reference_type,notes,user_id,previous_quantity,new_quantity,warehouse_location,timestamp) VALUES ($1,$2,$3,'PUT_AWAY',$4,$5,'inventory_putaway',$6,$7,$8,$8,$9,now()) RETURNING id`, [organizationId, row.item_id, row.warehouse_id, Math.max(1, Math.round(Number(row.quantity))), row.id, `Put away from ${row.from_location} to ${requestedBin ?? "warehouse stock"}`, actorId, Number(stock.rows[0].quantity), requestedBin ?? "Warehouse stock"]);
        const updated = await client.query(`UPDATE inventory_putaway_tasks SET status='COMPLETED',to_bin=$3,completed_at=now(),completed_by=$4,movement_id=$5,exception_reason=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId, row.id, requestedBin, actorId, movement.rows[0].id]);
        await client.query(`UPDATE operational_exceptions SET status='resolved',resolved_at=now(),updated_at=now() WHERE organization_id=$1 AND status IN ('open','in_progress') AND related_refs @> $2::jsonb`, [organizationId, JSON.stringify({ putAwayTaskId: row.id })]);
        return updated.rows[0];
      });
      return sendOk(res, completed);
    } catch (error) { return handleError(res, error); }
  });

  app.post("/api/v2/inventory/put-away/:id/exception", ...execute, async (req: Request, res: Response) => {
    try {
      const body = taskMutationSchema.parse(req.body);
      if (!body.reason) return sendError(res, 400, "INVALID_EXCEPTION_REASON", "An exception reason of at least five characters is required.");
      const organizationId = getActiveOrganizationId();
      const result = await transaction(async (client) => {
        const task = await client.query(`UPDATE inventory_putaway_tasks SET status='EXCEPTION',exception_reason=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status NOT IN ('COMPLETED','CANCELLED') RETURNING *`, [organizationId, positiveInt(req.params.id, 0), body.reason]);
        if (!task.rows[0]) throw new Error("STATE_TASK_NOT_EXCEPTIONABLE");
        const row = task.rows[0];
        const refs = { area: "inventory", putAwayTaskId: row.id, receiptId: row.receipt_id, itemId: row.item_id, warehouseId: row.warehouse_id };
        await client.query(`INSERT INTO operational_exceptions (organization_id,type,severity,status,title,description,related_refs,sla_hours) SELECT $1,'PUTAWAY_EXCEPTION','high','open',$2,$3,$4::jsonb,8 WHERE NOT EXISTS (SELECT 1 FROM operational_exceptions WHERE organization_id=$1 AND type='PUTAWAY_EXCEPTION' AND status IN ('open','in_progress') AND related_refs @> $4::jsonb)`, [organizationId, `Put-away task ${row.task_number} needs attention`, body.reason, JSON.stringify(refs)]);
        return row;
      });
      return sendOk(res, result);
    } catch (error) { return handleError(res, error); }
  });
}
