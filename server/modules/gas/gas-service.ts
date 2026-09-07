import { and, count, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { emitNotificationToRoles } from "../../services/notification-emitter";
import { gasAssetProfiles, gasExchangeTransactions, gasProducts } from "@shared/schema";

/** Optional LP-gas tables may be absent or retain a legacy incompatible shape. */
function isOptionalGasSchemaCompatibilityError(e: unknown): boolean {
  const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err?.code ?? err?.cause?.code;
  if (code === "42P01" || code === "42703") return true;
  const msg = [err?.message, err?.cause?.message].filter((value): value is string => typeof value === "string").join(" ");
  return (msg.includes("does not exist") || msg.includes("undefined column"))
    && (msg.includes("gas_") || msg.includes("relation") || msg.includes("column"));
}

/** Placeholder: enforce regulator / gas-family pairing (extend with real rules). */
export function validateGasCompatibility(gasFamily: string, assetGasFamily: string | null): { ok: boolean; reason?: string } {
  if (!assetGasFamily) return { ok: true };
  if (gasFamily.toLowerCase() === assetGasFamily.toLowerCase()) return { ok: true };
  return { ok: false, reason: "Gas family mismatch for this asset" };
}

export async function getGasDashboardSummary() {
  const orgId = getActiveOrganizationId();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 30);

  const canonical = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM fuel_products WHERE organization_id = $1 AND active = true) AS product_count,
       (SELECT COUNT(*)::int FROM fuel_stations WHERE organization_id = $1 AND status = 'active') AS station_count`,
    [orgId],
  );
  const productCount = Number(canonical.rows[0]?.product_count ?? 0);
  const stationCount = Number(canonical.rows[0]?.station_count ?? 0);
  let lpGasState: "ready" | "degraded" = "ready";
  let openExchanges = 0;
  let profilesDueForTest30d = 0;

  try {
    const [exchangeRow] = await db
      .select({ c: count() })
      .from(gasExchangeTransactions)
      .where(
        and(
          eq(gasExchangeTransactions.organizationId, orgId),
          or(
            eq(gasExchangeTransactions.status, "pending"),
            eq(gasExchangeTransactions.status, "in_progress"),
          ),
        ),
      );

    const [dueRow] = await db
      .select({ c: count() })
      .from(gasAssetProfiles)
      .where(
        and(
          eq(gasAssetProfiles.organizationId, orgId),
          isNotNull(gasAssetProfiles.testDueDate),
          lte(gasAssetProfiles.testDueDate, horizon),
          sql`${gasAssetProfiles.complianceStatus} IS DISTINCT FROM 'blocked'`,
        ),
      );

    openExchanges = Number(exchangeRow?.c ?? 0);
    profilesDueForTest30d = Number(dueRow?.c ?? 0);
  } catch (e) {
    if (isOptionalGasSchemaCompatibilityError(e)) {
      lpGasState = "degraded";
      console.warn("[gas] optional gas_* compliance tables are unavailable or legacy-shaped; canonical fuel summary remains active.");
    } else {
      throw e;
    }
  }

  const setupRequired = productCount === 0 || stationCount === 0;
  return {
    state: setupRequired ? "setup_required" : lpGasState === "degraded" ? "degraded" : "ready",
    productCount,
    stationCount,
    openExchanges,
    profilesDueForTest30d,
    channels: {
      fuel: setupRequired ? "setup_required" : "ready",
      lpGas: lpGasState,
    },
  };
}

/** Emit in-app notifications to managers/admins when gas profiles need attention. */
export async function runGasComplianceAlerts(): Promise<{
  notificationsSent: number;
  dueWithin30d: number;
  blocked: number;
}> {
  const orgId = getActiveOrganizationId();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 30);

  try {
    const dueRows = await db
      .select({ trackedAssetId: gasAssetProfiles.trackedAssetId })
      .from(gasAssetProfiles)
      .where(
        and(
          eq(gasAssetProfiles.organizationId, orgId),
          isNotNull(gasAssetProfiles.testDueDate),
          lte(gasAssetProfiles.testDueDate, horizon),
          sql`${gasAssetProfiles.complianceStatus} IS DISTINCT FROM 'blocked'`,
        ),
      );

    const blockedRows = await db
      .select({ trackedAssetId: gasAssetProfiles.trackedAssetId })
      .from(gasAssetProfiles)
      .where(and(eq(gasAssetProfiles.organizationId, orgId), eq(gasAssetProfiles.complianceStatus, "blocked")));

    let notificationsSent = 0;

    if (dueRows.length > 0) {
      const ids = dueRows.map((r) => r.trackedAssetId).slice(0, 20);
      const more = dueRows.length > 20 ? ` (+${dueRows.length - 20} more)` : "";
      await emitNotificationToRoles(["manager", "admin"], {
        type: "gas_compliance_due",
        title: `Gas: ${dueRows.length} asset profile(s) due for test (30d)`,
        body: `Tracked asset IDs: ${ids.join(", ")}${more}`,
        entityType: "gas_asset_profile",
      });
      notificationsSent += 1;
    }

    if (blockedRows.length > 0) {
      const ids = blockedRows.map((r) => r.trackedAssetId).slice(0, 20);
      const more = blockedRows.length > 20 ? ` (+${blockedRows.length - 20} more)` : "";
      await emitNotificationToRoles(["manager", "admin"], {
        type: "gas_compliance_blocked",
        title: `Gas: ${blockedRows.length} blocked asset profile(s)`,
        body: `Tracked asset IDs: ${ids.join(", ")}${more}`,
        entityType: "gas_asset_profile",
      });
      notificationsSent += 1;
    }

    return {
      notificationsSent,
      dueWithin30d: dueRows.length,
      blocked: blockedRows.length,
    };
  } catch (e) {
    if (isOptionalGasSchemaCompatibilityError(e)) {
      console.warn("[gas] gas_* tables are unavailable or legacy-shaped; run migrations before enabling compliance alerts.");
      return { notificationsSent: 0, dueWithin30d: 0, blocked: 0 };
    }
    throw e;
  }
}
