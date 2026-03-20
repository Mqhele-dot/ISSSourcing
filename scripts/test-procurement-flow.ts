/**
 * End-to-end procurement flow smoke test.
 *
 * Covers:
 * requisition -> approval -> PO conversion -> shipment -> invoice -> payment.
 *
 * Requires server running and seeded users.
 *
 * Run:
 *   npx tsx scripts/test-procurement-flow.ts
 * or
 *   BASE_URL=http://127.0.0.1:5000 npx tsx scripts/test-procurement-flow.ts
 */
import process from "node:process";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

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

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("Procurement flow test (BASE_URL=%s)\n", BASE_URL);

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

  const itemsRes = await apiJsonRequest("/inventory", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/inventory", 200, itemsRes.status)) failures++;
  const items = asArray<{ id: number; price?: number }>(itemsRes.json);
  const firstItem = items[0];
  if (!firstItem?.id) {
    console.log("  ✗ Missing inventory items; run npm run db:seed");
    exitTest(1);
  }

  const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      requiredDate,
      notes: "E2E procurement flow requisition",
      items: [
        {
          itemId: firstItem.id,
          quantity: 2,
          unitPrice: Number(firstItem.price ?? 10),
        },
      ],
    },
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

  const shipmentCreateRes = await apiJsonRequest("/logistics/shipments", {
    method: "POST",
    cookie: adminCookie,
    body: {
      poNumber,
      carrier: "Demo Carrier",
      eta: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  if (!expectStatus("POST /api/logistics/shipments", 201, shipmentCreateRes.status)) failures++;
  const shipment = asRecord(shipmentCreateRes.json);
  const shipmentId = Number(shipment.id ?? 0);
  if (!shipmentId) {
    console.log("  ✗ Shipment create did not return id.");
    exitTest(1);
  }

  const inTransitRes = await apiJsonRequest(`/logistics/shipments/${shipmentId}/status`, {
    method: "POST",
    cookie: adminCookie,
    body: { toStatus: "in_transit", note: "Flow test status update" },
  });
  if (!expectStatus("POST /api/logistics/shipments/:id/status (in_transit)", 200, inTransitRes.status)) failures++;

  const deliveredRes = await apiJsonRequest(`/logistics/shipments/${shipmentId}/status`, {
    method: "POST",
    cookie: adminCookie,
    body: { toStatus: "delivered", note: "Flow test delivered" },
  });
  if (!expectStatus("POST /api/logistics/shipments/:id/status (delivered)", 200, deliveredRes.status)) failures++;

  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const total = Number(firstItem.price ?? 10) * 2;
  const invoiceCreateRes = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie: adminCookie,
    body: {
      invoiceNumber: `INV-FLOW-${Date.now().toString().slice(-8)}`,
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
          description: "Flow test line",
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

  const paymentRes = await apiJsonRequest(`/invoices/${invoiceId}/payments`, {
    method: "POST",
    cookie: adminCookie,
    body: {
      amount: Number((total / 2).toFixed(2)),
      method: "BANK_TRANSFER",
      transactionReference: `FLOW-PAY-${Date.now().toString().slice(-6)}`,
      receivedBy: createdBy,
      notes: "Flow test payment",
    },
  });
  if (!expectStatus("POST /api/invoices/:invoiceId/payments", 201, paymentRes.status)) failures++;

  const verifyRes = await apiJsonRequest(`/invoices/${invoiceId}`, { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/invoices/:id", 200, verifyRes.status)) failures++;

  console.log("\nFlow result: %d failure(s)", failures);
  exitTest(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", getTestBaseUrl());
    exitTest(0);
  }
  console.error(err);
  exitTest(1);
});

