#!/usr/bin/env npx tsx
/**
 * Ensures product onboarding is marked complete so E2E can reach routes behind ProductOnboardingGate.
 * Idempotent. Uses the same DB resolution as other maintenance scripts.
 *
 * Set SKIP_E2E_PRODUCT_ONBOARDING_PREP=1 to skip (not recommended for local runs).
 */
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

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

async function main() {
  if (process.env.SKIP_E2E_PRODUCT_ONBOARDING_PREP === "1") {
    console.log("e2e-prep: skipped (SKIP_E2E_PRODUCT_ONBOARDING_PREP=1)");
    return;
  }
  const url = resolveDatabaseUrl();
  if (!url) {
    console.error("e2e-prep: DATABASE_URL (or PG*) not set; cannot prepare DB.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const r = await client.query(`
      UPDATE app_settings
      SET product_onboarding_completed_at = NOW(),
          product_onboarding_state = NULL
      WHERE product_onboarding_completed_at IS NULL
    `);
    console.log(`e2e-prep: product onboarding marked complete where needed (rows=${r.rowCount ?? 0}).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
