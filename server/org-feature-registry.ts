export const ORG_PLAN_TIERS = ["starter", "standard", "growth", "enterprise"] as const;

export type OrgPlanTier = (typeof ORG_PLAN_TIERS)[number];

export type OrgFeatureCatalogEntry = {
  label: string;
  minimumPlan: OrgPlanTier;
  upgradeHint: string;
};

const PLAN_TIER_ALIASES: Record<string, OrgPlanTier> = {
  starter: "starter",
  basic: "starter",
  essential: "starter",
  essentials: "starter",
  standard: "standard",
  pro: "growth",
  professional: "growth",
  premium: "growth",
  growth: "growth",
  enterprise: "enterprise",
};

const PLAN_TIER_RANK: Record<OrgPlanTier, number> = {
  starter: 0,
  standard: 1,
  growth: 2,
  enterprise: 3,
};

export const ORG_FEATURE_CATALOG: Record<string, OrgFeatureCatalogEntry> = {
  exports: {
    label: "Exports",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to unlock exports.",
  },
  offline_sync: {
    label: "Offline sync",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to use offline sync.",
  },
  extensions: {
    label: "Industry extensions",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to enable extension modules.",
  },
  gas: {
    label: "Gas distribution",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to enable gas workflows.",
  },
  construction: {
    label: "Construction projects",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to enable project workflows.",
  },
  field_service: {
    label: "Field service",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to enable field service workflows.",
  },
  manufacturing_lite: {
    label: "Light manufacturing",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to enable manufacturing workflows.",
  },
};

export function normalizeOrgPlanTier(planTier: unknown): OrgPlanTier {
  if (typeof planTier !== "string") return "standard";
  const normalized = planTier.trim().toLowerCase();
  return PLAN_TIER_ALIASES[normalized] ?? "standard";
}

export function isFeatureIncludedInPlan(planTier: OrgPlanTier, feature: string): boolean {
  const entry = ORG_FEATURE_CATALOG[feature];
  if (!entry) return true;
  return PLAN_TIER_RANK[planTier] >= PLAN_TIER_RANK[entry.minimumPlan];
}

export function resolveOrgFeatureFlags(input?: {
  planTier?: unknown;
  featureFlags?: Record<string, boolean> | null;
}): Record<string, boolean> {
  const normalizedPlanTier = normalizeOrgPlanTier(input?.planTier);
  const explicitFlags = input?.featureFlags ?? {};
  const resolvedFlags: Record<string, boolean> = {};

  for (const feature of Object.keys(ORG_FEATURE_CATALOG)) {
    resolvedFlags[feature] =
      explicitFlags[feature] ?? isFeatureIncludedInPlan(normalizedPlanTier, feature);
  }

  for (const [feature, enabled] of Object.entries(explicitFlags)) {
    if (!(feature in resolvedFlags)) {
      resolvedFlags[feature] = enabled;
    }
  }

  return resolvedFlags;
}

export function buildOrgFeatureAvailability(input?: {
  planTier?: unknown;
  featureFlags?: Record<string, boolean> | null;
}): Array<{
  key: string;
  label: string;
  enabled: boolean;
  minimumPlan: OrgPlanTier;
  upgradeHint: string;
  overridden: boolean;
}> {
  const normalizedPlanTier = normalizeOrgPlanTier(input?.planTier);
  const explicitFlags = input?.featureFlags ?? {};
  const resolvedFlags = resolveOrgFeatureFlags(input);

  return Object.entries(ORG_FEATURE_CATALOG).map(([key, entry]) => ({
    key,
    label: entry.label,
    enabled: resolvedFlags[key] !== false,
    minimumPlan: entry.minimumPlan,
    upgradeHint: entry.upgradeHint,
    overridden: Object.prototype.hasOwnProperty.call(explicitFlags, key),
  }));
}

export function getOrgFeatureUpgradeHint(feature: string): string {
  return ORG_FEATURE_CATALOG[feature]?.upgradeHint ?? "Update organization feature flags for this plan.";
}
