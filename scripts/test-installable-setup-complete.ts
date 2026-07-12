/**
 * Verifies POST /api/setup/product/complete persists settings, org name, warehouse, and starter approval policies.
 * Snapshots org-scoped DB state, temporarily clears product onboarding completion, calls complete, asserts via APIs,
 * then restores app_settings, organizations.name, deletes the created warehouse, and deletes only newly added policies.
 *
 * Run: npx tsx scripts/test-installable-setup-complete.ts
 * Requires: server + DB (same as other scripts/test-*.ts).
 */
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { exitTest } from "./test-exit.ts";
import {
  apiJsonRequest,
  getTestBaseUrl,
  isConnectionRefused,
  isLiveServerRequired,
  loginForTests,
  peekSessionCookie,
  reportConnectionRefused,
} from "./test-http.ts";

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

type AppSnapRow = {
  company_name: string;
  currency_code: string;
  currency_symbol: string | null;
  business_country_code: string | null;
  tax_mode: string;
  enable_vat: boolean | null;
  default_vat_country: string | null;
  show_prices_with_vat: boolean | null;
  date_format: string | null;
  time_format: string | null;
  default_warehouse_id: number | null;
  product_onboarding_completed_at: Date | null;
  product_onboarding_state: unknown;
};

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("Installable setup — product complete API test (BASE_URL=%s)\n", baseUrl);

  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    console.error("DATABASE_URL (or PG*) required to snapshot/restore for this test.");
    exitTest(1);
    return;
  }

  let cookie = await loginForTests("admin", "Admin123!", baseUrl);
  if (!cookie) {
    console.log("  ⚠ Admin login failed. Skipping.");
    exitTest(0);
    return;
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  let orgId = 0;
  let snap: AppSnapRow | null = null;
  let prevOrgName: string | null = null;
  let beforePolicyIds: number[] = [];
  const warehouseName = `InstallableVerify-${Date.now()}`;
  let newPolicyIds: number[] = [];
  let restoreNeeded = false;

  try {
    const st = await apiJsonRequest("/setup/status", { method: "GET", cookie, baseUrl });
    cookie = peekSessionCookie() ?? cookie;
    if (st.status !== 200) {
      console.log("  ✗ GET /api/setup/status → %d (expected 200)", st.status);
      exitTest(1);
      return;
    }
    const stData = unwrapSendOk(st.json);
    const org = stData?.organization as { id?: number } | undefined;
    orgId = typeof org?.id === "number" ? org.id : 0;
    if (!orgId) {
      console.log("  ⚠ No organization in setup status. Skipping.");
      exitTest(0);
      return;
    }

    const sel = await client.query<AppSnapRow>(
      `SELECT company_name, currency_code, currency_symbol, business_country_code, tax_mode,
              enable_vat, default_vat_country, show_prices_with_vat, date_format, time_format,
              default_warehouse_id, product_onboarding_completed_at, product_onboarding_state
       FROM app_settings WHERE organization_id = $1 LIMIT 1`,
      [orgId],
    );
    if (sel.rows.length === 0) {
      console.log("  ⚠ No app_settings row for organization_id=%d. Skipping.", orgId);
      exitTest(0);
      return;
    }
    snap = sel.rows[0]!;

    const orgRow = await client.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1 LIMIT 1`, [orgId]);
    prevOrgName = orgRow.rows[0]?.name ?? null;

    const polSel = await client.query<{ id: number }>(
      `SELECT id FROM approval_policies WHERE organization_id = $1 ORDER BY id`,
      [orgId],
    );
    beforePolicyIds = polSel.rows.map((r) => r.id);

    await client.query(
      `UPDATE app_settings SET product_onboarding_completed_at = NULL, product_onboarding_state = NULL WHERE organization_id = $1`,
      [orgId],
    );
    restoreNeeded = true;

    const completeBody = {
      companyName: "Installable Complete Test Co",
      currencyCode: "USD",
      businessCountryCode: "US",
      taxMode: "none" as const,
      warehouseName,
      dateFormat: "DD/MM/YYYY" as const,
      timeFormat: "hh:mm A" as const,
    };

    const post = await apiJsonRequest("/setup/product/complete", {
      method: "POST",
      cookie,
      baseUrl,
      body: completeBody,
    });
    cookie = peekSessionCookie() ?? cookie;

    if (post.status !== 200) {
      console.log("  ✗ POST /api/setup/product/complete → %d (expected 200)", post.status);
      console.log("  Response:", JSON.stringify(post.json));
      exitTest(1);
      return;
    }
    console.log("  ✓ POST /api/setup/product/complete → 200");

    const st2 = await apiJsonRequest("/setup/status", { method: "GET", cookie, baseUrl });
    cookie = peekSessionCookie() ?? cookie;
    if (st2.status !== 200) {
      console.log("  ✗ GET /api/setup/status (after complete) → %d", st2.status);
      exitTest(1);
      return;
    }
    const st2Data = unwrapSendOk(st2.json);
    const onboarding = st2Data?.onboarding as Record<string, unknown> | undefined;
    const completedAt = onboarding?.completedAt;
    const required = onboarding?.required;
    if (required !== false) {
      console.log("  ✗ onboarding.required expected false, got %s", String(required));
      exitTest(1);
      return;
    }
    if (completedAt == null || completedAt === "") {
      console.log("  ✗ onboarding.completedAt should be set after complete");
      exitTest(1);
      return;
    }
    console.log("  ✓ GET /api/setup/status: onboarding complete + required false");

    const settingsRes = await apiJsonRequest("/settings", { method: "GET", cookie, baseUrl });
    cookie = peekSessionCookie() ?? cookie;
    if (settingsRes.status !== 200) {
      console.log("  ✗ GET /api/settings → %d", settingsRes.status);
      exitTest(1);
      return;
    }
    const settings = settingsRes.json as Record<string, unknown>;
    if (settings.dateFormat !== completeBody.dateFormat) {
      console.log("  ✗ settings.dateFormat mismatch: %s vs %s", String(settings.dateFormat), completeBody.dateFormat);
      exitTest(1);
      return;
    }
    if (settings.timeFormat !== completeBody.timeFormat) {
      console.log("  ✗ settings.timeFormat mismatch: %s vs %s", String(settings.timeFormat), completeBody.timeFormat);
      exitTest(1);
      return;
    }
    console.log("  ✓ GET /api/settings: date/time formats persisted");

    const polRes = await apiJsonRequest("/approval-policies", { method: "GET", cookie, baseUrl });
    cookie = peekSessionCookie() ?? cookie;
    if (polRes.status !== 200) {
      console.log("  ✗ GET /api/approval-policies → %d", polRes.status);
      exitTest(1);
      return;
    }
    const policies = unwrapSendOkArray(polRes.json) as { id?: number; entityType?: string; name?: string }[] | null;
    if (!policies) {
      console.log("  ✗ approval-policies response not sendOk array");
      exitTest(1);
      return;
    }
    const afterIds = policies.map((p) => Number(p.id)).filter((id) => Number.isFinite(id));
    const beforeSet = new Set(beforePolicyIds);
    newPolicyIds = afterIds.filter((id) => !beforeSet.has(id));

    const hasReq = policies.some((p) => p.entityType === "requisition");
    const hasPo = policies.some((p) => p.entityType === "purchase_order");
    if (!hasReq || !hasPo) {
      console.log("  ✗ expected requisition + purchase_order approval policies");
      exitTest(1);
      return;
    }
    if (beforePolicyIds.length === 0) {
      const names = new Set(policies.map((p) => p.name));
      if (!names.has("Requisition Standard Approval") || !names.has("PO High Value Approval")) {
        console.log("  ✗ starter policy names missing when org had no policies before test");
        exitTest(1);
        return;
      }
    }
    console.log("  ✓ GET /api/approval-policies: coverage OK (new ids: %s)", newPolicyIds.join(", ") || "(none)");

    console.log("\nResult: passed (DB state restored).");
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
    try {
      if (restoreNeeded && snap && orgId > 0) {
        const stateParam =
          snap.product_onboarding_state == null || snap.product_onboarding_state === undefined
            ? null
            : JSON.stringify(snap.product_onboarding_state);
        await client.query(
          `UPDATE app_settings SET
             company_name = $2,
             currency_code = $3,
             currency_symbol = $4,
             business_country_code = $5,
             tax_mode = $6,
             enable_vat = $7,
             default_vat_country = $8,
             show_prices_with_vat = $9,
             date_format = $10,
             time_format = $11,
             default_warehouse_id = $12,
             product_onboarding_completed_at = $13,
             product_onboarding_state = $14::jsonb,
             updated_at = NOW()
           WHERE organization_id = $1`,
          [
            orgId,
            snap.company_name,
            snap.currency_code,
            snap.currency_symbol,
            snap.business_country_code,
            snap.tax_mode,
            snap.enable_vat,
            snap.default_vat_country,
            snap.show_prices_with_vat,
            snap.date_format,
            snap.time_format,
            snap.default_warehouse_id,
            snap.product_onboarding_completed_at,
            stateParam,
          ],
        );
        if (prevOrgName != null) {
          await client.query(`UPDATE organizations SET name = $2, updated_at = NOW() WHERE id = $1`, [orgId, prevOrgName]);
        }

        if (newPolicyIds.length > 0) {
          await client.query(`DELETE FROM approval_policies WHERE id = ANY($1::int[])`, [newPolicyIds]);
        }

        await client.query(`DELETE FROM warehouses WHERE organization_id = $1 AND name = $2`, [orgId, warehouseName]);
      }
    } catch (e) {
      console.error("Failed to restore DB state after installable complete test:", e);
    } finally {
      await client.end().catch(() => {});
    }
  }
}

main();
