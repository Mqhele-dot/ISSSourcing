import { pool } from "../db";

export type ProcurementLineReportDataset = "purchase_orders" | "purchase_requisitions";

export type ProcurementLineReportFilters = {
  supplierId?: number | null;
  status?: string | null;
  projectId?: number | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
};

export type ProcurementLineReportRow = {
  documentId: number;
  documentNumber: string;
  supplierName: string;
  status: string;
  currencyCode: string;
  exchangeRate: number;
  documentDate: Date | null;
  requiredDate: Date | null;
  documentTotal: number;
  lineNumber: number | null;
  lineType: string;
  itemCode: string;
  lineDescription: string;
  quantity: number | null;
  uom: string;
  unitPrice: number | null;
  taxCode: string;
  lineTotal: number | null;
  costCentre: string;
  glAccount: string;
  notes: string;
  receivedQuantity: number | null;
  dataQualityStatus: string;
};

function buildFilterSql(
  alias: "po" | "pr",
  filters: ProcurementLineReportFilters,
  values: unknown[],
): string {
  const clauses: string[] = [];
  if (filters.supplierId) {
    values.push(filters.supplierId);
    clauses.push(`${alias}.supplier_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`LOWER(${alias}.status) = LOWER($${values.length})`);
  }
  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`${alias}.project_id = $${values.length}`);
  }
  if (filters.startDate) {
    values.push(filters.startDate);
    clauses.push(`${alias}.created_at >= $${values.length}`);
  }
  if (filters.endDate) {
    values.push(filters.endDate);
    clauses.push(`${alias}.created_at <= $${values.length}`);
  }
  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
}

export async function getProcurementLineReportRows(input: {
  organizationId: number;
  dataset: ProcurementLineReportDataset;
  filters?: ProcurementLineReportFilters;
  limit?: number;
  offset?: number;
}): Promise<ProcurementLineReportRow[]> {
  const values: unknown[] = [input.organizationId];
  const limit = Math.min(Math.max(Number(input.limit ?? 10_000), 1), 100_000);
  const offset = Math.max(Number(input.offset ?? 0), 0);
  const filters = input.filters ?? {};

  if (input.dataset === "purchase_orders") {
    const where = buildFilterSql("po", filters, values);
    values.push(limit, offset);
    const result = await pool.query<ProcurementLineReportRow>(
      `SELECT
         po.id AS "documentId",
         po.order_number AS "documentNumber",
         COALESCE(s.name, '') AS "supplierName",
         po.status,
         COALESCE(po.currency_code, 'ZAR') AS "currencyCode",
         1::real AS "exchangeRate",
         po.order_date AS "documentDate",
         po.expected_delivery_date AS "requiredDate",
         po.total_amount AS "documentTotal",
         poi.line_number AS "lineNumber",
         COALESCE(poi.line_type, CASE WHEN poi.id IS NULL THEN 'NO_LINES' ELSE 'CATALOG' END) AS "lineType",
         COALESCE(poi.item_code_snapshot, ii.sku, '') AS "itemCode",
         COALESCE(poi.description, poi.item_description_snapshot, ii.name, 'Document has no lines') AS "lineDescription",
         poi.quantity,
         COALESCE(uom.code, uom.symbol, '') AS uom,
         poi.unit_price AS "unitPrice",
         COALESCE(tc.code, '') AS "taxCode",
         poi.total_price AS "lineTotal",
         COALESCE(cc.code, '') AS "costCentre",
         COALESCE(poi.gl_account_code, '') AS "glAccount",
         COALESCE(poi.notes, '') AS notes,
         poi.received_quantity AS "receivedQuantity",
         CASE WHEN poi.id IS NULL THEN 'DOCUMENT_HAS_NO_LINES' ELSE 'OK' END AS "dataQualityStatus"
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.organization_id = po.organization_id
       LEFT JOIN purchase_order_items poi ON poi.order_id = po.id
       LEFT JOIN inventory_items ii ON ii.id = poi.item_id AND ii.organization_id = po.organization_id
       LEFT JOIN units_of_measure uom ON uom.id = poi.unit_of_measure_id
       LEFT JOIN tax_codes tc ON tc.id = poi.tax_code_id
       LEFT JOIN mdm_cost_centres cc ON cc.id = poi.cost_centre_id AND cc.organization_id = po.organization_id
       WHERE po.organization_id = $1${where}
       ORDER BY po.created_at DESC, po.id DESC, poi.line_number NULLS LAST, poi.id
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows;
  }

  const where = buildFilterSql("pr", filters, values);
  values.push(limit, offset);
  const result = await pool.query<ProcurementLineReportRow>(
    `SELECT
       pr.id AS "documentId",
       pr.requisition_number AS "documentNumber",
       COALESCE(s.name, '') AS "supplierName",
       pr.status,
       COALESCE(pr.currency_code, 'ZAR') AS "currencyCode",
       COALESCE(pr.exchange_rate_to_zar, 1) AS "exchangeRate",
       pr.created_at AS "documentDate",
       pr.required_date AS "requiredDate",
       pr.total_amount AS "documentTotal",
       pri.line_number AS "lineNumber",
       COALESCE(pri.line_type, CASE WHEN pri.id IS NULL THEN 'NO_LINES' ELSE 'CATALOG' END) AS "lineType",
       COALESCE(pri.item_code_snapshot, ii.sku, '') AS "itemCode",
       COALESCE(pri.description, pri.item_description_snapshot, ii.name, 'Document has no lines') AS "lineDescription",
       pri.quantity,
       COALESCE(uom.code, uom.symbol, '') AS uom,
       pri.unit_price AS "unitPrice",
       COALESCE(tc.code, '') AS "taxCode",
       pri.total_price AS "lineTotal",
       COALESCE(cc.code, '') AS "costCentre",
       COALESCE(pri.gl_account_code, '') AS "glAccount",
       COALESCE(pri.notes, '') AS notes,
       NULL::integer AS "receivedQuantity",
       CASE WHEN pri.id IS NULL THEN 'DOCUMENT_HAS_NO_LINES' ELSE 'OK' END AS "dataQualityStatus"
     FROM purchase_requisitions pr
     LEFT JOIN suppliers s ON s.id = pr.supplier_id AND s.organization_id = pr.organization_id
     LEFT JOIN purchase_requisition_items pri ON pri.requisition_id = pr.id
     LEFT JOIN inventory_items ii ON ii.id = pri.item_id AND ii.organization_id = pr.organization_id
     LEFT JOIN units_of_measure uom ON uom.id = pri.unit_of_measure_id
     LEFT JOIN tax_codes tc ON tc.id = pri.tax_code_id
     LEFT JOIN mdm_cost_centres cc ON cc.id = pri.cost_centre_id AND cc.organization_id = pr.organization_id
     WHERE pr.organization_id = $1${where}
     ORDER BY pr.created_at DESC, pr.id DESC, pri.line_number NULLS LAST, pri.id
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}
