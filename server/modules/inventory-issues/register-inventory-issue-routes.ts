import type { Express, Request, RequestHandler, Response } from "express";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { pool } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId } from "../../organization-context";

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

const issueSchema = z.object({
  warehouseId: z.coerce.number().int().positive(),
  recipient: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(500),
  carrierId: z.coerce.number().int().positive().nullable().optional(),
  trackingNumber: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(z.object({
    itemId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
  })).min(1),
});

const statusSchema = z.object({
  status: z.enum(["READY", "DELIVERED", "CANCELLED"]),
  note: z.string().trim().max(1000).optional(),
});

function actorId(req: Request): number | null {
  return (req as Request & { user?: { id?: number } }).user?.id ?? null;
}

function idempotencyKey(req: Request, res: Response): string | null {
  const key = req.get("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key must contain between 8 and 128 characters.");
    return null;
  }
  return key;
}

async function loadIssue(organizationId: number, id: number) {
  const result = await pool.query(
    `SELECT issue.*, warehouse.name AS warehouse_name, carrier.name AS carrier_name,
      COALESCE(json_agg(json_build_object(
        'id', line.id, 'itemId', line.item_id, 'sku', item.sku, 'name', item.name,
        'quantity', line.quantity, 'unitOfMeasure', COALESCE(line.unit_of_measure, item.unit_of_measure)
      ) ORDER BY line.id) FILTER (WHERE line.id IS NOT NULL), '[]') AS lines
     FROM inventory_issues issue
     JOIN warehouses warehouse ON warehouse.id = issue.warehouse_id AND warehouse.organization_id = issue.organization_id
     LEFT JOIN carriers carrier ON carrier.id = issue.carrier_id AND carrier.organization_id = issue.organization_id
     LEFT JOIN inventory_issue_lines line ON line.issue_id = issue.id AND line.organization_id = issue.organization_id
     LEFT JOIN inventory_items item ON item.id = line.item_id AND item.organization_id = issue.organization_id
     WHERE issue.organization_id = $1 AND issue.id = $2
     GROUP BY issue.id, warehouse.name, carrier.name`,
    [organizationId, id],
  );
  if (!result.rows[0]) return null;
  const events = await pool.query(
    `SELECT id, status, note, actor_user_id AS "actorUserId", created_at AS "createdAt"
     FROM inventory_issue_events WHERE organization_id = $1 AND issue_id = $2 ORDER BY id`,
    [organizationId, id],
  );
  return { ...result.rows[0], events: events.rows };
}

export function registerInventoryIssueRoutes(app: Express, auth: Auth): void {
  const read = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "read")];
  const write = [auth.ensureAuthenticated, auth.ensurePermission("inventory", "update")];

  app.get("/api/logistics/inventory-issues", ...read, async (req, res) => {
    try {
      const organizationId = getActiveOrganizationId();
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25) || 25));
      const q = String(req.query.q ?? "").trim();
      const status = String(req.query.status ?? "").trim().toUpperCase();
      const values: unknown[] = [organizationId];
      const clauses = ["issue.organization_id = $1"];
      if (q) {
        values.push(`%${q}%`);
        clauses.push(`(issue.issue_number ILIKE $${values.length} OR issue.recipient ILIKE $${values.length} OR issue.destination ILIKE $${values.length})`);
      }
      if (status) {
        if (!["DRAFT", "READY", "DISPATCHED", "DELIVERED", "CANCELLED"].includes(status)) {
          return sendError(res, 400, "INVALID_STATUS", "Unsupported inventory issue status filter.");
        }
        values.push(status);
        clauses.push(`issue.status = $${values.length}`);
      }
      const where = clauses.join(" AND ");
      const count = await pool.query(`SELECT count(*)::int AS total FROM inventory_issues issue WHERE ${where}`, values);
      values.push(pageSize, (page - 1) * pageSize);
      const rows = await pool.query(
        `SELECT issue.id, issue.issue_number AS "issueNumber", issue.status,
          issue.recipient, issue.destination, issue.tracking_number AS "trackingNumber",
          issue.created_at AS "createdAt", issue.updated_at AS "updatedAt",
          warehouse.name AS "warehouseName", carrier.name AS "carrierName",
          count(line.id)::int AS "lineCount", COALESCE(sum(line.quantity), 0)::int AS "totalQuantity"
         FROM inventory_issues issue
         JOIN warehouses warehouse ON warehouse.id = issue.warehouse_id AND warehouse.organization_id = issue.organization_id
         LEFT JOIN carriers carrier ON carrier.id = issue.carrier_id AND carrier.organization_id = issue.organization_id
         LEFT JOIN inventory_issue_lines line ON line.issue_id = issue.id
         WHERE ${where}
         GROUP BY issue.id, warehouse.name, carrier.name
         ORDER BY issue.updated_at DESC, issue.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      const total = Number(count.rows[0]?.total ?? 0);
      return sendOk(res, { items: rows.rows, total, page, pageSize, hasNext: page * pageSize < total });
    } catch (error) {
      console.error("GET inventory issues", error);
      return sendError(res, 500, "INVENTORY_ISSUE_LIST_FAILED", "Failed to load outbound inventory issues.");
    }
  });

  app.get("/api/logistics/inventory-issues/:id", ...read, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_ID", "Invalid inventory issue ID.");
    const issue = await loadIssue(getActiveOrganizationId(), id);
    return issue ? sendOk(res, issue) : sendError(res, 404, "INVENTORY_ISSUE_NOT_FOUND", "Inventory issue not found.");
  });

  app.post("/api/logistics/inventory-issues", ...write, async (req, res) => {
    const key = idempotencyKey(req, res);
    if (!key) return;
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "INVALID_INVENTORY_ISSUE", "Warehouse, recipient, destination and valid item lines are required.", { details: parsed.error.flatten() });
    const organizationId = getActiveOrganizationId();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT id FROM inventory_issues WHERE organization_id = $1 AND idempotency_key = $2", [organizationId, key]);
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return sendOk(res, await loadIssue(organizationId, Number(existing.rows[0].id)));
      }
      const warehouse = await client.query("SELECT id FROM warehouses WHERE organization_id = $1 AND id = $2", [organizationId, parsed.data.warehouseId]);
      if (!warehouse.rows[0]) throw Object.assign(new Error("Warehouse does not belong to the active organization."), { code: "INVALID_WAREHOUSE" });
      if (parsed.data.carrierId) {
        const carrier = await client.query("SELECT id FROM carriers WHERE organization_id = $1 AND id = $2 AND COALESCE(active, TRUE) = TRUE", [organizationId, parsed.data.carrierId]);
        if (!carrier.rows[0]) throw Object.assign(new Error("Carrier is inactive or belongs to another organization."), { code: "INVALID_CARRIER" });
      }
      const itemIds = [...new Set(parsed.data.lines.map((line) => line.itemId))];
      if (itemIds.length !== parsed.data.lines.length) throw Object.assign(new Error("Each item may appear only once."), { code: "DUPLICATE_ITEM" });
      const items = await client.query("SELECT id, unit_of_measure FROM inventory_items WHERE organization_id = $1 AND id = ANY($2::int[]) AND COALESCE(status, 'active') = 'active'", [organizationId, itemIds]);
      if (items.rowCount !== itemIds.length) throw Object.assign(new Error("One or more items are inactive or belong to another organization."), { code: "INVALID_ITEM" });
      const numberResult = await client.query("SELECT 'ISS-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('inventory_issues_id_seq')::text, 6, '0') AS issue_number");
      const issueNumber = String(numberResult.rows[0].issue_number);
      const inserted = await client.query(
        `INSERT INTO inventory_issues (id, organization_id, issue_number, warehouse_id, recipient, destination, carrier_id, tracking_number, notes, idempotency_key, created_by)
         VALUES (currval('inventory_issues_id_seq'), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [organizationId, issueNumber, parsed.data.warehouseId, parsed.data.recipient, parsed.data.destination, parsed.data.carrierId ?? null, parsed.data.trackingNumber ?? null, parsed.data.notes ?? null, key, actorId(req)],
      );
      const units = new Map(items.rows.map((row) => [Number(row.id), row.unit_of_measure]));
      for (const line of parsed.data.lines) {
        await client.query("INSERT INTO inventory_issue_lines (organization_id, issue_id, item_id, quantity, unit_of_measure) VALUES ($1,$2,$3,$4,$5)", [organizationId, inserted.rows[0].id, line.itemId, line.quantity, units.get(line.itemId) ?? null]);
      }
      await client.query("INSERT INTO inventory_issue_events (organization_id, issue_id, status, note, actor_user_id) VALUES ($1,$2,'DRAFT','Inventory issue created',$3)", [organizationId, inserted.rows[0].id, actorId(req)]);
      await client.query("COMMIT");
      return sendOk(res, await loadIssue(organizationId, Number(inserted.rows[0].id)), 201);
    } catch (error) {
      await client.query("ROLLBACK");
      const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "INVENTORY_ISSUE_CREATE_FAILED";
      return sendError(res, code.startsWith("INVALID") || code === "DUPLICATE_ITEM" ? 400 : 500, code, error instanceof Error ? error.message : "Failed to create inventory issue.");
    } finally {
      client.release();
    }
  });

  app.post("/api/logistics/inventory-issues/:id/dispatch", ...write, async (req, res) => {
    const key = idempotencyKey(req, res);
    if (!key) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_ID", "Invalid inventory issue ID.");
    const organizationId = getActiveOrganizationId();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const issueResult = await client.query("SELECT * FROM inventory_issues WHERE organization_id = $1 AND id = $2 FOR UPDATE", [organizationId, id]);
      const issue = issueResult.rows[0];
      if (!issue) throw Object.assign(new Error("Inventory issue not found."), { code: "INVENTORY_ISSUE_NOT_FOUND", status: 404 });
      if (issue.status === "DISPATCHED" && issue.dispatch_idempotency_key === key) {
        await client.query("COMMIT");
        return sendOk(res, await loadIssue(organizationId, id));
      }
      if (issue.status !== "READY") throw Object.assign(new Error("Only READY inventory issues can be dispatched."), { code: "INVENTORY_ISSUE_NOT_READY", status: 409 });
      const lines = await client.query("SELECT * FROM inventory_issue_lines WHERE organization_id = $1 AND issue_id = $2 ORDER BY id", [organizationId, id]);
      for (const line of lines.rows) {
        const stockResult = await client.query(
          "SELECT id, quantity FROM warehouse_inventory WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE",
          [organizationId, issue.warehouse_id, line.item_id],
        );
        const stock = stockResult.rows[0];
        if (!stock || Number(stock.quantity) < Number(line.quantity)) {
          throw Object.assign(new Error(`Insufficient warehouse stock for item ${line.item_id}.`), { code: "INSUFFICIENT_STOCK", status: 409, itemId: line.item_id });
        }
        const next = Number(stock.quantity) - Number(line.quantity);
        await client.query("UPDATE warehouse_inventory SET quantity = $1, updated_at = now() WHERE id = $2 AND organization_id = $3", [next, stock.id, organizationId]);
        await client.query(
          `INSERT INTO stock_movements (organization_id, item_id, warehouse_id, type, quantity, reference_id, reference_type, notes, user_id, previous_quantity, new_quantity)
           VALUES ($1,$2,$3,'ISSUE',$4,$5,'inventory_issue',$6,$7,$8,$9)`,
          [organizationId, line.item_id, issue.warehouse_id, -Number(line.quantity), id, `Dispatched ${issue.issue_number}`, actorId(req), Number(stock.quantity), next],
        );
      }
      await client.query(
        `INSERT INTO shipments (organization_id, po_number, status, carrier_id, carrier, tracking_number, direction, source_type, source_id, source_ref, delivery_note_ref)
         SELECT $1, issue_number, 'dispatched', carrier_id, carrier.name, tracking_number, 'outbound', 'inventory_issue', id, issue_number, issue_number
         FROM inventory_issues issue LEFT JOIN carriers carrier ON carrier.id = issue.carrier_id
         WHERE issue.organization_id = $1 AND issue.id = $2`,
        [organizationId, id],
      );
      await client.query("UPDATE inventory_issues SET status = 'DISPATCHED', dispatch_idempotency_key = $1, dispatched_at = now(), updated_at = now() WHERE organization_id = $2 AND id = $3", [key, organizationId, id]);
      await client.query("INSERT INTO inventory_issue_events (organization_id, issue_id, status, note, actor_user_id) VALUES ($1,$2,'DISPATCHED','Warehouse stock issued atomically',$3)", [organizationId, id, actorId(req)]);
      await client.query("COMMIT");
      return sendOk(res, await loadIssue(organizationId, id));
    } catch (error) {
      await client.query("ROLLBACK");
      const typed = error as { code?: string; status?: number; itemId?: number };
      return sendError(res, typed.status ?? 500, typed.code ?? "INVENTORY_ISSUE_DISPATCH_FAILED", error instanceof Error ? error.message : "Failed to dispatch inventory issue.", { details: typed.itemId ? { itemId: typed.itemId } : undefined });
    } finally {
      client.release();
    }
  });

  app.post("/api/logistics/inventory-issues/:id/status", ...write, async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "INVALID_STATUS", "Status must be READY, DELIVERED or CANCELLED.");
    const organizationId = getActiveOrganizationId();
    const id = Number(req.params.id);
    const allowedFrom: Record<string, string[]> = { READY: ["DRAFT"], CANCELLED: ["DRAFT", "READY"], DELIVERED: ["DISPATCHED"] };
    const result = await pool.query(
      `UPDATE inventory_issues SET status = $1, delivered_at = CASE WHEN $1 = 'DELIVERED' THEN now() ELSE delivered_at END, updated_at = now()
       WHERE organization_id = $2 AND id = $3 AND status = ANY($4::text[]) RETURNING id`,
      [parsed.data.status, organizationId, id, allowedFrom[parsed.data.status]],
    );
    if (!result.rows[0]) return sendError(res, 409, "INVALID_STATUS_TRANSITION", "The requested status transition is not allowed.");
    await pool.query("INSERT INTO inventory_issue_events (organization_id, issue_id, status, note, actor_user_id) VALUES ($1,$2,$3,$4,$5)", [organizationId, id, parsed.data.status, parsed.data.note ?? null, actorId(req)]);
    return sendOk(res, await loadIssue(organizationId, id));
  });

  app.get("/api/logistics/inventory-issues/:id/delivery-note.pdf", ...read, async (req: Request, res: Response) => {
    const organizationId = getActiveOrganizationId();
    const id = Number(req.params.id);
    const issue = await loadIssue(organizationId, id);
    if (!issue) return sendError(res, 404, "INVENTORY_ISSUE_NOT_FOUND", "Inventory issue not found.");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText("Inventory Issue Delivery Note", { x: 50, y: 790, size: 20, font: bold, color: rgb(0.08, 0.18, 0.3) });
    const lines = [
      `Issue: ${issue.issue_number}`, `Status: ${issue.status}`, `Warehouse: ${issue.warehouse_name}`,
      `Recipient: ${issue.recipient}`, `Destination: ${issue.destination}`,
      `Carrier: ${issue.carrier_name ?? "Not assigned"}`, `Tracking: ${issue.tracking_number ?? "Not assigned"}`,
    ];
    lines.forEach((value, index) => page.drawText(value, { x: 50, y: 750 - index * 22, size: 11, font }));
    page.drawText("Items", { x: 50, y: 570, size: 14, font: bold });
    (issue.lines as Array<{ sku: string; name: string; quantity: number; unitOfMeasure?: string }>).slice(0, 18).forEach((line, index) => {
      page.drawText(`${line.sku}  ${line.name}  ${line.quantity} ${line.unitOfMeasure ?? ""}`, { x: 50, y: 545 - index * 21, size: 10, font });
    });
    const bytes = await pdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${String(issue.issue_number).replace(/[^A-Za-z0-9_-]/g, "-")}-delivery-note.pdf"`);
    return res.status(200).send(Buffer.from(bytes));
  });
}
