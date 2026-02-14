import { apiRequest } from "@/lib/queryClient";
import type { DeepHealthCheck, DemoDataSummary, HealthCheck, InventoryListItem } from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function fetchHealth(): Promise<HealthCheck> {
  const response = await fetch("/health", { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Health request failed: ${response.status}`);
  }
  return parseJson<HealthCheck>(response);
}

export async function fetchDeepHealth(): Promise<DeepHealthCheck> {
  const response = await fetch("/health/deep", { credentials: "include" });
  if (!response.ok) {
    const payload = await response
      .json()
      .catch(() => ({ message: `Deep health request failed: ${response.status}` }));
    throw new Error(payload.message || `Deep health request failed: ${response.status}`);
  }
  return parseJson<DeepHealthCheck>(response);
}

export async function resetDemoData(): Promise<DemoDataSummary> {
  const response = await apiRequest("POST", "/admin/demo/reset");
  return parseJson<DemoDataSummary>(response);
}

export async function fetchInventory(params?: {
  location?: string;
  q?: string;
  lowStock?: boolean;
}): Promise<InventoryListItem[]> {
  const search = new URLSearchParams();
  if (params?.location) {
    search.set("location", params.location);
  }
  if (params?.q) {
    search.set("q", params.q);
  }
  if (typeof params?.lowStock === "boolean") {
    search.set("lowStock", String(params.lowStock));
  }

  const url = search.size > 0 ? `/api/inventory?${search.toString()}` : "/api/inventory";
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Inventory request failed: ${response.status}`);
  }
  return parseJson<InventoryListItem[]>(response);
}
