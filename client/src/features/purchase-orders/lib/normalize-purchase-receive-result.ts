import type { PurchaseOrderDetail, PurchaseReceiveResult } from "@/api/types";
import { normalizePurchaseOrderDetail } from "./normalize-operational-detail";

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function pickNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Safe runtime shape for receive API responses so toast/UI never throws on partial payloads. */
export function normalizePurchaseReceiveResult(raw: unknown): PurchaseReceiveResult {
  const r = asRecord(raw);
  const invRaw = r.inventoryChanges ?? r.inventory_changes;
  const inventoryChanges = Array.isArray(invRaw)
    ? invRaw.map((entry) => {
        const e = asRecord(entry);
        return {
          sku: String(e.sku ?? ""),
          location: String(e.location ?? ""),
          delta: pickNum(e.delta, 0),
          available: pickNum(e.available, 0),
          onHand: pickNum(e.onHand ?? e.on_hand, 0),
        };
      })
    : [];

  const shipRaw = r.shipmentUpdates ?? r.shipment_updates;
  const shipmentUpdates = Array.isArray(shipRaw)
    ? shipRaw.map((entry) => {
        const e = asRecord(entry);
        return {
          shipmentId: pickNum(e.shipmentId ?? e.shipment_id, 0),
          toStatus: String(e.toStatus ?? e.to_status ?? ""),
        };
      })
    : [];

  const mismatchRaw = r.mismatchExceptions ?? r.mismatch_exceptions;
  const mismatchExceptions = Array.isArray(mismatchRaw)
    ? mismatchRaw.map((entry) => {
        const e = asRecord(entry);
        return {
          id: pickNum(e.id, 0),
          sku: String(e.sku ?? ""),
          created: Boolean(e.created),
        };
      })
    : [];

  const ch = asRecord(r.changed);
  const changed = {
    inventoryChanges: pickNum(ch.inventoryChanges ?? ch.inventory_changes, 0),
    shipmentUpdates: pickNum(ch.shipmentUpdates ?? ch.shipment_updates, 0),
    mismatchExceptions: pickNum(ch.mismatchExceptions ?? ch.mismatch_exceptions, 0),
  };

  const orderRaw = r.order;
  const order: PurchaseOrderDetail =
    orderRaw !== undefined && orderRaw !== null
      ? normalizePurchaseOrderDetail(orderRaw)
      : normalizePurchaseOrderDetail(r);

  return {
    order,
    inventoryChanges,
    shipmentUpdates,
    mismatchExceptions,
    changed,
  };
}
