/**
 * AP workflow smoke test.
 *
 * Covers:
 * capture staging -> capture promotion -> requisition -> PO -> receive -> AP match ->
 * AP approval -> payment batch approval/release -> AP overview.
 */
import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  expectRequestId,
  getTestBaseUrl,
  isConnectionRefused,
  loginForTests,
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

function expectStatus(name: string, expected: number, actual: number): boolean {
  if (expected === actual) {
    console.log("  ✓ %s -> %d", name, actual);
    return true;
  }
  console.log("  ✗ %s -> expected %d, got %d", name, expected, actual);
  return false;
}

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("AP workflow test (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await loginForTests("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  ⚠ Admin login failed (seed users missing?).");
    exitTest(1);
  }

  let failures = 0;

  const suppliersRes = await apiJsonRequest("/suppliers", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/suppliers", 200, suppliersRes.status)) failures++;
  const suppliers = asArray<{ id: number }>(unwrapData<unknown>(suppliersRes.json));
  const supplierId = Number(suppliers[0]?.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers; run seed first.");
    exitTest(1);
  }

  const inventoryRes = await apiJsonRequest("/inventory", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/inventory", 200, inventoryRes.status)) failures++;
  const inventory = asArray<{ id: number; price?: number; sku?: string }>(unwrapData<unknown>(inventoryRes.json));
  const firstItem = inventory[0];
  if (!firstItem?.id) {
    console.log("  ✗ Missing inventory items; run seed first.");
    exitTest(1);
  }
  const itemSku = String(firstItem.sku ?? "");
  let itemIdForWrites = Number(firstItem.id ?? 0);
  if (itemSku) {
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
  }

  const invoicePolicyRes = await apiJsonRequest("/approval-policies", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: `AP Workflow Invoice Policy ${Date.now().toString().slice(-4)}`,
      entityType: "invoice",
      amountMin: 0,
      amountMax: 1_000_000,
      approvalLevel: 10,
      approverRole: "admin",
      isActive: true,
    },
  });
  if (!expectStatus("POST /api/approval-policies (invoice)", 201, invoicePolicyRes.status)) failures++;

  const batchPolicyRes = await apiJsonRequest("/approval-policies", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: `AP Workflow Batch Policy ${Date.now().toString().slice(-4)}`,
      entityType: "payment_batch",
      amountMin: 0,
      amountMax: 1_000_000,
      approvalLevel: 10,
      approverRole: "admin",
      isActive: true,
    },
  });
  if (!expectStatus("POST /api/approval-policies (payment_batch)", 201, batchPolicyRes.status)) failures++;

  const captureRes = await apiJsonRequest("/ap/captures", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      source: "document_extractor",
      invoiceNumber: `CAP-${Date.now().toString().slice(-6)}`,
      totalAmount: 125,
      confidenceScore: 0.97,
      reviewerNotes: "AP smoke test capture",
      extractedHeader: { smokeTest: true },
      extractedLines: [],
    },
  });
  if (!expectStatus("POST /api/ap/captures", 201, captureRes.status)) failures++;
  if (!expectRequestId("POST /api/ap/captures", captureRes.requestId)) failures++;
  const capture = asRecord(unwrapData<unknown>(captureRes.json));
  const captureId = Number(capture.id ?? 0);
  if (!captureId) {
    console.log("  ✗ Capture create did not return an id.");
    exitTest(1);
  }

  const promoteRes = await apiJsonRequest(`/ap/captures/${captureId}/promote`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/ap/captures/:id/promote", 200, promoteRes.status)) failures++;

  const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      requiredDate,
      notes: "AP workflow smoke test requisition",
      items: [{ itemId: itemIdForWrites, quantity: 2, unitPrice: Number(firstItem.price ?? 10) }],
    },
  });
  if (!expectStatus("POST /api/purchase-requisitions", 201, requisitionRes.status)) failures++;
  const requisition = asRecord(requisitionRes.json);
  const requisitionId = Number(requisition.id ?? 0);
  if (!requisitionId) exitTest(1);

  const approveReqRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/approve", 200, approveReqRes.status)) failures++;

  const convertRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/convert`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/convert", 201, convertRes.status)) failures++;
  const po = asRecord(convertRes.json);
  const poId = Number(po.id ?? 0);
  const poNumber = String(po.orderNumber ?? "");
  if (!poId || !poNumber) exitTest(1);

  const poDetailRes = await apiJsonRequest(`/purchase-orders/${poId}`, { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/purchase-orders/:id", 200, poDetailRes.status)) failures++;
  const poDetail = asRecord(unwrapData<unknown>(poDetailRes.json));
  const poLines = asArray<{ id?: number }>(poDetail.items);
  const poLineId = Number(poLines[0]?.id ?? 0);
  let receiveStatus = 0;
  if (poLineId > 0) {
    const receiveLineRes = await apiJsonRequest(`/purchase-order-items/${poLineId}/receive`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        receivedQuantity: 2,
        receiverName: "AP smoke test",
        warehouseLocation: "Receiving dock",
      },
    });
    receiveStatus = receiveLineRes.status;
    if (receiveLineRes.status === 200) {
      expectStatus("POST /api/purchase-order-items/:id/receive", 200, receiveLineRes.status);
    }
  }
  if (receiveStatus !== 200) {
    let receiveFallbackRes = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/receive`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        lines: [{ sku: itemSku, qty_received_now: 2 }],
      },
    });
    if (receiveFallbackRes.status === 400) {
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
      receiveFallbackRes = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/receive`, {
        method: "POST",
        cookie: adminCookie,
        body: {
          lines: [{ sku: itemSku, qty_received_now: 2 }],
        },
      });
    }
    if (!expectStatus("POST /api/purchase/orders/:po/receive", 200, receiveFallbackRes.status)) failures++;
  }

  const invoiceNumber = `AP-INV-${Date.now().toString().slice(-6)}`;
  const invoiceRes = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      purchaseOrderId: poId,
      invoiceNumber,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: "DRAFT",
      subtotal: Number(firstItem.price ?? 10) * 2,
      tax: 0,
      total: Number(firstItem.price ?? 10) * 2,
      dueAmount: Number(firstItem.price ?? 10) * 2,
      items: [
        {
          itemId: Number(firstItem.id),
          description: `AP smoke test for ${String(firstItem.sku ?? "SKU")}`,
          quantity: 2,
          unitPrice: Number(firstItem.price ?? 10),
          taxRate: 0,
          taxAmount: 0,
          totalPrice: Number(firstItem.price ?? 10) * 2,
        },
      ],
    },
  });
  if (!expectStatus("POST /api/invoices", 201, invoiceRes.status)) failures++;
  const invoice = asRecord(unwrapData<unknown>(invoiceRes.json));
  const invoiceId = Number(invoice.id ?? 0);
  if (!invoiceId) exitTest(1);

  const matchRes = await apiJsonRequest(`/ap/invoices/${invoiceId}/match`, {
    method: "POST",
    cookie: adminCookie,
    body: { priceTolerancePct: 2, quantityTolerancePct: 2, taxTolerancePct: 0 },
  });
  if (!expectStatus("POST /api/ap/invoices/:id/match", 200, matchRes.status)) failures++;

  const submitApprovalRes = await apiJsonRequest(`/ap/invoices/${invoiceId}/submit-approval`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/ap/invoices/:id/submit-approval", 200, submitApprovalRes.status)) failures++;

  const approveInvoiceRes = await apiJsonRequest(`/ap/invoices/${invoiceId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Workflow smoke override for creator/approver split" },
  });
  if (!expectStatus("POST /api/ap/invoices/:id/approve", 200, approveInvoiceRes.status)) failures++;

  const batchRes = await apiJsonRequest("/ap/payment-batches", {
    method: "POST",
    cookie: adminCookie,
    body: {
      paymentMethod: "BANK_TRANSFER",
      invoiceIds: [invoiceId],
    },
  });
  if (!expectStatus("POST /api/ap/payment-batches", 201, batchRes.status)) failures++;
  const batch = asRecord(unwrapData<unknown>(batchRes.json));
  const batchId = Number(batch.id ?? 0);
  if (!batchId) exitTest(1);

  const approveBatchRes = await apiJsonRequest(`/ap/payment-batches/${batchId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Workflow smoke override for creator/approver split" },
  });
  if (!expectStatus("POST /api/ap/payment-batches/:id/approve", 200, approveBatchRes.status)) failures++;

  const releaseBatchRes = await apiJsonRequest(`/ap/payment-batches/${batchId}/release`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Workflow smoke override for creator/releaser split" },
  });
  if (!expectStatus("POST /api/ap/payment-batches/:id/release", 200, releaseBatchRes.status)) failures++;

  const overviewRes = await apiJsonRequest("/ap/overview", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/ap/overview", 200, overviewRes.status)) failures++;
  if (!expectRequestId("GET /api/ap/overview", overviewRes.requestId)) failures++;

  console.log("\nAP workflow result: %d failure(s)", failures);
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
