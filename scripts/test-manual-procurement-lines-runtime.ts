import assert from "node:assert/strict";
import { pool } from "../server/db";
import { apiJsonRequest, loginForTests } from "./test-http";
import { exitTest } from "./test-exit";
import {
  createAndConvertMixedLineRequisition,
  errorCode,
  mixedLineBody,
  seedProcurementEvidenceFixture,
  unwrapData,
} from "./runtime-fixtures/procurement-line-evidence-fixture";

async function main() {
  const cookie = await loginForTests("admin", "Admin123!");
  assert.ok(cookie, "Seeded admin login is required");
  const fixture = await seedProcurementEvidenceFixture();
  const base = mixedLineBody(fixture);

  const invalidCases = [
    {
      label: "catalogue line without item",
      line: { ...base.items[0], itemId: null },
      code: "REQUISITION_CATALOG_ITEM_REQUIRED",
    },
    {
      label: "non-stock line without reason",
      line: { ...base.items[1], manualEntryReason: "" },
      code: "REQUISITION_MANUAL_LINE_DETAILS_REQUIRED",
    },
    {
      label: "service line without description",
      line: { ...base.items[2], description: "" },
      code: "REQUISITION_MANUAL_LINE_DETAILS_REQUIRED",
    },
  ];
  for (const testCase of invalidCases) {
    const response = await apiJsonRequest("/purchase-requisitions", {
      method: "POST",
      cookie,
      body: { ...base, items: [testCase.line] },
    });
    assert.equal(response.status, 400, `${testCase.label} must be rejected`);
    assert.equal(errorCode(response.json), testCase.code, `${testCase.label} should return a structured code`);
  }

  const { requisition, purchaseOrder } = await createAndConvertMixedLineRequisition(cookie, fixture);
  const reqResponse = await apiJsonRequest(`/purchase-requisitions/${requisition.id}`, { cookie });
  const req = unwrapData<{ items: Array<Record<string, unknown>> }>(reqResponse.json, "load mixed requisition");
  assert.deepEqual(req.items.map((line) => line.lineType), ["CATALOG", "NON_STOCK", "SERVICE"]);

  const poResponse = await apiJsonRequest(`/purchase-orders/${purchaseOrder.id}/items`, { cookie });
  assert.equal(poResponse.status, 200);
  const poLines = unwrapData<Array<Record<string, unknown>>>(poResponse.json, "load mixed PO lines");
  assert.equal(poLines.length, 3);
  const expected = new Map(req.items.map((line) => [String(line.lineType), line]));
  for (const poLine of poLines) {
    const source = expected.get(String(poLine.lineType));
    assert.ok(source, `unexpected PO line type ${poLine.lineType}`);
    for (const field of [
      "lineType",
      "description",
      "manualEntryReason",
      "fulfilmentType",
      "receiptRequired",
      "taxCodeId",
      "unitOfMeasureId",
      "costCentreId",
      "glAccountCode",
    ]) {
      assert.equal(poLine[field], source[field], `PO conversion must preserve ${field} for ${poLine.lineType}`);
    }
  }
  const serviceLine = poLines.find((line) => line.lineType === "SERVICE");
  assert.equal(serviceLine?.fulfilmentType, "SERVICE_CONFIRMATION");

  const invoiceResponse = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie,
    body: {
      supplierId: fixture.supplierId,
      purchaseOrderId: purchaseOrder.id,
      invoiceNumber: `W7-INV-${fixture.suffix}`,
      subtotal: 600,
      total: 600,
      dueAmount: 600,
      items: [{
        itemId: null,
        purchaseOrderItemId: serviceLine?.id,
        lineType: "SERVICE",
        description: String(serviceLine?.description),
        quantity: 1,
        unitPrice: 600,
        totalPrice: 600,
      }],
    },
  });
  assert.equal(invoiceResponse.status, 201, `manual AP line link failed: ${JSON.stringify(invoiceResponse.json)}`);
  const invoice = unwrapData<{ id: number }>(invoiceResponse.json, "create linked AP invoice");
  const invoiceItems = await apiJsonRequest(`/invoices/${invoice.id}/items`, { cookie });
  const linked = unwrapData<Array<Record<string, unknown>>>(invoiceItems.json, "load linked invoice lines");
  assert.equal(Number(linked[0]?.purchaseOrderItemId), Number(serviceLine?.id));
  assert.equal(linked[0]?.lineType, "SERVICE");

  console.log("Manual procurement line runtime proof passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => pool.end().catch(() => undefined));
