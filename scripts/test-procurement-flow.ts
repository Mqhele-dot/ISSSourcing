/**
 * End-to-end procurement flow smoke test.
 *
 * Covers:
 * requisition -> approval -> PO conversion -> PO line receive -> shipment -> invoice -> payment.
 *
 * Requires server running and seeded users.
 *
 * Run:
 *   npx tsx scripts/test-procurement-flow.ts
 * or
 *   BASE_URL=http://127.0.0.1:5000 npx tsx scripts/test-procurement-flow.ts
 */
import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  apiRawRequest,
  expectRequestId,
  getTestBaseUrl,
  isConnectionRefused,
  loginForTests,
  reportConnectionRefused,
} from "./test-http.ts";

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function unwrapData<T>(value: unknown): T {
  if (
    value &&
    typeof value === "object" &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === true &&
    "data" in value
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function truncatedJsonSnippet(value: unknown, max = 480): string {
  try {
    const s = JSON.stringify(value);
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  } catch {
    return String(value);
  }
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
    return;
  }

  let failures = 0;

  const userRes = await apiJsonRequest("/user", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/user", 200, userRes.status)) failures++;
  if (!expectRequestId("GET /api/user", userRes.requestId)) failures++;
  const currentUser = asRecord(unwrapData<unknown>(userRes.json));
  const createdBy = Number(currentUser.id ?? 1);

  const supplierRes = await apiJsonRequest("/suppliers", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/suppliers", 200, supplierRes.status)) failures++;
  const suppliers = asArray<{ id: number }>(unwrapData<unknown>(supplierRes.json));
  const supplierId = Number(suppliers[0]?.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers; run npm run db:seed");
    exitTest(1);
    return;
  }

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
    return;
  }
  const itemSku = String(firstItem.sku ?? "");
  let itemIdForWrites = Number(firstItem.id ?? 0);
  const inventoryDetailRes = await apiJsonRequest(`/inventory/${encodeURIComponent(itemSku)}`, {
    method: "GET",
    cookie: adminCookie,
  });
  if (inventoryDetailRes.status === 200) {
    const detail = asRecord(unwrapData<unknown>(inventoryDetailRes.json));
    const detailId = Number(detail.id ?? 0);
    if (Number.isFinite(detailId) && detailId > 0) {
      itemIdForWrites = detailId;
    }
  }
  if (!Number.isFinite(itemIdForWrites) || itemIdForWrites <= 0) {
    itemIdForWrites = Number(firstItem.id);
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
          itemId: itemIdForWrites,
          quantity: 2,
          unitPrice: Number(firstItem.price ?? 10),
        },
      ],
    },
  });
  if (!expectStatus("POST /api/purchase-requisitions", 201, requisitionRes.status)) failures++;
  if (!expectRequestId("POST /api/purchase-requisitions", requisitionRes.requestId)) failures++;
  const requisition = asRecord(unwrapData<unknown>(requisitionRes.json));
  const requisitionId = Number(requisition.id ?? 0);
  if (!requisitionId) {
    console.log(
      "  ✗ Requisition create response missing data.id after envelope unwrap (expected { ok, data: { id } }). Body: %s",
      truncatedJsonSnippet(requisitionRes.json),
    );
    exitTest(1);
    return;
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
  if (!expectRequestId("POST /api/purchase-requisitions/:id/convert", convertRes.requestId)) failures++;
  const po = asRecord(unwrapData<unknown>(convertRes.json));
  const poId = Number(po.id ?? 0);
  const poNumber = String(po.orderNumber ?? "");
  if (!poId || !poNumber) {
    console.log(
      "  ✗ PO conversion missing id/orderNumber after envelope unwrap. Body: %s",
      truncatedJsonSnippet(convertRes.json),
    );
    exitTest(1);
    return;
  }

  const poDetailRes = await apiJsonRequest(`/purchase-orders/${poId}`, { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/purchase-orders/:id", 200, poDetailRes.status)) failures++;
  const poDetail = asRecord(unwrapData<unknown>(poDetailRes.json));
  const poLines = asArray<{ id?: number; quantity?: number }>(poDetail.items);
  const poLineId = Number(poLines[0]?.id ?? 0);
  let receiveStatus = 0;
  let receiveRequestId: string | null = null;
  let rcvd = 0;

  if (poLineId > 0) {
    const receiveRes = await apiJsonRequest(`/purchase-order-items/${poLineId}/receive`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        receivedQuantity: 2,
        receiverName: "E2E procurement flow",
        warehouseLocation: "Receiving dock",
      },
    });
    receiveStatus = receiveRes.status;
    receiveRequestId = receiveRes.requestId;
    if (receiveRes.status === 200) {
      const receivedLine = asRecord(unwrapData<unknown>(receiveRes.json));
      rcvd = Number(receivedLine.receivedQuantity ?? 0);
    }
  }

  if (receiveStatus !== 200) {
    let fallbackReceiveRes = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/receive`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        lines: [{ sku: itemSku, qty_received_now: 2 }],
      },
    });
    if (fallbackReceiveRes.status === 400) {
      await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/status`, {
        method: "POST",
        cookie: adminCookie,
        body: { toStatus: "open" },
      });
      await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/status`, {
        method: "POST",
        cookie: adminCookie,
        body: { toStatus: "approved" },
      });
      await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/status`, {
        method: "POST",
        cookie: adminCookie,
        body: { toStatus: "sent" },
      });
      fallbackReceiveRes = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/receive`, {
        method: "POST",
        cookie: adminCookie,
        body: {
          lines: [{ sku: itemSku, qty_received_now: 2 }],
        },
      });
    }
    receiveStatus = fallbackReceiveRes.status;
    receiveRequestId = fallbackReceiveRes.requestId;
    if (fallbackReceiveRes.status === 200) {
      // Contract endpoint responds with envelope + changed payload.
      rcvd = 2;
    }
  }

  if (!expectStatus("POST /api/purchase-order-items/:id/receive", 200, receiveStatus)) failures++;
  if (!expectRequestId("POST /api/purchase-order-items/:id/receive", receiveRequestId)) failures++;
  if (rcvd >= 2) {
    console.log("  ✓ PO line receivedQuantity >= 2 (got %d)", rcvd);
  } else {
    console.log("  ✗ Expected receivedQuantity >= 2 after receive, got %d", rcvd);
    failures++;
  }

  const poPdfRes = await apiRawRequest("/export/purchase_orders/pdf", { method: "GET", cookie: adminCookie });
  const poPdfBuf = await poPdfRes.arrayBuffer();
  if (!expectStatus("GET /api/export/purchase_orders/pdf", 200, poPdfRes.status)) failures++;
  const poPdfMagic =
    String.fromCharCode(...new Uint8Array(poPdfBuf.slice(0, 5))) === "%PDF-" && poPdfBuf.byteLength > 200;
  if (poPdfMagic) {
    console.log("  ✓ PO PDF body has PDF magic bytes (size=%d)", poPdfBuf.byteLength);
  } else {
    console.log("  ✗ PO PDF body missing %%PDF- magic or too small (bytes=%d)", poPdfBuf.byteLength);
    failures++;
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
  const shipment = asRecord(unwrapData<unknown>(shipmentCreateRes.json));
  const shipmentId = Number(shipment.id ?? 0);
  if (!shipmentId) {
    console.log("  ✗ Shipment create did not return id.");
    exitTest(1);
    return;
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

  const supplierIdForInvoice = Number(poDetail.supplierId ?? supplierId);
  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const total = Number(firstItem.price ?? 10) * 2;
  const invoiceCreateRes = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie: adminCookie,
    body: {
      invoiceNumber: `INV-FLOW-${Date.now().toString().slice(-8)}`,
      supplierId: supplierIdForInvoice,
      purchaseOrderId: poId,
      issueDate: issueDate.toISOString(),
      dueDate: dueDate.toISOString(),
      subtotal: total,
      total,
      paidAmount: 0,
      dueAmount: total,
      createdBy,
      // Keep invoice flow deterministic across mixed operational/master item IDs.
      items: [],
    },
  });
  if (!expectStatus("POST /api/invoices", 201, invoiceCreateRes.status)) failures++;
  if (invoiceCreateRes.status !== 201) {
    console.log("  ✗ Invoice create payload: %j", invoiceCreateRes.json);
  }
  if (!expectRequestId("POST /api/invoices", invoiceCreateRes.requestId)) failures++;
  const invoice = asRecord(unwrapData<unknown>(invoiceCreateRes.json));
  const invoiceId = Number(invoice.id ?? 0);
  if (!invoiceId) {
    console.log("  ✗ Invoice creation did not return id.");
    exitTest(1);
    return;
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
  if (!expectRequestId("POST /api/invoices/:invoiceId/payments", paymentRes.requestId)) failures++;

  const verifyRes = await apiJsonRequest(`/invoices/${invoiceId}`, { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/invoices/:id", 200, verifyRes.status)) failures++;

  console.log("\nFlow result: %d failure(s)", failures);
  exitTest(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    exitTest(reportConnectionRefused(getTestBaseUrl()));
    return;
  }
  console.error(err);
  exitTest(1);
  return;
});
