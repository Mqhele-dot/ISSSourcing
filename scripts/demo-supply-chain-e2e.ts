/**
 * Full supply-chain demo path (API): requisition → approve → PO → receipt → invoice → 3-way match → payment → export → activity.
 *
 * Also prints a short "UI gaps" checklist (see docs/DEMO_WORKFLOW.md).
 *
 * Run (server up, seeded users):
 *   npx tsx scripts/demo-supply-chain-e2e.ts
 *   BASE_URL=http://127.0.0.1:5000 npx tsx scripts/demo-supply-chain-e2e.ts
 */
import process from "node:process";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, apiRawRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function expectStatus(name: string, expected: number, actual: number): boolean {
  if (actual === expected) {
    console.log("  ✓ %s -> %d", name, actual);
    return true;
  }
  console.log("  ✗ %s -> expected %d, got %d", name, expected, actual);
  return false;
}

function printUiGaps(): void {
  console.log("\n--- UI gaps (see docs/DEMO_WORKFLOW.md) ---");
  console.log("- Master data edit / extended supplier & PO master wiring may be incomplete.");
  console.log("- PO approval policy enforcement in UI may lag requisition policies.");
  console.log("- Invoice: list + create + match; full invoice lifecycle UI may be partial.");
  console.log("- Warehouse: allocations / put-away / batch-serial depth — use /warehouse-operations + PO receive.");
  console.log("- Portal, exceptions automation, notifications, mobile — see PROGRESS-REPORT.md.");
}

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("Demo supply-chain E2E (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await loginForTests("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  ⚠ Admin login failed (seed users missing?).");
    exitTest(1);
  }

  let failures = 0;

  const userRes = await apiJsonRequest("/user", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/user", 200, userRes.status)) failures++;
  const currentUser = asRecord(userRes.json);
  const createdBy = Number(currentUser.id ?? 1);

  const supplierRes = await apiJsonRequest("/suppliers", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/suppliers", 200, supplierRes.status)) failures++;
  const suppliers = asArray<{ id: number }>(supplierRes.json);
  const supplierId = Number(suppliers[0]?.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers; run npm run db:seed");
    exitTest(1);
  }

  const deptRes = await apiJsonRequest("/departments", { method: "GET", cookie: adminCookie });
  const departments = asArray<{ id: number }>(deptRes.json);
  const departmentId = Number(departments[0]?.id ?? 0);

  const itemsRes = await apiJsonRequest("/inventory", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/inventory", 200, itemsRes.status)) failures++;
  const rawInv = itemsRes.json;
  const items = Array.isArray(rawInv)
    ? asArray<{ id: number; price?: number }>(rawInv)
    : rawInv && typeof rawInv === "object" && "data" in rawInv && Array.isArray((rawInv as { data: unknown }).data)
      ? asArray<{ id: number; price?: number }>((rawInv as { data: unknown }).data)
      : [];
  const firstItem = items[0];
  if (!firstItem?.id) {
    console.log("  ✗ Missing inventory items; run npm run db:seed");
    exitTest(1);
  }

  const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requisitionBody: Record<string, unknown> = {
    supplierId,
    requiredDate,
    notes: "Demo E2E requisition",
    items: [
      {
        itemId: firstItem.id,
        quantity: 2,
        unitPrice: Number(firstItem.price ?? 10),
      },
    ],
  };
  if (departmentId) requisitionBody.departmentId = departmentId;

  const requisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: requisitionBody,
  });
  if (!expectStatus("POST /api/purchase-requisitions", 201, requisitionRes.status)) failures++;
  const requisition = asRecord(requisitionRes.json);
  const requisitionId = Number(requisition.id ?? 0);
  if (!requisitionId) {
    console.log("  ✗ Requisition was not created.");
    exitTest(1);
  }

  const approveRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/approve", 200, approveRes.status)) failures++;

  const histRes = await apiJsonRequest(`/approval-history/requisition/${requisitionId}`, {
    method: "GET",
    cookie: adminCookie,
  });
  if (!expectStatus("GET /api/approval-history/requisition/:id", 200, histRes.status)) failures++;

  const convertRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/convert`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/convert", 201, convertRes.status)) failures++;
  const po = asRecord(convertRes.json);
  const poId = Number(po.id ?? 0);
  const poNumber = String(po.orderNumber ?? "");
  if (!poId || !poNumber) {
    console.log("  ✗ PO conversion did not return id/orderNumber.");
    exitTest(1);
  }

  const poItemsRes = await apiJsonRequest(`/purchase-orders/${poId}/items`, { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/purchase-orders/:id/items", 200, poItemsRes.status)) failures++;
  const poItems = asArray<{ id: number; quantity: number; receivedQuantity?: number | null }>(poItemsRes.json);
  for (const line of poItems) {
    const remaining = Number(line.quantity ?? 0) - Number(line.receivedQuantity ?? 0);
    if (remaining <= 0) continue;
    const recvRes = await apiJsonRequest(`/purchase-order-items/${line.id}/receive`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        receivedQuantity: remaining,
        receiverName: "Demo Receiver",
        warehouseLocation: "RCV-01",
        receivedAt: new Date().toISOString(),
      },
    });
    if (!expectStatus(`POST /api/purchase-order-items/${line.id}/receive`, 200, recvRes.status)) failures++;
  }

  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const total = Number(firstItem.price ?? 10) * 2;
  const invoiceCreateRes = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie: adminCookie,
    body: {
      invoiceNumber: `INV-DEMO-${Date.now().toString().slice(-8)}`,
      supplierId,
      purchaseOrderId: poId,
      issueDate: issueDate.toISOString(),
      dueDate: dueDate.toISOString(),
      subtotal: total,
      total,
      paidAmount: 0,
      dueAmount: total,
      createdBy,
      items: [
        {
          itemId: firstItem.id,
          description: "Demo line",
          quantity: 2,
          unitPrice: Number(firstItem.price ?? 10),
          totalPrice: total,
        },
      ],
    },
  });
  if (!expectStatus("POST /api/invoices", 201, invoiceCreateRes.status)) failures++;
  const invoice = asRecord(invoiceCreateRes.json);
  const invoiceId = Number(invoice.id ?? 0);
  if (!invoiceId) {
    console.log("  ✗ Invoice creation did not return id.");
    exitTest(1);
  }

  const matchRes = await apiJsonRequest(`/invoices/${invoiceId}/match`, { method: "POST", cookie: adminCookie });
  if (!expectStatus("POST /api/invoices/:id/match", 200, matchRes.status)) failures++;
  const matchRoot = asRecord(matchRes.json);
  const matchPayload =
    matchRoot.ok === true && matchRoot.data && typeof matchRoot.data === "object"
      ? asRecord(matchRoot.data)
      : matchRoot;
  if (typeof matchPayload.matched !== "boolean") {
    console.log("  ✗ Match response missing boolean `matched`");
    failures++;
  } else {
    const mm = asArray(matchPayload.mismatches);
    console.log(
      "  ✓ 3-way match payload: matched=%s mismatchCount=%d status=%s",
      matchPayload.matched,
      mm.length,
      String(matchPayload.status ?? ""),
    );
  }

  const paymentRes = await apiJsonRequest(`/invoices/${invoiceId}/payments`, {
    method: "POST",
    cookie: adminCookie,
    body: {
      amount: Number((total / 2).toFixed(2)),
      method: "BANK_TRANSFER",
      transactionReference: `DEMO-PAY-${Date.now().toString().slice(-6)}`,
      receivedBy: createdBy,
      notes: "Demo payment",
    },
  });
  if (!expectStatus("POST /api/invoices/:invoiceId/payments", 201, paymentRes.status)) failures++;

  const poPdfRes = await apiRawRequest("/export/purchase_orders/pdf", { method: "GET", cookie: adminCookie });
  const poPdfBuf = await poPdfRes.arrayBuffer();
  if (!expectStatus("GET /api/export/purchase_orders/pdf", 200, poPdfRes.status)) failures++;
  const poPdfMagic =
    String.fromCharCode(...new Uint8Array(poPdfBuf.slice(0, 5))) === "%PDF-" && poPdfBuf.byteLength > 200;
  if (poPdfMagic) {
    console.log("  ✓ PO PDF export (size=%d)", poPdfBuf.byteLength);
  } else {
    console.log("  ✗ PO PDF export missing %%PDF- or too small");
    failures++;
  }

  const logsRes = await apiJsonRequest("/activity-logs?limit=20", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/activity-logs?limit=20", 200, logsRes.status)) failures++;
  const logs = asArray(logsRes.json);
  console.log("  ✓ Legacy activity-logs sample count: %d", logs.length);

  const opsActRes = await apiJsonRequest("/activity?limit=10", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/activity?limit=10", 200, opsActRes.status)) failures++;
  const opsRoot = asRecord(opsActRes.json);
  const opsRows = opsRoot.ok === true && Array.isArray(opsRoot.data) ? opsRoot.data : asArray(opsActRes.json);
  console.log("  ✓ Operational /api/activity sample count: %d", opsRows.length);

  const sugRes = await apiJsonRequest(
    "/approval-suggestions?entityType=requisition&amount=100",
    { method: "GET", cookie: adminCookie },
  );
  if (!expectStatus("GET /api/approval-suggestions (preview)", 200, sugRes.status)) failures++;

  console.log("\nDemo result: %d failure(s)", failures);
  printUiGaps();
  exitTest(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", getTestBaseUrl());
    printUiGaps();
    exitTest(0);
  }
  console.error(err);
  exitTest(1);
});
