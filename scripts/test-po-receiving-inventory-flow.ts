/**
 * Runtime proof: Purchase Order receiving must update inventory, warehouse stock,
 * GRN/AP receipt evidence, PO line received quantities, and audit/activity trails.
 */
import assert from "node:assert/strict";
import { pool } from "../server/db.ts";
import { exitTest } from "./test-exit.ts";
import { getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";
import {
  assertActivityOrAuditRecord,
  createSentWorkflowPo,
  ensureWorkflowFixture,
  receiveWorkflowPo,
  unwrapData,
} from "./workflow-proof-fixtures.ts";

async function main(): Promise<void> {
  const baseUrl = getTestBaseUrl();
  console.log("PO receiving -> inventory runtime flow (BASE_URL=%s)\n", baseUrl);

  let cookie: string | undefined;
  try {
    cookie = await loginForTests("admin", "Admin123!");
  } catch (error) {
    if (isConnectionRefused(error)) {
      console.log("  Server not reachable at %s - start with: npm run dev", baseUrl);
      exitTest(1);
      return;
    }
    throw error;
  }
  if (!cookie) throw new Error("Admin login failed; seed users are required.");

  const fixture = await ensureWorkflowFixture("rcv");
  const po = await createSentWorkflowPo(cookie, fixture, 2);
  const beforeItem = await pool.query<{ quantity: number }>(
    `SELECT quantity FROM inventory_items WHERE id = $1`,
    [fixture.itemId],
  );
  const beforeWarehouse = await pool.query<{ quantity: number }>(
    `
      SELECT quantity
      FROM warehouse_inventory
      WHERE organization_id = 1 AND warehouse_id = $1 AND item_id = $2
      LIMIT 1
    `,
    [fixture.warehouseId, fixture.itemId],
  );

  const grnNumber = `GRN-${fixture.suffix}`;
  const receive = await receiveWorkflowPo(cookie, po.poNumber, fixture, 2, grnNumber);
  assert.equal(receive.status, 200, `receive PO failed: ${receive.status} ${JSON.stringify(receive.json)}`);
  const receivePayload = unwrapData<{
    order?: { id?: number; orderNumber?: string; status?: string };
    inventoryChanges?: Array<{ sku: string; delta: number }>;
    apReceipt?: { receiptId?: number };
  }>(receive.json, "receive PO");
  assert.equal(Number(receivePayload.order?.id), po.poId);
  assert.ok(["received", "partially_received", "RECEIVED", "PARTIALLY_RECEIVED"].includes(String(receivePayload.order?.status)));
  assert.ok(receivePayload.inventoryChanges?.some((change) => change.sku === fixture.sku && Number(change.delta) === 2));
  console.log("  ok operational receive returned order, inventory change, and status");

  const poLine = await pool.query<{ received_quantity: number }>(
    `SELECT received_quantity FROM purchase_order_items WHERE id = $1`,
    [po.poItemId],
  );
  assert.equal(Number(poLine.rows[0]?.received_quantity), 2, "PO line received quantity should update");

  const movement = await pool.query<{
    id: number;
    quantity: number;
    receiver_user_id: number | null;
    receiver_name: string | null;
    warehouse_location: string | null;
    timestamp: Date;
  }>(
    `
      SELECT id, quantity, receiver_user_id, receiver_name, warehouse_location, timestamp
      FROM stock_movements
      WHERE organization_id = 1
        AND item_id = $1
        AND warehouse_id = $2
        AND reference_type = 'purchase_order'
        AND reference_id = $3
        AND type = 'RECEIPT'
      ORDER BY id DESC
      LIMIT 1
    `,
    [fixture.itemId, fixture.warehouseId, po.poId],
  );
  assert.ok(movement.rows[0], "receiving should create a stock movement");
  assert.equal(Number(movement.rows[0].quantity), 2);
  assert.equal(Number(movement.rows[0].receiver_user_id), 1);
  assert.equal(movement.rows[0].receiver_name, "Runtime Receiver");
  assert.ok(movement.rows[0].warehouse_location);
  assert.ok(movement.rows[0].timestamp);

  const afterItem = await pool.query<{ quantity: number }>(
    `SELECT quantity FROM inventory_items WHERE id = $1`,
    [fixture.itemId],
  );
  assert.equal(
    Number(afterItem.rows[0]?.quantity),
    Number(beforeItem.rows[0]?.quantity ?? 0) + 2,
    "receiving should increase item on-hand quantity",
  );

  const afterWarehouse = await pool.query<{ quantity: number }>(
    `
      SELECT quantity
      FROM warehouse_inventory
      WHERE organization_id = 1 AND warehouse_id = $1 AND item_id = $2
      LIMIT 1
    `,
    [fixture.warehouseId, fixture.itemId],
  );
  assert.equal(
    Number(afterWarehouse.rows[0]?.quantity),
    Number(beforeWarehouse.rows[0]?.quantity ?? 0) + 2,
    "receiving should increase warehouse inventory quantity",
  );
  console.log("  ok receive created stock movement and updated item/warehouse inventory");

  const apReceipt = await pool.query<{ id: number; receipt_number: string; status: string; received_by: number | null }>(
    `
      SELECT id, receipt_number, status, received_by
      FROM ap_receipts
      WHERE organization_id = 1 AND purchase_order_id = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [po.poId],
  );
  assert.ok(apReceipt.rows[0], "operational receive should create AP receipt/GRN evidence");
  assert.equal(apReceipt.rows[0].status, "POSTED");
  assert.ok(apReceipt.rows[0].receipt_number, "AP receipt should have a receipt/GRN number");
  const apReceiptLine = await pool.query<{ accepted_quantity: number }>(
    `SELECT accepted_quantity FROM ap_receipt_items WHERE receipt_id = $1 AND item_id = $2 LIMIT 1`,
    [apReceipt.rows[0].id, fixture.itemId],
  );
  assert.equal(Number(apReceiptLine.rows[0]?.accepted_quantity), 2);
  console.log("  ok receive posted AP receipt and receipt line evidence");

  const poEvent = await pool.query<{ id: number; created_at: Date }>(
    `SELECT id, created_at FROM purchase_order_events WHERE po_number = $1 AND event_type = 'receive' ORDER BY id DESC LIMIT 1`,
    [po.poNumber],
  );
  assert.ok(poEvent.rows[0], "receiving should write purchase_order_events receive row");
  await assertActivityOrAuditRecord({
    actionLike: "receive",
    referenceType: "purchase_order",
    label: "PO receive/post GRN",
  });
  assert.ok(movement.rows[0].id, "stock movement id should be available for audit reference");
  console.log("  ok receive activity/audit evidence exists");

  const overFixture = await ensureWorkflowFixture("over");
  const overPo = await createSentWorkflowPo(cookie, overFixture, 2);
  const overReceive = await receiveWorkflowPo(cookie, overPo.poNumber, overFixture, 3, `GRN-OVER-${overFixture.suffix}`);
  assert.equal(overReceive.status, 400, `over receipt should be blocked: ${JSON.stringify(overReceive.json)}`);
  assert.match(JSON.stringify(overReceive.json), /RECEIVE_EXCEEDS_REMAINING|exceed/i);
  console.log("  ok over-receipt is blocked");

  await pool.query(`UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [overPo.poId]);
  const invalidStateReceive = await receiveWorkflowPo(
    cookie,
    overPo.poNumber,
    overFixture,
    1,
    `GRN-CANCEL-${overFixture.suffix}`,
  );
  assert.equal(
    invalidStateReceive.status,
    400,
    `receiving cancelled PO should be blocked: ${JSON.stringify(invalidStateReceive.json)}`,
  );
  assert.match(JSON.stringify(invalidStateReceive.json), /INVALID_RECEIVE_STATE|approved\/sent/i);
  console.log("  ok receiving against cancelled/closed PO is blocked");

  console.log("\nPO receiving -> inventory runtime flow passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
