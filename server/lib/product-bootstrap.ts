import { pool } from "../db";

/**
 * Hints for packaged / installable deployments: empty DB after migrations means first-run onboarding
 * may be required (no org row yet, or orgs exist but app was never configured).
 */
export type ProductBootstrapHints = {
  organizationCount: number;
  /** True when there is no organization row — typical fresh install before seed/onboarding. */
  needsFirstRunOnboarding: boolean;
};

export async function getProductBootstrapHints(): Promise<ProductBootstrapHints | null> {
  try {
    const r = await pool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM organizations");
    const organizationCount = Number(r.rows[0]?.c ?? 0);
    return {
      organizationCount,
      needsFirstRunOnboarding: organizationCount === 0,
    };
  } catch {
    return null;
  }
}
