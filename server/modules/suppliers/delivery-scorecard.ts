import type { PoolClient } from "pg";
import { z } from "zod";
import type { SupplierDeliveryScorecard } from "../../../shared/supplier-delivery-scorecard";
import { approvedOrderStates } from "../reports/financial-source-contributions";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return value >= "0001-01-01" && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export const supplierObservationFilters = z.object({ from: day.optional(), to: day.optional() }).strict().refine(value => !value.from || !value.to || value.from <= value.to);
export const supplierObservationPage = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().refine(value => [25, 50, 100].includes(value)).default(25) }).strict();
export const SUPPLIER_OBSERVATION_LIMIT = 10000;
export const supplierDeliveryQuery = z.object({
  from: day.optional(), to: day.optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().refine(value => [25, 50, 100].includes(value)).default(25),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to);

/** Caller owns one read-only repeatable-read observation, with membership/source access checked first. */
export async function readSupplierDeliveryScorecard(client: PoolClient, organizationId: number, supplierId: number,
  filters: z.infer<typeof supplierDeliveryQuery>, capture = false): Promise<SupplierDeliveryScorecard> {
  // Aggregate all eligible sources; only the contribution page is limited. EXISTS prevents receipt-line fanout.
  const result = await client.query(`WITH cohort AS MATERIALIZED (
    SELECT p.id,p.order_number,p.order_date,p.updated_at,p.expected_delivery_date
    FROM purchase_orders p WHERE p.organization_id=$1 AND p.supplier_id=$2
      AND upper(trim(p.approval_status))='APPROVED' AND upper(trim(p.status))=ANY($7::text[])
      AND p.order_date<=transaction_timestamp() AT TIME ZONE 'UTC'
      AND ($3::date IS NULL OR p.order_date>=$3::date)
      AND ($4::date IS NULL OR p.order_date<$4::date+interval '1 day')
  ), accepted AS MATERIALIZED (
    SELECT DISTINCT l.receipt_id FROM ap_receipt_items l
    JOIN ap_receipts r ON r.id=l.receipt_id AND r.organization_id=$1 AND r.supplier_id=$2
    WHERE l.accepted_quantity>0 AND l.accepted_quantity::text NOT IN ('NaN','Infinity','-Infinity')
  ), receipts AS MATERIALIZED (
    SELECT DISTINCT ON(r.purchase_order_id) r.purchase_order_id,r.received_date AS first_receipt,r.id AS receipt_id,r.updated_at AS receipt_revision
    FROM ap_receipts r JOIN accepted l ON l.receipt_id=r.id
    WHERE r.organization_id=$1 AND r.supplier_id=$2 AND upper(r.status::text)='POSTED'
      AND r.received_date<=transaction_timestamp() AT TIME ZONE 'UTC'
    ORDER BY r.purchase_order_id,r.received_date,r.id
  ), evidence AS MATERIALIZED (
    SELECT p.*,r.first_receipt,r.receipt_id,r.receipt_revision,CASE WHEN p.expected_delivery_date IS NULL THEN 'missing_promise'
      WHEN r.first_receipt IS NULL THEN 'missing_accepted_receipt'
      WHEN r.first_receipt<=p.expected_delivery_date THEN 'on_time' ELSE 'late' END AS outcome
    FROM cohort p LEFT JOIN receipts r ON r.purchase_order_id=p.id
  ), summary AS (
    SELECT count(*)::int AS total,count(*) FILTER(WHERE outcome='on_time')::int AS on_time,
      count(*) FILTER(WHERE outcome='late')::int AS late,
      count(*) FILTER(WHERE outcome='missing_promise')::int AS missing_promise,
      count(*) FILTER(WHERE outcome='missing_accepted_receipt')::int AS missing_receipt,
      round(100.0*count(*) FILTER(WHERE outcome='on_time')/
        nullif(count(*) FILTER(WHERE outcome IN ('on_time','late')),0),1)::text AS rate FROM evidence
  ), page AS (SELECT * FROM evidence ORDER BY order_date DESC,id DESC LIMIT $5 OFFSET $6)
  SELECT summary.*,transaction_timestamp() AS observed_at,
    coalesce((SELECT jsonb_agg(jsonb_build_object('purchaseOrderId',id,'orderNumber',order_number,
      'orderDate',to_char(order_date,'YYYY-MM-DD"T"HH24:MI:SS.US')||'Z',
      'sourceRevision',updated_at::text,'promisedAt',CASE WHEN expected_delivery_date IS NOT NULL THEN to_char(expected_delivery_date,'YYYY-MM-DD"T"HH24:MI:SS.US')||'Z' END,
      'firstAcceptedReceiptAt',CASE WHEN first_receipt IS NOT NULL THEN to_char(first_receipt,'YYYY-MM-DD"T"HH24:MI:SS.US')||'Z' END,
      'receiptId',receipt_id,'receiptSourceRevision',receipt_revision::text,
      'outcome',outcome) ORDER BY order_date DESC,id DESC) FROM page),'[]'::jsonb) AS items FROM summary`,
  [organizationId, supplierId, filters.from ?? null, filters.to ?? null, capture ? SUPPLIER_OBSERVATION_LIMIT + 1 : filters.pageSize,
    capture ? 0 : (filters.page - 1) * filters.pageSize, approvedOrderStates]);
  const row = result.rows[0];
  const measured = row.on_time + row.late;
  return {
    supplierId, observedAt: new Date(row.observed_at).toISOString(), methodVersion: "accepted-first-receipt-v1",
    basis: "Approved PO order-date cohort; first posted receipt with accepted quantity against the current promised timestamp. Dates use the source UTC convention.",
    limitation: "Live observation, not a historical snapshot. PO dates and statuses may change. First accepted receipt does not prove complete delivery, quality compliance or bank settlement. Missing evidence is excluded from the rate. Each order has one exclusion reason; a missing promised date takes priority over a missing receipt.",
    filters: { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) },
    state: row.total === 0 ? "empty" : measured === 0 ? "insufficient_evidence" : measured < row.total ? "partial" : "observed",
    total: row.total, measured, onTime: row.on_time, late: row.late,
    missingPromise: row.missing_promise, missingReceipt: row.missing_receipt, onTimePercent: row.rate,
    page: filters.page, pageSize: filters.pageSize, items: row.items,
  };
}
