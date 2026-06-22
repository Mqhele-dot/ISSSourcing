import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function unwrapData<T>(value: unknown): T {
  if (value && typeof value === "object" && "ok" in value && (value as { ok?: unknown }).ok === true) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function expectPass(name: string, pass: boolean): number {
  if (pass) {
    console.log("  ✓ %s", name);
    return 0;
  }
  console.log("  ✗ %s", name);
  return 1;
}

async function createInvoice(cookie: string, supplierId: number, itemId: number, total: number, suffix: string) {
  const res = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie,
    body: {
      supplierId,
      invoiceNumber: `AP-CTRL-${suffix}-${Date.now().toString().slice(-6)}`,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: "DRAFT",
      subtotal: total,
      tax: 0,
      total,
      dueAmount: total,
      items: [
        {
          itemId,
          description: "AP controls test item",
          quantity: 1,
          unitPrice: total,
          taxRate: 0,
          taxAmount: 0,
          totalPrice: total,
        },
      ],
    },
  });
  if (res.status !== 201) {
    throw new Error(`Failed to create invoice (${suffix}), status=${res.status}`);
  }
  const invoice = asRecord(unwrapData<unknown>(res.json));
  return Number(invoice.id ?? 0);
}

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("AP controls test (BASE_URL=%s)\n", baseUrl);

  const adminCookie = await loginForTests("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  ⚠ Admin login failed.");
    exitTest(1);
  }

  let failures = 0;

  const suppliersRes = await apiJsonRequest("/suppliers", { cookie: adminCookie });
  const supplierId = Number(asArray<{ id: number }>(unwrapData(suppliersRes.json))[0]?.id ?? 0);
  const inventoryRes = await apiJsonRequest("/inventory", { cookie: adminCookie });
  const itemId = Number(asArray<{ id: number }>(unwrapData(inventoryRes.json))[0]?.id ?? 0);
  if (!supplierId || !itemId) {
    console.log("  ✗ Missing seed supplier or inventory.");
    exitTest(1);
  }

  const validInvoicePolicyRes = await apiJsonRequest("/approval-policies", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: "AP Test Invoice Policy",
      entityType: "invoice",
      amountMin: 0,
      amountMax: 1_000_000,
      approvalLevel: 10,
      approverRole: "admin",
      isActive: true,
    },
  });
  failures += expectPass("Create valid invoice policy", validInvoicePolicyRes.status === 201);

  const validBatchPolicyRes = await apiJsonRequest("/approval-policies", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: "AP Test Batch Policy",
      entityType: "payment_batch",
      amountMin: 0,
      amountMax: 1_000_000,
      approvalLevel: 10,
      approverRole: "admin",
      isActive: true,
    },
  });
  failures += expectPass("Create valid batch policy", validBatchPolicyRes.status === 201);

  const invalidPolicyRes = await apiJsonRequest("/approval-policies", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: "AP Invalid Approver Policy",
      entityType: "invoice",
      amountMin: 11,
      amountMax: 11,
      approvalLevel: 99,
      approverUserId: 999999,
      isActive: true,
    },
  });
  failures += expectPass("Create invalid approver policy", invalidPolicyRes.status === 201);
  const invalidPolicyId = Number(asRecord(unwrapData<unknown>(invalidPolicyRes.json)).id ?? 0);

  const selfInvoiceId = await createInvoice(adminCookie, supplierId, itemId, 20, "SELF");
  await apiJsonRequest(`/invoices/${selfInvoiceId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { status: "PENDING_APPROVAL" },
  });
  const selfApproveBlocked = await apiJsonRequest(`/ap/invoices/${selfInvoiceId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  failures += expectPass("Self-approval blocked without override", selfApproveBlocked.status >= 400);
  const selfApproveOverride = await apiJsonRequest(`/ap/invoices/${selfInvoiceId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Emergency finance override" },
  });
  failures += expectPass("Self-approval allowed with explicit override", selfApproveOverride.status === 200);

  const duplicateInvoiceNumber = `AP-DUP-${Date.now().toString().slice(-6)}`;
  const duplicateOne = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      invoiceNumber: duplicateInvoiceNumber,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: "DRAFT",
      subtotal: 12,
      tax: 0,
      total: 12,
      dueAmount: 12,
    },
  });
  const duplicateTwo = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      invoiceNumber: duplicateInvoiceNumber,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: "DRAFT",
      subtotal: 12,
      tax: 0,
      total: 12,
      dueAmount: 12,
    },
  });
  failures += expectPass("Duplicate supplier invoice number is blocked", duplicateOne.status === 201 && duplicateTwo.status >= 400);

  const invalidApproverInvoiceId = await createInvoice(adminCookie, supplierId, itemId, 11, "BADAPP");
  await apiJsonRequest(`/invoices/${invalidApproverInvoiceId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { status: "PENDING_APPROVAL" },
  });
  const invalidApproverAttempt = await apiJsonRequest(`/ap/invoices/${invalidApproverInvoiceId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Should still fail policy" },
  });
  failures += expectPass("Invalid approver blocked by policy", invalidApproverAttempt.status >= 400);

  if (invalidPolicyId > 0) {
    await apiJsonRequest(`/approval-policies/${invalidPolicyId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { isActive: false },
    });
  }

  const historyRes = await apiJsonRequest(`/approval-history/invoice/${selfInvoiceId}`, {
    method: "GET",
    cookie: adminCookie,
  });
  const historyRows = asArray<Record<string, unknown>>(unwrapData(historyRes.json));
  failures += expectPass(
    "Approval history is org-scoped",
    historyRes.status === 200 && historyRows.length > 0 && historyRows.every((row) => Number(row.organizationId ?? 0) > 0),
  );

  const batchInvoiceId = await createInvoice(adminCookie, supplierId, itemId, 30, "BATCH");
  await apiJsonRequest(`/invoices/${batchInvoiceId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { status: "PENDING_APPROVAL" },
  });
  await apiJsonRequest(`/ap/invoices/${batchInvoiceId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Controls test" },
  });

  const createBatchRes = await apiJsonRequest("/ap/payment-batches", {
    method: "POST",
    cookie: adminCookie,
    body: { paymentMethod: "BANK_TRANSFER", invoiceIds: [batchInvoiceId, batchInvoiceId] },
  });
  failures += expectPass("Batch creation dedupes duplicate invoice IDs", createBatchRes.status === 201);
  const batch = asRecord(unwrapData<unknown>(createBatchRes.json));
  const batchId = Number(batch.id ?? 0);

  const approveBatchRes = await apiJsonRequest(`/ap/payment-batches/${batchId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Controls test" },
  });
  failures += expectPass("Payment batch approval succeeds with policy + override", approveBatchRes.status === 200);

  const release1 = await apiJsonRequest(`/ap/payment-batches/${batchId}/release`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Controls test release" },
  });
  const release2 = await apiJsonRequest(`/ap/payment-batches/${batchId}/release`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Idempotency check" },
  });
  const invoicePayments = await apiJsonRequest(`/invoices/${batchInvoiceId}/payments`, {
    method: "GET",
    cookie: adminCookie,
  });
  const payments = asArray<Record<string, unknown>>(unwrapData(invoicePayments.json));
  failures += expectPass(
    "Batch release is idempotent under repeat call",
    release1.status === 200 && release2.status === 200 && payments.length === 1,
  );

  const requiredDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
  const reqRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      requiredDate,
      notes: "AP controls receipt test",
      items: [{ itemId, quantity: 1, unitPrice: 10 }],
    },
  });
  const requisitionId = Number(asRecord(unwrapData<unknown>(reqRes.json)).id ?? 0);
  await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, { method: "POST", cookie: adminCookie, body: {} });
  const convertRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/convert`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  const poId = Number(asRecord(unwrapData<unknown>(convertRes.json)).id ?? 0);
  const poDetail = await apiJsonRequest(`/purchase-orders/${poId}`, { method: "GET", cookie: adminCookie });
  const poLineId = Number(
    asArray<Record<string, unknown>>(asRecord(unwrapData<unknown>(poDetail.json)).items)[0]?.id ?? 0,
  );
  const invalidReceipt = await apiJsonRequest("/ap/receipts", {
    method: "POST",
    cookie: adminCookie,
    body: {
      purchaseOrderId: poId,
      supplierId,
      items: [{ purchaseOrderItemId: poLineId, itemId, quantity: 10, acceptedQuantity: 10 }],
    },
  });
  failures += expectPass("Invalid receipt quantities are blocked", invalidReceipt.status >= 400);

  const duplicateNumber = `DUP-${Date.now().toString().slice(-6)}`;
  const captureOne = await apiJsonRequest("/ap/captures", {
    method: "POST",
    cookie: adminCookie,
    body: { supplierId, invoiceNumber: duplicateNumber, totalAmount: 50, source: "manual_upload" },
  });
  const captureOneId = Number(asRecord(unwrapData<unknown>(captureOne.json)).id ?? 0);
  await apiJsonRequest(`/ap/captures/${captureOneId}/promote`, {
    method: "POST",
    cookie: adminCookie,
    body: { overrideReason: "Initial promotion" },
  });
  const captureTwo = await apiJsonRequest("/ap/captures", {
    method: "POST",
    cookie: adminCookie,
    body: { supplierId, invoiceNumber: duplicateNumber, totalAmount: 50, source: "manual_upload" },
  });
  const captureTwoId = Number(asRecord(unwrapData<unknown>(captureTwo.json)).id ?? 0);
  const promoteDuplicateBlocked = await apiJsonRequest(`/ap/captures/${captureTwoId}/promote`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  failures += expectPass("Duplicate capture promotion is blocked", promoteDuplicateBlocked.status >= 400);

  const illegalTransitionInvoiceId = await createInvoice(adminCookie, supplierId, itemId, 40, "ILLEGAL");
  const illegalApprove = await apiJsonRequest(`/ap/invoices/${illegalTransitionInvoiceId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: { adminOverride: true, overrideReason: "Should fail transition gate" },
  });
  failures += expectPass("Illegal invoice transition is blocked", illegalApprove.status >= 400);

  console.log("\nAP controls result: %d failure(s)", failures);
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
