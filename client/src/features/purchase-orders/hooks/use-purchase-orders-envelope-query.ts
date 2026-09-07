import { useQuery } from "@tanstack/react-query";
import { fetchPurchaseOrdersPageEnvelope } from "../api/purchase-orders.api";
import type { PurchaseOrderListItem } from "@/api/types";
import type { ApiEnvelopeResult } from "@/api/client";
import { normalizeEnvelopeFilters, purchaseOrdersEnvelopeQueryKey } from "../lib/query-keys";

export type PurchaseOrdersListFilters = {
  status: string;
  supplier: string;
  q: string;
  page: number;
  pageSize: number;
};

export function usePurchaseOrdersEnvelopeQuery(filters: PurchaseOrdersListFilters) {
  const normalized = normalizeEnvelopeFilters(filters);

  return useQuery<ApiEnvelopeResult<{ items: PurchaseOrderListItem[]; total: number; page: number; pageSize: number; hasNext: boolean; summary?: { totalAmount: number; byStatus: Record<string, number> } }>>({
    queryKey: purchaseOrdersEnvelopeQueryKey({ ...normalized, page: filters.page, pageSize: filters.pageSize }),
    queryFn: ({ signal }) =>
      fetchPurchaseOrdersPageEnvelope(
        {
          status: normalized.status || undefined,
          supplier: normalized.supplier || undefined,
          q: normalized.q || undefined,
          page: filters.page,
          pageSize: filters.pageSize,
        },
        { signal },
      ),
    staleTime: 15_000,
    retry: 1,
  });
}
