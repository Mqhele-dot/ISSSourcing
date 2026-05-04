/**
 * Pure money and supply-chain calculations for tests and UI.
 * Use integer cents for aggregations to avoid float drift.
 */

export function toMoneyCents(amount: number | null | undefined): bigint {
  if (amount == null || Number.isNaN(Number(amount))) {
    return 0n;
  }
  return BigInt(Math.round(Number(amount) * 100));
}

export function fromMoneyCents(cents: bigint): number {
  return Number(cents) / 100;
}

export function sumMoneyCents(amounts: Array<number | null | undefined>): bigint {
  return amounts.reduce((acc, a) => acc + toMoneyCents(a), 0n);
}

export function calculateAvailable(onHand: number, allocated: number): number {
  return onHand - allocated;
}

export type InventoryAvailabilityStatus = "error" | "low" | "active";

export function getInventoryAvailabilityStatus(
  available: number,
  lowStockThreshold: number,
): InventoryAvailabilityStatus {
  if (available < 0) return "error";
  if (available <= lowStockThreshold) return "low";
  return "active";
}

/** Amount owed for AP selection: prefer explicit due amount when finite; else total. */
export function invoicePayableCents(
  total: number | null | undefined,
  dueAmount: number | null | undefined,
): bigint {
  if (dueAmount != null && Number.isFinite(Number(dueAmount))) {
    return toMoneyCents(dueAmount);
  }
  return toMoneyCents(total);
}

export function sumSelectedInvoicePayableCents(
  invoices: Array<{ id: number; total?: number | null; dueAmount?: number | null }>,
  selectedIds: readonly number[],
): bigint {
  const seen = new Set<number>();
  let sum = 0n;
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const inv = invoices.find((i) => i.id === id);
    if (inv) sum += invoicePayableCents(inv.total, inv.dueAmount);
  }
  return sum;
}

export function calculatePoLineTotalCents(
  qty: number,
  unitPrice: number,
  taxRatePct?: number | null,
): bigint {
  const line = toMoneyCents(qty * unitPrice);
  if (taxRatePct == null || !Number.isFinite(Number(taxRatePct))) {
    return line;
  }
  const tax = (line * BigInt(Math.round(Number(taxRatePct) * 100))) / 10000n;
  return line + tax;
}

export function calculatePoTotalCentsFromLines(
  lines: Array<{ quantity: number; unitPrice: number; taxRatePct?: number | null }>,
): bigint {
  return lines.reduce((acc, l) => acc + calculatePoLineTotalCents(l.quantity, l.unitPrice, l.taxRatePct), 0n);
}

export type InventoryValuationRow = {
  quantity: number;
  cost?: number | null;
  price?: number | null;
  categoryId?: number | null;
};

export function calculateInventoryValueCents(items: InventoryValuationRow[]): bigint {
  let sum = 0n;
  for (const it of items) {
    const q = Number(it.quantity) || 0;
    const unit = Number(it.cost ?? it.price ?? 0) || 0;
    sum += toMoneyCents(q * unit);
  }
  return sum;
}

export function groupInventoryValueCentsByCategory(
  items: InventoryValuationRow[],
): Map<number | "none", bigint> {
  const m = new Map<number | "none", bigint>();
  for (const it of items) {
    const key = it.categoryId == null ? "none" : it.categoryId;
    const q = Number(it.quantity) || 0;
    const unit = Number(it.cost ?? it.price ?? 0) || 0;
    const add = toMoneyCents(q * unit);
    m.set(key, (m.get(key) ?? 0n) + add);
  }
  return m;
}

export type AgingInvoice = {
  dueDate: Date | string | null | undefined;
  balanceCents: bigint;
};

export function calculateApAgingBuckets(
  invoices: AgingInvoice[],
  asOf: Date = new Date(),
): { current: bigint; d30: bigint; d60: bigint; d90p: bigint } {
  const now = asOf.getTime();
  let current = 0n;
  let d30 = 0n;
  let d60 = 0n;
  let d90p = 0n;
  for (const inv of invoices) {
    if (!inv.dueDate) {
      d90p += inv.balanceCents;
      continue;
    }
    const d = new Date(inv.dueDate).getTime();
    if (Number.isNaN(d)) {
      d90p += inv.balanceCents;
      continue;
    }
    const daysLate = Math.floor((now - d) / (86400 * 1000));
    if (daysLate <= 0) current += inv.balanceCents;
    else if (daysLate <= 30) d30 += inv.balanceCents;
    else if (daysLate <= 60) d60 += inv.balanceCents;
    else d90p += inv.balanceCents;
  }
  return { current, d30, d60, d90p };
}
