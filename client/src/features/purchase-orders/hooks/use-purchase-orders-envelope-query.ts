import { useQuery } from "@tanstack/react-query";
import { fetchPurchaseOrdersEnvelope } from "../api/purchase-orders.api";
import type { PurchaseOrderListItem } from "@/api/types";
import type { ApiEnvelopeResult } from "@/api/client";
import { normalizeEnvelopeFilters, purchaseOrdersEnvelopeQueryKey } from "../lib/query-keys";

export type PurchaseOrdersListFilters = {
  status: string;
  supplier: string;
  q: string;
};

export function usePurchaseOrdersEnvelopeQuery(filters: PurchaseOrdersListFilters) {
  const normalized = normalizeEnvelopeFilters(filters);

  return useQuery<ApiEnvelopeResult<PurchaseOrderListItem[]>>({
    queryKey: purchaseOrdersEnvelopeQueryKey(normalized),
    queryFn: ({ signal }) =>
      fetchPurchaseOrdersEnvelope(
        {
          status: normalized.status || undefined,
          supplier: normalized.supplier || undefined,
          q: normalized.q || undefined,
        },
        { signal },
      ),
    staleTime: 15_000,
    retry: 1,
  });
}
