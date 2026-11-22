/** Operational observation, deliberately not a financial or immutable historical score. */
export const SUPPLIER_DELIVERY_QUERY_ROOT = "supplier-delivery-scorecard";
export function supplierDeliveryQueryKey(actor: { userId: number; organizationId: number; warehouseId: number | null },
  supplierId: number, filters: { from: string; to: string }, page: number, pageSize: number) {
  return [SUPPLIER_DELIVERY_QUERY_ROOT, actor.organizationId, actor.userId, actor.warehouseId, supplierId, filters, page, pageSize] as const;
}
export type SupplierDeliveryOutcome = "on_time" | "late" | "missing_promise" | "missing_accepted_receipt";
export type SupplierDeliveryScorecard = {
  supplierId: number;
  observedAt: string;
  methodVersion: "accepted-first-receipt-v1";
  basis: string;
  limitation: string;
  filters: { from?: string; to?: string };
  state: "empty" | "insufficient_evidence" | "partial" | "observed";
  total: number;
  measured: number;
  onTime: number;
  late: number;
  missingPromise: number;
  missingReceipt: number;
  onTimePercent: string | null;
  page: number;
  pageSize: number;
  items: Array<{
    purchaseOrderId: number; orderNumber: string; orderDate: string;
    sourceRevision: string; promisedAt: string | null;
    firstAcceptedReceiptAt: string | null; outcome: SupplierDeliveryOutcome;
    receiptId?: number | null;
    receiptSourceRevision?: string | null;
  }>;
};
