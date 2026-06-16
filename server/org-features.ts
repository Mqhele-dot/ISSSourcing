import { eq } from "drizzle-orm";
import { db } from "./db";
import { organizationSettings } from "@shared/schema";
import { getActiveOrganizationId } from "./organization-context";
import type { Response } from "express";
import { sendError } from "./api-response";
import {
  buildOrgFeatureAvailability,
  getOrgFeatureUpgradeHint,
  normalizeOrgPlanTier,
  resolveOrgFeatureFlags,
} from "./org-feature-registry";

async function getActiveOrgFeatureConfig(): Promise<{
  planTier: string | null;
  featureFlags: Record<string, boolean>;
}> {
  const orgId = getActiveOrganizationId();
  const [row] = await db
    .select({
      planTier: organizationSettings.planTier,
      featureFlags: organizationSettings.featureFlags,
    })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1);

  return {
    planTier: row?.planTier ?? null,
    featureFlags: (row?.featureFlags as Record<string, boolean> | null) ?? {},
  };
}

/** Effective feature flags for the active org after applying plan defaults plus explicit overrides. */
export async function getFeatureFlagsForActiveOrg(): Promise<Record<string, boolean>> {
  const config = await getActiveOrgFeatureConfig();
  return resolveOrgFeatureFlags(config);
}

export async function getOrgSubscriptionForActiveOrg(): Promise<{
  rawPlanTier: string | null;
  normalizedPlanTier: string;
  featureFlags: Record<string, boolean>;
  effectiveFeatureFlags: Record<string, boolean>;
  featureCatalog: Array<{
    key: string;
    label: string;
    enabled: boolean;
    minimumPlan: string;
    upgradeHint: string;
    overridden: boolean;
  }>;
}> {
  const config = await getActiveOrgFeatureConfig();
  return {
    rawPlanTier: config.planTier,
    normalizedPlanTier: normalizeOrgPlanTier(config.planTier),
    featureFlags: config.featureFlags,
    effectiveFeatureFlags: resolveOrgFeatureFlags(config),
    featureCatalog: buildOrgFeatureAvailability(config),
  };
}

/** When flag is explicitly `false`, the feature is off; missing/undefined defaults to allowed. */
export function isOrgFeatureEnabled(flags: Record<string, boolean>, key: string): boolean {
  return flags[key] !== false;
}

export function sendOrgFeatureDisabled(res: Response, feature: string): void {
  sendError(res, 403, "FEATURE_DISABLED", `Feature "${feature}" is not enabled for this organization.`, {
    hint: getOrgFeatureUpgradeHint(feature),
  });
}
