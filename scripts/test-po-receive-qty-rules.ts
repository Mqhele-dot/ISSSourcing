/**
 * Pure rules for PO receive line normalization (client + server alignment).
 * Run: npm run test:po-receive-qty
 */
import assert from "node:assert/strict";
import {
  clampReceiveQtyToRemaining,
  isValidReceiveQty,
  normalizeBatchInput,
  normalizeReceiveQtyInput,
  normalizeSerialTokensCsv,
} from "../client/src/features/purchase-orders/lib/receive-line-rules.ts";

function main() {
  assert.ok(Number.isNaN(normalizeReceiveQtyInput("x")));
  assert.equal(normalizeReceiveQtyInput("3"), 3);
  assert.ok(isValidReceiveQty(0));
  assert.ok(!isValidReceiveQty(1.2));
  assert.equal(clampReceiveQtyToRemaining(99, 5), 5);
  assert.equal(clampReceiveQtyToRemaining(-1, 5), 0);
  assert.equal(normalizeBatchInput("  abcd  ").length, 4);
  const longBatch = "x".repeat(400);
  assert.equal(normalizeBatchInput(longBatch).length, 256);
  const many = normalizeSerialTokensCsv("a,".repeat(400));
  assert.ok(many.length <= 200);
  assert.ok(many.every((t) => t.length <= 128));
}

main();
console.log("test-po-receive-qty-rules: ok");
