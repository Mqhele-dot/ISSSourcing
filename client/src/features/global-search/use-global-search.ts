import { useQuery } from "@tanstack/react-query";
import type { UniversalSearchResult } from "@shared/schema";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { requestJson } from "@/lib/queryClient";

export type GlobalSearchResult = UniversalSearchResult;

export function getGlobalSearchTypeLabel(type: GlobalSearchResult["type"]): string {
  switch (type) {
    case "inventory":
      return "Inventory";
    case "supplier":
      return "Supplier";
    case "purchase-order":
      return "Purchase order";
    case "requisition":
      return "Requisition";
    case "rfq":
      return "Sourcing";
    case "shipment":
      return "Shipment";
    case "exception":
      return "Exception";
    default:
      return "Record";
  }
}

export function useGlobalSearch(
  rawQuery: string,
  options?: {
    enabled?: boolean;
    limit?: number;
  },
) {
  const query = useDebouncedValue(rawQuery.trim(), 180);
  const limit = options?.limit ?? 5;
  const enabled = (options?.enabled ?? true) && query.length >= 2;

  const searchQuery = useQuery({
    queryKey: ["/api/v2/search", query, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
      });
      return requestJson<GlobalSearchResult[]>("GET", `/api/v2/search?${params.toString()}`);
    },
    enabled,
    staleTime: 30_000,
  });

  return {
    ...searchQuery,
    query,
    isActive: enabled,
  };
}
