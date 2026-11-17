import assert from "node:assert/strict";
import { receiptEvidenceByPoLine } from "../server/modules/accounts-payable/receipt-match-evidence";

const po = [{ id: 1, itemId: 20, receivedQuantity: 100 }, { id: 2, itemId: 20, receivedQuantity: 100 }];
const receipt = { purchaseOrderItemId: 1, itemId: 20, acceptedQuantity: 3, quantity: 5 };
assert.deepEqual([...receiptEvidenceByPoLine(po, [receipt])], [[1, 3]]);
assert.deepEqual([...receiptEvidenceByPoLine(po, [receipt, receipt])], [[1, 6]]);
assert.equal(receiptEvidenceByPoLine(po, [{ ...receipt, acceptedQuantity: 0 }]).get(1), 0);
assert.equal(receiptEvidenceByPoLine(po, [{ ...receipt, purchaseOrderItemId: null }]).size, 0);
assert.equal(receiptEvidenceByPoLine(po, [{ ...receipt, purchaseOrderItemId: 999 }]).size, 0);
assert.equal(receiptEvidenceByPoLine(po, [{ ...receipt, itemId: 999 }]).size, 0);
assert.equal(receiptEvidenceByPoLine([po[0]], [{ ...receipt, purchaseOrderItemId: null }]).get(1), 3);
assert.equal(receiptEvidenceByPoLine(po, [{ ...receipt, acceptedQuantity: "bad" }]).get(1), 0);
assert.equal(receiptEvidenceByPoLine(po, [{ ...receipt, acceptedQuantity: "1.25" }]).get(1), 1.25);
assert.deepEqual([...receiptEvidenceByPoLine(po, [])], [[1, 100], [2, 100]]);
assert.equal(receiptEvidenceByPoLine(po, [], false).size,0,"Inspection-pending receipts must not fall back to PO totals");
console.log("Receipt matching evidence: exact-line, legacy, rejected, malformed and fractional cases passed.");
