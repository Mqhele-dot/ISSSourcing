import { exitTest } from "./test-exit.ts";
import { buildPurchaseOrderPrintHtml } from "../client/src/pages/orders/purchase-order-shared.ts";
import type { PurchaseOrderDetail } from "../client/src/api/types.ts";

let failures = 0;

function expectPass(name: string, pass: boolean) {
  if (pass) {
    console.log("  ✓ %s", name);
    return;
  }
  failures += 1;
  console.log("  ✗ %s", name);
}

const detail = {
  id: 1,
  poNumber: "PO-<TEST>",
  supplierId: 9,
  supplierName: "Supplier <script>alert('x')</script>",
  status: "APPROVED",
  requestedDate: "2026-05-10T00:00:00.000Z",
  totalAmount: 10,
  receivedProgress: 0,
  lines: [
    {
      id: 1,
      sku: "SKU-&-1",
      itemName: "Item <b>Unsafe</b>",
      qtyOrdered: 1,
      qtyReceived: 0,
      unitPrice: 42,
      expectedRemaining: 1,
    },
  ],
} as unknown as PurchaseOrderDetail;

const html = buildPurchaseOrderPrintHtml(detail, (amount) => `ZAR ${amount.toFixed(2)}`);

console.log("PO print HTML tests\n");
expectPass("escapes supplier names", html.includes("Supplier &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"));
expectPass("escapes item names", html.includes("Item &lt;b&gt;Unsafe&lt;/b&gt;"));
expectPass("escapes SKU text", html.includes("SKU-&amp;-1"));
expectPass("does not hardcode dollar signs", !html.includes("$"));
expectPass("uses provided money formatter", html.includes("ZAR 42.00"));

console.log(`\nPO print HTML result: ${failures} failure(s)`);
exitTest(failures > 0 ? 1 : 0);
