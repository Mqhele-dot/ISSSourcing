/**
 * Shared purchase order lifecycle normalization and permission checks.
 * Operational PO transitions align with `transitionOperationalPurchaseOrderStatus` and receive flows
 * in `server/modules/operations/operations-core.ts`.
 */

export type PurchaseOrderNorm =
  | "draft"
  | "open"
  | "approved"
  | "sent"
  | "partially_received"
  | "received"
  | "closed"
  | "cancelled";

/** Allowed single-step transitions for operational PO workflow (normalized statuses). */
export const OPERATIONAL_PO_TRANSITIONS: Record<PurchaseOrderNorm, PurchaseOrderNorm[]> = {
  draft: ["open", "approved"],
  open: ["approved"],
  approved: ["sent"],
  sent: ["partially_received", "received"],
  partially_received: ["received"],
  received: ["closed"],
  closed: [],
  cancelled: [],
};

export function normalizePurchaseOrderStatus(raw: string | null | undefined): PurchaseOrderNorm {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (normalized === "acknowledged") return "sent";

  if (normalized === "partial_received" || normalized === "partially_received") return "partially_received";

  if (normalized === "completed") return "received";

  if (normalized === "cancelled" || normalized === "void") return "cancelled";

  if (normalized === "closed") return "closed";

  const alias: Partial<Record<string, PurchaseOrderNorm>> = {
    pending: "open",
    pending_approval: "open",
    submitted: "open",
    pending_release: "open",
    issued: "sent",
  };
  if (alias[normalized]) return alias[normalized]!;

  const direct: PurchaseOrderNorm[] = [
    "draft",
    "open",
    "approved",
    "sent",
    "partially_received",
    "received",
    "closed",
    "cancelled",
  ];
  if ((direct as string[]).includes(normalized)) return normalized as PurchaseOrderNorm;

  return "draft";
}

export function purchaseOrderStatusLabel(status: string): string {
  const n = normalizePurchaseOrderStatus(status);
  return n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function canApprovePurchaseOrder(status: string, opts?: { role?: string }): boolean {
  const s = normalizePurchaseOrderStatus(status);
  if (s !== "open" && s !== "draft") return false;
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
  if (s === "cancelled" || s === "closed") return false;
  return s === "draft" || s === "open" || s === "approved";
}

export function canReceivePurchaseOrder(status: string): boolean {
  const s = normalizePurchaseOrderStatus(status);
  return s === "approved" || s === "sent" || s === "partially_received";
}

export function canTransitionPurchaseOrderStatus(from: string, to: string): boolean {
  const a = normalizePurchaseOrderStatus(from);
  const b = normalizePurchaseOrderStatus(to);
  return (OPERATIONAL_PO_TRANSITIONS[a] ?? []).includes(b);
}
