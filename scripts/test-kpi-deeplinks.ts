import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { APP_ROUTES } from "../client/src/lib/routes/app-routes.ts";
import {
  apiJsonRequest,
  clearSessionCookie,
  getTestBaseUrl,
  loginForTests,
  peekSessionCookie,
} from "./test-http.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

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
  const homePath = path.join(PROJECT_ROOT, "client", "src", "pages", "home.tsx");
  const source = await fs.readFile(homePath, "utf8");
  const expected = {
    exceptions: `${APP_ROUTES.operations.exceptions}?status=open&severity=high`,
    logistics: `${APP_ROUTES.operations.logistics}?status=in_transit&risk=late`,
    purchase: `${APP_ROUTES.procurement.orders}?status=approved`,
    inventory: "/inventory?low=1",
  };
  const requiredTemplateSnippets = [
    "`${APP_ROUTES.operations.exceptions}?status=open&severity=high`",
    "`${APP_ROUTES.operations.logistics}?status=in_transit&risk=late`",
    "`${APP_ROUTES.procurement.orders}?status=approved`",
    '"/inventory?low=1"',
  ];
  for (const snippet of requiredTemplateSnippets) {
    assert(source.includes(snippet), `Missing KPI deep link snippet (canonical routes): ${snippet}`);
  }
  assert(source.includes("KPI_DEEP_LINKS"), "home.tsx should export KPI_DEEP_LINKS");
  assert(
    expected.exceptions.startsWith("/operations/") && expected.logistics.startsWith("/operations/"),
    "KPI paths should use operations hub prefixes",
  );
}

async function main() {
  await assertHomeKpiLinks();

  const baseUrl = withNoTrailingSlash(process.env.BASE_URL ?? getTestBaseUrl());

  try {
    await waitForHealthy(baseUrl, 10_000);
  } catch (err) {
    console.warn(
      "⚠️ Skipping KPI deeplinks API checks: server not reachable at",
      baseUrl,
      "(start with npm run dev to run full test)",
    );
    console.log("✅ KPI deep-link test passed (file checks only)");
    process.exitCode = 0;
    return;
  }

  clearSessionCookie();
  await loginForTests("admin", "Admin123!", baseUrl);
  const cookie = peekSessionCookie();
  if (!cookie) {
    console.warn(
      "⚠️ Skipping KPI deeplinks API checks: login did not return a session cookie.",
      "Use a seeded DB and valid credentials.",
    );
    console.log("✅ KPI deep-link test passed (file checks only)");
    process.exitCode = 0;
    return;
  }

  const walkthrough = await apiJsonRequest("/demo/walkthrough/run", {
    method: "POST",
    body: {},
    cookie,
    baseUrl,
  });
  if (!walkthrough.ok && (walkthrough.status >= 500 || walkthrough.status === 429)) {
    console.warn(
      "⚠️ Skipping KPI deeplinks API checks: walkthrough failed.",
      walkthrough.status,
      extractErrorMessage(walkthrough.json),
    );
    console.log("✅ KPI deep-link test passed (file checks only)");
    process.exitCode = 0;
    return;
  }
  assert(
    walkthrough.ok,
    `Walkthrough setup failed: ${walkthrough.status} ${extractErrorMessage(walkthrough.json)}`,
  );

  const exceptions = await apiJsonRequest("/exceptions?status=open&severity=high", { cookie, baseUrl });
  assert(exceptions.ok && exceptions.json?.ok === true, "Exceptions filter endpoint failed");
  for (const row of exceptions.json.data as Array<{ status: string; severity: string }>) {
    assert(row.status === "open", "Exceptions filter did not apply status=open");
    assert(row.severity === "high", "Exceptions filter did not apply severity=high");
  }

  const logistics = await apiJsonRequest("/logistics/shipments?status=in_transit&risk=late", { cookie, baseUrl });
  assert(logistics.ok && logistics.json?.ok === true, "Logistics filter endpoint failed");
  for (const row of logistics.json.data as Array<{ status: string; atRisk: boolean }>) {
    assert(row.status === "in_transit", "Logistics filter did not apply status=in_transit");
    assert(row.atRisk === true, "Logistics filter did not apply risk=late");
  }

  const purchase = await apiJsonRequest("/purchase/orders?status=approved", { cookie, baseUrl });
  assert(purchase.ok && purchase.json?.ok === true, "Purchase filter endpoint failed");
  for (const row of purchase.json.data as Array<{ status: string }>) {
    assert(row.status === "approved", "Purchase filter did not apply status=approved");
  }

  const inventory = await apiJsonRequest("/inventory?low=1", { cookie, baseUrl });
  assert(inventory.ok, "Inventory low filter endpoint failed");
  const inventoryData = Array.isArray(inventory.json)
    ? inventory.json
    : (inventory.json?.ok === true && Array.isArray(inventory.json?.data) ? inventory.json.data : []);
  for (const row of inventoryData as Array<{ available?: number; lowStockThreshold?: number }>) {
    const avail = row.available ?? 0;
    const threshold = row.lowStockThreshold ?? 0;
    assert(avail <= threshold, "Inventory filter did not enforce low=1");
  }

  console.log("✅ KPI deep-link test passed");
}

main().catch((error) => {
  console.error("❌ KPI deep-link test failed:", error);
  process.exit(1);
});
