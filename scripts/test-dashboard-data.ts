/**
 * Integration check for GET /api/dashboard/control-tower (needs dev server + DB + auth).
 * Run: npm run test:dashboard-data
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  apiJsonRequest,
  clearSessionCookie,
  getTestBaseUrl,
  isConnectionRefused,
  peekSessionCookie,
} from "./test-http.ts";
import { exitTest } from "./test-exit.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function unwrap<T>(json: unknown, label: string): T {
  if (json && typeof json === "object" && "ok" in json && (json as { ok?: boolean }).ok === true && "data" in json) {
    return (json as { data: T }).data;
  }
  throw new Error(`${label}: expected { ok: true, data }`);
}

async function main() {
  const seed = spawnSync("npm", ["run", "seed:functional-qa"], {
    cwd: repoRoot,
    shell: true,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (seed.status !== 0) {
    console.error("test-dashboard-data: seed:functional-qa failed");
    exitTest(1);
    return;
  }

  clearSessionCookie();
  const login = await apiJsonRequest("/login", {
    method: "POST",
    body: { username: "admin", password: "Admin123!" },
  });
  if (!login.ok) {
    console.error("Login failed:", login.status, login.json);
    exitTest(1);
    return;
  }
  const cookie = peekSessionCookie();

  const res = await apiJsonRequest("/dashboard/control-tower?days=7&area=all", { cookie });
  assert.ok(res.ok, `dashboard GET failed: ${res.status} ${JSON.stringify(res.json)}`);

  const data = unwrap<Record<string, unknown>>(res.json, "dashboard");
  assert.ok(typeof data.generatedAt === "string" && data.generatedAt.length > 0, "generatedAt");
  assert.ok(data.kpis && typeof data.kpis === "object", "kpis");
  assert.ok(Array.isArray(data.procurementPipeline), "procurementPipeline");
  assert.ok(Array.isArray(data.inventoryHealth), "inventoryHealth");
  assert.ok(Array.isArray(data.stockValueByCategory), "stockValueByCategory");
  assert.ok(Array.isArray(data.apAging), "apAging");
  assert.ok(Array.isArray(data.logisticsRisk), "logisticsRisk");
  assert.ok(Array.isArray(data.supplierPerformance), "supplierPerformance");
  assert.ok(Array.isArray(data.operationsTrend), "operationsTrend");
  assert.ok(Array.isArray(data.needsAttention), "needsAttention");
  assert.ok(Array.isArray(data.recentActivity), "recentActivity");
  assert.ok(data.spotlight && typeof data.spotlight === "object", "spotlight");
  const spotlight = data.spotlight as { delayedShipments?: unknown; oldestOpenExceptions?: unknown; supplierRisks?: unknown };
  assert.ok(Array.isArray(spotlight.delayedShipments), "spotlight.delayedShipments");
  assert.ok(Array.isArray(spotlight.oldestOpenExceptions), "spotlight.oldestOpenExceptions");
  assert.ok(Array.isArray(spotlight.supplierRisks), "spotlight.supplierRisks");
  assert.ok(
    (data.recentActivity as unknown[]).length <= 10,
    `recentActivity must be <= 10, got ${(data.recentActivity as unknown[]).length}`,
  );

  console.log("test-dashboard-data: all checks passed.");
  exitTest(0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.error("Server not reachable at", getTestBaseUrl(), "- start with: npm run dev");
    exitTest(1);
    return;
  }
  console.error(err);
  exitTest(1);
});
