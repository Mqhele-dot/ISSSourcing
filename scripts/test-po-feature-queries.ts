/**
 * Purchase-order normalization, query keys, validation, guards, and invalidation wiring.
 * Run: npm run test:po-feature-queries
 */
import assert from "node:assert/strict";
import type { QueryClient } from "@tanstack/react-query";
import type { PurchaseOrderDetail } from "../client/src/api/types.ts";
import { downloadPurchaseOrderSignedPdf } from "../client/src/features/purchase-orders/api/operational-purchase-orders.api.ts";
import { invalidatePurchaseOrderOperationalQueries } from "../client/src/features/purchase-orders/lib/invalidate-purchase-order-queries.ts";
import { normalizePurchaseOrderDetail } from "../client/src/features/purchase-orders/lib/normalize-operational-detail.ts";
import { normalizePurchaseReceiveResult } from "../client/src/features/purchase-orders/lib/normalize-purchase-receive-result.ts";
import {
  assertNonEmptyReceiveLines,
  assertPoNumberForMutation,
  assertTransitionTargetStatus,
} from "../client/src/features/purchase-orders/lib/po-mutation-guards.ts";
import {
  normalizeEnvelopeFilters,
  normalizeOperationalPoParam,
  purchaseOrderOperationalDetailQueryKey,
  purchaseOrdersEnvelopeQueryKey,
} from "../client/src/features/purchase-orders/lib/query-keys.ts";
import { validateReceiveLines } from "../client/src/features/purchase-orders/lib/receive-line-rules.ts";

async function main() {
  const snake = normalizePurchaseOrderDetail({
    po_number: "X1",
    supplier_id: "2",
    total_amount: "100.5",
    lines: [
      {
        item_id: 9,
        sku: "A",
        item_name: "Thing",
        qty_ordered: "3",
        qty_received: "1",
        unit_price: "10",
        expected_remaining: "2",
      },
    ],
    progress: { qty_ordered: 3, qty_received: 1 },
  });
  assert.equal(snake.poNumber, "X1");
  assert.equal(snake.supplierId, 2);
  assert.equal(snake.totalAmount, 100.5);
  assert.equal(snake.lines[0]?.itemId, 9);
  assert.equal(snake.lines[0]?.qtyOrdered, 3);
  assert.equal(snake.lines[0]?.sku, "A");

  const recvBare = normalizePurchaseReceiveResult({});
  assert.deepEqual(recvBare.inventoryChanges, []);
  assert.deepEqual(recvBare.shipmentUpdates, []);
  assert.deepEqual(recvBare.mismatchExceptions, []);
  assert.equal(recvBare.changed.inventoryChanges, 0);
  assert.equal(recvBare.changed.shipmentUpdates, 0);
  assert.equal(recvBare.changed.mismatchExceptions, 0);
  assert.ok(Array.isArray(recvBare.order.lines));

  const recvSnake = normalizePurchaseReceiveResult({
    inventory_changes: [{ sku: "A", location: "L", delta: 1, available: 2, on_hand: 3 }],
    mismatch_exceptions: [{ id: 1, sku: "A", created: true }],
  });
  assert.equal(recvSnake.inventoryChanges.length, 1);
  assert.equal(recvSnake.inventoryChanges[0]?.onHand, 3);
  assert.equal(recvSnake.mismatchExceptions[0]?.created, true);

  const recvMalformed = normalizePurchaseReceiveResult({
    inventory_changes: [
      {
        sku: "s",
        location: "l",
        delta: "abc",
        available: null,
        on_hand: "",
      },
    ],
    shipment_updates: [{ shipment_id: "nope", to_status: "ok" }],
    mismatch_exceptions: [{ id: undefined, sku: "a", created: false }],
    changed: {
      inventory_changes: "bad",
      shipment_updates: null,
      mismatch_exceptions: "xyz",
    },
  });
  const malformedNums: number[] = [
    recvMalformed.inventoryChanges[0]!.delta,
    recvMalformed.inventoryChanges[0]!.available,
    recvMalformed.inventoryChanges[0]!.onHand,
    recvMalformed.shipmentUpdates[0]!.shipmentId,
    recvMalformed.mismatchExceptions[0]!.id,
    recvMalformed.changed.inventoryChanges,
    recvMalformed.changed.shipmentUpdates,
    recvMalformed.changed.mismatchExceptions,
  ];
  for (const n of malformedNums) {
    assert.ok(Number.isFinite(n));
    assert.ok(!Number.isNaN(n));
  }

  assert.throws(() => assertPoNumberForMutation(""), /required/i);
  assert.throws(() => assertPoNumberForMutation("   "), /required/i);
  assert.throws(() => assertTransitionTargetStatus(""), /required/i);
  assert.throws(() => assertTransitionTargetStatus("   "), /required/i);
  assert.throws(() => assertNonEmptyReceiveLines([]), /required/i);

  const envelopeA = purchaseOrdersEnvelopeQueryKey({ status: " open ", supplier: "  ", q: "\t" });
  const envelopeB = purchaseOrdersEnvelopeQueryKey({ status: "open", supplier: "", q: "" });
  assert.deepEqual(envelopeA, envelopeB);

  assert.equal(normalizeOperationalPoParam("  \n PO-99 "), "PO-99");
  assert.deepEqual(purchaseOrderOperationalDetailQueryKey("  x "), ["purchase-order-operational-detail", "x"]);

  const filters = normalizeEnvelopeFilters({ status: " a ", supplier: "b", q: " " });
  assert.equal(filters.q, "");

  const detail = {
    id: 1,
    poNumber: "P1",
    supplierId: 1,
    supplierName: null,
    status: "sent",
    requestedDate: null,
    createdAt: null,
    totalAmount: 0,
    lines: [
      {
        id: 1,
        itemId: 1,
        sku: "SKU1",
        itemName: "Item",
        qtyOrdered: 10,
        qtyReceived: 0,
        unitPrice: 1,
        expectedRemaining: 5,
        serialTrackingRequired: true,
      },
    ],
    shipments: [],
    progress: { qtyOrdered: 10, qtyReceived: 0, percent: 0 },
  } satisfies PurchaseOrderDetail;

  const noLines = validateReceiveLines(detail, []);
  assert.equal(noLines.ok, false);
  if (noLines.ok) throw new Error("expected no-lines failure");
  assert.ok(noLines.errors.some((e) => e.field === "_line"));

  const zeroQty = validateReceiveLines(detail, [{ sku: "SKU1", qtyReceivedNow: 0 }]);
  assert.equal(zeroQty.ok, false);
  if (zeroQty.ok) throw new Error("expected zero-qty failure");
  assert.ok(zeroQty.errors.some((e) => e.field === "_line"));

  const badSerial = validateReceiveLines(detail, [
    { sku: "SKU1", qtyReceivedNow: 2, serialNumbers: ["a", "a"] },
  ]);
  assert.equal(badSerial.ok, false);
  if (badSerial.ok) throw new Error("expected duplicate serial failure");
  assert.ok(badSerial.errors.some((e) => /unique/i.test(e.message)));

  const badSerialCount = validateReceiveLines(detail, [{ sku: "SKU1", qtyReceivedNow: 2, serialNumbers: ["a"] }]);
  assert.equal(badSerialCount.ok, false);

  const overQty = validateReceiveLines(detail, [{ sku: "SKU1", qtyReceivedNow: 99 }]);
  assert.equal(overQty.ok, false);
  if (overQty.ok) throw new Error("expected qty failure");
  assert.ok(overQty.errors.some((e) => /exceed/i.test(e.message)));

  const good = validateReceiveLines(detail, [{ sku: "SKU1", qtyReceivedNow: 2, serialNumbers: ["a", "b"] }]);
  assert.equal(good.ok, true);

  const unknownSku = validateReceiveLines(detail, [{ sku: "Nope", qtyReceivedNow: 1 }]);
  assert.equal(unknownSku.ok, false);

  const calls: unknown[] = [];
  const fakeClient = {
    invalidateQueries: (opts: unknown) => {
      calls.push(opts);
      return Promise.resolve();
    },
  } as unknown as QueryClient;

  await invalidatePurchaseOrderOperationalQueries(fakeClient, "  PO-1 ");
  assert.ok(calls.length >= 2);
  assert.ok(
    calls.some(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "queryKey" in c &&
        Array.isArray((c as { queryKey: unknown }).queryKey) &&
        (c as { queryKey: string[] }).queryKey[0] === "purchase-orders-envelope",
    ),
  );
  assert.ok(
    calls.some(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "queryKey" in c &&
        Array.isArray((c as { queryKey: unknown }).queryKey) &&
        (c as { queryKey: string[] }).queryKey[1] === "PO-1",
    ),
  );

  assert.equal(normalizeOperationalPoParam("   \t").length, 0);

  /** `fetchPurchaseOrderRecordById` maps HTTP 404/401 from `invTrackFetch` to `null` (see implementation). */

  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "PDF unavailable" } }), {
      status: 502,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await downloadPurchaseOrderSignedPdf("PO-TEST");
    assert.fail("expected downloadPurchaseOrderSignedPdf to throw on HTTP error");
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.match(e.message, /PDF unavailable|502/);
  } finally {
    globalThis.fetch = savedFetch;
  }
}

await main();
console.log("test-po-feature-queries: ok");
