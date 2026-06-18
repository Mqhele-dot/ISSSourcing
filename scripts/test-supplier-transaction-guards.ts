import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
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
  if (actual === expected) {
    console.log("  ok %s -> %d", name, actual);
    return true;
  }
  console.log("  X %s -> expected %d, got %d", name, expected, actual);
  return false;
}

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("Supplier transaction guard test (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await loginForTests("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  X Admin login failed (seed users missing?).");
    exitTest(1);
    return;
  }

  let failures = 0;

  const currenciesRes = await apiJsonRequest("/currencies", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/currencies", 200, currenciesRes.status)) failures++;
  const currencies = asArray<{ code?: string }>(unwrapData(currenciesRes.json));
  const currencyCode =
    String(currencies.find((row) => typeof row.code === "string")?.code ?? "USD").trim().toUpperCase() || "USD";

  const inventoryRes = await apiJsonRequest("/inventory", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/inventory", 200, inventoryRes.status)) failures++;
  const inventory = asArray<{ id?: number; price?: number }>(unwrapData(inventoryRes.json));
  const itemId = Number(inventory[0]?.id ?? 0);
  const itemPrice = Number(inventory[0]?.price ?? 10);
  if (!itemId) {
    console.log("  X Missing inventory seed data.");
    exitTest(1);
    return;
  }

  const supplierName = `Guard Supplier ${Date.now()}`;
  const createSupplierRes = await apiJsonRequest("/suppliers", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: supplierName,
      email: `guard-${Date.now()}@example.com`,
      defaultCurrencyCode: currencyCode,
      notes: "Created by supplier transaction guard test",
    },
  });
  if (!expectStatus("POST /api/suppliers", 201, createSupplierRes.status)) failures++;
  const supplier = asRecord(unwrapData(createSupplierRes.json));
  const supplierId = Number(supplier.id ?? 0);
  if (!supplierId) {
    console.log("  X Supplier creation did not return id.");
    exitTest(1);
    return;
  }

  const requisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      requiredDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      notes: "Guard requisition",
      items: [
        {
          itemId,
          quantity: 1,
          unitPrice: itemPrice,
        },
      ],
    },
  });
  if (!expectStatus("POST /api/purchase-requisitions", 201, requisitionRes.status)) failures++;
  const requisition = asRecord(unwrapData(requisitionRes.json));
  const requisitionId = Number(requisition.id ?? 0);
  if (!requisitionId) {
    console.log("  X Requisition creation did not return id.");
    exitTest(1);
    return;
  }

  const approveReqRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/approve", 200, approveReqRes.status)) failures++;

  const captureBeforeBlockRes = await apiJsonRequest("/ap/captures", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      invoiceNumber: `CAP-PROMOTE-GUARD-${Date.now().toString().slice(-6)}`,
      issueDate: new Date().toISOString(),
      totalAmount: itemPrice,
      currencyCode,
      source: "manual_upload",
      status: "READY_TO_PROMOTE",
      extractedLines: [
        {
          itemId,
          quantity: 1,
          unitPrice: itemPrice,
          totalPrice: itemPrice,
        },
      ],
    },
  });
  if (!expectStatus("POST /api/ap/captures (active supplier)", 201, captureBeforeBlockRes.status)) failures++;
  const captureBeforeBlock = asRecord(unwrapData(captureBeforeBlockRes.json));
  const captureBeforeBlockId = Number(captureBeforeBlock.id ?? 0);
  if (!captureBeforeBlockId) {
    console.log("  X Capture creation did not return id before supplier block.");
    exitTest(1);
    return;
  }

  const blockSupplierRes = await apiJsonRequest(`/suppliers/${supplierId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: {
      status: "inactive",
      complianceStatus: "blocked",
      blockedReason: "Supplier onboarding hold",
    },
  });
  if (!expectStatus("PATCH /api/suppliers/:id", 200, blockSupplierRes.status)) failures++;

  const blockedPoRes = await apiJsonRequest("/purchase-orders", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      items: [
        {
          itemId,
          quantity: 1,
          unitPrice: itemPrice,
        },
      ],
    },
  });
  if (!expectStatus("POST /api/purchase-orders blocks inactive supplier", 409, blockedPoRes.status)) failures++;

  const blockedRequisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      requiredDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      notes: "Blocked supplier requisition should fail",
      items: [
        {
          itemId,
          quantity: 1,
          unitPrice: itemPrice,
        },
      ],
    },
  });
  if (!expectStatus("POST /api/purchase-requisitions blocks inactive supplier", 409, blockedRequisitionRes.status)) {
    failures++;
  }

  const blockedConvertRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/convert`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/convert blocks inactive supplier", 409, blockedConvertRes.status)) {
    failures++;
  }

  const blockedInvoiceRes = await apiJsonRequest("/invoices", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      invoiceNumber: `INV-GUARD-${Date.now().toString().slice(-6)}`,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      subtotal: itemPrice,
      total: itemPrice,
      dueAmount: itemPrice,
      paidAmount: 0,
      items: [
        {
          itemId,
          quantity: 1,
          unitPrice: itemPrice,
        },
      ],
    },
  });
  if (!expectStatus("POST /api/invoices blocks inactive supplier", 409, blockedInvoiceRes.status)) failures++;

  const blockedCaptureRes = await apiJsonRequest("/ap/captures", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      invoiceNumber: `CAP-GUARD-${Date.now().toString().slice(-6)}`,
      issueDate: new Date().toISOString(),
      totalAmount: itemPrice,
      currencyCode,
      status: "captured",
      extractedPayload: {},
    },
  });
  if (!expectStatus("POST /api/ap/captures blocks inactive supplier", 409, blockedCaptureRes.status)) failures++;

  const blockedCapturePromoteRes = await apiJsonRequest(`/ap/captures/${captureBeforeBlockId}/promote`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/ap/captures/:id/promote blocks inactive supplier", 409, blockedCapturePromoteRes.status)) {
    failures++;
  }

  console.log("\nSupplier transaction guard result: %d failure(s)", failures);
  exitTest(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.log("  ! Server not reachable at %s. Start with: npm run dev", getTestBaseUrl());
    exitTest(0);
    return;
  }
  console.error(err);
  exitTest(1);
});
