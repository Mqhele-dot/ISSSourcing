import type { Express } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId } from "../../organization-context";
import type { AuthBundle } from "../procurement/types";
import { INVENTORY_BASE_SQL } from "../inventory/operational-stock-query";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value), "Page size must be 25, 50, or 100").default(25),
  q: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  category: z.preprocess((value) => value === "" || value == null ? undefined : value, z.coerce.number().int().positive().optional()),
  low: z.preprocess((value) => value == null || value === "" || value === "0" || value === "false" ? false : value, z.coerce.boolean().default(false)),
  sort: z.enum(["name_asc", "sku_asc", "available_asc", "available_desc", "updated_desc", "updated_asc"]).default("name_asc"),
});

export function registerInventoryV2Routes(app: Express, auth: AuthBundle): void {
  app.get("/api/v2/inventory", auth.ensureAuthenticated, auth.ensurePermission("inventory", "read"), async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return sendError(res, 400, "INVALID_QUERY", "Invalid inventory pagination, filter, or sort value", { fieldIssues: parsed.error.flatten().fieldErrors as Record<string, string[]> });
    const query = parsed.data;
    const values: Array<string | number> = [getActiveOrganizationId()];
    const filters: string[] = [];
    if (query.q) { values.push(`%${query.q}%`); filters.push(`(base.name ILIKE $${values.length} OR base.sku ILIKE $${values.length})`); }
    if (query.location) { values.push(query.location); filters.push(`base.location = $${values.length}`); }
    if (query.category) { values.push(query.category); filters.push(`base.category_id = $${values.length}`); }
    if (query.low) filters.push("base.available <= base.low_stock_threshold");
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const order = ({ name_asc: "name ASC, id ASC", sku_asc: "sku ASC, id ASC", available_asc: "available ASC, id ASC", available_desc: "available DESC, id DESC", updated_desc: "updated_at DESC NULLS LAST, id DESC", updated_asc: "updated_at ASC NULLS FIRST, id ASC" } as const)[query.sort];
    try {
      const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
      const [pageResult, summaryResult] = await Promise.all([
        pool.query(`${INVENTORY_BASE_SQL} SELECT * FROM base ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, pageValues),
        pool.query(`${INVENTORY_BASE_SQL} SELECT COUNT(*)::int AS total, COALESCE(SUM((available <= low_stock_threshold)::int),0)::int AS low_stock, COALESCE(SUM((available < 0)::int),0)::int AS negative_availability, COALESCE(SUM(on_hand),0)::numeric::text AS total_on_hand, COALESCE(SUM(allocated),0)::numeric::text AS total_allocated, COALESCE(SUM(available),0)::numeric::text AS total_available FROM base ${where}`, values),
      ]);
      const s = summaryResult.rows[0] ?? {};
      const total = Number(s.total ?? 0);
      const items = pageResult.rows.map((row) => ({ id: row.id, name: row.name, sku: row.sku, categoryId: row.category_id, quantity: Number(row.quantity), price: Number(row.price), lowStockThreshold: Number(row.low_stock_threshold), onHand: Number(row.on_hand), allocated: Number(row.allocated), available: Number(row.available), location: row.location, warehouseQuantity: Number(row.warehouse_quantity), unassignedQuantity: Number(row.unassigned_quantity), warehousePositionCount: Number(row.warehouse_position_count), hasQuantityMismatch: Boolean(row.has_quantity_mismatch), lastMovementAt: row.last_movement_at, lastMovementReason: row.last_movement_reason, updatedAt: row.updated_at }));
      return sendOk(res, { items, total, page: query.page, pageSize: query.pageSize, hasNext: query.page * query.pageSize < total, summary: { totalSkus: total, lowStock: Number(s.low_stock ?? 0), negativeAvailability: Number(s.negative_availability ?? 0), totalOnHand: String(s.total_on_hand ?? "0"), totalAllocated: String(s.total_allocated ?? "0"), totalAvailable: String(s.total_available ?? "0"), basis: "operational_availability", qualityEligible: false } });
    } catch (error) { return sendError(res, 500, "INVENTORY_FETCH_FAILED", "Failed to fetch inventory", { details: String(error) }); }
  });
}
