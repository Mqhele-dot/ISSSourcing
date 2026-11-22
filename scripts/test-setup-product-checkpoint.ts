/**
 * Verifies PUT /api/setup/product/checkpoint persists draft + step and GET /api/setup/status reflects it.
 * Temporarily clears product onboarding completion for org 1, then restores previous DB values.
 *
 * Run: npx tsx scripts/test-setup-product-checkpoint.ts
 * Requires: server + DB (same as other scripts/test-*.ts).
 */
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

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
  if (o.ok === true && o.data && typeof o.data === "object") return o.data as Record<string, unknown>;
  return null;
}

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("Setup product checkpoint API test (BASE_URL=%s)\n", baseUrl);

  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    console.error("DATABASE_URL (or PG*) required to restore app_settings after test.");
    exitTest(1);
    return;
  }

  const cookie = await loginForTests("admin", "Admin123!", baseUrl);
  if (!cookie) {
    console.log("  ⚠ Admin login failed. Skipping.");
    exitTest(0);
    return;
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  let prevCompletedAt: Date | null | undefined;
  let prevState: unknown | undefined;
  let restoreNeeded = false;

  try {
    const sel = await client.query<{
      product_onboarding_completed_at: Date | null;
      product_onboarding_state: unknown;
    }>(`SELECT product_onboarding_completed_at, product_onboarding_state FROM app_settings WHERE organization_id = 1 LIMIT 1`);

    if (sel.rows.length === 0) {
      console.log("  ⚠ No app_settings row for organization_id=1. Skipping.");
      exitTest(0);
      return;
    }

    prevCompletedAt = sel.rows[0].product_onboarding_completed_at ?? null;
    prevState = sel.rows[0].product_onboarding_state ?? null;

    await client.query(
      `UPDATE app_settings SET product_onboarding_completed_at = NULL, product_onboarding_state = NULL WHERE organization_id = 1`,
    );
    restoreNeeded = true;

    const put = await apiJsonRequest("/setup/product/checkpoint", {
      method: "PUT",
      cookie,
      baseUrl,
      body: {
        step: "business",
        draft: { companyName: "CheckpointApiTestCo" },
      },
    });

    if (put.status !== 200) {
      console.log("  ✗ PUT /api/setup/product/checkpoint → %d (expected 200)", put.status);
      exitTest(1);
      return;
    }
    console.log("  ✓ PUT /api/setup/product/checkpoint → 200");

    const get = await apiJsonRequest("/setup/status", { method: "GET", cookie, baseUrl });
    if (get.status !== 200) {
      console.log("  ✗ GET /api/setup/status → %d (expected 200)", get.status);
      exitTest(1);
      return;
    }

    const data = unwrapSendOk(get.json);
    const onboarding = data?.onboarding as Record<string, unknown> | undefined;
    const checkpoint = onboarding?.checkpoint as Record<string, unknown> | undefined;

    if (!checkpoint || typeof checkpoint !== "object") {
      console.log("  ✗ setup status missing onboarding.checkpoint");
      exitTest(1);
      return;
    }
    if (checkpoint.step !== "business") {
      console.log("  ✗ checkpoint.step expected business, got %s", String(checkpoint.step));
      exitTest(1);
      return;
    }
    const draft = checkpoint.draft as Record<string, unknown> | undefined;
    if (!draft || draft.companyName !== "CheckpointApiTestCo") {
      console.log("  ✗ checkpoint.draft.companyName mismatch");
      exitTest(1);
      return;
    }

    console.log("  ✓ GET /api/setup/status includes checkpoint step + draft");
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
      if (restoreNeeded && prevCompletedAt !== undefined) {
        const stateParam = prevState == null || prevState === undefined ? null : JSON.stringify(prevState);
        await client.query(
          `UPDATE app_settings SET product_onboarding_completed_at = $1, product_onboarding_state = $2::jsonb WHERE organization_id = 1`,
          [prevCompletedAt, stateParam],
        );
      }
    } catch (e) {
      console.error("Failed to restore app_settings onboarding columns:", e);
    } finally {
      await client.end().catch(() => {});
    }
  }
}

main();
