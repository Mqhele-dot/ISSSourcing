/** Stable React Query key roots for purchase-order domain queries. */
export const PO_ENVELOPE_QUERY_ROOT = "purchase-orders-envelope" as const;
export const PO_OPERATIONAL_DETAIL_QUERY_ROOT = "purchase-order-operational-detail" as const;

export type PurchaseOrdersEnvelopeFilters = {
  status: string;
  supplier: string;
  q: string;
};

/** Normalized filter tuple so whitespace-only keys do not fragment the cache. */
export function normalizeEnvelopeFilters(filters: PurchaseOrdersEnvelopeFilters): PurchaseOrdersEnvelopeFilters {
  return {
    status: String(filters.status ?? "").trim(),
    supplier: String(filters.supplier ?? "").trim(),
    q: String(filters.q ?? "").trim(),
  };
}

export function purchaseOrdersEnvelopeQueryKey(filters: PurchaseOrdersEnvelopeFilters) {
  const f = normalizeEnvelopeFilters(filters);
  return [PO_ENVELOPE_QUERY_ROOT, f.status, f.supplier, f.q] as const;
}

export function normalizeOperationalPoParam(po: string | undefined | null): string {
  return String(po ?? "").trim();
}

export function purchaseOrderOperationalDetailQueryKey(poNumber: string) {
  return [PO_OPERATIONAL_DETAIL_QUERY_ROOT, normalizeOperationalPoParam(poNumber)] as const;
}
