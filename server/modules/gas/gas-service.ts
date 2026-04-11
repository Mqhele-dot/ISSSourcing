import { and, count, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { emitNotificationToRoles } from "../../services/notification-emitter";
import { gasAssetProfiles, gasExchangeTransactions, gasProducts } from "@shared/schema";

/** Postgres undefined_table / missing relation (e.g. gas_* not migrated yet). */
function isMissingGasRelationError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  if (err?.code === "42P01") return true;
  const msg = typeof err?.message === "string" ? err.message : "";
  return msg.includes("does not exist") && (msg.includes("gas_") || msg.includes("relation"));
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

  try {
    const [productRow] = await db
      .select({ c: count() })
      .from(gasProducts)
      .where(eq(gasProducts.organizationId, orgId));

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

    return {
      productCount: Number(productRow?.c ?? 0),
      openExchanges: Number(exchangeRow?.c ?? 0),
      profilesDueForTest30d: Number(dueRow?.c ?? 0),
    };
  } catch (e) {
    if (isMissingGasRelationError(e)) {
      console.warn("[gas] gas_* tables are not in the database yet; run `npm run db:push`. Returning empty summary.");
      return {
        productCount: 0,
        openExchanges: 0,
        profilesDueForTest30d: 0,
      };
    }
    throw e;
  }
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
    if (isMissingGasRelationError(e)) {
      console.warn("[gas] gas_* tables are not in the database yet; run `npm run db:push`. Skipping compliance alerts.");
      return { notificationsSent: 0, dueWithin30d: 0, blocked: 0 };
    }
    throw e;
  }
}
