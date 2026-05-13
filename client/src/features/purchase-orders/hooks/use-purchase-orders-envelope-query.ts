import { useQuery } from "@tanstack/react-query";
import { fetchPurchaseOrdersEnvelope } from "../api/purchase-orders.api";
import type { PurchaseOrderListItem } from "../api/purchase-orders.api";
import type { ApiEnvelopeResult } from "@/api/client";

export type PurchaseOrdersListFilters = {
  status: string;
  supplier: string;
  q: string;
};

export function usePurchaseOrdersEnvelopeQuery(filters: PurchaseOrdersListFilters) {
  const status = String(filters.status || "").trim();
  const supplier = String(filters.supplier || "").trim();
  const q = String(filters.q || "").trim();

  return useQuery<ApiEnvelopeResult<PurchaseOrderListItem[]>>({
    queryKey: ["purchase-orders-envelope", status, supplier, q],
    queryFn: () =>
      fetchPurchaseOrdersEnvelope({
        status: status || undefined,
        supplier: supplier || undefined,
        q: q || undefined,
      }),
    staleTime: 10_000,
    retry: 1,
  });
}
