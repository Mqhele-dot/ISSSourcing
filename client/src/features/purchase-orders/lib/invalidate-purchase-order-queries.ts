import type { QueryClient } from "@tanstack/react-query";
import { PO_ENVELOPE_QUERY_ROOT, normalizeOperationalPoParam, purchaseOrderOperationalDetailQueryKey } from "./query-keys";

export async function invalidatePurchaseOrderOperationalQueries(queryClient: QueryClient, po: string): Promise<void> {
  const poNumber = normalizeOperationalPoParam(po);
  const tasks: Promise<unknown>[] = [queryClient.invalidateQueries({ queryKey: [PO_ENVELOPE_QUERY_ROOT] })];
  if (poNumber) {
    tasks.push(queryClient.invalidateQueries({ queryKey: purchaseOrderOperationalDetailQueryKey(poNumber) }));
  }
  await Promise.all(tasks);
}
