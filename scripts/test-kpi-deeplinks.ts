import fs from "node:fs/promises";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function withNoTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function extractErrorMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    (payload as { ok: unknown }).ok === false &&
    "error" in payload
  ) {
    const error = (payload as { error?: { code?: string; message?: string } }).error;
    if (error?.code || error?.message) {
      return `[${error.code ?? "UNKNOWN"}] ${error.message ?? "Unknown error"}`;
    }
  }

  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return JSON.stringify(payload);
}

async function waitForHealthy(baseUrl: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // waiting for startup
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for health endpoint at ${baseUrl}/health`);
}

async function assertHomeKpiLinks() {
  const source = await fs.readFile("/workspace/client/src/pages/home.tsx", "utf8");
  const required = [
    `exceptions: "/exceptions?status=open&severity=high"`,
    `logistics: "/logistics?status=in_transit&risk=late"`,
    `purchase: "/purchase?status=approved"`,
    `inventory: "/inventory?low=1"`,
  ];
  for (const snippet of required) {
    assert(source.includes(snippet), `Missing KPI deep link snippet: ${snippet}`);
  }
}

async function main() {
  await assertHomeKpiLinks();

  const baseUrl = withNoTrailingSlash(process.env.BASE_URL ?? "http://127.0.0.1:5000");
  const apiBase = withNoTrailingSlash(process.env.API_BASE ?? `${baseUrl}/api`);
  let cookie = "";

  const request = async (
    url: string,
    options?: { method?: string; body?: unknown },
  ): Promise<{ ok: boolean; status: number; json: any }> => {
    const response = await fetch(url, {
      method: options?.method ?? "GET",
      headers: {
        ...(options?.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(";")[0];
    }
    const json = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  };

  const requestApi = (
    path: string,
    options?: { method?: string; body?: unknown },
  ) => request(`${apiBase}${path.startsWith("/") ? path : `/${path}`}`, options);

  await waitForHealthy(baseUrl, 120_000);

  const loginPrimary = await requestApi("/auth/login", {
    method: "POST",
    body: { username: "admin", password: "Admin123!" },
  });
  let login = loginPrimary;
  if (!login.ok && login.status === 404) {
    login = await requestApi("/login", {
      method: "POST",
      body: { username: "admin", password: "Admin123!" },
    });
  }
  assert(login.ok, `Login failed: ${login.status} ${extractErrorMessage(login.json)}`);

  const walkthrough = await requestApi("/demo/walkthrough/run", {
    method: "POST",
    body: {},
  });
  assert(
    walkthrough.ok,
    `Walkthrough setup failed: ${walkthrough.status} ${extractErrorMessage(walkthrough.json)}`,
  );

  const exceptions = await requestApi("/exceptions?status=open&severity=high");
  assert(exceptions.ok && exceptions.json?.ok === true, "Exceptions filter endpoint failed");
  for (const row of exceptions.json.data as Array<{ status: string; severity: string }>) {
    assert(row.status === "open", "Exceptions filter did not apply status=open");
    assert(row.severity === "high", "Exceptions filter did not apply severity=high");
  }

  const logistics = await requestApi("/logistics/shipments?status=in_transit&risk=late");
  assert(logistics.ok && logistics.json?.ok === true, "Logistics filter endpoint failed");
  for (const row of logistics.json.data as Array<{ status: string; atRisk: boolean }>) {
    assert(row.status === "in_transit", "Logistics filter did not apply status=in_transit");
    assert(row.atRisk === true, "Logistics filter did not apply risk=late");
  }

  const purchase = await requestApi("/purchase/orders?status=approved");
  assert(purchase.ok && purchase.json?.ok === true, "Purchase filter endpoint failed");
  for (const row of purchase.json.data as Array<{ status: string }>) {
    assert(row.status === "approved", "Purchase filter did not apply status=approved");
  }

  const inventory = await requestApi("/inventory?low=1");
  assert(inventory.ok && inventory.json?.ok === true, "Inventory low filter endpoint failed");
  for (const row of inventory.json.data as Array<{ available: number; lowStockThreshold: number }>) {
    assert(
      row.available <= row.lowStockThreshold,
      "Inventory filter did not enforce low=1",
    );
  }

  console.log("✅ KPI deep-link test passed");
}

main().catch((error) => {
  console.error("❌ KPI deep-link test failed:", error);
  process.exit(1);
});
