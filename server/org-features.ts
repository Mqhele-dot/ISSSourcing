import { eq } from "drizzle-orm";
import { db } from "./db";
import { organizationSettings } from "@shared/schema";
import { getActiveOrganizationId } from "./organization-context";
import type { Response } from "express";
import { sendError } from "./api-response";
import {
  buildOrgFeatureAvailability,
  getOrgPlanLimits,
  getOrgFeatureUpgradeHint,
  normalizeOrgPlanTier,
  type OrgPlanTier,
  resolveOrgFeatureFlags,
} from "./org-feature-registry";

async function getActiveOrgFeatureConfig(): Promise<{
  planTier: string | null;
  featureFlags: Record<string, boolean>;
  subscriptionStatus: string | null;
  billingProvider: string | null;
  billingCustomerId: string | null;
  billingSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean | null;
  usageSnapshot: Record<string, unknown>;
  lastBillingSyncAt: Date | null;
}> {
  const orgId = getActiveOrganizationId();
  const [row] = await db
    .select({
      planTier: organizationSettings.planTier,
      featureFlags: organizationSettings.featureFlags,
      subscriptionStatus: organizationSettings.subscriptionStatus,
      billingProvider: organizationSettings.billingProvider,
      billingCustomerId: organizationSettings.billingCustomerId,
      billingSubscriptionId: organizationSettings.billingSubscriptionId,
      currentPeriodStart: organizationSettings.currentPeriodStart,
      currentPeriodEnd: organizationSettings.currentPeriodEnd,
      trialEndsAt: organizationSettings.trialEndsAt,
      cancelAtPeriodEnd: organizationSettings.cancelAtPeriodEnd,
      usageSnapshot: organizationSettings.usageSnapshot,
      lastBillingSyncAt: organizationSettings.lastBillingSyncAt,
    })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1);

  return {
    planTier: row?.planTier ?? null,
    featureFlags: (row?.featureFlags as Record<string, boolean> | null) ?? {},
    subscriptionStatus: row?.subscriptionStatus ?? null,
    billingProvider: row?.billingProvider ?? null,
    billingCustomerId: row?.billingCustomerId ?? null,
    billingSubscriptionId: row?.billingSubscriptionId ?? null,
    currentPeriodStart: row?.currentPeriodStart ?? null,
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    trialEndsAt: row?.trialEndsAt ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? null,
    usageSnapshot: (row?.usageSnapshot as Record<string, unknown> | null) ?? {},
    lastBillingSyncAt: row?.lastBillingSyncAt ?? null,
  };
}

/** Effective feature flags for the active org after applying plan defaults plus explicit overrides. */
export async function getFeatureFlagsForActiveOrg(): Promise<Record<string, boolean>> {
  const config = await getActiveOrgFeatureConfig();
  return resolveOrgFeatureFlags(config);
}

export async function getOrgSubscriptionForActiveOrg(): Promise<{
  rawPlanTier: string | null;
  normalizedPlanTier: OrgPlanTier;
  featureFlags: Record<string, boolean>;
  effectiveFeatureFlags: Record<string, boolean>;
  featureCatalog: Array<{
    key: string;
    label: string;
    enabled: boolean;
    minimumPlan: OrgPlanTier;
    upgradeHint: string;
    overridden: boolean;
  }>;
  limits: {
    users: number | null;
    warehouses: number | null;
    skus: number | null;
  };
  lifecycle: {
    subscriptionStatus: string;
    billingProvider: string;
    billingCustomerId: string | null;
    billingSubscriptionId: string | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    trialEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
    usageSnapshot: Record<string, unknown>;
    lastBillingSyncAt: Date | null;
  };
}> {
  const config = await getActiveOrgFeatureConfig();
  const normalizedPlanTier = normalizeOrgPlanTier(config.planTier);
  return {
    rawPlanTier: config.planTier,
    normalizedPlanTier,
    featureFlags: config.featureFlags,
    effectiveFeatureFlags: resolveOrgFeatureFlags(config),
    featureCatalog: buildOrgFeatureAvailability(config),
    limits: getOrgPlanLimits(normalizedPlanTier),
    lifecycle: {
      subscriptionStatus: config.subscriptionStatus ?? "active",
      billingProvider: config.billingProvider ?? "local",
      billingCustomerId: config.billingCustomerId,
      billingSubscriptionId: config.billingSubscriptionId,
      currentPeriodStart: config.currentPeriodStart,
      currentPeriodEnd: config.currentPeriodEnd,
      trialEndsAt: config.trialEndsAt,
      cancelAtPeriodEnd: Boolean(config.cancelAtPeriodEnd),
      usageSnapshot: config.usageSnapshot,
      lastBillingSyncAt: config.lastBillingSyncAt,
    },
  };
}

/** When flag is explicitly `false`, the feature is off; missing/undefined defaults to allowed. */
export function isOrgFeatureEnabled(flags: Record<string, boolean>, key: string): boolean {
  return flags[key] !== false;
}

export function sendOrgFeatureDisabled(res: Response, feature: string): void {
  sendError(res, 403, "FEATURE_NOT_INCLUDED", `Feature "${feature}" is not included in this organization's plan.`, {
    hint: getOrgFeatureUpgradeHint(feature),
  });
}
