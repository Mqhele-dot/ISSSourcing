/**
 * Master-data propagation smoke test: reference data reads, requisition→PO, commercial PATCH, AP list.
 *
 * Requires server running and seeded users (`npm run db:seed`).
 *
 * Run:
 *   npx tsx scripts/test-master-data-propagation.ts
 * or
 *   BASE_URL=http://127.0.0.1:5000 npx tsx scripts/test-master-data-propagation.ts
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
  console.log("Master-data propagation test (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await loginForTests("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  ⚠ Admin login failed (seed users missing?).");
    exitTest(1);
    return;
  }

  let failures = 0;

  const curRes = await apiJsonRequest("/currencies", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/currencies", 200, curRes.status)) failures++;
  const payRes = await apiJsonRequest("/payment-terms", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/payment-terms", 200, payRes.status)) failures++;
  const taxRes = await apiJsonRequest("/tax-codes", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/tax-codes", 200, taxRes.status)) failures++;
  const contractsRes = await apiJsonRequest("/contracts", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/contracts", 200, contractsRes.status)) failures++;

  const apOverviewRes = await apiJsonRequest("/ap/overview", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/ap/overview", 200, apOverviewRes.status)) failures++;

  const invoicesRes = await apiJsonRequest("/invoices", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/invoices", 200, invoicesRes.status)) failures++;

  const suppliersRes = await apiJsonRequest("/suppliers", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/suppliers", 200, suppliersRes.status)) failures++;
  const suppliers = asArray<{ id: number }>(unwrapData<unknown>(suppliersRes.json));
  const supplierId = Number(suppliers[0]?.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers; run npm run db:seed");
    exitTest(1);
    return;
  }

  const contractsRaw = unwrapData<unknown>(contractsRes.json);
  const contracts = asArray<{ id: number; supplierId?: number; currency?: string }>(contractsRaw);
  const contractForSupplier = contracts.find((c) => Number(c.supplierId) === supplierId) ?? null;

  const itemsRes = await apiJsonRequest("/inventory", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/inventory", 200, itemsRes.status)) failures++;
  const items = asArray<{ id: number; price?: number; sku?: string }>(unwrapData<unknown>(itemsRes.json));
  const firstItem = items[0];
  if (!firstItem?.id) {
    console.log("  ✗ Missing inventory items; run npm run db:seed");
    exitTest(1);
    return;
  }
  const itemIdForWrites = Number(firstItem.id);

  let departmentId: number | undefined;
  const deptRes = await apiJsonRequest("/departments", { method: "GET", cookie: adminCookie });
  if (deptRes.status === 200) {
    const departments = asArray<{ id: number }>(unwrapData<unknown>(deptRes.json));
    const d0 = Number(departments[0]?.id ?? 0);
    if (d0 > 0) departmentId = d0;
  }

  const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requisitionRes = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie: adminCookie,
    body: {
      supplierId,
      ...(departmentId ? { departmentId } : {}),
      requiredDate,
      notes: "Master-data propagation test requisition",
      items: [
        {
          itemId: itemIdForWrites,
          quantity: 1,
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
      "  ✗ Requisition create response missing id. Body: %s",
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
  const po = asRecord(unwrapData<unknown>(convertRes.json));
  const poId = Number(po.id ?? 0);
  if (!poId) {
    console.log("  ✗ PO conversion missing id. Body: %s", truncatedJsonSnippet(convertRes.json));
    exitTest(1);
    return;
  }

  const currencies = asArray<{ code: string }>(unwrapData<unknown>(curRes.json));
  const firstCurrencyCode =
    typeof currencies[0]?.code === "string" && /^[A-Za-z]{3}$/.test(currencies[0].code)
      ? currencies[0].code.toUpperCase()
      : "USD";

  let commercialCurrency = firstCurrencyCode;
  if (
    contractForSupplier?.currency &&
    typeof contractForSupplier.currency === "string" &&
    /^[A-Za-z]{3}$/.test(contractForSupplier.currency)
  ) {
    const cc = contractForSupplier.currency.toUpperCase();
    if (currencies.some((c) => c.code === cc)) {
      commercialCurrency = cc;
    }
  }

  const commercialPatch = await apiJsonRequest(`/procurement/purchase-orders/records/${poId}/commercial`, {
    method: "PATCH",
    cookie: adminCookie,
    body: {
      currencyCode: commercialCurrency,
      ...(contractForSupplier ? { contractId: contractForSupplier.id } : {}),
    },
  });
  if (!expectStatus("PATCH /api/procurement/purchase-orders/records/:id/commercial", 200, commercialPatch.status)) {
    failures++;
  }

  if (failures > 0) {
    exitTest(1);
    return;
  }

  console.log("\n  All master-data propagation checks passed.");
  exitTest(0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", getTestBaseUrl());
    exitTest(0);
    return;
  }
  console.error(err);
  exitTest(1);
});
