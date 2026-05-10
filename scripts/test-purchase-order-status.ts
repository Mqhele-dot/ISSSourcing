/**
 * Shared PO lifecycle helpers (no server).
 * Run: npm run test:purchase-order-status
 */
import assert from "node:assert/strict";
import {
  canApprovePurchaseOrder,
  canReceivePurchaseOrder,
  canSendPurchaseOrder,
  canUpdatePurchaseOrder,
  normalizePurchaseOrderStatus,
} from "../shared/purchase-order-status.ts";
import { exitTest } from "./test-exit.ts";

function main() {
  assert.equal(normalizePurchaseOrderStatus("OPEN"), "open");
  assert.equal(normalizePurchaseOrderStatus("pending_approval"), "open");
  assert.equal(normalizePurchaseOrderStatus("issued"), "sent");
  assert.equal(normalizePurchaseOrderStatus("PARTIALLY_RECEIVED"), "sent");

  const mgr = { role: "manager" as const };
  assert.equal(canApprovePurchaseOrder("open", mgr), true);
  assert.equal(canApprovePurchaseOrder("approved", mgr), false);
  assert.equal(canApprovePurchaseOrder("sent", mgr), false);
  assert.equal(canApprovePurchaseOrder("received", mgr), false);
  assert.equal(canApprovePurchaseOrder("open", { role: "viewer" }), false);

  assert.equal(canSendPurchaseOrder("approved", mgr), true);
  assert.equal(canSendPurchaseOrder("open", mgr), false);
  assert.equal(canSendPurchaseOrder("sent", mgr), false);
  assert.equal(canSendPurchaseOrder("approved", { role: "clerk" }), false);

  assert.equal(canUpdatePurchaseOrder("draft"), true);
  assert.equal(canUpdatePurchaseOrder("open"), true);
  assert.equal(canUpdatePurchaseOrder("approved"), true);
  assert.equal(canUpdatePurchaseOrder("sent"), false);
  assert.equal(canUpdatePurchaseOrder("received"), false);
  assert.equal(canUpdatePurchaseOrder("closed"), false);
  assert.equal(canUpdatePurchaseOrder("cancelled"), false);

  assert.equal(canReceivePurchaseOrder("approved"), true);
  assert.equal(canReceivePurchaseOrder("sent"), true);
  assert.equal(canReceivePurchaseOrder("partially_received"), true);
  assert.equal(canReceivePurchaseOrder("draft"), false);
  assert.equal(canReceivePurchaseOrder("open"), false);

  console.log("Purchase order status script: all assertions passed.");
  exitTest(0);
}

main();
