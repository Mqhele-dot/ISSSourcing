import { apiRequest } from "@/lib/queryClient";
import type {
  ControlTowerOverview,
  DeepHealthCheck,
  DemoDataSummary,
  HealthCheck,
  IntegrationRun,
  InventoryListItem,
  OperationalException,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  PurchaseReceiveResult,
  ShipmentDetail,
  ShipmentListItem,
} from "./types";

export type {
  ControlTowerOverview,
  IntegrationRun,
  InventoryListItem,
  OperationalException,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  ShipmentDetail,
  ShipmentListItem,
} from "./types";

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
  category?: string;
  lowStock?: boolean;
}): Promise<InventoryListItem[]> {
  const search = new URLSearchParams();
  if (params?.location) {
    search.set("location", params.location);
  }
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.category) {
    search.set("category", params.category);
  }
  if (typeof params?.lowStock === "boolean") {
    search.set("low", String(params.lowStock));
  }

  const url = search.size > 0 ? `/api/inventory?${search.toString()}` : "/api/inventory";
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Inventory request failed: ${response.status}`);
  }
  const rawItems = (await response.json()) as Array<Record<string, unknown>>;
  return rawItems.map((item) => {
    const onHand = Number(item.onHand ?? item.quantity ?? 0);
    const allocated = Number(item.allocated ?? 0);
    const lowStockThreshold = Number(item.lowStockThreshold ?? 0);
    return {
      id: typeof item.id === "number" ? item.id : undefined,
      name: String(item.name ?? ""),
      sku: String(item.sku ?? ""),
      categoryId:
        typeof item.categoryId === "number"
          ? item.categoryId
          : typeof item.category_id === "number"
            ? item.category_id
            : null,
      quantity: typeof item.quantity === "number" ? item.quantity : undefined,
      lowStockThreshold,
      onHand,
      allocated,
      available: Number(item.available ?? onHand - allocated),
      location: typeof item.location === "string" ? item.location : null,
      updatedAt:
        typeof item.updatedAt === "string" || item.updatedAt instanceof Date
          ? item.updatedAt
          : typeof item.updated_at === "string" || item.updated_at instanceof Date
            ? item.updated_at
            : null,
    } satisfies InventoryListItem;
  });
}

export async function fetchPurchaseOrders(params?: {
  status?: string;
  supplier?: string;
  q?: string;
}): Promise<PurchaseOrderListItem[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.supplier) search.set("supplier", params.supplier);
  if (params?.q) search.set("q", params.q);

  const url =
    search.size > 0 ? `/api/purchase/orders?${search.toString()}` : "/api/purchase/orders";
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Purchase orders request failed: ${response.status}`);
  }
  return parseJson<PurchaseOrderListItem[]>(response);
}

export async function fetchPurchaseOrder(po: string): Promise<PurchaseOrderDetail> {
  const response = await fetch(`/api/purchase/orders/${encodeURIComponent(po)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Purchase order detail request failed: ${response.status}`);
  }
  return parseJson<PurchaseOrderDetail>(response);
}

export async function transitionPurchaseOrderStatus(
  po: string,
  toStatus: string,
): Promise<PurchaseOrderDetail> {
  const response = await apiRequest("POST", `/api/purchase/orders/${encodeURIComponent(po)}/status`, {
    toStatus,
  });
  return parseJson<PurchaseOrderDetail>(response);
}

export async function approvePurchaseOrder(po: string): Promise<PurchaseOrderDetail> {
  const response = await apiRequest("POST", `/api/purchase/orders/${encodeURIComponent(po)}/approve`);
  return parseJson<PurchaseOrderDetail>(response);
}

export async function sendPurchaseOrder(po: string): Promise<PurchaseOrderDetail> {
  const response = await apiRequest("POST", `/api/purchase/orders/${encodeURIComponent(po)}/send`);
  return parseJson<PurchaseOrderDetail>(response);
}

export async function receivePurchaseOrder(
  po: string,
  lines: Array<{ sku: string; qtyReceivedNow: number }>,
): Promise<PurchaseReceiveResult> {
  const response = await apiRequest("POST", `/api/purchase/orders/${encodeURIComponent(po)}/receive`, {
    lines: lines.map((line) => ({
      sku: line.sku,
      qty_received_now: line.qtyReceivedNow,
    })),
  });
  return parseJson<PurchaseReceiveResult>(response);
}

export async function fetchShipments(params?: {
  status?: string;
  po?: string;
  carrier?: string;
}): Promise<ShipmentListItem[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.po) search.set("po", params.po);
  if (params?.carrier) search.set("carrier", params.carrier);
  const url =
    search.size > 0 ? `/api/logistics/shipments?${search.toString()}` : "/api/logistics/shipments";
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Shipments request failed: ${response.status}`);
  }
  return parseJson<ShipmentListItem[]>(response);
}

export async function fetchShipment(id: string | number): Promise<ShipmentDetail> {
  const response = await fetch(`/api/logistics/shipments/${id}`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Shipment detail request failed: ${response.status}`);
  }
  return parseJson<ShipmentDetail>(response);
}

export async function updateShipmentStatus(input: {
  id: string | number;
  toStatus: string;
  note?: string;
}): Promise<ShipmentDetail> {
  const response = await apiRequest("POST", `/api/logistics/shipments/${input.id}/status`, {
    toStatus: input.toStatus,
    note: input.note,
  });
  return parseJson<ShipmentDetail>(response);
}

export async function fetchExceptions(params?: {
  severity?: string;
  status?: string;
  type?: string;
}): Promise<OperationalException[]> {
  const search = new URLSearchParams();
  if (params?.severity) search.set("severity", params.severity);
  if (params?.status) search.set("status", params.status);
  if (params?.type) search.set("type", params.type);
  const url = search.size > 0 ? `/api/exceptions?${search.toString()}` : "/api/exceptions";
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Exceptions request failed: ${response.status}`);
  }
  return parseJson<OperationalException[]>(response);
}

export async function fetchException(id: string | number): Promise<OperationalException> {
  const response = await fetch(`/api/exceptions/${id}`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Exception detail request failed: ${response.status}`);
  }
  return parseJson<OperationalException>(response);
}

export async function updateExceptionStatus(
  id: string | number,
  toStatus: string,
): Promise<OperationalException> {
  const response = await apiRequest("POST", `/api/exceptions/${id}/status`, { toStatus });
  return parseJson<OperationalException>(response);
}

export async function assignException(
  id: string | number,
  assignee: string,
): Promise<OperationalException> {
  const response = await apiRequest("POST", `/api/exceptions/${id}/assign`, { assignee });
  return parseJson<OperationalException>(response);
}

export async function addExceptionComment(
  id: string | number,
  comment: string,
): Promise<OperationalException> {
  const response = await apiRequest("POST", `/api/exceptions/${id}/comment`, { comment });
  return parseJson<OperationalException>(response);
}

export async function fetchIntegrationRuns(): Promise<IntegrationRun[]> {
  const response = await fetch("/api/integrations/runs", { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Integration runs request failed: ${response.status}`);
  }
  return parseJson<IntegrationRun[]>(response);
}

export async function runIntegration(connector: string): Promise<IntegrationRun> {
  const response = await apiRequest("POST", `/api/integrations/${encodeURIComponent(connector)}/run`);
  return parseJson<IntegrationRun>(response);
}

export async function fetchControlTowerOverview(): Promise<ControlTowerOverview> {
  const response = await fetch("/api/control-tower/overview", { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Control tower request failed: ${response.status}`);
  }
  return parseJson<ControlTowerOverview>(response);
}
