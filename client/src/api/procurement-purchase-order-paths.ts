/** Canonical procurement PO API (`/api/procurement/purchase-orders/*`). Legacy `/api/purchase/orders` aliases remain on the server. */
const OP_BASE = "/api/procurement/purchase-orders";
const REC_BASE = "/api/procurement/purchase-orders/records";

export function procurementPoOperationalListUrl(search?: URLSearchParams): string {
  const q = search && search.size > 0 ? `?${search.toString()}` : "";
  return `${OP_BASE}${q}`;
}

export function procurementPoOperationalDetailUrl(po: string): string {
  return `${OP_BASE}/${encodeURIComponent(po)}`;
}

export function procurementPoSignedPdfUrl(po: string): string {
  return `${OP_BASE}/${encodeURIComponent(po)}/signed-pdf`;
}

export function procurementPoStatusUrl(po: string): string {
  return `${OP_BASE}/${encodeURIComponent(po)}/status`;
}

export function procurementPoApproveUrl(po: string): string {
  return `${OP_BASE}/${encodeURIComponent(po)}/approve`;
}

export function procurementPoSendUrl(po: string): string {
  return `${OP_BASE}/${encodeURIComponent(po)}/send`;
}

export function procurementPoReceiveUrl(po: string): string {
  return `${OP_BASE}/${encodeURIComponent(po)}/receive`;
}

export function procurementPoRecordUrl(id: number): string {
  return `${REC_BASE}/${id}`;
}

export function procurementPoCommercialUrl(id: number): string {
  return `${REC_BASE}/${id}/commercial`;
}

export function procurementPoRevisionsUrl(id: number): string {
  return `${REC_BASE}/${id}/revisions`;
}

export function procurementPoRecordItemsUrl(orderId: number): string {
  return `${REC_BASE}/${orderId}/items`;
}

/** List + record base path (`GET` list, `GET/PATCH …/:id`, etc.) */
export const PROCUREMENT_PURCHASE_ORDER_RECORDS_PATH = REC_BASE;
