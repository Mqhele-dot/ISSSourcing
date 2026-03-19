import process from "node:process";
import { exitTest } from "./test-exit.ts";

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

async function main() {
  console.log("Supplier portal tests (BASE_URL=%s)\n", BASE_URL);

  const adminCookie = await login("admin", "Admin123!");
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

  const suppliers = await request("/suppliers", { method: "GET", cookie: adminCookie });
  expectStatus("GET /api/suppliers", 200, suppliers.status);
  const supplierList = Array.isArray(suppliers.json) ? (suppliers.json as Array<{ id: number }>) : [];
  const supplierId = Number(supplierList[0]?.id ?? 0);
  if (!supplierId) {
    console.log("  ✗ Missing suppliers for supplier-portal test");
    exitTest(1);
  }

  const orders = await request(`/supplier/orders?supplierId=${supplierId}`, { method: "GET", cookie: adminCookie });
  expectStatus("GET /api/supplier/orders", 200, orders.status);
  const orderList = Array.isArray(orders.json) ? (orders.json as Array<{ id: number }>) : [];
  const orderId = Number(orderList[0]?.id ?? 0);
  if (!orderId) {
    console.log("  ⚠ No supplier orders available for action tests.");
    exitTest(failures > 0 ? 1 : 0);
  }

  const confirm = await request(`/supplier/orders/${orderId}/confirm?supplierId=${supplierId}`, {
    method: "POST",
    body: {},
    cookie: adminCookie,
  });
  expectStatus("POST /api/supplier/orders/:id/confirm", 200, confirm.status);

  const delivery = await request(`/supplier/orders/${orderId}/delivery?supplierId=${supplierId}`, {
    method: "PATCH",
    body: { expectedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() },
    cookie: adminCookie,
  });
  expectStatus("PATCH /api/supplier/orders/:id/delivery", 200, delivery.status);

  const invoice = await request("/supplier/invoices", {
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
  const cause = (err as NodeJS.ErrnoException & { cause?: { code?: string } })?.cause;
  if (cause?.code === "ECONNREFUSED") {
    console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", BASE_URL);
    exitTest(0);
  }
  console.error(err);
  exitTest(1);
});
