/**
 * Purchase-order query keys, list filter normalization, receive validation, and invalidation wiring.
 * Run: npm run test:po-feature-queries
 */
import assert from "node:assert/strict";
import type { QueryClient } from "@tanstack/react-query";
import type { PurchaseOrderDetail } from "../client/src/api/types.ts";
import { invalidatePurchaseOrderOperationalQueries } from "../client/src/features/purchase-orders/lib/invalidate-purchase-order-queries.ts";
import {
  normalizeEnvelopeFilters,
  normalizeOperationalPoParam,
  purchaseOrderOperationalDetailQueryKey,
  purchaseOrdersEnvelopeQueryKey,
} from "../client/src/features/purchase-orders/lib/query-keys.ts";
import { validateReceiveLines } from "../client/src/features/purchase-orders/lib/receive-line-rules.ts";
import { downloadPurchaseOrderSignedPdf } from "../client/src/features/purchase-orders/api/operational-purchase-orders.api.ts";

async function main() {
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

  const badSerial = validateReceiveLines(detail, [
    { sku: "SKU1", qtyReceivedNow: 2, serialNumbers: ["a", "a"] },
  ]);
  assert.equal(badSerial.ok, false);
  if (badSerial.ok) throw new Error("expected duplicate serial failure");
  assert.ok(badSerial.errors.some((e) => /unique/i.test(e.message)));

  const badSerialCount = validateReceiveLines(detail, [{ sku: "SKU1", qtyReceivedNow: 2, serialNumbers: ["a"] }]);
  assert.equal(badSerialCount.ok, false);

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

  /** Mirrors `usePurchaseOrderOperationalDetailQuery` — whitespace-only PO yields empty key segment. */
  assert.equal(normalizeOperationalPoParam("   \t").length, 0);

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
    assert.match(e.message, /PDF unavailable/);
  } finally {
    globalThis.fetch = savedFetch;
  }
}

await main();
console.log("test-po-feature-queries: ok");
