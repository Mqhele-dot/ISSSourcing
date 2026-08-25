/**
 * Aggregated Control Tower / executive dashboard metrics (org-scoped where tables support it).
 */
import { normalizePurchaseOrderStatus } from "@shared/purchase-order-status";
import { pool } from "../../db";
import { INVENTORY_BASE_SQL } from "../v2/register-inventory-v2-routes";
import { listOperationalActivity } from "./operations-core";

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function mediumSev(n: number): "low" | "medium" | "high" {
  if (n >= 20) return "high";
  if (n >= 5) return "medium";
  return "low";
}

function orgInventoryWhere(alias: string, orgId: number, paramIndex: number): string {
  if (orgId === 1) {
    return `(${alias}.organization_id = $${paramIndex} OR ${alias}.organization_id IS NULL)`;
  }
  return `${alias}.organization_id = $${paramIndex}`;
}

function orgPoWhere(paramIndex: number): string {
  return `po.organization_id = $${paramIndex}`;
}

export type ControlTowerDashboardPayload = {
  generatedAt: string;
  meta: {
    organizationId: number;
    trendDays: number;
    valueBasisLabel: string;
    businessArea: string;
    queryMs?: number;
    dataFreshness?: Partial<Record<
      | "inventory"
      | "purchaseOrders"
      | "shipments"
      | "invoices"
      | "exceptions"
      | "activity"
      | "requisitions",
      string | null
    >>;
    partialFailures?: Array<{
      area: string;
      code: string;
      message: string;
      fallbackUsed: boolean;
    }>;
    filtersApplied?: Record<string, string | number | boolean | null>;
  };
  kpis: {
    inventoryValue: number;
    inventoryValueTrendPct: number | null;
    lowStockItems: number;
    openRequisitions: number;
    openPurchaseOrders: number;
    delayedShipments: number;
    inTransitShipments: number;
    apInvoicesDueOrOverdue: number;
    operationalExceptions: number;
    supplierRiskAlerts: number;
  };
  procurementPipeline: Array<{
    id: string;
    label: string;
    count: number;
    href: string;
    area: "procurement";
  }>;
  inventoryHealth: Array<{ id: string; label: string; count: number; href: string }>;
  stockValueByCategory: Array<{ category: string; value: number }>;
  apAging: Array<{ bucket: string; label: string; count: number; amount: number }>;
  logisticsRisk: Array<{ id: string; label: string; count: number; href: string }>;
  supplierPerformance: Array<{
    supplierId: number;
    name: string;
    riskScore: number;
    lateShipments: number;
    openExceptions: number;
  }>;
  operationsTrend: Array<{
    date: string;
    requisitions: number;
    purchaseOrders: number;
    receiving: number;
    invoices: number;
    exceptions: number;
  }>;
  needsAttention: Array<{
    id: string;
    title: string;
    severity: "low" | "medium" | "high";
    reason: string;
    href: string;
    area: string;
  }>;
  recentActivity: Array<{
    id: number;
    action: string;
    entityType: string;
    entityId: string;
    actor: string;
    createdAt: string | null;
    summary: string;
  }>;
  spotlight: {
    delayedShipments: Array<{
      id: number;
      poNumber: string;
      carrier: string | null;
      eta: string | null;
      driftMinutes: number;
      href: string;
    }>;
    oldestOpenExceptions: Array<{
      id: number;
      type: string;
      title: string;
      agedHours: number;
      severity: string;
      href: string;
    }>;
    supplierRisks: Array<{
      supplierId: number;
      name: string;
      lateShipments: number;
      openExceptions: number;
      href: string;
    }>;
  };
};

const EMPTY: ControlTowerDashboardPayload = {
  generatedAt: new Date().toISOString(),
  meta: {
    organizationId: 1,
    trendDays: 7,
    valueBasisLabel: "Estimated value (cost when set, else price × available quantity)",
    businessArea: "all",
  },
  kpis: {
    inventoryValue: 0,
    inventoryValueTrendPct: null,
    lowStockItems: 0,
    openRequisitions: 0,
    openPurchaseOrders: 0,
    delayedShipments: 0,
    inTransitShipments: 0,
    apInvoicesDueOrOverdue: 0,
    operationalExceptions: 0,
    supplierRiskAlerts: 0,
  },
  procurementPipeline: [],
  inventoryHealth: [],
  stockValueByCategory: [],
  apAging: [],
  logisticsRisk: [],
  supplierPerformance: [],
  operationsTrend: [],
  needsAttention: [],
  recentActivity: [],
  spotlight: { delayedShipments: [], oldestOpenExceptions: [], supplierRisks: [] },
};

export function buildEmptyControlTowerDashboard(
  organizationId: number,
  trendDays: number,
  businessArea: string,
): ControlTowerDashboardPayload {
  return {
    ...EMPTY,
    generatedAt: new Date().toISOString(),
    meta: {
      ...EMPTY.meta,
      organizationId,
      trendDays,
      businessArea,
      filtersApplied: { trendDays, businessArea },
      partialFailures: [],
      dataFreshness: {},
    },
  };
}

function wipeInventoryDash(base: ControlTowerDashboardPayload) {
  base.kpis.inventoryValue = 0;
  base.kpis.inventoryValueTrendPct = null;
  base.kpis.lowStockItems = 0;
  base.inventoryHealth = [];
  base.stockValueByCategory = [];
}

function wipeProcurementDash(base: ControlTowerDashboardPayload) {
  base.kpis.openRequisitions = 0;
  base.kpis.openPurchaseOrders = 0;
  base.procurementPipeline = [];
}

function wipeLogisticsDash(base: ControlTowerDashboardPayload) {
  base.kpis.delayedShipments = 0;
  base.logisticsRisk = [];
  base.spotlight.delayedShipments = [];
  base.supplierPerformance = [];
  base.spotlight.supplierRisks = [];
  base.kpis.supplierRiskAlerts = 0;
}

function wipeFinanceDash(base: ControlTowerDashboardPayload) {
  base.kpis.apInvoicesDueOrOverdue = 0;
  base.apAging = base.apAging.map((b) => ({ ...b, count: 0, amount: 0 }));
}

function wipeOperationsExceptionDash(base: ControlTowerDashboardPayload) {
  base.kpis.operationalExceptions = 0;
  base.spotlight.oldestOpenExceptions = [];
}

function applyBusinessAreaFilter(base: ControlTowerDashboardPayload, areaRaw: string): void {
  const a = (areaRaw || "all").toLowerCase();
  if (a === "all") return;
  if (a === "inventory") {
    wipeProcurementDash(base);
    wipeLogisticsDash(base);
    wipeFinanceDash(base);
    wipeOperationsExceptionDash(base);
  } else if (a === "procurement") {
    wipeInventoryDash(base);
    wipeLogisticsDash(base);
    wipeFinanceDash(base);
    wipeOperationsExceptionDash(base);
  } else if (a === "logistics") {
    wipeInventoryDash(base);
    wipeProcurementDash(base);
    wipeFinanceDash(base);
    wipeOperationsExceptionDash(base);
  } else if (a === "finance") {
    wipeInventoryDash(base);
    wipeProcurementDash(base);
    wipeLogisticsDash(base);
    wipeOperationsExceptionDash(base);
  } else if (a === "operations") {
    wipeInventoryDash(base);
    wipeProcurementDash(base);
    wipeLogisticsDash(base);
    wipeFinanceDash(base);
  }

  const allowedAreas =
    a === "inventory"
      ? new Set(["inventory"])
      : a === "procurement"
        ? new Set(["procurement"])
        : a === "logistics"
          ? new Set(["logistics"])
          : a === "finance"
            ? new Set(["finance"])
            : new Set(["operations"]);
  base.needsAttention = base.needsAttention.filter((n) => allowedAreas.has(n.area));
}

function summaryText(summary: Record<string, unknown>): string {
  if (typeof summary.message === "string") return summary.message;
  if (typeof summary.details === "string") return summary.details;
  if (typeof summary.title === "string") return summary.title;
  return "";
}

export async function getControlTowerDashboard(
  organizationId: number,
  opts: { trendDays: number; businessArea: string },
): Promise<ControlTowerDashboardPayload> {
  const orgId = Number.isFinite(organizationId) ? organizationId : 1;
  const trendDays = [7, 30, 90].includes(opts.trendDays) ? opts.trendDays : 7;
  const businessArea = opts.businessArea || "all";
  const base: ControlTowerDashboardPayload = {
    ...EMPTY,
    generatedAt: new Date().toISOString(),
    meta: {
      ...EMPTY.meta,
      organizationId: orgId,
      trendDays,
      businessArea,
      filtersApplied: { trendDays, businessArea },
      partialFailures: [],
      dataFreshness: {},
    },
  };

  /* ── inventory rollups (SKU-level available, threshold, value) ── */
  let invRows: {
    sku: string;
    available: number;
    threshold: number;
    value_proxy: number;
    expiry: Date | null;
  }[] = [];
  try {
    const invRes = await pool.query<{
      sku: string;
      available: number;
      threshold: number;
      value_proxy: number;
      expiry: Date | null;
    }>(
      `${INVENTORY_BASE_SQL}
       SELECT sku, available::real AS available, low_stock_threshold::real AS threshold,
              (available * valuation_rate)::real AS value_proxy, expiry_date AS expiry
       FROM base`,
      [orgId],
    );
    invRows = invRes.rows;
    base.meta.dataFreshness = { ...base.meta.dataFreshness, inventory: new Date().toISOString() };
  } catch {
    invRows = [];
    base.meta.partialFailures!.push({
      area: "inventory",
      code: "ROLLUP_FAILED",
      message: "Inventory KPI rollup query failed",
      fallbackUsed: true,
    });
  }

  let inventoryValue = 0;
  let lowStock = 0;
  let healthy = 0;
  let negative = 0;
  let zeroStock = 0;
  let expiringSoon = 0;
  const now = Date.now();
  const expSoonMs = 30 * 86400_000;

  for (const row of invRows) {
    const av = toNumber(row.available, 0);
    const th = toNumber(row.threshold, 0);
    const vp = toNumber(row.value_proxy, 0);
    inventoryValue += vp;

    // Keep this definition identical to /api/v2/inventory?low=1. Negative and
    // zero availability intentionally overlap the low-stock KPI.
    if (av <= th) {
      lowStock += 1;
    }

    if (av < 0) {
      negative += 1;
      continue;
    }
    if (av === 0) {
      zeroStock += 1;
      continue;
    }
    if (row.expiry && av > 0) {
      const exp = new Date(row.expiry).getTime();
      if (!Number.isNaN(exp) && exp > now && exp - now <= expSoonMs) {
        expiringSoon += 1;
      }
    }
    if (av > 0 && av <= th) {
      // Already counted above; keep this branch from classifying low stock as healthy.
    } else {
      healthy += 1;
    }
  }

  base.kpis.inventoryValue = Math.round(inventoryValue * 100) / 100;
  base.kpis.lowStockItems = lowStock;

  base.inventoryHealth = [
    { id: "healthy", label: "Healthy", count: healthy, href: `${"/inventory"}` },
    { id: "low", label: "Low stock", count: lowStock, href: "/inventory?low=1" },
    { id: "negative", label: "Negative availability", count: negative, href: "/inventory" },
    { id: "zero", label: "Zero stock", count: zeroStock, href: "/inventory" },
    { id: "expiring", label: "Expiring soon", count: expiringSoon, href: "/inventory" },
  ];

  /* stock by category — available × unit (cost else price) */
  try {
    const catRes2 = await pool.query<{ name: string; value: number }>(
      `
      WITH stock AS (
        SELECT
          i.id,
          COALESCE(NULLIF(trim(c.name), ''), 'Uncategorized') AS name,
          (COALESCE(SUM(p.on_hand), COALESCE(i.quantity, 0)) - COALESCE(SUM(p.allocated), 0))::double precision AS available,
          COALESCE(i.cost, i.price, 0)::double precision AS unit
        FROM inventory_items i
        LEFT JOIN inventory_positions p ON p.sku = i.sku
        LEFT JOIN categories c ON c.id = i.category_id
        WHERE ${orgInventoryWhere("i", orgId, 1)}
        GROUP BY i.id, c.name, i.quantity, i.cost, i.price
      )
      SELECT name, SUM(available * unit)::real AS value
      FROM stock
      GROUP BY name
      ORDER BY value DESC NULLS LAST
      LIMIT 12
      `,
      [orgId],
    );
    base.stockValueByCategory = catRes2.rows.map((r) => ({
      category: r.name,
      value: Math.round(toNumber(r.value, 0) * 100) / 100,
    }));
  } catch {
    base.stockValueByCategory = [];
  }

  /* requisitions pipeline */
  let draftReq = 0;
  let pendingReq = 0;
  let approvedReq = 0;
  try {
    const rq = await pool.query<{ status: string; count: number }>(
      `
      SELECT upper(trim(status)) AS status, count(*)::int AS count
      FROM purchase_requisitions
      WHERE organization_id = $1
      GROUP BY upper(trim(status))
      `,
      [orgId],
    );
    for (const row of rq.rows) {
      const s = row.status;
      const c = toNumber(row.count, 0);
      if (s === "DRAFT") draftReq += c;
      else if (s === "PENDING") pendingReq += c;
      else if (s === "APPROVED") approvedReq += c;
    }
    base.kpis.openRequisitions = draftReq + pendingReq;
  } catch {
    draftReq = pendingReq = approvedReq = 0;
  }

  /* purchase orders — pipeline + open count */
  const poByNorm = new Map<string, number>();
  let openPoCount = 0;
  try {
    const poRes = await pool.query<{ status: string; count: number }>(
      `
      SELECT status, count(*)::int AS count
      FROM purchase_orders po
      WHERE ${orgPoWhere(1)}
      GROUP BY status
      `,
      [orgId],
    );
    for (const row of poRes.rows) {
      const norm = normalizePurchaseOrderStatus(row.status);
      poByNorm.set(norm, (poByNorm.get(norm) ?? 0) + toNumber(row.count, 0));
      if (!["received", "closed", "cancelled"].includes(norm)) {
        openPoCount += toNumber(row.count, 0);
      }
    }
    base.kpis.openPurchaseOrders = openPoCount;
  } catch {
    base.kpis.openPurchaseOrders = 0;
  }

  const openPo = (poByNorm.get("open") ?? 0) + (poByNorm.get("draft") ?? 0);
  const approvedPo = poByNorm.get("approved") ?? 0;
  const sentPo = poByNorm.get("sent") ?? 0;
  const partialPo = poByNorm.get("partially_received") ?? 0;
  const receivedPo = (poByNorm.get("received") ?? 0) + (poByNorm.get("closed") ?? 0);

  base.procurementPipeline = [
    { id: "req_draft", label: "Draft requisitions", count: draftReq, href: "/procurement/requisitions", area: "procurement" },
    { id: "req_pending", label: "Pending approval", count: pendingReq, href: "/procurement/requisitions", area: "procurement" },
    { id: "req_approved", label: "Approved requisitions", count: approvedReq, href: "/procurement/requisitions", area: "procurement" },
    { id: "po_open", label: "Open POs", count: openPo, href: "/procurement/orders", area: "procurement" },
    { id: "po_approved", label: "Approved POs", count: approvedPo, href: "/procurement/orders", area: "procurement" },
    { id: "po_sent", label: "Sent POs", count: sentPo, href: "/procurement/orders", area: "procurement" },
    { id: "po_partial", label: "Partially received", count: partialPo, href: "/procurement/orders", area: "procurement" },
    { id: "po_received", label: "Received POs", count: receivedPo, href: "/procurement/orders", area: "procurement" },
  ];

  /* late shipments scoped to org POs */
  let lateShip = 0;
  try {
    const ls = await pool.query<{ count: number }>(
      `
      SELECT count(*)::int AS count
      FROM shipments s
      INNER JOIN purchase_orders po ON po.order_number = s.po_number AND ${orgPoWhere(1)}
      WHERE s.eta IS NOT NULL
        AND s.eta < now()
        AND lower(s.status) NOT IN ('delivered', 'cancelled')
        AND COALESCE(s.organization_id, po.organization_id) = $1
      `,
      [orgId],
    );
    lateShip = toNumber(ls.rows[0]?.count, 0);
    base.kpis.delayedShipments = lateShip;
  } catch {
    base.kpis.delayedShipments = 0;
  }

  /* logistics risk buckets (same org scope) */
  let onTime = 0;
  let dueSoon = 0;
  let late = 0;
  let noEta = 0;
  let excShip = 0;
  try {
    const lr = await pool.query<{ bucket: string; count: number }>(
      `
      SELECT
        CASE
          WHEN lower(s.status) IN ('delivered', 'cancelled') THEN 'on_time'
          WHEN s.eta < now() THEN 'late'
          WHEN lower(s.status) IN ('delayed', 'exception') THEN 'exception'
          WHEN s.eta IS NULL THEN 'no_eta'
          WHEN s.eta <= now() + interval '3 days' THEN 'due_soon'
          ELSE 'on_time'
        END AS bucket,
        count(*)::int AS count
      FROM shipments s
      INNER JOIN purchase_orders po ON po.order_number = s.po_number AND ${orgPoWhere(1)}
      WHERE lower(s.status) <> 'delivered'
        AND COALESCE(s.organization_id, po.organization_id) = $1
      GROUP BY 1
      `,
      [orgId],
    );
    for (const row of lr.rows) {
      const c = toNumber(row.count, 0);
      switch (row.bucket) {
        case "on_time":
          onTime += c;
          break;
        case "due_soon":
          dueSoon += c;
          break;
        case "late":
          late += c;
          break;
        case "no_eta":
          noEta += c;
          break;
        case "exception":
          excShip += c;
          break;
        default:
          break;
      }
    }
  } catch {
    /* leave zeros */
  }
  try {
    const transit = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM shipments s
       INNER JOIN purchase_orders po ON po.order_number = s.po_number AND ${orgPoWhere(1)}
       WHERE lower(s.status) = 'in_transit'
         AND COALESCE(s.organization_id, po.organization_id) = $1`,
      [orgId],
    );
    base.kpis.inTransitShipments = toNumber(transit.rows[0]?.count, 0);
  } catch {
    base.kpis.inTransitShipments = 0;
  }
  base.logisticsRisk = [
    { id: "on_time", label: "On time", count: onTime, href: "/operations/logistics?risk=on_time" },
    { id: "due_soon", label: "Due soon", count: dueSoon, href: "/operations/logistics?risk=due_soon" },
    { id: "late", label: "Late", count: late, href: "/operations/logistics?risk=late" },
    { id: "no_eta", label: "No ETA", count: noEta, href: "/operations/logistics?risk=no_eta" },
    { id: "exception", label: "Exception", count: excShip, href: "/operations/logistics?risk=exception" },
  ];

  /* AP aging — supplier invoices with due balances */
  const apBuckets: ControlTowerDashboardPayload["apAging"] = [
    { bucket: "not_due", label: "Not due", count: 0, amount: 0 },
    { bucket: "due_7", label: "Due in 7 days", count: 0, amount: 0 },
    { bucket: "due_30", label: "Due in 30 days", count: 0, amount: 0 },
    { bucket: "od_1_30", label: "Overdue 1–30 days", count: 0, amount: 0 },
    { bucket: "od_31_60", label: "Overdue 31–60 days", count: 0, amount: 0 },
    { bucket: "od_60p", label: "Overdue 60+ days", count: 0, amount: 0 },
  ];
  const apMap = new Map(apBuckets.map((b) => [b.bucket, b]));
  let apDueCount = 0;
  try {
    const apRes = await pool.query<{ due_date: Date; due_amount: number; status: string }>(
      `
      SELECT due_date, COALESCE(due_amount, total, 0)::real AS due_amount, status::text AS status
      FROM invoices
      WHERE organization_id = $1
        AND supplier_id IS NOT NULL
        AND lower(status::text) NOT IN ('paid', 'cancelled', 'void')
        AND COALESCE(due_amount, total, 0) > 0.01
      `,
      [orgId],
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const row of apRes.rows) {
      const amt = toNumber(row.due_amount, 0);
      const due = row.due_date ? new Date(row.due_date) : null;
      if (!due) continue;
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400_000);
      let key = "not_due";
      if (diffDays < 0) {
        const od = -diffDays;
        apDueCount += 1;
        if (od <= 30) key = "od_1_30";
        else if (od <= 60) key = "od_31_60";
        else key = "od_60p";
      } else if (diffDays === 0) {
        key = "due_7";
        apDueCount += 1;
      } else if (diffDays <= 7) {
        key = "due_7";
        apDueCount += 1;
      } else if (diffDays <= 30) {
        key = "due_30";
      } else {
        key = "not_due";
      }
      const b = apMap.get(key);
      if (b) {
        b.count += 1;
        b.amount += amt;
      }
    }
    base.apAging = apBuckets.map((b) => ({
      ...b,
      amount: Math.round(b.amount * 100) / 100,
    }));
    base.kpis.apInvoicesDueOrOverdue = apDueCount;
  } catch {
    base.apAging = apBuckets;
    base.kpis.apInvoicesDueOrOverdue = 0;
  }

  /* exceptions (global table — count open) */
  try {
    const ex = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM operational_exceptions WHERE status IN ('open', 'in_progress')`,
    );
    base.kpis.operationalExceptions = toNumber(ex.rows[0]?.count, 0);
  } catch {
    base.kpis.operationalExceptions = 0;
  }

  /* supplier risk snapshot */
  try {
    const sp = await pool.query<{ supplier_id: number; name: string; late: number }>(
      `
      SELECT po.supplier_id, sup.name, count(*)::int AS late
      FROM shipments s
      INNER JOIN purchase_orders po ON po.order_number = s.po_number AND ${orgPoWhere(1)}
      INNER JOIN suppliers sup ON sup.id = po.supplier_id
      WHERE s.eta IS NOT NULL
        AND s.eta < now()
        AND lower(s.status) NOT IN ('delivered', 'cancelled')
        AND COALESCE(s.organization_id, po.organization_id) = $1
      GROUP BY po.supplier_id, sup.name
      ORDER BY late DESC
      LIMIT 5
      `,
      [orgId],
    );
    base.supplierPerformance = sp.rows.map((r) => ({
      supplierId: r.supplier_id,
      name: r.name,
      riskScore: toNumber(r.late, 0),
      lateShipments: toNumber(r.late, 0),
      openExceptions: 0,
    }));
    base.kpis.supplierRiskAlerts = base.supplierPerformance.filter((s) => s.riskScore > 0).length;
    base.spotlight.supplierRisks = base.supplierPerformance.slice(0, 8).map((r) => ({
      supplierId: r.supplierId,
      name: r.name,
      lateShipments: r.lateShipments,
      openExceptions: r.openExceptions,
      href: `/procurement/suppliers/${r.supplierId}`,
    }));
  } catch {
    base.supplierPerformance = [];
    base.kpis.supplierRiskAlerts = 0;
    base.spotlight.supplierRisks = [];
  }

  /* operations trend from ops_activity */
  try {
    const trRes = await pool.query<{
      day: Date;
      requisitions: number;
      pos: number;
      receiving: number;
      invoices: number;
      exceptions: number;
    }>(
      `
      SELECT
        date_trunc('day', created_at)::date AS day,
        count(*) FILTER (WHERE lower(entity_type) LIKE '%requisition%')::int AS requisitions,
        count(*) FILTER (
          WHERE lower(entity_type) LIKE '%purchase%'
            OR lower(entity_type) LIKE '%order%'
            OR lower(action) LIKE '%purchase_order%'
        )::int AS pos,
        count(*) FILTER (
          WHERE lower(action) LIKE '%receive%'
            OR lower(entity_type) LIKE '%receipt%'
        )::int AS receiving,
        count(*) FILTER (WHERE lower(entity_type) LIKE '%invoice%')::int AS invoices,
        count(*) FILTER (WHERE lower(entity_type) LIKE '%exception%')::int AS exceptions
      FROM ops_activity
      WHERE created_at >= (now() - ($1::int * interval '1 day'))
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [trendDays],
    );
    base.operationsTrend = trRes.rows.map((r) => ({
      date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      requisitions: toNumber(r.requisitions, 0),
      purchaseOrders: toNumber(r.pos, 0),
      receiving: toNumber(r.receiving, 0),
      invoices: toNumber(r.invoices, 0),
      exceptions: toNumber(r.exceptions, 0),
    }));
  } catch {
    base.operationsTrend = [];
  }

  /* needs attention (lightweight caps) */
  const na: ControlTowerDashboardPayload["needsAttention"] = [];
  if (negative > 0) {
    na.push({
      id: "neg-inv",
      title: "Negative inventory SKUs",
      severity: "high",
      reason: `${negative} SKU(s) have negative available quantity.`,
      href: "/inventory",
      area: "inventory",
    });
  }
  if (lowStock > 0) {
    na.push({
      id: "low-inv",
      title: "Low stock items",
      severity: mediumSev(lowStock),
      reason: `${lowStock} SKU(s) at or below reorder threshold, including zero or negative availability.`,
      href: "/inventory?low=1",
      area: "inventory",
    });
  }
  if (approvedPo > 0) {
    na.push({
      id: "po-approve",
      title: "POs awaiting send",
      severity: "medium",
      reason: `${approvedPo} approved PO(s) not yet sent.`,
      href: "/procurement/orders",
      area: "procurement",
    });
  }
  if (sentPo + partialPo > 0) {
    na.push({
      id: "po-inflight",
      title: "POs sent / partially received",
      severity: "low",
      reason: `${sentPo + partialPo} PO(s) in flight — confirm receiving.`,
      href: "/procurement/orders",
      area: "procurement",
    });
  }
  if (lateShip > 0) {
    na.push({
      id: "late-ship",
      title: "Late shipments",
      severity: "high",
      reason: `${lateShip} shipment(s) past ETA and not delivered.`,
      href: "/operations/logistics?risk=late",
      area: "logistics",
    });
  }
  if (apDueCount > 0) {
    na.push({
      id: "ap-due",
      title: "AP invoices due or overdue",
      severity: "high",
      reason: `${apDueCount} invoice(s) need payment attention.`,
      href: "/finance/invoices?attention=due",
      area: "finance",
    });
  }
  if (base.kpis.operationalExceptions > 0) {
    na.push({
      id: "ex-open",
      title: "Operational exceptions",
      severity: "medium",
      reason: `${base.kpis.operationalExceptions} open exception case(s).`,
      href: "/operations/exceptions?status=active",
      area: "operations",
    });
  }

  /* portal captures needing review */
  try {
    const cap = await pool.query<{ count: number }>(
      `
      SELECT count(*)::int AS count
      FROM ap_invoice_captures
      WHERE organization_id = $1
        AND status IN ('STAGED', 'REVIEW_REQUIRED')
      `,
      [orgId],
    );
    const capN = toNumber(cap.rows[0]?.count, 0);
    if (capN > 0) {
      na.push({
        id: "ap-capture",
        title: "Supplier invoices to review",
        severity: "medium",
        reason: `${capN} capture(s) need portal / intake review.`,
        href: "/finance/accounts-payable/intake",
        area: "finance",
      });
    }
  } catch {
    /* table may not exist in some installs */
  }

  base.needsAttention = na.slice(0, 12);

  /* recent activity — limited, single query */
  try {
    const rows = await listOperationalActivity({ limit: 10 });
    base.recentActivity = rows.map((entry: any) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actor: entry.actor,
      createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
      summary: summaryText(entry.summary ?? {}),
    }));
  } catch {
    base.recentActivity = [];
  }

  /* spotlight — delayed shipments + oldest open exceptions */
  try {
    const ds = await pool.query<{
      id: number;
      po_number: string;
      carrier: string | null;
      eta: Date | null;
      drift: string | null;
    }>(
      `
      SELECT s.id, s.po_number, s.carrier, s.eta,
        (EXTRACT(EPOCH FROM (now() - s.eta)) / 60.0)::text AS drift
      FROM shipments s
      INNER JOIN purchase_orders po ON po.order_number = s.po_number AND ${orgPoWhere(1)}
      WHERE s.eta IS NOT NULL
        AND s.eta < now()
        AND lower(s.status) NOT IN ('delivered', 'cancelled')
        AND COALESCE(s.organization_id, po.organization_id) = $1
      ORDER BY s.eta ASC
      LIMIT 8
      `,
      [orgId],
    );
    base.spotlight.delayedShipments = ds.rows.map((r) => ({
      id: r.id,
      poNumber: r.po_number,
      carrier: r.carrier,
      eta: r.eta ? r.eta.toISOString() : null,
      driftMinutes: Math.max(0, Math.round(Number(r.drift ?? 0))),
      href: `/operations/logistics/${r.id}`,
    }));
    base.meta.dataFreshness = { ...base.meta.dataFreshness, shipments: new Date().toISOString() };
  } catch {
    base.meta.partialFailures!.push({
      area: "spotlight_shipments",
      code: "QUERY_FAILED",
      message: "Delayed shipments spotlight failed",
      fallbackUsed: true,
    });
  }

  try {
    const ox = await pool.query<{
      id: number;
      type: string;
      title: string;
      severity: string;
      aged: string | null;
    }>(
      `
      SELECT id, type, title, severity,
        (EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0)::text AS aged
      FROM operational_exceptions
      WHERE lower(status) IN ('open', 'in_progress')
      ORDER BY created_at ASC
      LIMIT 8
      `,
    );
    base.spotlight.oldestOpenExceptions = ox.rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      agedHours: Math.max(0, Math.round(Number(r.aged ?? 0))),
      severity: r.severity,
      href: `/operations/exceptions/${r.id}`,
    }));
    base.meta.dataFreshness = { ...base.meta.dataFreshness, exceptions: new Date().toISOString() };
  } catch {
    base.meta.partialFailures!.push({
      area: "spotlight_exceptions",
      code: "QUERY_FAILED",
      message: "Oldest exceptions spotlight failed",
      fallbackUsed: true,
    });
  }

  applyBusinessAreaFilter(base, businessArea);
  return base;
}
