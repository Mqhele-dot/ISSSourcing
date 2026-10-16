#!/usr/bin/env npx tsx
/**
 * Adds app_settings columns required by the installable product / setup wizard when a dev DB
 * predates Drizzle push (avoids interactive drizzle-kit prompts).
 *
 * Run: npm run db:ensure-installable-app-settings
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

const STATEMENTS = [
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD'`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS business_country_code text DEFAULT 'US'`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'none'`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS product_onboarding_completed_at timestamp`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS product_onboarding_state jsonb`,
];

async function main() {
  const url = resolveDatabaseUrl();
  if (!url) {
    console.error("Set DATABASE_URL (or PGHOST/PGPORT/PGDATABASE/PGUSER) to run this script.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const sql of STATEMENTS) {
      await client.query(sql);
    }
    console.log("app_settings installable columns verified (added or already present).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
