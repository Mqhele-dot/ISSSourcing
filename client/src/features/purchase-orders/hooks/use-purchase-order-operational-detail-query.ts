import { useQuery } from "@tanstack/react-query";
import { fetchPurchaseOrder } from "../api/purchase-orders.api";
import type { PurchaseOrderDetail } from "../api/purchase-orders.api";

export function usePurchaseOrderOperationalDetailQuery(po: string) {
  return useQuery<PurchaseOrderDetail>({
    queryKey: ["purchase-order-operational-detail", po],
    queryFn: () => fetchPurchaseOrder(po),
    staleTime: 15_000,
    retry: 1,
    enabled: Boolean(po && po.trim()),
  });
}
