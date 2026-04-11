/**
 * Supplier portal API smoke test (confirm, delivery, invoice).
 * Uses scripts/test-http.ts. If no POs exist for the supplier, creates requisition → approve → convert
 * so the important steps always run (empty list is not treated as success).
 */
import process from "node:process";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

/**
 * Ensures at least one purchase order exists for the supplier (admin/manager + ?supplierId=).
 */
async function ensureSupplierPurchaseOrder(adminCookie: string, supplierId: number): Promise<number | null> {
  const initial = await apiJsonRequest(`/supplier/orders?supplierId=${supplierId}`, { method: "GET", cookie: adminCookie });
  if (initial.status !== 200) return null;
  let orders = asArray<{ id: number }>(unwrapData<unknown>(initial.json));
  let orderId = Number(orders[0]?.id ?? 0);
  if (orderId) return orderId;

  const itemsRes = await apiJsonRequest("/inventory", { method: "GET", cookie: adminCookie });
  if (itemsRes.status !== 200) return null;
  const items = asArray<{ id: number; price?: number }>(unwrapData<unknown>(itemsRes.json));
  const firstItem = items[0];
  if (!firstItem?.id) return null;

  const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      requiredDate,
      notes: "ensureSupplierPurchaseOrder (supplier portal integration test)",
      items: [{ itemId: firstItem.id, quantity: 1, unitPrice: Number(firstItem.price ?? 10) }],
    },
  });
  if (requisitionRes.status !== 201) {
    console.log("  ✗ ensureSupplierPurchaseOrder: POST requisition -> %d", requisitionRes.status);
    return null;
  }
  const req = requisitionRes.json as { id?: number };
  const requisitionId = Number(req.id ?? 0);
  if (!requisitionId) return null;

  const approveRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (approveRes.status !== 200) {
    console.log("  ✗ ensureSupplierPurchaseOrder: approve -> %d", approveRes.status);
    return null;
  }

  const convertRes = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/convert`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (convertRes.status !== 201) {
    console.log("  ✗ ensureSupplierPurchaseOrder: convert -> %d", convertRes.status);
    return null;
  }

  const again = await apiJsonRequest(`/supplier/orders?supplierId=${supplierId}`, { method: "GET", cookie: adminCookie });
  if (again.status !== 200) return null;
  orders = asArray<{ id: number }>(unwrapData<unknown>(again.json));
  orderId = Number(orders[0]?.id ?? 0);
  return orderId || null;
}

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("Supplier portal tests (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await loginForTests("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  ⚠ Admin login failed (seed users missing?).");
    exitTest(1);
  }

  let failures = 0;
  const expectStatus = (name: string, expected: number, actual: number) => {
    if (expected === actual) {
      console.log("  ✓ %s -> %d", name, actual);
    } else {
      failures++;
      console.log("  ✗ %s -> expected %d, got %d", name, expected, actual);
    }
  };

  const suppliers = await apiJsonRequest("/suppliers", { method: "GET", cookie: adminCookie });
  expectStatus("GET /api/suppliers", 200, suppliers.status);
  const supplierList = asArray<{ id: number }>(unwrapData<unknown>(suppliers.json));
  const supplierId = Number(supplierList[0]?.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers for supplier-portal test");
    exitTest(1);
  }

  const orders = await apiJsonRequest(`/supplier/orders?supplierId=${supplierId}`, { method: "GET", cookie: adminCookie });
  expectStatus("GET /api/supplier/orders", 200, orders.status);

  const orderId = await ensureSupplierPurchaseOrder(adminCookie, supplierId);
  if (!orderId) {
    console.log("  ✗ Could not obtain a supplier purchase order (create requisition → approve → convert).");
    exitTest(1);
  }
  console.log("  ✓ Using purchase order id %d for portal actions", orderId);

  const confirm = await apiJsonRequest(`/supplier/orders/${orderId}/confirm?supplierId=${supplierId}`, {
    method: "POST",
    body: {},
    cookie: adminCookie,
  });
  expectStatus("POST /api/supplier/orders/:id/confirm", 200, confirm.status);

  const delivery = await apiJsonRequest(`/supplier/orders/${orderId}/delivery?supplierId=${supplierId}`, {
    method: "PATCH",
    body: { expectedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() },
    cookie: adminCookie,
  });
  expectStatus("PATCH /api/supplier/orders/:id/delivery", 200, delivery.status);

  const invoice = await apiJsonRequest("/supplier/invoices", {
    method: "POST",
    body: {
      purchaseOrderId: orderId,
      supplierId,
      invoiceNumber: `SUP-INV-${Date.now().toString().slice(-6)}`,
      total: 100,
      subtotal: 100,
      tax: 0,
      discount: 0,
    },
    cookie: adminCookie,
  });
  expectStatus("POST /api/supplier/invoices", 201, invoice.status);

  console.log("\nSupplier portal result: %d failure(s)", failures);
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
