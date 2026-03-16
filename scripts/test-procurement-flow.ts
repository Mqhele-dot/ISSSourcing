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

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
const API = `${BASE_URL}/api`;

type HttpResult = { status: number; ok: boolean; json: unknown };

let lastCookie: string | undefined;

async function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string },
): Promise<HttpResult> {
  const url = path.startsWith("http") ? path : `${API}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) lastCookie = setCookie.split(";")[0];
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, json };
}

async function login(username: string, password: string): Promise<string | undefined> {
  lastCookie = undefined;
  await request("/auth/login", { method: "POST", body: { username, password } });
  if (!lastCookie) {
    await request("/login", { method: "POST", body: { username, password } });
  }
  return lastCookie;
}

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
  console.log("Procurement flow test (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await login("admin", "Admin123!");
  if (!adminCookie) {
    console.log("  ⚠ Admin login failed (seed users missing?).");
    process.exit(1);
  }

  let failures = 0;

  const userRes = await request("/user", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/user", 200, userRes.status)) failures++;
  const currentUser = asRecord(userRes.json);
  const createdBy = Number(currentUser.id ?? 1);

  const supplierRes = await request("/suppliers", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/suppliers", 200, supplierRes.status)) failures++;
  const suppliers = asArray<{ id: number }>(supplierRes.json);
  const supplierId = Number(suppliers[0]?.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers; run npm run db:seed");
    process.exit(1);
  }

  const itemsRes = await request("/inventory", { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/inventory", 200, itemsRes.status)) failures++;
  const items = asArray<{ id: number; price?: number }>(itemsRes.json);
  const firstItem = items[0];
  if (!firstItem?.id) {
    console.log("  ✗ Missing inventory items; run npm run db:seed");
    process.exit(1);
  }

  const requiredDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requisitionRes = await request("/purchase-requisitions", {
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
    process.exit(1);
  }

  const approveRes = await request(`/purchase-requisitions/${requisitionId}/approve`, {
    method: "POST",
    cookie: adminCookie,
    body: {},
  });
  if (!expectStatus("POST /api/purchase-requisitions/:id/approve", 200, approveRes.status)) failures++;

  const convertRes = await request(`/purchase-requisitions/${requisitionId}/convert`, {
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
    process.exit(1);
  }

  const shipmentCreateRes = await request("/logistics/shipments", {
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
    process.exit(1);
  }

  const inTransitRes = await request(`/logistics/shipments/${shipmentId}/status`, {
    method: "POST",
    cookie: adminCookie,
    body: { toStatus: "in_transit", note: "Flow test status update" },
  });
  if (!expectStatus("POST /api/logistics/shipments/:id/status (in_transit)", 200, inTransitRes.status)) failures++;

  const deliveredRes = await request(`/logistics/shipments/${shipmentId}/status`, {
    method: "POST",
    cookie: adminCookie,
    body: { toStatus: "delivered", note: "Flow test delivered" },
  });
  if (!expectStatus("POST /api/logistics/shipments/:id/status (delivered)", 200, deliveredRes.status)) failures++;

  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const total = Number(firstItem.price ?? 10) * 2;
  const invoiceCreateRes = await request("/invoices", {
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
    process.exit(1);
  }

  const paymentRes = await request(`/invoices/${invoiceId}/payments`, {
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

  const verifyRes = await request(`/invoices/${invoiceId}`, { method: "GET", cookie: adminCookie });
  if (!expectStatus("GET /api/invoices/:id", 200, verifyRes.status)) failures++;

  console.log("\nFlow result: %d failure(s)", failures);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  const cause = (err as NodeJS.ErrnoException & { cause?: { code?: string } })?.cause;
  if (cause?.code === "ECONNREFUSED") {
    console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", BASE_URL);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

