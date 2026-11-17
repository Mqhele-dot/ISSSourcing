/**
 * Stricter GET /api/dashboard/control-tower checks (spotlight.supplierRisks, logistics hrefs, area gating).
 * Run: npm run test:control-tower-dashboard
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
    console.error("test-control-tower-dashboard: seed:functional-qa failed");
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
  assert.ok(res.ok, `dashboard GET failed: ${res.status}`);

  const data = unwrap<Record<string, unknown>>(res.json, "dashboard");
  assert.ok(typeof data.generatedAt === "string");
  const spotlight = data.spotlight as {
    delayedShipments?: unknown[];
    oldestOpenExceptions?: unknown[];
    supplierRisks?: unknown[];
  };
  assert.ok(Array.isArray(spotlight.supplierRisks), "spotlight.supplierRisks");

  for (const row of data.logisticsRisk as Array<{ href?: string }>) {
    assert.ok(typeof row.href === "string" && row.href.includes("/operations/logistics"), "logisticsRisk.href");
  }

  const inv = await apiJsonRequest("/dashboard/control-tower?days=7&area=inventory", { cookie });
  assert.ok(inv.ok);
  const invData = unwrap<Record<string, unknown>>(inv.json, "dashboard inventory area");
  assert.equal((invData.procurementPipeline as unknown[]).length, 0, "inventory focus clears procurement pipeline");
  assert.equal(
    (invData.spotlight as typeof spotlight).delayedShipments?.length ?? 0,
    0,
    "inventory focus clears delayed shipments spotlight",
  );

  console.log("test-control-tower-dashboard: all checks passed.");
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
