import type { PoolClient } from "pg";
import type { FinancialContribution, FinancialMeasure } from "../../../shared/financial-measures";
import { isApBalanceMeasure } from "../../../shared/financial-measures";
import {readApHistoricalContributions} from "./ap-historical-balances";

export interface FinancialSourceFilters { from?: string; to?: string; supplierId?: number;asOf?:string }

// Shared by summaries and their frozen contribution evidence. Unknown lifecycle states
// are not silently interpreted as approval.
export const approvedOrderStates = ["APPROVED", "SENT", "ACKNOWLEDGED", "PARTIALLY_RECEIVED", "RECEIVED", "COMPLETED", "CLOSED"];
export const approvedInvoiceStates = ["APPROVED", "SENT", "OVERDUE", "PARTIALLY_PAID", "PAID"];
export const approvedOrderScopeSql = "upper(p.approval_status)='APPROVED' AND upper(p.status)=ANY";

/** Both the ordered value and purchase evidence list use PO issue dates (inclusive calendar dates). */
export function orderDateSupplierScopeSql(from: `$${number}`, to: `$${number}`, supplier: `$${number}`) {
  return `(${from}::date IS NULL OR p.order_date >= ${from}::date)
    AND (${to}::date IS NULL OR p.order_date < ${to}::date+interval '1 day')
    AND (${supplier}::int IS NULL OR p.supplier_id=${supplier})`;
}

/** All joins start from an organization-owned source. Legacy REAL values are cast
 * before arithmetic; this preserves their stored precision, not precision lost earlier. */
export async function readFinancialSourceContributions(client: PoolClient, organizationId: number,
  measure: FinancialMeasure, filters: FinancialSourceFilters, orderedSourceIds?: readonly number[]): Promise<FinancialContribution[]> {
  if (orderedSourceIds && (measure !== "ordered" || orderedSourceIds.length > 100)) throw new Error("Unsupported order contribution scope");
  if(isApBalanceMeasure(measure)) {
    if(filters.from||filters.to) throw Object.assign(new Error("AP balances use an as-of date, not a lifecycle date range."),{code:"AP_INVALID_FILTERS",status:400});
    return readApHistoricalContributions(client,organizationId,measure,filters);
  }
  if(filters.asOf) throw Object.assign(new Error("As-of dates apply only to AP balance measures."),{code:"AP_INVALID_FILTERS",status:400});
  let query: string;
  switch (measure) {
    default: throw new Error("Unsupported financial source measure");
    case "ordered":
    case "open_commitment": {
      const open = measure === "open_commitment";
      query = `SELECT '${open ? "purchase_order_line" : "purchase_order"}' AS "sourceType",
        ${open ? "l.id" : "p.id"}::text AS "sourceId", p.updated_at::text AS "sourceRevision",
        p.order_date AS date, ${open ? "(GREATEST(l.quantity::numeric-COALESCE(l.received_quantity,0)::numeric,0)*l.unit_price::numeric)" : "p.total_amount::numeric"}::text AS amount,
        p.currency_code AS "currencyCode"
        FROM purchase_orders p ${open ? "JOIN purchase_order_items l ON l.order_id=p.id" : ""}
        WHERE p.organization_id=$1 AND ${approvedOrderScopeSql}($5::text[])
        ${orderedSourceIds ? "AND p.id=ANY($6::int[])" : ""}
        ${open ? "AND upper(p.status) NOT IN ('CLOSED','COMPLETED','RECEIVED') AND l.quantity>COALESCE(l.received_quantity,0)" : ""}
        AND ${orderDateSupplierScopeSql("$2","$3","$4")}
        ORDER BY p.order_date,${open ? "l.id" : "p.id"}`;
      break;
    }
    case "invoiced":
    case "recorded_payments": {
      const payment = measure === "recorded_payments";
      query = `SELECT '${payment ? "payment" : "invoice"}' AS "sourceType",
        ${payment ? "p.id" : "i.id"}::text AS "sourceId", ${payment ? "p" : "i"}.updated_at::text AS "sourceRevision",
        ${payment ? "p.payment_date" : "i.issue_date"} AS date,
        ${payment ? "p.amount" : "i.total"}::numeric::text AS amount,i.currency_code AS "currencyCode"
        FROM invoices i ${payment ? "JOIN payments p ON p.invoice_id=i.id" : ""}
        WHERE i.organization_id=$1 AND i.supplier_id IS NOT NULL
        AND ${payment ? "$5::text[] IS NOT NULL" : "upper(i.status::text)=ANY($5::text[])"}
        AND ($2::date IS NULL OR ${payment ? "p.payment_date" : "i.issue_date"} >= $2::date)
        AND ($3::date IS NULL OR ${payment ? "p.payment_date" : "i.issue_date"} < $3::date+interval '1 day')
        AND ($4::int IS NULL OR i.supplier_id=$4)
        ORDER BY ${payment ? "p.payment_date,p.id" : "i.issue_date,i.id"}`;
      break;
    }
    case "received":
      // No fallback to today's editable PO price. Missing snapshots are explicit exclusions.
      query = `SELECT x.* FROM (SELECT 'receipt_item' AS "sourceType",l.id::text AS "sourceId",
        l.updated_at::text AS "sourceRevision",r.received_date AS date,
        (e.quantity*e.unit_price)::text AS amount,e.currency_code AS "currencyCode",r.supplier_id,
        CASE WHEN e.id IS NULL THEN 'missing_price_evidence' END AS exclusion
        FROM ap_receipts r JOIN ap_receipt_items l ON l.receipt_id=r.id
        LEFT JOIN receipt_value_evidence e ON e.organization_id=r.organization_id AND e.receipt_item_id=l.id
        WHERE r.organization_id=$1 AND (upper(r.status::text)='POSTED' OR EXISTS
          (SELECT 1 FROM goods_receipt_reversals g WHERE g.organization_id=r.organization_id AND g.receipt_id=r.id)) AND l.accepted_quantity>0
        AND $5::text[] IS NOT NULL
        UNION ALL
        SELECT 'receipt_reversal',g.id::text||':'||l.id::text,g.created_at::text,g.created_at,
        (v.quantity*e.unit_price)::text,e.currency_code,r.supplier_id,
        CASE WHEN e.id IS NULL OR v.id IS NULL THEN 'missing_price_evidence' END
        FROM goods_receipt_reversals g JOIN ap_receipts r ON r.id=g.receipt_id AND r.organization_id=g.organization_id
        JOIN ap_receipt_items l ON l.receipt_id=r.id
        LEFT JOIN receipt_value_evidence e ON e.organization_id=r.organization_id AND e.receipt_item_id=l.id
        LEFT JOIN receipt_value_reversal_evidence v ON v.organization_id=g.organization_id AND v.reversal_id=g.id AND v.original_evidence_id=e.id
        WHERE g.organization_id=$1 AND l.accepted_quantity>0) x
        WHERE ($2::date IS NULL OR date >= $2::date)
        AND ($3::date IS NULL OR date < $3::date+interval '1 day')
        AND ($4::int IS NULL OR supplier_id=$4)
        ORDER BY date,"sourceType","sourceId"`;
      break;
  }
  const result = await client.query(query,[organizationId,filters.from ?? null,filters.to ?? null,
    filters.supplierId ?? null,measure === "ordered" || measure === "open_commitment" ? approvedOrderStates : approvedInvoiceStates,
    ...(orderedSourceIds ? [orderedSourceIds] : [])]);
  return result.rows.map(row => ({...row,date:row.date ? new Date(row.date).toISOString() : null,
    ...(row.exclusion ? {exclusion:row.exclusion} : {exclusion:undefined})}));
}
