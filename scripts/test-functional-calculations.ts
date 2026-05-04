/**
 * Pure calculation regression tests (no browser).
 * Run: npm run test:functional-calculations
 */
import assert from "node:assert/strict";
import {
  calculateApAgingBuckets,
  calculateAvailable,
  calculateInventoryValueCents,
  calculatePoLineTotalCents,
  calculatePoTotalCentsFromLines,
  fromMoneyCents,
  getInventoryAvailabilityStatus,
  invoicePayableCents,
  sumMoneyCents,
  sumSelectedInvoicePayableCents,
  toMoneyCents,
  groupInventoryValueCentsByCategory,
} from "../shared/functional-calculations.ts";

function main() {
  assert.equal(calculateAvailable(10, 3), 7);
  assert.equal(calculateAvailable(0, 2), -2);
  assert.equal(getInventoryAvailabilityStatus(-2, 1), "error");
  assert.equal(getInventoryAvailabilityStatus(3, 5), "low");
  assert.equal(getInventoryAvailabilityStatus(5, 5), "low");
  assert.equal(getInventoryAvailabilityStatus(7, 5), "active");
  assert.equal(getInventoryAvailabilityStatus(8, 5), "active");

  const a = 0.1;
  const b = 0.2;
  assert.notEqual(a + b, 0.3);
  assert.equal(fromMoneyCents(toMoneyCents(a) + toMoneyCents(b)), 0.3);

  assert.equal(fromMoneyCents(sumMoneyCents([0.1, 0.2])), 0.3);

  const vat = calculatePoLineTotalCents(1, 10, 15);
  assert.equal(fromMoneyCents(vat), 11.5);

  const po = calculatePoTotalCentsFromLines([
    { quantity: 2, unitPrice: 12.5, taxRatePct: 10 },
    { quantity: 1, unitPrice: 5 },
  ]);
  assert.equal(po, toMoneyCents(2 * 12.5 * 1.1 + 5));

  assert.equal(invoicePayableCents(1000, 1000), toMoneyCents(1000));
  assert.equal(invoicePayableCents(500, 250), toMoneyCents(250));
  assert.equal(invoicePayableCents(300, null as unknown as number), toMoneyCents(300));

  const invs = [
    { id: 1, total: 1000, dueAmount: 1000 },
    { id: 2, total: 500, dueAmount: 250 },
    { id: 3, total: 300, dueAmount: null as unknown as number },
  ];
  const batch = sumSelectedInvoicePayableCents(invs, [1, 2]);
  assert.equal(fromMoneyCents(batch), 1250);

  const dup = sumSelectedInvoicePayableCents(invs, [1, 1, 2]);
  assert.equal(fromMoneyCents(dup), 1250);

  const items = [
    { quantity: 10, cost: 5, categoryId: 1 },
    { quantity: 4, cost: 2.5, categoryId: 1 },
  ];
  assert.equal(fromMoneyCents(calculateInventoryValueCents(items)), 60);

  const byCat = groupInventoryValueCentsByCategory([
    { quantity: 2, cost: 10, categoryId: 1 },
    { quantity: 1, cost: 5, categoryId: 2 },
  ]);
  assert.equal(byCat.get(1), toMoneyCents(20));
  assert.equal(byCat.get(2), toMoneyCents(5));

  const base = new Date("2025-06-15T12:00:00Z");
  const aging = calculateApAgingBuckets(
    [
      { dueDate: new Date("2025-06-20T12:00:00Z"), balanceCents: 100n },
      { dueDate: new Date("2025-05-01T12:00:00Z"), balanceCents: 200n },
    ],
    base,
  );
  assert.equal(aging.current, 100n);
  assert.ok(aging.d30 + aging.d60 + aging.d90p >= 200n);

  console.log("test-functional-calculations: all checks passed");
}

main();
