/**
 * Deterministic functional QA expectations — keep in sync with server/seed-functional-qa.ts.
 * Used by E2E and pure calculation tests.
 */
export const FQA_SKUS = ["SKU-A", "SKU-B", "SKU-C", "SKU-D"] as const;
export type FqaSku = (typeof FQA_SKUS)[number];

export const FQA_SKU_REGEX = /^SKU-[A-D]$/;

/** Master row: quantity matches seed onHand; cost seeded at 5. */
export const FQA_UNIT_COST = 5;

export const FQA_INVENTORY_MASTER = {
  "SKU-A": { quantity: 10, allocatedUi: 3, availableUi: 7, lowStockThreshold: 5, location: "Johannesburg", category: "Electronics" },
  "SKU-B": { quantity: 4, allocatedUi: 1, availableUi: 3, lowStockThreshold: 5, location: "Cape Town", category: "Electronics" },
  "SKU-C": { quantity: 20, allocatedUi: 0, availableUi: 20, lowStockThreshold: 5, location: "Durban", category: "Consumables" },
  "SKU-D": { quantity: 0, allocatedUi: 2, availableUi: -2, lowStockThreshold: 1, location: "Johannesburg", category: "Consumables" },
} as const satisfies Record<
  FqaSku,
  { quantity: number; allocatedUi: number; availableUi: number; lowStockThreshold: number; location: string; category: string }
>;

export function fqaMasterValueCents(): bigint {
  let s = 0n;
  for (const sku of FQA_SKUS) {
    const row = FQA_INVENTORY_MASTER[sku];
    s += BigInt(Math.round(row.quantity * FQA_UNIT_COST * 100));
  }
  return s;
}

export const FQA_PO_NUMBERS = ["PO-FQA-001", "PO-FQA-002", "PO-FQA-003"] as const;

/** Lines seeded for PO-FQA-001: single line 10 × 100 = 1000 (no tax). */
export const FQA_PO_001_LINES = [{ quantity: 10, unitPrice: 100 }] as const;
export const FQA_PO_001_HEADER_TOTAL = 1000;

export const FQA_AP_INVOICES = {
  "INV-FQA-001": { total: 1000, dueAmount: 1000 },
  "INV-FQA-002": { total: 500, dueAmount: 250 },
  "INV-FQA-003": { total: 300, dueAmount: null as number | null },
} as const;

/** Payable cents: due when finite, else total — matches invoicePayableCents. */
export function fqaApPayableCentsForNumber(num: keyof typeof FQA_AP_INVOICES): bigint {
  const row = FQA_AP_INVOICES[num];
  const due = row.dueAmount;
  const amt = due != null && Number.isFinite(Number(due)) ? due : row.total;
  return BigInt(Math.round(Number(amt) * 100));
}

export const FQA_REQUISITION_NUMBER = "REQ-FQA-001";
export const FQA_REQUISITION_STATUS = "PENDING";
