/**
 * Domain-facing re-exports for purchase-order API calls.
 * Keep transport in `@/api/client`; feature code imports from here for a stable seam.
 */
export {
  fetchPurchaseOrders,
  fetchPurchaseOrdersEnvelope,
  fetchPurchaseOrder,
  downloadPurchaseOrderSignedPdf,
  approvePurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  transitionPurchaseOrderStatus,
  type PurchaseOrderDetail,
  type PurchaseOrderListItem,
  type ApiEnvelopeResult,
} from "@/api/client";
