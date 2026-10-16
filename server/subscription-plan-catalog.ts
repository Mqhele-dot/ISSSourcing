import {
  ORG_FEATURE_CATALOG,
  ORG_PLAN_LIMITS,
  ORG_PLAN_TIERS,
  type OrgPlanTier,
} from "./org-feature-registry";

export type SubscriptionPlanDefinition = {
  tier: OrgPlanTier;
  displayName: string;
  description: string;
  idealCustomer: string;
  monthlyPrice: string;
  annualPrice: string;
  limits: {
    users: number | null;
    warehouses: number | null;
    skus: number | null;
  };
  includedFeatures: string[];
  lockedFeatures: string[];
  upgradeCta: string;
  supportLevel: string;
};

const FEATURE_GROUPS: Record<OrgPlanTier, string[]> = {
  starter: ["core_procurement", "inventory", "receiving", "ap_basics", "mobile_stock_counts"],
  standard: ["exports", "offline_sync", "industry_extensions", "extensions", "advanced_variance_approvals"],
  growth: ["analytics", "api_access", "document_branding", "integration_runs"],
  enterprise: ["sso", "warehouse_limit_overrides", "custom_enterprise_controls"],
};

const PLAN_METADATA: Record<
  OrgPlanTier,
  Pick<SubscriptionPlanDefinition, "displayName" | "description" | "idealCustomer" | "upgradeCta" | "supportLevel">
> = {
  starter: {
    displayName: "Starter",
    description: "Core procurement, receiving, inventory, AP basics, and online mobile stock counts.",
    idealCustomer: "Small teams proving the operating model in one warehouse.",
    upgradeCta: "Upgrade to Standard for exports, offline sync, and industry extensions.",
    supportLevel: "Standard product support",
  },
  standard: {
    displayName: "Standard",
    description: "Adds exports, offline sync, controlled variance approvals, and industry extensions.",
    idealCustomer: "Growing operations that need reliable warehouse execution and repeatable exports.",
    upgradeCta: "Upgrade to Growth for advanced analytics, API access, branding, and integrations.",
    supportLevel: "Priority product support",
  },
  growth: {
    displayName: "Growth",
    description: "Advanced analytics, API access, document branding, and managed integration runs.",
    idealCustomer: "Multi-site teams standardizing finance, procurement, reporting, and integrations.",
    upgradeCta: "Contact sales for Enterprise SSO, custom controls, and flexible warehouse limits.",
    supportLevel: "Priority support with implementation guidance",
  },
  enterprise: {
    displayName: "Enterprise",
    description: "Contracted limits, SSO, warehouse limit overrides, and custom enterprise controls.",
    idealCustomer: "Complex or regulated organizations needing bespoke controls and governance.",
    upgradeCta: "Contact sales to configure Enterprise terms.",
    supportLevel: "Enterprise support and success management",
  },
};

function priceLabel(tier: OrgPlanTier, cadence: "monthly" | "annual"): string {
  const envKey = `SUBSCRIPTION_${tier.toUpperCase()}_${cadence.toUpperCase()}_PRICE_LABEL`;
  return process.env[envKey] || "Configurable pricing";
}

function featuresThroughPlan(tier: OrgPlanTier): string[] {
  const index = ORG_PLAN_TIERS.indexOf(tier);
  return ORG_PLAN_TIERS.slice(0, index + 1).flatMap((plan) => FEATURE_GROUPS[plan]);
}

export function getSubscriptionPlanCatalog(): SubscriptionPlanDefinition[] {
  const allFeatures = Object.keys(ORG_FEATURE_CATALOG);
  return ORG_PLAN_TIERS.map((tier) => {
    const includedFeatures = Array.from(new Set(featuresThroughPlan(tier)));
    return {
      tier,
      ...PLAN_METADATA[tier],
      monthlyPrice: priceLabel(tier, "monthly"),
      annualPrice: priceLabel(tier, "annual"),
      limits: ORG_PLAN_LIMITS[tier],
      includedFeatures,
      lockedFeatures: allFeatures.filter((feature) => !includedFeatures.includes(feature)),
    };
  });
}

export function getSubscriptionPlanDefinition(tier: OrgPlanTier): SubscriptionPlanDefinition {
  return getSubscriptionPlanCatalog().find((plan) => plan.tier === tier) ?? getSubscriptionPlanCatalog()[1];
}

export function getFeatureLabel(feature: string): string {
  return ORG_FEATURE_CATALOG[feature]?.label ?? feature.replace(/_/g, " ");
}
