/**
 * DB helpers for Playwright tests that need a reversible product-onboarding row mutation.
 * Loads `.env` / `.env.local` like other maintenance scripts.
 */
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

config({ path: path.join(process.cwd(), ".env") });
config({ path: path.join(process.cwd(), ".env.local") });

export function resolveE2EDatabaseUrl(): string | undefined {
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

export type ProductOnboardingSnap = {
  completedAt: Date | null;
  state: unknown;
};

export async function readProductOnboardingForOrg(
  client: pg.Client,
  organizationId: number,
): Promise<ProductOnboardingSnap | undefined> {
  const r = await client.query<{
    product_onboarding_completed_at: Date | null;
    product_onboarding_state: unknown;
  }>(
    `SELECT product_onboarding_completed_at, product_onboarding_state
     FROM app_settings WHERE organization_id = $1 LIMIT 1`,
    [organizationId],
  );
  if (r.rows.length === 0) return undefined;
  const row = r.rows[0]!;
  return {
    completedAt: row.product_onboarding_completed_at ?? null,
    state: row.product_onboarding_state ?? null,
  };
}

export async function writeProductOnboardingForOrg(
  client: pg.Client,
  organizationId: number,
  snap: ProductOnboardingSnap,
): Promise<void> {
  const stateParam =
    snap.state === null || snap.state === undefined ? null : JSON.stringify(snap.state);
  await client.query(
    `UPDATE app_settings
     SET product_onboarding_completed_at = $1,
         product_onboarding_state = $2::jsonb
     WHERE organization_id = $3`,
    [snap.completedAt, stateParam, organizationId],
  );
}
