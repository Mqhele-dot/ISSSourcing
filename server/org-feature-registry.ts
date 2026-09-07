export const ORG_PLAN_TIERS = ["starter", "standard", "growth", "enterprise"] as const;

export type OrgPlanTier = (typeof ORG_PLAN_TIERS)[number];

export type OrgFeatureCatalogEntry = {
  label: string;
  minimumPlan: OrgPlanTier;
  upgradeHint: string;
};

export type OrgPlanLimit = {
  users: number | null;
  warehouses: number | null;
  skus: number | null;
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

export const ORG_PLAN_LIMITS: Record<OrgPlanTier, OrgPlanLimit> = {
  starter: { users: 3, warehouses: 1, skus: 5000 },
  standard: { users: 10, warehouses: 3, skus: 25000 },
  growth: { users: 50, warehouses: 10, skus: 100000 },
  enterprise: { users: null, warehouses: null, skus: null },
};

export const ORG_FEATURE_CATALOG: Record<string, OrgFeatureCatalogEntry> = {
  core_procurement: {
    label: "Core procurement",
    minimumPlan: "starter",
    upgradeHint: "Core procurement is included in every plan.",
  },
  inventory: {
    label: "Inventory management",
    minimumPlan: "starter",
    upgradeHint: "Inventory management is included in every plan.",
  },
  receiving: {
    label: "Receiving and GRN",
    minimumPlan: "starter",
    upgradeHint: "Receiving is included in every plan.",
  },
  ap_basics: {
    label: "AP basics",
    minimumPlan: "starter",
    upgradeHint: "AP basics are included in every plan.",
  },
  mobile_stock_counts: {
    label: "Mobile stock counts",
    minimumPlan: "starter",
    upgradeHint: "Mobile stock counts are included in every plan.",
  },
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
  industry_extensions: {
    label: "Industry extensions",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to enable industry extension modules.",
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
  advanced_variance_approvals: {
    label: "Advanced variance approvals",
    minimumPlan: "standard",
    upgradeHint: "Upgrade to Standard or higher to route count variances for approval.",
  },
  analytics: {
    label: "Advanced analytics",
    minimumPlan: "growth",
    upgradeHint: "Upgrade to Growth or higher to unlock advanced analytics.",
  },
  api_access: {
    label: "API access",
    minimumPlan: "growth",
    upgradeHint: "Upgrade to Growth or higher to use API access.",
  },
  document_branding: {
    label: "Document branding",
    minimumPlan: "growth",
    upgradeHint: "Upgrade to Growth or higher to customize branded documents.",
  },
  integration_runs: {
    label: "Integration runs",
    minimumPlan: "growth",
    upgradeHint: "Upgrade to Growth or higher to run managed integrations.",
  },
  sso: {
    label: "Single sign-on",
    minimumPlan: "enterprise",
    upgradeHint: "Contact sales to enable Enterprise single sign-on.",
  },
  warehouse_limit_overrides: {
    label: "Warehouse limit overrides",
    minimumPlan: "enterprise",
    upgradeHint: "Contact sales for Enterprise warehouse limits.",
  },
  custom_enterprise_controls: {
    label: "Custom enterprise controls",
    minimumPlan: "enterprise",
    upgradeHint: "Contact sales to configure custom enterprise controls.",
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

export function getOrgPlanLimits(planTier: unknown): OrgPlanLimit {
  return ORG_PLAN_LIMITS[normalizeOrgPlanTier(planTier)];
}
