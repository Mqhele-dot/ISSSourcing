import type { Express, Request, Response } from "express";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId, getOptionalTenantContext } from "../../organization-context";
import { storage } from "../../storage";
import {
  inventoryItems,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequisitionItems,
  purchaseRequisitions,
  sourcingEvents,
  supplierQuotes,
  supplierContracts,
  suppliers,
  type UniversalSearchResult,
} from "@shared/schema";
import type { AuthBundle } from "../procurement/types";
import { registerInventoryV2Routes } from "./register-inventory-v2-routes";
import { getReportingFx, reportingAmount } from "../../lib/reporting-fx";

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(25);
const optionalText = z.preprocess((value) => value === "" ? undefined : value, z.string().trim().max(200).optional());

function querySchema<const T extends readonly [string, ...string[]]>(sorts: T) {
  return z.object({
    page: pageSchema,
    pageSize: pageSizeSchema,
    q: optionalText,
    status: optionalText,
    supplier: optionalText,
    supplierId: z.preprocess((value) => value === "" || value == null ? undefined : value, z.coerce.number().int().positive().optional()),
    sort: z.enum(sorts).default(sorts[0]),
  });
}

const receivableStatuses = ["approved", "sent", "partially_received"] as const;
const purchaseOrderQuerySchema = querySchema(["created_desc", "created_asc", "number_asc", "number_desc", "amount_desc", "amount_asc"])
  .extend({
    statuses: z.preprocess(
      (value) => typeof value === "string" ? value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean) : value,
      z.array(z.enum(receivableStatuses)).min(1).max(receivableStatuses.length).optional(),
    ),
  })
  .superRefine((value, context) => {
    if (value.status && value.status !== "all" && value.statuses) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["statuses"], message: "status and statuses cannot be combined" });
    }
  });

function parseQuery(res: Response, schema: z.ZodTypeAny, value: unknown): any | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  sendError(res, 400, "INVALID_QUERY", "Invalid pagination, filter, or sort value", {
    fieldIssues: parsed.error.flatten().fieldErrors as Record<string, string[]>,
  });
  return undefined;
}

function paginated<T>(items: T[], total: number, page: number, pageSize: number, summary?: unknown) {
  return { items, total, page, pageSize, hasNext: page * pageSize < total, ...(summary === undefined ? {} : { summary }) };
}

function conditions(...values: Array<SQL | undefined>): SQL | undefined {
  const present = values.filter((value): value is SQL => Boolean(value));
  return present.length ? and(...present) : undefined;
}

async function allowed(req: Request, resource: string): Promise<boolean> {
  const user = (req as Request & { user?: { id?: number; role?: string } }).user;
  const role = getOptionalTenantContext()?.userRole ?? user?.role;
  if (!role) return false;
  if (role === "admin") return true;
  if (await storage.checkPermission(role, resource as any, "read")) return true;
  if (role === "custom" && user?.id) {
    const customRoleId = await storage.getUserCustomRoleId(user.id);
    return customRoleId ? storage.checkCustomRolePermission(customRoleId, resource as any, "read" as any) : false;
  }
  return false;
}

export function registerV2Routes(app: Express, auth: AuthBundle): void {
  registerInventoryV2Routes(app, auth);
  const purchasesRead = [auth.ensureAuthenticated, auth.ensurePermission("purchases", "read")];
  const suppliersRead = [auth.ensureAuthenticated, auth.ensurePermission("suppliers", "read")];

  app.get("/api/v2/procurement/purchase-orders", ...purchasesRead, async (req, res) => {
    const query = parseQuery(res, purchaseOrderQuerySchema, req.query);
    if (!query) return;
    const orgId = getActiveOrganizationId();
    const search = query.q ? `%${query.q}%` : undefined;
    const supplierNumber = query.supplier && /^\d+$/.test(query.supplier) ? Number(query.supplier) : undefined;
    const supplierSearch = query.supplier && supplierNumber == null ? `%${query.supplier}%` : undefined;
    const where = conditions(
      eq(purchaseOrders.organizationId, orgId),
      query.status === "active"
        ? sql`lower(${purchaseOrders.status}) NOT IN ('received', 'completed', 'closed', 'cancelled')`
        : query.status && query.status !== "all"
          ? sql`lower(${purchaseOrders.status}) = ${query.status.toLowerCase()}`
          : undefined,
      query.statuses ? inArray(purchaseOrders.status, query.statuses) : undefined,
      query.statuses ? sql`EXISTS (
        SELECT 1 FROM ${purchaseOrderItems} receivable_item
        WHERE receivable_item.order_id = ${purchaseOrders.id}
          AND receivable_item.quantity > COALESCE(receivable_item.received_quantity, 0)
      )` : undefined,
      supplierNumber ? eq(purchaseOrders.supplierId, supplierNumber) : undefined,
      supplierSearch ? ilike(suppliers.name, supplierSearch) : undefined,
      search ? or(ilike(purchaseOrders.orderNumber, search), ilike(suppliers.name, search)) : undefined,
    );
    const order = ({
      created_desc: [desc(purchaseOrders.createdAt), desc(purchaseOrders.id)], created_asc: [asc(purchaseOrders.createdAt), asc(purchaseOrders.id)],
      number_asc: [asc(purchaseOrders.orderNumber), asc(purchaseOrders.id)], number_desc: [desc(purchaseOrders.orderNumber), desc(purchaseOrders.id)],
      amount_desc: [desc(purchaseOrders.totalAmount), desc(purchaseOrders.id)], amount_asc: [asc(purchaseOrders.totalAmount), asc(purchaseOrders.id)],
    } as Record<string, SQL[]>)[query.sort] ?? [desc(purchaseOrders.createdAt), desc(purchaseOrders.id)];
    try {
      const linesCount = sql<number>`(select count(*)::int from ${purchaseOrderItems} poi where poi.order_id = ${purchaseOrders.id})`;
      const qtyOrdered = sql<number>`coalesce((select sum(poi.quantity)::float8 from ${purchaseOrderItems} poi where poi.order_id = ${purchaseOrders.id}), 0)`;
      const qtyReceived = sql<number>`coalesce((select sum(coalesce(poi.received_quantity, 0))::float8 from ${purchaseOrderItems} poi where poi.order_id = ${purchaseOrders.id}), 0)`;
      const receivedProgress = sql<number>`coalesce((select round(100.0 * sum(least(coalesce(poi.received_quantity, 0), poi.quantity)) / nullif(sum(poi.quantity), 0))::int from ${purchaseOrderItems} poi where poi.order_id = ${purchaseOrders.id}), 0)`;
      const [items, totals, summaries] = await Promise.all([
        db.select({ order: purchaseOrders, supplierName: suppliers.name, linesCount, qtyOrdered, qtyReceived, receivedProgress }).from(purchaseOrders)
          .leftJoin(suppliers, and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.organizationId, orgId)))
          .where(where).orderBy(...order).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ value: count() }).from(purchaseOrders)
          .leftJoin(suppliers, and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.organizationId, orgId))).where(where),
        db.select({ status: purchaseOrders.status, currencyCode: purchaseOrders.currencyCode, count: count(), amount: sql<number>`coalesce(sum(${purchaseOrders.totalAmount}), 0)` })
          .from(purchaseOrders)
          .leftJoin(suppliers, and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.organizationId, orgId)))
          .where(where).groupBy(purchaseOrders.status, purchaseOrders.currencyCode),
      ]);
      const fx = await getReportingFx(orgId, [
        ...items.map(({ order: item }) => item.currencyCode),
        ...summaries.map((row) => row.currencyCode),
      ]);
      const byStatus: Record<string, number> = {};
      let totalAmount = 0;
      let missingFxCount = 0;
      for (const row of summaries) {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.count);
        const converted = reportingAmount(row.amount, row.currencyCode, fx);
        if (converted == null) missingFxCount += Number(row.count);
        else totalAmount += converted;
      }
      const summary = { totalAmount, reportingCurrencyCode: fx.reportingCurrencyCode, missingFxCount, byStatus };
      return sendOk(res, paginated(items.map(({ order: item, supplierName, linesCount: lines, qtyOrdered: ordered, qtyReceived: received, receivedProgress: progress }) => {
        const rate = fx.rates.get(String(item.currencyCode).toUpperCase()) ?? null;
        return {
          ...item,
          poNumber: item.orderNumber,
          supplierName,
          requestedDate: item.orderDate,
          linesCount: Number(lines),
          qtyOrdered: Number(ordered),
          qtyReceived: Number(received),
          receivedProgress: Number(progress),
          reportingCurrencyCode: fx.reportingCurrencyCode,
          reportingExchangeRate: rate,
          reportingTotal: rate == null ? null : Number(item.totalAmount) * rate,
        };
      }), Number(totals[0]?.value ?? 0), query.page, query.pageSize, summary));
    } catch (error) { return sendError(res, 500, "PURCHASE_ORDERS_FETCH_FAILED", "Failed to fetch purchase orders", { details: String(error) }); }
  });

  app.get("/api/v2/procurement/requisitions", ...purchasesRead, async (req, res) => {
    const query = parseQuery(res, querySchema(["created_desc", "created_asc", "number_asc", "number_desc", "amount_desc", "amount_asc"]), req.query);
    if (!query) return;
    const orgId = getActiveOrganizationId();
    const search = query.q ? `%${query.q}%` : undefined;
    const where = conditions(eq(purchaseRequisitions.organizationId, orgId), query.status === "active"
      ? sql`lower(${purchaseRequisitions.status}) IN ('draft', 'pending')`
      : query.status && query.status !== "all"
        ? sql`lower(${purchaseRequisitions.status}) = ${query.status.toLowerCase()}`
        : undefined,
      search ? or(ilike(purchaseRequisitions.requisitionNumber, search), ilike(purchaseRequisitions.notes, search), ilike(purchaseRequisitions.justification, search)) : undefined);
    const order = ({
      created_desc: [desc(purchaseRequisitions.createdAt), desc(purchaseRequisitions.id)], created_asc: [asc(purchaseRequisitions.createdAt), asc(purchaseRequisitions.id)],
      number_asc: [asc(purchaseRequisitions.requisitionNumber), asc(purchaseRequisitions.id)], number_desc: [desc(purchaseRequisitions.requisitionNumber), desc(purchaseRequisitions.id)],
      amount_desc: [desc(purchaseRequisitions.totalAmount), desc(purchaseRequisitions.id)], amount_asc: [asc(purchaseRequisitions.totalAmount), asc(purchaseRequisitions.id)],
    } as Record<string, SQL[]>)[query.sort] ?? [desc(purchaseRequisitions.createdAt), desc(purchaseRequisitions.id)];
    try {
      const lineCount = sql<number>`(select count(*)::int from ${purchaseRequisitionItems} pri where pri.requisition_id = ${purchaseRequisitions.id})`;
      const [items, totals, summaries] = await Promise.all([
        db.select({ requisition: purchaseRequisitions, lineCount }).from(purchaseRequisitions).where(where).orderBy(...order).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ value: count() }).from(purchaseRequisitions).where(where),
        db.select({ status: purchaseRequisitions.status, currencyCode: purchaseRequisitions.currencyCode, count: count(), amount: sql<number>`coalesce(sum(${purchaseRequisitions.totalAmount}), 0)` })
          .from(purchaseRequisitions).where(where).groupBy(purchaseRequisitions.status, purchaseRequisitions.currencyCode),
      ]);
      const fx = await getReportingFx(orgId, [
        ...items.map(({ requisition }) => requisition.currencyCode),
        ...summaries.map((row) => row.currencyCode),
      ]);
      const byStatus: Record<string, number> = {};
      let totalAmount = 0;
      let missingFxCount = 0;
      for (const row of summaries) {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.count);
        const converted = reportingAmount(row.amount, row.currencyCode, fx);
        if (converted == null) missingFxCount += Number(row.count);
        else totalAmount += converted;
      }
      const summary = { totalAmount, reportingCurrencyCode: fx.reportingCurrencyCode, missingFxCount, byStatus };
      return sendOk(res, paginated(items.map(({ requisition, lineCount: lines }) => {
        const rate = fx.rates.get(String(requisition.currencyCode).toUpperCase()) ?? null;
        return {
          ...requisition,
          lineCount: Number(lines),
          reportingCurrencyCode: fx.reportingCurrencyCode,
          reportingExchangeRate: rate,
          reportingTotal: rate == null ? null : Number(requisition.totalAmount) * rate,
        };
      }), Number(totals[0]?.value ?? 0), query.page, query.pageSize, summary));
    } catch (error) { return sendError(res, 500, "REQUISITIONS_FETCH_FAILED", "Failed to fetch requisitions", { details: String(error) }); }
  });

  app.get("/api/v2/suppliers", ...suppliersRead, async (req, res) => {
    const query = parseQuery(res, querySchema(["name_asc", "name_desc", "created_desc", "created_asc"]), req.query);
    if (!query) return;
    const orgId = getActiveOrganizationId();
    const search = query.q ? `%${query.q}%` : undefined;
    const where = conditions(eq(suppliers.organizationId, orgId), query.status && query.status !== "all" ? eq(suppliers.status, query.status) : undefined,
      search ? or(ilike(suppliers.name, search), ilike(suppliers.supplierCode, search), ilike(suppliers.legalName, search), ilike(suppliers.email, search)) : undefined);
    const order = ({ name_asc: [asc(suppliers.name), asc(suppliers.id)], name_desc: [desc(suppliers.name), desc(suppliers.id)], created_desc: [desc(suppliers.createdAt), desc(suppliers.id)], created_asc: [asc(suppliers.createdAt), asc(suppliers.id)] } as Record<string, SQL[]>)[query.sort] ?? [asc(suppliers.name), asc(suppliers.id)];
    try {
      const [items, totals] = await Promise.all([
        db.select().from(suppliers).where(where).orderBy(...order).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ value: count() }).from(suppliers).where(where),
      ]);
      return sendOk(res, paginated(items, Number(totals[0]?.value ?? 0), query.page, query.pageSize));
    } catch (error) { return sendError(res, 500, "SUPPLIERS_FETCH_FAILED", "Failed to fetch suppliers", { details: String(error) }); }
  });

  app.get("/api/v2/contracts", ...suppliersRead, async (req, res) => {
    const query = parseQuery(res, querySchema(["created_desc", "created_asc", "title_asc", "title_desc", "end_asc", "end_desc"]), req.query);
    if (!query) return;
    const orgId = getActiveOrganizationId();
    const search = query.q ? `%${query.q}%` : undefined;
    const where = conditions(eq(supplierContracts.organizationId, orgId), query.supplierId ? eq(supplierContracts.supplierId, query.supplierId) : undefined,
      query.status && query.status !== "all" ? eq(supplierContracts.status, query.status) : undefined,
      search ? or(ilike(supplierContracts.title, search), ilike(supplierContracts.referenceNumber, search), ilike(suppliers.name, search)) : undefined);
    const order = ({ created_desc: [desc(supplierContracts.createdAt), desc(supplierContracts.id)], created_asc: [asc(supplierContracts.createdAt), asc(supplierContracts.id)], title_asc: [asc(supplierContracts.title), asc(supplierContracts.id)], title_desc: [desc(supplierContracts.title), desc(supplierContracts.id)], end_asc: [asc(supplierContracts.endDate), asc(supplierContracts.id)], end_desc: [desc(supplierContracts.endDate), desc(supplierContracts.id)] } as Record<string, SQL[]>)[query.sort] ?? [desc(supplierContracts.createdAt), desc(supplierContracts.id)];
    try {
      const baseJoin = and(eq(suppliers.id, supplierContracts.supplierId), eq(suppliers.organizationId, orgId));
      const [items, totals] = await Promise.all([
        db.select({ contract: supplierContracts, supplierName: suppliers.name }).from(supplierContracts).leftJoin(suppliers, baseJoin).where(where).orderBy(...order).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ value: count() }).from(supplierContracts).leftJoin(suppliers, baseJoin).where(where),
      ]);
      return sendOk(res, paginated(items.map(({ contract, supplierName }) => ({ ...contract, supplierName })), Number(totals[0]?.value ?? 0), query.page, query.pageSize));
    } catch (error) { return sendError(res, 500, "CONTRACTS_FETCH_FAILED", "Failed to fetch contracts", { details: String(error) }); }
  });

  app.get("/api/v2/procurement/sourcing-events", ...purchasesRead, async (req, res) => {
    const query = parseQuery(res, querySchema(["updated_desc", "updated_asc", "deadline_asc", "deadline_desc", "number_asc", "number_desc"]), req.query);
    if (!query) return;
    const orgId = getActiveOrganizationId();
    const search = query.q ? `%${query.q}%` : undefined;
    const where = conditions(eq(sourcingEvents.organizationId, orgId), query.status && query.status !== "all" ? eq(sourcingEvents.status, query.status) : undefined,
      search ? or(ilike(sourcingEvents.eventNumber, search), ilike(sourcingEvents.title, search), ilike(sourcingEvents.description, search)) : undefined);
    const order = ({ updated_desc: [desc(sourcingEvents.updatedAt), desc(sourcingEvents.id)], updated_asc: [asc(sourcingEvents.updatedAt), asc(sourcingEvents.id)], deadline_asc: [asc(sourcingEvents.deadline), asc(sourcingEvents.id)], deadline_desc: [desc(sourcingEvents.deadline), desc(sourcingEvents.id)], number_asc: [asc(sourcingEvents.eventNumber), asc(sourcingEvents.id)], number_desc: [desc(sourcingEvents.eventNumber), desc(sourcingEvents.id)] } as Record<string, SQL[]>)[query.sort] ?? [desc(sourcingEvents.updatedAt), desc(sourcingEvents.id)];
    try {
      const [items, totals] = await Promise.all([db.select().from(sourcingEvents).where(where).orderBy(...order).limit(query.pageSize).offset((query.page - 1) * query.pageSize), db.select({ value: count() }).from(sourcingEvents).where(where)]);
      return sendOk(res, paginated(items, Number(totals[0]?.value ?? 0), query.page, query.pageSize));
    } catch (error) { return sendError(res, 500, "SOURCING_EVENTS_FETCH_FAILED", "Failed to fetch sourcing events", { details: String(error) }); }
  });

  app.get("/api/v2/search", auth.ensureAuthenticated, async (req, res) => {
    const parsed = z.object({ q: z.string().trim().min(2).max(100), limit: z.coerce.number().int().min(1).max(5).default(5) }).safeParse(req.query);
    if (!parsed.success) return sendError(res, 400, "INVALID_SEARCH_QUERY", "Search requires at least two characters and a limit from 1 to 5", { fieldIssues: parsed.error.flatten().fieldErrors as Record<string, string[]> });
    const orgId = getActiveOrganizationId();
    const pattern = `%${parsed.data.q}%`;
    const results: UniversalSearchResult[] = [];
    try {
      const [inventoryAllowed, purchasesAllowed, supplierAllowed] = await Promise.all([allowed(req, "inventory"), allowed(req, "purchases"), allowed(req, "suppliers")]);
      if (inventoryAllowed) {
        const rows = await db.select({ id: inventoryItems.id, sku: inventoryItems.sku, name: inventoryItems.name, status: inventoryItems.status }).from(inventoryItems).where(and(eq(inventoryItems.organizationId, orgId), or(ilike(inventoryItems.sku, pattern), ilike(inventoryItems.name, pattern)))).orderBy(asc(inventoryItems.name), asc(inventoryItems.id)).limit(parsed.data.limit);
        results.push(...rows.map((row) => ({ type: "inventory" as const, id: row.id, title: row.name, subtitle: row.sku, status: row.status, href: `/inventory/${encodeURIComponent(row.sku)}` })));
        const shipments = await pool.query<{ id: number; tracking_number: string | null; po_number: string | null; carrier: string | null; status: string | null }>(
          `select id, tracking_number, po_number, carrier, status from shipments where organization_id = $1 and (tracking_number ilike $2 or po_number ilike $2 or carrier ilike $2) order by updated_at desc, id desc limit $3`,
          [orgId, pattern, parsed.data.limit],
        );
        results.push(...shipments.rows.map((row) => ({ type: "shipment" as const, id: row.id, title: row.tracking_number || row.po_number || `Shipment ${row.id}`, subtitle: row.carrier || "Shipment", status: row.status, href: `/operations/logistics/${row.id}` })));
      }
      if (supplierAllowed) {
        const rows = await db.select({ id: suppliers.id, code: suppliers.supplierCode, name: suppliers.name, status: suppliers.status }).from(suppliers).where(and(eq(suppliers.organizationId, orgId), or(ilike(suppliers.name, pattern), ilike(suppliers.supplierCode, pattern)))).orderBy(asc(suppliers.name), asc(suppliers.id)).limit(parsed.data.limit);
        results.push(...rows.map((row) => ({ type: "supplier" as const, id: row.id, title: row.name, subtitle: row.code ?? "Supplier", status: row.status, href: `/procurement/suppliers/${row.id}` })));
      }
      if (purchasesAllowed) {
        const [orders, requisitions, rfqs, quotations] = await Promise.all([
          db.select({ id: purchaseOrders.id, number: purchaseOrders.orderNumber, status: purchaseOrders.status }).from(purchaseOrders).where(and(eq(purchaseOrders.organizationId, orgId), ilike(purchaseOrders.orderNumber, pattern))).orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id)).limit(parsed.data.limit),
          db.select({ id: purchaseRequisitions.id, number: purchaseRequisitions.requisitionNumber, status: purchaseRequisitions.status }).from(purchaseRequisitions).where(and(eq(purchaseRequisitions.organizationId, orgId), ilike(purchaseRequisitions.requisitionNumber, pattern))).orderBy(desc(purchaseRequisitions.createdAt), desc(purchaseRequisitions.id)).limit(parsed.data.limit),
          db.select({ id: sourcingEvents.id, number: sourcingEvents.eventNumber, title: sourcingEvents.title, status: sourcingEvents.status }).from(sourcingEvents).where(and(eq(sourcingEvents.organizationId, orgId), or(ilike(sourcingEvents.eventNumber, pattern), ilike(sourcingEvents.title, pattern)))).orderBy(desc(sourcingEvents.updatedAt), desc(sourcingEvents.id)).limit(parsed.data.limit),
          db.select({ id: supplierQuotes.id, number: supplierQuotes.quoteNumber, status: supplierQuotes.status, supplierName: suppliers.name }).from(supplierQuotes).innerJoin(suppliers, and(eq(suppliers.id, supplierQuotes.supplierId), eq(suppliers.organizationId, orgId))).where(and(eq(supplierQuotes.organizationId, orgId), or(ilike(supplierQuotes.quoteNumber, pattern), ilike(suppliers.name, pattern)))).orderBy(desc(supplierQuotes.createdAt), desc(supplierQuotes.id)).limit(parsed.data.limit),
        ]);
        results.push(...orders.map((row) => ({ type: "purchase-order" as const, id: row.id, title: row.number, subtitle: "Purchase order", status: row.status, href: `/procurement/orders/${encodeURIComponent(row.number)}` })), ...requisitions.map((row) => ({ type: "requisition" as const, id: row.id, title: row.number, subtitle: "Purchase requisition", status: row.status, href: `/procurement/requisitions/${row.id}` })), ...rfqs.map((row) => ({ type: "rfq" as const, id: row.id, title: row.title, subtitle: row.number, status: row.status, href: `/procurement/sourcing/${row.id}` })), ...quotations.map((row) => ({ type: "quotation" as const, id: row.id, title: row.number, subtitle: row.supplierName, status: row.status, href: `/procurement/quotations/${row.id}` })));
      }
      return sendOk(res, results);
    } catch (error) { return sendError(res, 500, "SEARCH_FAILED", "Search is temporarily unavailable", { details: String(error) }); }
  });
}
