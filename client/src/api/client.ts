import {
  apiRequest,
} from "@/lib/queryClient";
import { toastStore } from "@/lib/toast-store";
import type {
  ActivityRecord,
  ApiErrorPayload,
  ApiResponse,
  ControlTowerOverview,
  DeepHealthCheck,
  DemoDataSummary,
  DemoWalkthroughResult,
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
  ActivityRecord,
  ActivityItem,
  ApiErrorPayload,
  ControlTowerOverview,
  DemoWalkthroughResult,
  ExceptionCase,
  InventoryDetail,
  InventoryItem,
  IntegrationRun,
  InventoryListItem,
  OperationalException,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  PurchaseReceiveResult,
  Shipment,
  ShipmentDetail,
  ShipmentListItem,
} from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(payload: ApiErrorPayload, status = 400) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.hint = payload.hint;
    this.details = payload.details;
    this.status = status;
  }
}

function isApiEnvelope<T>(value: unknown): value is ApiResponse<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

async function parseJsonOrNull(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function unwrapEnvelope<T>(response: Response): Promise<T> {
  const payload = await parseJsonOrNull(response);

  if (isApiEnvelope<T>(payload)) {
    if (payload.ok) {
      return payload.data as T;
    }
    toastStore.push({
      type: "error",
      title: payload.error.code || "Request failed",
      message: payload.error.message,
    });
    throw new ApiError(payload.error, response.status || 400);
  }

  if (!response.ok) {
    const fallbackMessage =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof (payload as { message?: unknown }).message === "string"
        ? String((payload as { message: string }).message)
        : `Request failed: ${response.status}`;
    throw new ApiError(
      {
        code: "UNEXPECTED_RESPONSE",
        message: fallbackMessage,
      },
      response.status,
    );
  }

  return payload as T;
}

const API_TIMEOUT_MS = 15000;

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  if (init?.signal) {
    init.signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      credentials: "include",
      ...init,
      signal: controller.signal,
    });
    return unwrapEnvelope<T>(response);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      toastStore.push({
        type: "error",
        title: "Request timeout",
        message: `Request timed out after ${API_TIMEOUT_MS / 1000}s. Check network or try again.`,
      });
      throw new ApiError(
        { code: "REQUEST_TIMEOUT", message: `Request timed out after ${API_TIMEOUT_MS / 1000}s` },
        408,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function apiMutate<T>(method: string, url: string, data?: unknown): Promise<T> {
  const response = await apiRequest(method, url, data);
  return unwrapEnvelope<T>(response);
}

export async function fetchHealth(): Promise<HealthCheck> {
  const response = await fetch("/health", { credentials: "include" });
  if (!response.ok) {
    throw new ApiError({
      code: "HEALTH_REQUEST_FAILED",
      message: `Health request failed: ${response.status}`,
    });
  }
  return (await response.json()) as HealthCheck;
}

export async function fetchDeepHealth(): Promise<DeepHealthCheck> {
  const response = await fetch("/health/deep", { credentials: "include" });
  if (!response.ok) {
    const payload = await parseJsonOrNull(response);
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof (payload as { message?: unknown }).message === "string"
        ? String((payload as { message: string }).message)
        : `Deep health request failed: ${response.status}`;
    throw new ApiError({
      code: "DEEP_HEALTH_REQUEST_FAILED",
      message,
    });
  }
  return (await response.json()) as DeepHealthCheck;
}

export async function resetDemoData(): Promise<DemoDataSummary> {
  return apiMutate<DemoDataSummary>("POST", "/admin/demo/reset");
}

export async function runDemoWalkthrough(): Promise<DemoWalkthroughResult> {
  return apiMutate<DemoWalkthroughResult>("POST", "/api/demo/walkthrough/run");
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
    search.set("low", params.lowStock ? "1" : "0");
  }

  const url = search.size > 0 ? `/api/inventory?${search.toString()}` : "/api/inventory";
  const rawItems = await apiFetch<Array<Record<string, unknown>>>(url);

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
  return apiFetch<PurchaseOrderListItem[]>(url);
}

export async function fetchPurchaseOrder(po: string): Promise<PurchaseOrderDetail> {
  return apiFetch<PurchaseOrderDetail>(`/api/purchase/orders/${encodeURIComponent(po)}`);
}

export async function transitionPurchaseOrderStatus(
  po: string,
  toStatus: string,
): Promise<PurchaseOrderDetail> {
  return apiMutate<PurchaseOrderDetail>(
    "POST",
    `/api/purchase/orders/${encodeURIComponent(po)}/status`,
    { toStatus },
  );
}

export async function approvePurchaseOrder(po: string): Promise<PurchaseOrderDetail> {
  return apiMutate<PurchaseOrderDetail>(
    "POST",
    `/api/purchase/orders/${encodeURIComponent(po)}/approve`,
  );
}

export async function sendPurchaseOrder(po: string): Promise<PurchaseOrderDetail> {
  return apiMutate<PurchaseOrderDetail>(
    "POST",
    `/api/purchase/orders/${encodeURIComponent(po)}/send`,
  );
}

export async function receivePurchaseOrder(
  po: string,
  lines: Array<{ sku: string; qtyReceivedNow: number }>,
): Promise<PurchaseReceiveResult> {
  const result = await apiMutate<PurchaseReceiveResult>(
    "POST",
    `/api/purchase/orders/${encodeURIComponent(po)}/receive`,
    {
      lines: lines.map((line) => ({
        sku: line.sku,
        qty_received_now: line.qtyReceivedNow,
      })),
    },
  );
  const firstChange = result.inventoryChanges[0];
  const mismatchCreated = result.mismatchExceptions.some((entry) => entry.created);
  const baseMessage = firstChange
    ? `Received (partial): ${firstChange.sku} +${firstChange.delta}`
    : `Received (partial): ${result.changed.inventoryChanges} inventory updates`;
  toastStore.push({
    type: mismatchCreated ? "warning" : "success",
    title: "PO receive processed",
    message: mismatchCreated
      ? `${baseMessage}, mismatch exception created`
      : baseMessage,
  });
  return result;
}

export async function fetchShipments(params?: {
  status?: string;
  po?: string;
  carrier?: string;
  risk?: string;
}): Promise<ShipmentListItem[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.po) search.set("po", params.po);
  if (params?.carrier) search.set("carrier", params.carrier);
  if (params?.risk) search.set("risk", params.risk);

  const url =
    search.size > 0 ? `/api/logistics/shipments?${search.toString()}` : "/api/logistics/shipments";
  return apiFetch<ShipmentListItem[]>(url);
}

export async function fetchShipment(id: string | number): Promise<ShipmentDetail> {
  return apiFetch<ShipmentDetail>(`/api/logistics/shipments/${id}`);
}

export async function updateShipmentStatus(input: {
  id: string | number;
  toStatus: string;
  note?: string;
}): Promise<ShipmentDetail> {
  return apiMutate<ShipmentDetail>(`POST`, `/api/logistics/shipments/${input.id}/status`, {
    toStatus: input.toStatus,
    note: input.note,
  });
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
  return apiFetch<OperationalException[]>(url);
}

export async function fetchException(id: string | number): Promise<OperationalException> {
  return apiFetch<OperationalException>(`/api/exceptions/${id}`);
}

export async function updateExceptionStatus(
  id: string | number,
  toStatus: string,
): Promise<OperationalException> {
  return apiMutate<OperationalException>("POST", `/api/exceptions/${id}/status`, { toStatus });
}

export async function assignException(
  id: string | number,
  assignee: string,
): Promise<OperationalException> {
  return apiMutate<OperationalException>("POST", `/api/exceptions/${id}/assign`, { assignee });
}

export async function addExceptionComment(
  id: string | number,
  comment: string,
): Promise<OperationalException> {
  return apiMutate<OperationalException>("POST", `/api/exceptions/${id}/comment`, { comment });
}

export async function fetchIntegrationRuns(): Promise<IntegrationRun[]> {
  return apiFetch<IntegrationRun[]>("/api/integrations/runs");
}

export async function runIntegration(connector: string): Promise<IntegrationRun> {
  return apiMutate<IntegrationRun>(
    "POST",
    `/api/integrations/${encodeURIComponent(connector)}/run`,
  );
}

export async function fetchControlTowerOverview(): Promise<ControlTowerOverview> {
  return apiFetch<ControlTowerOverview>("/api/control-tower/overview");
}

export async function fetchActivity(params?: {
  limit?: number;
  entityType?: string;
  entityId?: string | number;
}): Promise<ActivityRecord[]> {
  const search = new URLSearchParams();
  if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
    search.set("limit", String(params.limit));
  }
  if (params?.entityType) {
    search.set("entity_type", params.entityType);
  }
  if (params?.entityId !== undefined && params?.entityId !== null) {
    search.set("entity_id", String(params.entityId));
  }
  const url = search.size > 0 ? `/api/activity?${search.toString()}` : "/api/activity";
  return apiFetch<ActivityRecord[]>(url);
}
