/**
 * Purchase-order feature API: operational routes + commercial record fetches.
 * Shared HTTP transport patterns live in `@/lib/queryClient` (`invTrackFetch`); this module owns PO URLs and normalization.
 */
export type { ApiEnvelopeResult } from "@/api/client";
export type { PurchaseOrderDetail, PurchaseOrderListItem, PurchaseReceiveResult } from "@/api/types";

export type { PoHttpOptions } from "./http-options";
export type { PurchaseOrderSendBody } from "./operational-purchase-orders.api";
export {
  fetchPurchaseOrders,
  fetchPurchaseOrdersEnvelope,
  fetchPurchaseOrdersPageEnvelope,
  fetchPurchaseOrder,
  downloadPurchaseOrderSignedPdf,
  submitPurchaseOrderForApproval,
  approvePurchaseOrderRecord,
  dispatchPurchaseOrderRecord,
  approvePurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  transitionPurchaseOrderStatus,
} from "./operational-purchase-orders.api";

export { fetchPurchaseOrderRecordById, type PurchaseOrderRecordSummary } from "./purchase-order-records.api";
