/**
 * Shared purchase order lifecycle normalization and permission checks.
 * Operational PO status transitions (approve/send) match `transitionOperationalPurchaseOrderStatus`
 * in server/modules/operations/operations-core.ts.
 */

export type PurchaseOrderNorm = "draft" | "open" | "approved" | "sent" | "received" | "cancelled";

/** Exact transitions the operations API applies today (see transitionOperationalPurchaseOrderStatus). */
export const OPERATIONAL_PO_TRANSITIONS: Record<PurchaseOrderNorm, PurchaseOrderNorm[]> = {
  draft: ["open"],
  open: ["approved"],
  approved: ["sent"],
  sent: ["received"],
  received: [],
  cancelled: [],
};

export function normalizePurchaseOrderStatus(raw: string | null | undefined): PurchaseOrderNorm {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (normalized === "acknowledged") return "sent";
  if (normalized === "partially_received" || normalized === "partial_received") return "sent";
  if (normalized === "completed") return "received";

  if (normalized === "cancelled" || normalized === "void") return "cancelled";

  if (normalized === "closed") return "received";

  const alias: Record<string, PurchaseOrderNorm> = {
    pending: "open",
    pending_approval: "open",
    submitted: "open",
    pending_release: "open",
    issued: "sent",
  };
  if (alias[normalized]) return alias[normalized];

  if (
    normalized === "draft" ||
    normalized === "open" ||
    normalized === "approved" ||
    normalized === "sent" ||
    normalized === "received" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }

  return "draft";
}

export function purchaseOrderStatusLabel(status: string): string {
  const n = normalizePurchaseOrderStatus(status);
  return n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function canApprovePurchaseOrder(status: string, opts?: { role?: string }): boolean {
  if (normalizePurchaseOrderStatus(status) !== "open") return false;
  if (!opts?.role) return true;
  const r = opts.role.toLowerCase();
  return ["manager", "planner", "admin"].includes(r);
}

export function canSendPurchaseOrder(status: string, opts?: { role?: string }): boolean {
  if (normalizePurchaseOrderStatus(status) !== "approved") return false;
  if (!opts?.role) return true;
  const r = opts.role.toLowerCase();
  return ["manager", "planner", "admin"].includes(r);
}

export function canUpdatePurchaseOrder(status: string): boolean {
  const s = normalizePurchaseOrderStatus(status);
  if (s === "cancelled") return false;
  return s === "draft" || s === "open" || s === "approved";
}

export function canReceivePurchaseOrder(status: string): boolean {
  const s = normalizePurchaseOrderStatus(status);
  return s === "approved" || s === "sent";
}

export function canTransitionPurchaseOrderStatus(from: string, to: string): boolean {
  const a = normalizePurchaseOrderStatus(from);
  const b = normalizePurchaseOrderStatus(to);
  return (OPERATIONAL_PO_TRANSITIONS[a] ?? []).includes(b);
}
