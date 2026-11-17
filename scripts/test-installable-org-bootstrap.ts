/**
 * Opt-in integration test for a literally empty `organizations` table (disposable / first-run DB only).
 * When any organization exists, exits 0 immediately. When none exist, requires RUN_EMPTY_ORG_BOOTSTRAP_TEST=1,
 * then POST /api/onboarding/bootstrap and POST /api/setup/product/complete for the new org session.
 *
 * Does not restore DB state — use only against a throwaway database.
 *
 * Run: RUN_EMPTY_ORG_BOOTSTRAP_TEST=1 npx tsx scripts/test-installable-org-bootstrap.ts
 */
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests, peekSessionCookie } from "./test-http.ts";

config({ path: path.join(process.cwd(), ".env") });
config({ path: path.join(process.cwd(), ".env.local") });

function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.PGHOST;
  const port = process.env.PGPORT;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  if (host && port && database && user) {
    const credentials = `${encodeURIComponent(user)}:${encodeURIComponent((password ?? "").replace(/^"(.*)"$/, "$1"))}`;
    return `postgresql://${credentials}@${host}:${port}/${database}`;
  }
  return undefined;
}

function unwrapSendOk(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.ok === true && o.data && typeof o.data === "object" && !Array.isArray(o.data)) return o.data as Record<string, unknown>;
  return null;
}

function unwrapSendOkArray(json: unknown): unknown[] | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.ok === true && Array.isArray(o.data)) return o.data;
  return null;
}

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("Installable org bootstrap API test (BASE_URL=%s)\n", baseUrl);

  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    console.error("DATABASE_URL (or PG*) required to check organizations count.");
    exitTest(1);
    return;
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const cnt = await client.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM organizations`);
    const n = Number(cnt.rows[0]?.c ?? "0");
    if (n > 0) {
      console.log("  ⏭ organizations count=%d — skipping (not an empty-DB scenario).", n);
      exitTest(0);
      return;
    }

    if (process.env.RUN_EMPTY_ORG_BOOTSTRAP_TEST !== "1") {
      console.log("  ⏭ Empty organizations table but RUN_EMPTY_ORG_BOOTSTRAP_TEST=1 not set — skipping.");
      exitTest(0);
      return;
    }

    let cookie = await loginForTests("admin", "Admin123!", baseUrl);
    if (!cookie) {
      console.error("  ✗ Admin login failed (seed user required for empty-org bootstrap test).");
      exitTest(1);
      return;
    }

    const slugBase = `boot-${Date.now()}`;
    const boot = await apiJsonRequest("/onboarding/bootstrap", {
      method: "POST",
      cookie,
      baseUrl,
      body: { name: `Bootstrap Verify ${Date.now()}`, slug: slugBase },
    });
    cookie = peekSessionCookie() ?? cookie;
    if (boot.status !== 201) {
      console.log("  ✗ POST /api/onboarding/bootstrap → %d (expected 201)", boot.status);
      console.log("  Response:", JSON.stringify(boot.json));
      exitTest(1);
      return;
    }
    console.log("  ✓ POST /api/onboarding/bootstrap → 201");

    const st = await apiJsonRequest("/setup/status", { method: "GET", cookie, baseUrl });
    cookie = peekSessionCookie() ?? cookie;
    const stData = unwrapSendOk(st.json);
    const org = stData?.organization as { id?: number } | undefined;
    const orgId = typeof org?.id === "number" ? org.id : 0;
    if (!orgId) {
      console.log("  ✗ setup status missing organization after bootstrap");
      exitTest(1);
      return;
    }

    const warehouseName = `BootstrapWh-${Date.now()}`;
    const completeBody = {
      companyName: "Bootstrap Complete Co",
      currencyCode: "USD",
      businessCountryCode: "US",
      taxMode: "none" as const,
      warehouseName,
      dateFormat: "YYYY-MM-DD" as const,
      timeFormat: "HH:mm" as const,
    };

    const post = await apiJsonRequest("/setup/product/complete", {
      method: "POST",
      cookie,
      baseUrl,
      body: completeBody,
    });
    cookie = peekSessionCookie() ?? cookie;
    if (post.status !== 200) {
      console.log("  ✗ POST /api/setup/product/complete → %d", post.status);
      console.log("  Response:", JSON.stringify(post.json));
      exitTest(1);
      return;
    }
    console.log("  ✓ POST /api/setup/product/complete → 200");

    const st2 = await apiJsonRequest("/setup/status", { method: "GET", cookie, baseUrl });
    const st2Data = unwrapSendOk(st2.json);
    const onboarding = st2Data?.onboarding as Record<string, unknown> | undefined;
    if (onboarding?.required !== false || onboarding?.completedAt == null) {
      console.log("  ✗ onboarding not marked complete after wizard");
      exitTest(1);
      return;
    }

    const settingsRes = await apiJsonRequest("/settings", { method: "GET", cookie, baseUrl });
    const settings = settingsRes.json as Record<string, unknown>;
    if (settings.dateFormat !== completeBody.dateFormat || settings.timeFormat !== completeBody.timeFormat) {
      console.log("  ✗ settings date/time format mismatch after complete");
      exitTest(1);
      return;
    }

    const polRes = await apiJsonRequest("/approval-policies", { method: "GET", cookie, baseUrl });
    const policies = unwrapSendOkArray(polRes.json) as { entityType?: string }[] | null;
    if (!policies?.some((p) => p.entityType === "requisition") || !policies.some((p) => p.entityType === "purchase_order")) {
      console.log("  ✗ missing starter approval policies");
      exitTest(1);
      return;
    }

    console.log("\nResult: passed (empty-DB bootstrap + complete; DB left as-is).");
    exitTest(0);
  } catch (err) {
    if (isConnectionRefused(err)) {
      console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", baseUrl);
      exitTest(0);
      return;
    }
    console.error(err);
    exitTest(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
