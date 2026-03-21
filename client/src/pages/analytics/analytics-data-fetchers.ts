import { requestJson } from "@/lib/queryClient";

/** Normalize API response to array (handles envelope or raw array); never throw */
export async function fetchInventoryArray(): Promise<unknown[]> {
  try {
    const raw = await requestJson<unknown>("GET", "/api/inventory");
    if (Array.isArray(raw)) return raw;
    const data = (raw as { data?: unknown[] })?.data;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Fetch inventory stats for analytics; never throw */
export async function fetchStatsSafe(): Promise<{
  totalItems?: number;
  lowStockItems?: number;
  outOfStockItems?: number;
  inventoryValue?: number;
}> {
  try {
    const raw = await requestJson<unknown>("GET", "/api/inventory/stats");
    const unwrapped = (raw as { data?: unknown })?.data ?? raw;
    if (typeof unwrapped === "object" && unwrapped !== null) {
      return unwrapped as {
        totalItems?: number;
        lowStockItems?: number;
        outOfStockItems?: number;
        inventoryValue?: number;
      };
    }
    return {};
  } catch {
    return {};
  }
}
