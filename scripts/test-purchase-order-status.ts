/**
 * Shared PO lifecycle helpers (no server).
 * Run: npm run test:purchase-order-status
 */
import assert from "node:assert/strict";
import {
  canApprovePurchaseOrder,
  canReceivePurchaseOrder,
  canSendPurchaseOrder,
  canTransitionPurchaseOrderStatus,
  canUpdatePurchaseOrder,
  normalizePurchaseOrderStatus,
} from "../shared/purchase-order-status.ts";
import { exitTest } from "./test-exit.ts";

function main() {
  assert.equal(normalizePurchaseOrderStatus("OPEN"), "open");
  assert.equal(normalizePurchaseOrderStatus("pending_approval"), "open");
  assert.equal(normalizePurchaseOrderStatus("issued"), "sent");
  assert.equal(normalizePurchaseOrderStatus("PARTIALLY_RECEIVED"), "partially_received");
  assert.equal(normalizePurchaseOrderStatus("partial received"), "partially_received");
  assert.equal(normalizePurchaseOrderStatus("acknowledged"), "sent");
  assert.equal(normalizePurchaseOrderStatus("completed"), "received");
  assert.equal(normalizePurchaseOrderStatus("closed"), "closed");
  assert.equal(normalizePurchaseOrderStatus("void"), "cancelled");

  const mgr = { role: "manager" as const };
  assert.equal(canApprovePurchaseOrder("open", mgr), true);
  assert.equal(canApprovePurchaseOrder("approved", mgr), false);
  assert.equal(canApprovePurchaseOrder("sent", mgr), false);
  assert.equal(canApprovePurchaseOrder("partially_received", mgr), false);
  assert.equal(canApprovePurchaseOrder("open", { role: "viewer" }), false);

  assert.equal(canSendPurchaseOrder("approved", mgr), true);
  assert.equal(canSendPurchaseOrder("open", mgr), false);
  assert.equal(canSendPurchaseOrder("sent", mgr), false);
  assert.equal(canSendPurchaseOrder("approved", { role: "clerk" }), false);

  assert.equal(canUpdatePurchaseOrder("draft"), true);
  assert.equal(canUpdatePurchaseOrder("open"), true);
  assert.equal(canUpdatePurchaseOrder("approved"), true);
  assert.equal(canUpdatePurchaseOrder("sent"), false);
  assert.equal(canUpdatePurchaseOrder("partially_received"), false);
  assert.equal(canUpdatePurchaseOrder("received"), false);
  assert.equal(canUpdatePurchaseOrder("closed"), false);
  assert.equal(canUpdatePurchaseOrder("cancelled"), false);

  assert.equal(canReceivePurchaseOrder("approved"), true);
  assert.equal(canReceivePurchaseOrder("sent"), true);
  assert.equal(canReceivePurchaseOrder("partially_received"), true);
  assert.equal(canReceivePurchaseOrder("draft"), false);
  assert.equal(canReceivePurchaseOrder("open"), false);
  assert.equal(canReceivePurchaseOrder("received"), false);

  assert.equal(canTransitionPurchaseOrderStatus("draft", "open"), true);
  assert.equal(canTransitionPurchaseOrderStatus("sent", "partially_received"), true);
  assert.equal(canTransitionPurchaseOrderStatus("sent", "received"), true);
  assert.equal(canTransitionPurchaseOrderStatus("partially_received", "received"), true);
  assert.equal(canTransitionPurchaseOrderStatus("received", "closed"), true);
  assert.equal(canTransitionPurchaseOrderStatus("received", "sent"), false);
  assert.equal(canTransitionPurchaseOrderStatus("closed", "sent"), false);
  assert.equal(canTransitionPurchaseOrderStatus("cancelled", "sent"), false);
  assert.equal(canTransitionPurchaseOrderStatus("cancelled", "received"), false);

  console.log("Purchase order status script: all assertions passed.");
  exitTest(0);
}

main();
