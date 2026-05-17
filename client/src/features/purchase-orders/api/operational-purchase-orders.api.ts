import type { ApiEnvelopeResult } from "@/api/client";
import type { PurchaseOrderDetail, PurchaseOrderListItem, PurchaseReceiveResult } from "@/api/types";
import { toastStore } from "@/lib/toast-store";
import { invTrackFetch, fetchAuthenticatedBlob } from "@/lib/queryClient";
import {
  procurementPoApproveUrl,
  procurementPoOperationalDetailUrl,
  procurementPoOperationalListUrl,
  procurementPoReceiveUrl,
  procurementPoSendUrl,
  procurementPoSignedPdfUrl,
  procurementPoStatusUrl,
} from "@/api/procurement-purchase-order-paths";
import { normalizePurchaseOrderDetail } from "../lib/normalize-operational-detail";
import { normalizePurchaseReceiveResult } from "../lib/normalize-purchase-receive-result";
import {
  assertNonEmptyReceiveLines,
  assertPoNumberForMutation,
  assertTransitionTargetStatus,
} from "../lib/po-mutation-guards";
import { normalizeOperationalPoParam } from "../lib/query-keys";
import type { PoHttpOptions } from "./http-options";

export type { PoHttpOptions } from "./http-options";

export async function fetchPurchaseOrdersEnvelope(
  params?: {
    status?: string;
    supplier?: string;
    q?: string;
  },
  options?: PoHttpOptions,
): Promise<ApiEnvelopeResult<PurchaseOrderListItem[]>> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.supplier) search.set("supplier", params.supplier);
  if (params?.q) search.set("q", params.q);
  const url = procurementPoOperationalListUrl(search);
  const { data, meta } = await invTrackFetch<PurchaseOrderListItem[]>("GET", url, undefined, options);
  return { data, meta };
}

export async function fetchPurchaseOrders(
  params?: {
    status?: string;
    supplier?: string;
    q?: string;
  },
  options?: PoHttpOptions,
): Promise<PurchaseOrderListItem[]> {
  const { data } = await fetchPurchaseOrdersEnvelope(params, options);
  return data;
}

export async function fetchPurchaseOrder(po: string, options?: PoHttpOptions): Promise<PurchaseOrderDetail> {
  const poNumber = normalizeOperationalPoParam(po);
  assertPoNumberForMutation(poNumber);
  const { data: raw } = await invTrackFetch<unknown>(
    "GET",
    procurementPoOperationalDetailUrl(poNumber),
    undefined,
    options,
  );
  return normalizePurchaseOrderDetail(raw);
}

export async function transitionPurchaseOrderStatus(
  po: string,
  toStatus: string,
  options?: PoHttpOptions,
): Promise<PurchaseOrderDetail> {
  const poNumber = normalizeOperationalPoParam(po);
  assertPoNumberForMutation(poNumber);
  assertTransitionTargetStatus(toStatus);
  const { data: raw } = await invTrackFetch<unknown>(
    "POST",
    procurementPoStatusUrl(poNumber),
    { toStatus },
    options,
  );
  return normalizePurchaseOrderDetail(raw);
}

export async function approvePurchaseOrder(po: string, options?: PoHttpOptions): Promise<PurchaseOrderDetail> {
  const poNumber = normalizeOperationalPoParam(po);
  assertPoNumberForMutation(poNumber);
  const { data: raw } = await invTrackFetch<unknown>(
    "POST",
    procurementPoApproveUrl(poNumber),
    {},
    options,
  );
  return normalizePurchaseOrderDetail(raw);
}

export async function sendPurchaseOrder(po: string, options?: PoHttpOptions): Promise<PurchaseOrderDetail> {
  const poNumber = normalizeOperationalPoParam(po);
  assertPoNumberForMutation(poNumber);
  const { data: raw } = await invTrackFetch<unknown>("POST", procurementPoSendUrl(poNumber), {}, options);
  return normalizePurchaseOrderDetail(raw);
}

export async function receivePurchaseOrder(
  po: string,
  lines: Array<{
    sku: string;
    qtyReceivedNow: number;
    batchNumber?: string;
    serialNumbers?: string[];
  }>,
  receiveOptions?: {
    receiverUserId?: number;
    receiverName?: string;
    warehouseLocation?: string;
    warehouseId?: number;
    aisle?: string;
    binCode?: string;
    receivedAt?: string;
  },
  httpOptions?: PoHttpOptions,
): Promise<PurchaseReceiveResult> {
  const poNumber = normalizeOperationalPoParam(po);
  assertPoNumberForMutation(poNumber);
  assertNonEmptyReceiveLines(lines);
  const { data: result } = await invTrackFetch<unknown>(
    "POST",
    procurementPoReceiveUrl(poNumber),
    {
      lines: lines.map((line) => ({
        sku: line.sku,
        qty_received_now: line.qtyReceivedNow,
        batch_number: line.batchNumber,
        serial_numbers: line.serialNumbers,
      })),
      receiver_user_id: receiveOptions?.receiverUserId,
      receiver_name: receiveOptions?.receiverName,
      warehouse_location: receiveOptions?.warehouseLocation,
      warehouse_id: receiveOptions?.warehouseId,
      aisle: receiveOptions?.aisle,
      bin_code: receiveOptions?.binCode,
      received_at: receiveOptions?.receivedAt,
    },
    httpOptions,
  );

  const normalized = normalizePurchaseReceiveResult(result);
  const firstChange = normalized.inventoryChanges[0];
  const mismatchCreated = normalized.mismatchExceptions.some((entry) => entry.created);
  const baseMessage = firstChange
    ? `Received (partial): ${firstChange.sku} +${firstChange.delta}`
    : `Received (partial): ${normalized.changed.inventoryChanges} inventory updates`;
  toastStore.push({
    type: mismatchCreated ? "warning" : "success",
    title: "PO receive processed",
    message: mismatchCreated ? `${baseMessage}, mismatch exception created` : baseMessage,
  });
  return normalized;
}

export async function downloadPurchaseOrderSignedPdf(po: string, options?: PoHttpOptions): Promise<Blob> {
  const poNumber = normalizeOperationalPoParam(po);
  assertPoNumberForMutation(poNumber);
  return fetchAuthenticatedBlob(procurementPoSignedPdfUrl(poNumber), options);
}
