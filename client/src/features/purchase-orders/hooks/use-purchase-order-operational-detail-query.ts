import { useQuery } from "@tanstack/react-query";
import { fetchPurchaseOrder } from "../api/purchase-orders.api";
import type { PurchaseOrderDetail } from "@/api/types";
import { normalizeOperationalPoParam, purchaseOrderOperationalDetailQueryKey } from "../lib/query-keys";

export function usePurchaseOrderOperationalDetailQuery(po: string) {
  const poNumber = normalizeOperationalPoParam(po);
  return useQuery<PurchaseOrderDetail>({
    queryKey: purchaseOrderOperationalDetailQueryKey(poNumber),
    queryFn: ({ signal }) => fetchPurchaseOrder(poNumber, { signal }),
    staleTime: 15_000,
    retry: 1,
    enabled: poNumber.length > 0,
  });
}
