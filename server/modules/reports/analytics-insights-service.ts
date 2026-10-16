import type { QueryResultRow } from "pg";
import { pool } from "../../db";
import type {
  AnalyticsFilters,
  AnalyticsPartialFailure,
  AnalyticsRecommendation,
  AnalyticsResponse,
  ChartDatum,
  TableData,
  TrendDatum,
} from "../../../shared/analytics-types";

type AnalyticsArea = "overview" | "procurement" | "inventory" | "logistics" | "suppliers" | "finance" | "exceptions" | "diagnostics" | "reports";

const OPEN_PO_STATUSES = ["DRAFT", "OPEN", "APPROVED", "SENT", "ACKNOWLEDGED", "PARTIALLY_RECEIVED"];
const CLOSED_SHIPMENT_STATUSES = ["delivered", "cancelled"];

function finite(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusHref(base: string, key: string, value: string | number): string {
  return `${base}?${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
}

export async function buildAnalyticsInsights(
  organizationId: number,
  area: AnalyticsArea,
  filters: AnalyticsFilters,
): Promise<AnalyticsResponse> {
  const started = Date.now();
  const partialFailures: AnalyticsPartialFailure[] = [];
  const params = [
    organizationId,
    filters.dateFrom ?? null,
    filters.dateTo ?? null,
    filters.supplierId ?? null,
    filters.warehouseId ?? null,
    filters.categoryId ?? null,
    filters.ownerId ?? null,
    filters.departmentId ?? null,
    filters.risk ?? null,
    filters.status ?? null,
    OPEN_PO_STATUSES,
    CLOSED_SHIPMENT_STATUSES,
  ];

  async function query<T extends QueryResultRow>(source: string, sql: string): Promise<T[]> {
    try {
      // Analytics queries intentionally use one shared semantic parameter map,
      // but individual datasets reference different subsets. PostgreSQL requires
      // every positional parameter up to the highest index to have an inferable
      // type, so compact sparse placeholders before execution.
      const referenced = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))]
        .sort((left, right) => left - right);
      const compactIndexes = new Map(referenced.map((original, index) => [original, index + 1]));
      const compactSql = sql.replace(/\$(\d+)/g, (_placeholder, rawIndex: string) => `$${compactIndexes.get(Number(rawIndex))}`);
      const compactParams = referenced.map((index) => params[index - 1]);
      return (await pool.query<T>(compactSql, compactParams)).rows;
    } catch (error) {
      partialFailures.push({
        area: source,
        code: `${source.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_ANALYTICS_UNAVAILABLE`,
        message: error instanceof Error ? error.message : `The ${source} analytics query failed.`,
        fallbackUsed: false,
      });
      return [];
    }
  }

  const [supplierOptions, warehouseOptions, categoryOptions, departmentOptions, ownerOptions] = await Promise.all([
    query<{ id: number; label: string; code: string | null }>("filter_suppliers", `
      SELECT id, COALESCE(legal_name, name) AS label, supplier_code AS code
      FROM suppliers WHERE organization_id=$1 AND status='active' ORDER BY label, id LIMIT 100`),
    query<{ id: number; label: string; code: string | null }>("filter_warehouses", `
      SELECT id, name AS label, NULL::text AS code FROM warehouses WHERE organization_id=$1 ORDER BY name, id LIMIT 100`),
    query<{ id: number; label: string; code: string | null }>("filter_categories", `
      SELECT id, name AS label, NULL::text AS code FROM categories WHERE organization_id=$1 ORDER BY name, id LIMIT 100`),
    query<{ id: number; label: string; code: string | null }>("filter_departments", `
      SELECT id, name AS label, code FROM departments WHERE organization_id=$1 AND COALESCE(active, true)=true ORDER BY name, id LIMIT 100`),
    query<{ id: number; label: string; code: string | null }>("filter_owners", `
      SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS label, u.username AS code
      FROM organization_members membership JOIN users u ON u.id=membership.user_id
      WHERE membership.organization_id=$1 AND membership.active=true ORDER BY label, u.id LIMIT 100`),
  ]);

  const [poSummaryRows, poPipelineRows, requisitionPipelineRows, supplierSpendRows, categorySpendRows] = await Promise.all([
    query<Record<string, unknown>>("procurement", `
      SELECT COALESCE(SUM(po.total_amount),0)::float8 AS spend,
             COUNT(*) FILTER (WHERE upper(po.status)=ANY($11::text[]))::int AS open_count,
             COALESCE(SUM(po.total_amount) FILTER (WHERE upper(po.status)=ANY($11::text[])),0)::float8 AS open_value,
             MIN(po.order_date) FILTER (WHERE upper(po.status)=ANY($11::text[])) AS oldest_open,
             COUNT(*) FILTER (WHERE po.expected_delivery_date < now() AND upper(po.status)=ANY($11::text[]))::int AS late_count,
             MAX(po.updated_at) AS freshness
      FROM purchase_orders po
      WHERE po.organization_id=$1
        AND ($2::timestamptz IS NULL OR po.order_date >= $2)
        AND ($3::timestamptz IS NULL OR po.order_date <= $3)
        AND ($4::int IS NULL OR po.supplier_id=$4)
        AND ($7::int IS NULL OR po.created_by_user_id=$7)
        AND ($8::int IS NULL OR po.department_id=$8)
        AND ($10::text IS NULL OR lower(po.status)=lower($10))`,
    ),
    query<{ status: string; value: number }>("procurement_pipeline", `
      SELECT lower(status) AS status, COUNT(*)::int AS value
      FROM purchase_orders po WHERE po.organization_id=$1
        AND ($2::timestamptz IS NULL OR po.order_date >= $2) AND ($3::timestamptz IS NULL OR po.order_date <= $3)
        AND ($4::int IS NULL OR po.supplier_id=$4) AND ($7::int IS NULL OR po.created_by_user_id=$7)
        AND ($8::int IS NULL OR po.department_id=$8)
      GROUP BY lower(status) ORDER BY lower(status)`),
    query<{ status: string; value: number }>("requisition_pipeline", `
      SELECT lower(status) AS status, COUNT(*)::int AS value
      FROM purchase_requisitions requisition WHERE requisition.organization_id=$1
        AND ($2::timestamptz IS NULL OR requisition.created_at >= $2) AND ($3::timestamptz IS NULL OR requisition.created_at <= $3)
        AND ($4::int IS NULL OR requisition.supplier_id=$4) AND ($7::int IS NULL OR requisition.requestor_id=$7)
        AND ($8::int IS NULL OR requisition.department_id=$8)
      GROUP BY lower(status) ORDER BY lower(status)`),
    query<Record<string, unknown>>("supplier_spend", `
      SELECT supplier.id, COALESCE(supplier.legal_name,supplier.name) AS label,
             COUNT(po.id)::int AS count, COALESCE(SUM(po.total_amount),0)::float8 AS amount
      FROM suppliers supplier LEFT JOIN purchase_orders po ON po.supplier_id=supplier.id AND po.organization_id=$1
        AND ($2::timestamptz IS NULL OR po.order_date >= $2) AND ($3::timestamptz IS NULL OR po.order_date <= $3)
        AND ($8::int IS NULL OR po.department_id=$8)
      WHERE supplier.organization_id=$1 AND ($4::int IS NULL OR supplier.id=$4)
      GROUP BY supplier.id, supplier.legal_name, supplier.name ORDER BY amount DESC, supplier.id LIMIT 15`),
    query<Record<string, unknown>>("category_spend", `
      SELECT COALESCE(category.name,'Uncategorised') AS label, COALESCE(SUM(line.total_price),0)::float8 AS amount,
             COUNT(DISTINCT po.id)::int AS count
      FROM purchase_order_items line JOIN purchase_orders po ON po.id=line.order_id AND po.organization_id=$1
      LEFT JOIN inventory_items item ON item.id=line.item_id AND item.organization_id=$1
      LEFT JOIN categories category ON category.id=item.category_id AND category.organization_id=$1
      WHERE ($2::timestamptz IS NULL OR po.order_date >= $2) AND ($3::timestamptz IS NULL OR po.order_date <= $3)
        AND ($4::int IS NULL OR po.supplier_id=$4) AND ($6::int IS NULL OR item.category_id=$6)
        AND ($8::int IS NULL OR po.department_id=$8)
      GROUP BY COALESCE(category.name,'Uncategorised') ORDER BY amount DESC LIMIT 15`),
  ]);

  const inventoryRows = await query<Record<string, unknown>>("inventory", `
    WITH warehouse_stock AS (
      SELECT item_id, SUM(quantity)::float8 AS quantity FROM warehouse_inventory
      WHERE organization_id=$1 AND ($5::int IS NULL OR warehouse_id=$5) GROUP BY item_id
    )
    SELECT item.id, item.sku, item.name, COALESCE(category.name,'Uncategorised') AS category,
           COALESCE(warehouse_stock.quantity,item.quantity,0)::float8 AS available,
           COALESCE(item.low_stock_threshold,item.reorder_point,0)::float8 AS threshold,
           COALESCE(item.cost,item.price,0)::float8 AS unit_cost, item.expiry_date, item.updated_at,
           supplier.name AS supplier_name
    FROM inventory_items item LEFT JOIN warehouse_stock ON warehouse_stock.item_id=item.id
    LEFT JOIN categories category ON category.id=item.category_id AND category.organization_id=$1
    LEFT JOIN suppliers supplier ON supplier.id=item.supplier_id AND supplier.organization_id=$1
    WHERE item.organization_id=$1 AND COALESCE(item.status,'active')='active'
      AND ($4::int IS NULL OR item.supplier_id=$4) AND ($6::int IS NULL OR item.category_id=$6)
    ORDER BY available ASC, item.id LIMIT 5000`);

  const shipmentRows = await query<Record<string, unknown>>("logistics", `
    SELECT shipment.id, shipment.po_number, shipment.carrier, shipment.tracking_number, shipment.status,
           shipment.eta, shipment.created_at, shipment.updated_at,
           COALESCE(supplier.legal_name,supplier.name) AS supplier_name,
           CASE WHEN shipment.eta IS NULL THEN 'no_eta'
                WHEN shipment.eta < now() AND lower(shipment.status) <> ALL($12::text[]) THEN 'late'
                WHEN shipment.eta <= now()+interval '7 days' AND lower(shipment.status) <> ALL($12::text[]) THEN 'due_soon'
                ELSE 'on_time' END AS risk,
           GREATEST(0, EXTRACT(EPOCH FROM (now()-shipment.eta))/86400)::float8 AS days_late
    FROM shipments shipment LEFT JOIN purchase_orders po ON po.organization_id=$1
      AND (po.id=shipment.purchase_order_id OR po.order_number=shipment.po_number)
    LEFT JOIN suppliers supplier ON supplier.id=po.supplier_id AND supplier.organization_id=$1
    WHERE shipment.organization_id=$1
      AND ($2::timestamptz IS NULL OR shipment.created_at >= $2) AND ($3::timestamptz IS NULL OR shipment.created_at <= $3)
      AND ($4::int IS NULL OR po.supplier_id=$4) AND ($10::text IS NULL OR lower(shipment.status)=lower($10))
    ORDER BY shipment.eta NULLS FIRST, shipment.id DESC LIMIT 5000`);

  const invoiceRows = await query<Record<string, unknown>>("finance", `
    SELECT invoice.id, invoice.invoice_number, invoice.status, invoice.issue_date, invoice.due_date,
           COALESCE(NULLIF(invoice.due_amount,0), invoice.total-COALESCE(invoice.paid_amount,0),0)::float8 AS due_amount,
           COALESCE(supplier.legal_name,supplier.name) AS supplier_name, invoice.purchase_order_id, invoice.updated_at,
           CASE WHEN invoice.due_date < now()-interval '60 days' THEN 'overdue_60_plus'
                WHEN invoice.due_date < now()-interval '30 days' THEN 'overdue_31_60'
                WHEN invoice.due_date < now() THEN 'overdue_1_30'
                WHEN invoice.due_date <= now()+interval '7 days' THEN 'due_7'
                WHEN invoice.due_date <= now()+interval '30 days' THEN 'due_30'
                ELSE 'not_due' END AS aging
    FROM invoices invoice LEFT JOIN suppliers supplier ON supplier.id=invoice.supplier_id AND supplier.organization_id=$1
    WHERE invoice.organization_id=$1
      AND ($2::timestamptz IS NULL OR invoice.issue_date >= $2) AND ($3::timestamptz IS NULL OR invoice.issue_date <= $3)
      AND ($4::int IS NULL OR invoice.supplier_id=$4) AND ($7::int IS NULL OR invoice.created_by=$7)
      AND ($10::text IS NULL OR lower(invoice.status::text)=lower($10))
    ORDER BY invoice.due_date, invoice.id DESC LIMIT 5000`);

  const exceptionRows = await query<Record<string, unknown>>("exceptions", `
    SELECT id, type, severity, status, title, assignee, sla_hours, related_refs, created_at, updated_at,
           EXTRACT(EPOCH FROM (now()-created_at))/3600 AS age_hours
    FROM operational_exceptions exception WHERE exception.organization_id=$1
      AND ($2::timestamptz IS NULL OR exception.created_at >= $2) AND ($3::timestamptz IS NULL OR exception.created_at <= $3)
      AND ($9::text IS NULL OR lower(exception.severity)=lower($9)) AND ($10::text IS NULL OR lower(exception.status)=lower($10))
    ORDER BY CASE lower(severity) WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
             created_at ASC, id ASC LIMIT 5000`);

  const supplierRiskRows = await query<Record<string, unknown>>("supplier_risk", `
    SELECT supplier.id, COALESCE(supplier.legal_name,supplier.name) AS supplier,
           COALESCE(supplier.risk_rating,supplier.risk_status,'unrated') AS risk,
           COUNT(DISTINCT po.id) FILTER (WHERE upper(po.status)=ANY($11::text[]))::int AS open_pos,
           COALESCE(SUM(po.total_amount) FILTER (WHERE upper(po.status)=ANY($11::text[])),0)::float8 AS open_value,
           COUNT(DISTINCT shipment.id) FILTER (WHERE shipment.eta < now() AND lower(shipment.status)<>ALL($12::text[]))::int AS late_shipments
    FROM suppliers supplier
    LEFT JOIN purchase_orders po ON po.supplier_id=supplier.id AND po.organization_id=$1
    LEFT JOIN shipments shipment ON shipment.organization_id=$1 AND (shipment.purchase_order_id=po.id OR shipment.po_number=po.order_number)
    WHERE supplier.organization_id=$1 AND supplier.status='active' AND ($4::int IS NULL OR supplier.id=$4)
    GROUP BY supplier.id, supplier.legal_name, supplier.name, supplier.risk_rating, supplier.risk_status
    ORDER BY late_shipments DESC, open_value DESC, supplier.id LIMIT 100`);

  const trendRows = await query<Record<string, unknown>>("operations_trend", `
    WITH days AS (SELECT generate_series(COALESCE($2::date, current_date-interval '29 days'), COALESCE($3::date,current_date), interval '1 day')::date AS day)
    SELECT day,
      (SELECT count(*) FROM purchase_requisitions r WHERE r.organization_id=$1 AND r.created_at::date=day)::int AS requisitions,
      (SELECT count(*) FROM purchase_orders p WHERE p.organization_id=$1 AND p.created_at::date=day)::int AS purchase_orders,
      (SELECT count(*) FROM stock_movements m WHERE m.organization_id=$1 AND m.timestamp::date=day AND m.type='RECEIPT')::int AS receipts,
      (SELECT count(*) FROM shipments s WHERE s.organization_id=$1 AND s.created_at::date=day)::int AS shipments,
      (SELECT count(*) FROM invoices i WHERE i.organization_id=$1 AND i.created_at::date=day)::int AS invoices,
      (SELECT count(*) FROM operational_exceptions e WHERE e.organization_id=$1 AND e.created_at::date=day)::int AS exceptions_opened
    FROM days ORDER BY day`);

  const openPoStatuses = new Set(OPEN_PO_STATUSES.map((value) => value.toLowerCase()));
  const closedShipments = new Set(CLOSED_SHIPMENT_STATUSES);
  const filteredShipments = shipmentRows.filter((row) => !filters.risk || row.risk === filters.risk);
  const activeExceptions = exceptionRows.filter((row) => ["open", "in_progress"].includes(String(row.status).toLowerCase()));
  const inventory = inventoryRows.map((row): Record<string, unknown> & { available: number; threshold: number; unit_cost: number } => ({
    ...row,
    available: finite(row.available),
    threshold: finite(row.threshold),
    unit_cost: finite(row.unit_cost),
  }));
  const lowStock = inventory.filter((row) => finite(row.available) <= finite(row.threshold));
  const negativeStock = inventory.filter((row) => finite(row.available) < 0);
  const zeroStock = inventory.filter((row) => finite(row.available) === 0);
  const expiring = inventory.filter((row) => row.expiry_date && new Date(String(row.expiry_date)).getTime() <= Date.now() + 30 * 86_400_000);
  const healthy = inventory.filter((row) => finite(row.available) > finite(row.threshold));
  const lateShipments = filteredShipments.filter((row) => row.risk === "late" && !closedShipments.has(String(row.status).toLowerCase()));
  const noEtaShipments = filteredShipments.filter((row) => row.risk === "no_eta" && !closedShipments.has(String(row.status).toLowerCase()));
  const openInvoices = invoiceRows.filter((row) => !["PAID", "CANCELLED", "REJECTED"].includes(String(row.status).toUpperCase()) && finite(row.due_amount) > 0);
  const overdueInvoices = openInvoices.filter((row) => String(row.aging).startsWith("overdue"));
  const pendingInvoices = openInvoices.filter((row) => String(row.status).toUpperCase() === "PENDING_APPROVAL");
  const highRiskSuppliers = supplierRiskRows.filter((row) => ["high", "critical", "blocked"].includes(String(row.risk).toLowerCase()) || finite(row.late_shipments) > 0);
  const poSummary = poSummaryRows[0] ?? {};

  const pipeline: ChartDatum[] = [
    ...requisitionPipelineRows.map((row) => ({ label: `Requisition: ${row.status.replaceAll("_", " ")}`, value: finite(row.value), href: statusHref("/procurement/requisitions", "status", row.status) })),
    ...poPipelineRows.map((row) => ({ label: `PO: ${row.status.replaceAll("_", " ")}`, value: finite(row.value), href: statusHref("/procurement/orders", "status", row.status) })),
  ];
  const inventoryHealth: ChartDatum[] = [
    { label: "Healthy", value: healthy.length, href: "/inventory?stockStatus=healthy" },
    { label: "Low stock", value: lowStock.length, risk: "high", href: "/inventory?low=1" },
    { label: "Zero stock", value: zeroStock.length, risk: "high", href: "/inventory?stockStatus=zero" },
    { label: "Negative", value: negativeStock.length, risk: "critical", href: "/inventory?stockStatus=negative" },
    { label: "Expiring", value: expiring.length, risk: "medium", href: "/inventory?stockStatus=expiring" },
  ];
  const logisticsRisk: ChartDatum[] = ["on_time", "due_soon", "late", "no_eta"].map((risk) => ({
    label: risk.replaceAll("_", " "),
    value: filteredShipments.filter((row) => row.risk === risk).length,
    href: statusHref("/operations/logistics", "risk", risk),
  }));
  const apAging: ChartDatum[] = ["not_due", "due_7", "due_30", "overdue_1_30", "overdue_31_60", "overdue_60_plus"].map((aging) => ({
    label: aging.replaceAll("_", " "), value: openInvoices.filter((row) => row.aging === aging).length,
    amount: openInvoices.filter((row) => row.aging === aging).reduce((sum, row) => sum + finite(row.due_amount), 0),
    href: statusHref("/finance/accounts-payable/aging", "aging", aging),
  }));
  const exceptionSeverity: ChartDatum[] = ["low", "medium", "high", "critical"].map((severity) => ({
    label: severity, value: activeExceptions.filter((row) => String(row.severity).toLowerCase() === severity).length,
    risk: severity as ChartDatum["risk"], href: statusHref("/operations/exceptions", "severity", severity),
  }));
  const operationsTrend: TrendDatum[] = trendRows.map((row) => ({
    date: String(row.day).slice(0, 10), requisitions: finite(row.requisitions), purchaseOrders: finite(row.purchase_orders),
    receipts: finite(row.receipts), shipments: finite(row.shipments), invoices: finite(row.invoices), exceptionsOpened: finite(row.exceptions_opened),
  }));

  const tables: Record<string, TableData> = {
    delayedShipments: {
      columns: [
        { key: "id", label: "Shipment", type: "link" }, { key: "poNumber", label: "PO" }, { key: "supplier", label: "Supplier" },
        { key: "carrier", label: "Carrier" }, { key: "eta", label: "ETA", type: "date" }, { key: "daysLate", label: "Days late", type: "number" }, { key: "risk", label: "Risk", type: "risk" },
      ],
      rows: lateShipments.slice(0, 25).map((row) => ({ id: row.id, href: `/operations/logistics/${row.id}`, poNumber: row.po_number, supplier: row.supplier_name ?? "—", carrier: row.carrier ?? "—", eta: iso(row.eta), daysLate: Math.floor(finite(row.days_late)), risk: row.risk })),
      emptyTitle: "No late shipments", emptyDescription: "All shipments with an ETA are currently on time for the selected period.",
    },
    oldestOpenExceptions: {
      columns: [
        { key: "id", label: "Exception", type: "link" }, { key: "title", label: "Title" }, { key: "area", label: "Area" },
        { key: "severity", label: "Severity", type: "risk" }, { key: "ageHours", label: "Age (hours)", type: "number" }, { key: "owner", label: "Owner" },
      ],
      rows: activeExceptions.slice(0, 25).map((row) => ({ id: row.id, href: `/operations/exceptions?finding=${row.id}`, title: row.title, area: row.type, severity: row.severity, ageHours: Math.floor(finite(row.age_hours)), owner: row.assignee ?? "Unassigned" })),
      emptyTitle: "No open exceptions", emptyDescription: "No current operational exceptions match the selected filters.",
    },
    highRiskSuppliers: {
      columns: [
        { key: "supplier", label: "Supplier", type: "link" }, { key: "risk", label: "Risk", type: "risk" }, { key: "openPos", label: "Open POs", type: "number" },
        { key: "lateShipments", label: "Late shipments", type: "number" }, { key: "exposure", label: "Open exposure", type: "money" },
      ],
      rows: highRiskSuppliers.slice(0, 25).map((row) => ({ supplier: row.supplier, href: `/procurement/suppliers/${row.id}`, risk: row.risk, openPos: finite(row.open_pos), lateShipments: finite(row.late_shipments), exposure: finite(row.open_value) })),
      emptyTitle: "No high-risk suppliers", emptyDescription: "No active supplier currently meets the high-risk or late-delivery criteria.",
    },
    lowStockItems: {
      columns: [
        { key: "sku", label: "SKU", type: "link" }, { key: "name", label: "Item" }, { key: "category", label: "Category" },
        { key: "available", label: "Available", type: "number" }, { key: "threshold", label: "Reorder point", type: "number" }, { key: "supplier", label: "Preferred supplier" },
      ],
      rows: lowStock.slice(0, 25).map((row) => ({ sku: row.sku, href: `/inventory/${encodeURIComponent(String(row.sku))}`, name: row.name, category: row.category, available: finite(row.available), threshold: finite(row.threshold), supplier: row.supplier_name ?? "Not configured" })),
      emptyTitle: "No low-stock items", emptyDescription: "Every active item is above its configured threshold for this view.",
    },
    overdueInvoices: {
      columns: [
        { key: "invoice", label: "Invoice", type: "link" }, { key: "supplier", label: "Supplier" }, { key: "dueDate", label: "Due date", type: "date" },
        { key: "amount", label: "Amount", type: "money" }, { key: "status", label: "Status", type: "status" }, { key: "aging", label: "Aging" },
      ],
      rows: overdueInvoices.slice(0, 25).map((row) => ({ invoice: row.invoice_number ?? `Invoice #${row.id}`, href: `/finance/invoices/${row.id}`, supplier: row.supplier_name ?? "—", dueDate: iso(row.due_date), amount: finite(row.due_amount), status: row.status, aging: row.aging })),
      emptyTitle: "No overdue invoices", emptyDescription: "No unpaid supplier invoices are overdue for the selected period.",
    },
  };

  const recommendations: AnalyticsRecommendation[] = [];
  if (negativeStock.length) recommendations.push({ id: "negative-stock", severity: "critical", area: "Inventory", title: `${negativeStock.length} item${negativeStock.length === 1 ? " has" : "s have"} negative stock`, reason: "Negative availability can allow commitments that cannot be fulfilled.", suggestedAction: "Review stock movements and correct the affected warehouse balances.", href: "/inventory?stockStatus=negative" });
  if (lateShipments.length) recommendations.push({ id: "late-shipments", severity: "high", area: "Logistics", title: `${lateShipments.length} shipment${lateShipments.length === 1 ? " is" : "s are"} past ETA`, reason: `The worst current delay is ${Math.floor(Math.max(...lateShipments.map((row) => finite(row.days_late))))} day(s).`, suggestedAction: "Contact the supplier or carrier and update the expected arrival date.", href: "/operations/logistics?risk=late" });
  if (lowStock.length) recommendations.push({ id: "low-stock", severity: negativeStock.length ? "critical" : "high", area: "Inventory", title: `${lowStock.length} item${lowStock.length === 1 ? " is" : "s are"} at or below reorder threshold`, reason: "Low stock can interrupt receiving, fulfilment, and operational work.", suggestedAction: "Review replenishment and open purchase-order coverage.", href: "/inventory?low=1" });
  if (overdueInvoices.length) recommendations.push({ id: "overdue-ap", severity: "high", area: "Finance / AP", title: `${overdueInvoices.length} supplier invoice${overdueInvoices.length === 1 ? " is" : "s are"} overdue`, reason: `Overdue exposure is ${overdueInvoices.reduce((sum, row) => sum + finite(row.due_amount), 0).toFixed(2)} in document currencies.`, suggestedAction: "Resolve approval, matching, or payment blockers.", href: "/finance/accounts-payable/aging?aging=overdue" });
  if (activeExceptions.length) recommendations.push({ id: "open-exceptions", severity: activeExceptions.some((row) => String(row.severity).toLowerCase() === "critical") ? "critical" : "medium", area: "Exceptions", title: `${activeExceptions.length} operational exception${activeExceptions.length === 1 ? " needs" : "s need"} attention`, reason: `${activeExceptions.filter((row) => finite(row.age_hours) > finite(row.sla_hours)).length} are beyond their configured SLA.`, suggestedAction: "Assign owners and resolve the oldest or highest-severity findings first.", href: "/operations/exceptions?status=open" });
  if (noEtaShipments.length) recommendations.push({ id: "missing-eta", severity: "medium", area: "Logistics", title: `${noEtaShipments.length} active shipment${noEtaShipments.length === 1 ? " has" : "s have"} no ETA`, reason: "Delivery risk cannot be measured without an expected arrival date.", suggestedAction: "Request and record an ETA from the supplier or carrier.", href: "/operations/logistics?risk=no_eta" });

  const dataQualityWarnings = [
    { code: "PO_MISSING_EXPECTED_DATE", message: "Purchase orders have no expected delivery date.", count: Math.max(0, finite(poSummary.open_count) - filteredShipments.filter((row) => row.eta).length), href: "/procurement/orders" },
    { code: "ITEM_MISSING_REORDER_POINT", message: "Inventory items have no meaningful reorder threshold.", count: inventory.filter((row) => finite(row.threshold) <= 0).length, href: "/inventory" },
    { code: "SHIPMENT_MISSING_CARRIER", message: "Shipments have no carrier configured.", count: filteredShipments.filter((row) => !row.carrier).length, href: "/operations/logistics" },
    { code: "SHIPMENT_MISSING_ETA", message: "Active shipments have no ETA.", count: noEtaShipments.length, href: "/operations/logistics?risk=no_eta" },
  ].filter((warning) => warning.count > 0);

  const reportingCurrency = "reporting currency";
  const kpis = {
    procurementSpend: { label: "Total procurement spend", value: finite(poSummary.spend), status: "neutral" as const, href: "/procurement/orders", helperText: `Purchase-order value in document currencies for the selected period (${reportingCurrency} conversion is shown in detailed reports).` },
    openPurchaseOrders: { label: "Open purchase orders", value: finite(poSummary.open_count), status: finite(poSummary.late_count) ? "warning" as const : "good" as const, href: "/procurement/orders?status=open", helperText: "Draft, open, approved, sent, acknowledged, and partially received orders.", details: { value: finite(poSummary.open_value), oldestOpen: iso(poSummary.oldest_open), highRiskCount: finite(poSummary.late_count) } },
    inventoryHealth: { label: "Inventory health", value: healthy.length, status: negativeStock.length ? "danger" as const : lowStock.length ? "warning" as const : "good" as const, href: "/inventory", helperText: "Healthy active SKUs; low, zero, and negative stock are shown separately.", details: { lowStock: lowStock.length, zeroStock: zeroStock.length, negativeStock: negativeStock.length } },
    lateShipments: { label: "Late shipments", value: lateShipments.length, status: lateShipments.length ? "danger" as const : "good" as const, href: "/operations/logistics?risk=late", helperText: "Active shipments whose ETA has passed.", details: { averageDaysLate: lateShipments.length ? Number((lateShipments.reduce((sum, row) => sum + finite(row.days_late), 0) / lateShipments.length).toFixed(1)) : 0, worstDelayDays: lateShipments.length ? Math.floor(Math.max(...lateShipments.map((row) => finite(row.days_late)))) : 0 } },
    openExceptions: { label: "Open exceptions", value: activeExceptions.length, status: activeExceptions.some((row) => String(row.severity).toLowerCase() === "critical") ? "danger" as const : activeExceptions.length ? "warning" as const : "good" as const, href: "/operations/exceptions?status=open", helperText: "Current open or in-progress operational exceptions.", details: { critical: activeExceptions.filter((row) => String(row.severity).toLowerCase() === "critical").length, overSla: activeExceptions.filter((row) => finite(row.age_hours) > finite(row.sla_hours)).length, oldestHours: activeExceptions.length ? Math.floor(Math.max(...activeExceptions.map((row) => finite(row.age_hours)))) : 0 } },
    apExposure: { label: "AP exposure", value: openInvoices.reduce((sum, row) => sum + finite(row.due_amount), 0), status: overdueInvoices.length ? "danger" as const : "neutral" as const, href: "/finance/accounts-payable", helperText: "Unpaid supplier invoice exposure in document currencies.", details: { overdueValue: overdueInvoices.reduce((sum, row) => sum + finite(row.due_amount), 0), dueThisWeek: openInvoices.filter((row) => row.aging === "due_7").reduce((sum, row) => sum + finite(row.due_amount), 0), pendingApprovalValue: pendingInvoices.reduce((sum, row) => sum + finite(row.due_amount), 0) } },
    supplierRisk: { label: "Supplier risk", value: highRiskSuppliers.length, status: highRiskSuppliers.length ? "warning" as const : "good" as const, href: "/procurement/suppliers?risk=high", helperText: "Active suppliers with high/critical ratings or current late shipments.", details: { worstSupplier: String(highRiskSuppliers[0]?.supplier ?? "None"), lateShipments: highRiskSuppliers.reduce((sum, row) => sum + finite(row.late_shipments), 0) } },
    systemHealth: { label: "System health", value: partialFailures.length ? "Degraded" : "Ready", status: partialFailures.length ? "warning" as const : "good" as const, href: "/admin/system-diagnostics", helperText: "Readiness of the analytics data sources used for this view.", details: { failedAnalyticsFeeds: partialFailures.length, failedApiCalls: "Open diagnostics", slowEndpoints: "Open diagnostics", routeWarnings: "Open diagnostics" } },
  };

  const charts: AnalyticsResponse["charts"] = {
    procurementPipeline: pipeline,
    inventoryHealth,
    logisticsRisk,
    apAging,
    exceptionsBySeverity: exceptionSeverity,
    operationsTrend,
    spendBySupplier: supplierSpendRows.map((row) => ({ label: String(row.label), value: finite(row.amount), amount: finite(row.amount), count: finite(row.count), href: `/procurement/suppliers/${row.id}` })),
    spendByCategory: categorySpendRows.map((row) => ({ label: String(row.label), value: finite(row.amount), amount: finite(row.amount), count: finite(row.count), href: "/analytics/reports/purchase-orders" })),
    supplierRisk: supplierRiskRows.slice(0, 15).map((row) => ({ label: String(row.supplier), value: finite(row.late_shipments) + finite(row.open_pos), amount: finite(row.open_value), href: `/procurement/suppliers/${row.id}` })),
    invoiceStatus: [...new Set(invoiceRows.map((row) => String(row.status)))].map((status) => ({ label: status, value: invoiceRows.filter((row) => String(row.status) === status).length, href: statusHref("/finance/invoices", "status", status) })),
    stockValueByCategory: Object.values(inventory.reduce<Record<string, { label: string; value: number; count: number }>>((out, row) => { const key=String(row.category); out[key] ??={label:key,value:0,count:0}; out[key].value += finite(row.available)*finite(row.unit_cost); out[key].count += 1; return out; }, {})),
    exceptionAging: [
      { label: "0–24 hours", value: activeExceptions.filter((row) => finite(row.age_hours) <= 24).length },
      { label: "1–3 days", value: activeExceptions.filter((row) => finite(row.age_hours) > 24 && finite(row.age_hours) <= 72).length },
      { label: "4–7 days", value: activeExceptions.filter((row) => finite(row.age_hours) > 72 && finite(row.age_hours) <= 168).length },
      { label: "8+ days", value: activeExceptions.filter((row) => finite(row.age_hours) > 168).length },
    ],
  };

  const freshnessValues = [poSummary.freshness, ...inventory.slice(0, 1).map((row) => row.updated_at), ...shipmentRows.slice(0, 1).map((row) => row.updated_at), ...invoiceRows.slice(0, 1).map((row) => row.updated_at), ...exceptionRows.slice(0, 1).map((row) => row.updated_at)];
  const response: AnalyticsResponse = {
    generatedAt: new Date().toISOString(),
    meta: {
      queryMs: Date.now() - started,
      filtersApplied: { ...filters, area },
      dataFreshness: {
        procurement: iso(poSummary.freshness), inventory: iso(inventory[0]?.updated_at), logistics: iso(shipmentRows[0]?.updated_at),
        finance: iso(invoiceRows[0]?.updated_at), exceptions: iso(exceptionRows[0]?.updated_at), latest: iso(freshnessValues.filter(Boolean).sort().at(-1)),
      },
      partialFailures,
    },
    filterOptions: {
      suppliers: supplierOptions, warehouses: warehouseOptions, categories: categoryOptions, owners: ownerOptions, departments: departmentOptions,
    },
    kpis,
    charts,
    tables,
    recommendations: recommendations.slice(0, 10),
    dataQualityWarnings,
    reportTemplates: [
      ["procurement-spend", "Procurement Spend Report", "/analytics/reports/purchase-orders"],
      ["open-pos", "Open PO Report", "/analytics/reports/purchase-orders"],
      ["supplier-performance", "Supplier Performance Report", "/analytics/reports/suppliers"],
      ["inventory-health", "Inventory Health Report", "/analytics/reports/inventory"],
      ["low-stock", "Low Stock Report", "/analytics/reports/low-stock"],
      ["logistics-risk", "Logistics Risk Report", "/analytics/reports/shipments"],
      ["ap-aging", "AP Aging Report", "/analytics/reports/invoices"],
      ["open-exceptions", "Open Exceptions Report", "/operations/exceptions"],
      ["diagnostics", "Diagnostics Report", "/admin/system-diagnostics"],
    ].map(([id, label, href]) => ({ id, label, href })),
  };
  return JSON.parse(JSON.stringify(response)) as AnalyticsResponse;
}

export const analyticsAreas: AnalyticsArea[] = ["overview", "procurement", "inventory", "logistics", "suppliers", "finance", "exceptions", "diagnostics", "reports"];
