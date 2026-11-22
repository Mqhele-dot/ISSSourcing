import { ORG_PLAN_TIERS, normalizeOrgPlanTier, type OrgPlanTier } from "./org-feature-registry";

export type CompanyConfigType = "boolean" | "number" | "string" | "enum" | "json" | "duration" | "currency";
export type CompanyConfigScope = "organization" | "warehouse" | "role";
export type CompanyConfigInvalidation =
  | "none"
  | "client-cache"
  | "future-transactions-only"
  | "recompute-open-drafts"
  | "requires-reindex";

export type CompanyConfigDefinition = {
  key: string;
  label: string;
  type: CompanyConfigType;
  category:
    | "mobile"
    | "variance"
    | "inventory"
    | "subscription"
    | "branding"
    | "notifications"
    | "integrations"
    | "security";
  scopes: CompanyConfigScope[];
  minimumPlan: OrgPlanTier;
  feature?: string;
  defaultValue: unknown;
  invalidationMode: CompanyConfigInvalidation;
  auditLevel: "standard" | "sensitive";
  uiControl: "toggle" | "number" | "text" | "select" | "json" | "duration";
  options?: string[];
};

export const COMPANY_CONFIGURATION_REGISTRY: CompanyConfigDefinition[] = [
  {
    key: "inventory.count.blindMode",
    label: "Blind count by default",
    type: "boolean",
    category: "mobile",
    scopes: ["organization", "warehouse", "role"],
    minimumPlan: "starter",
    feature: "mobile_stock_counts",
    defaultValue: true,
    invalidationMode: "future-transactions-only",
    auditLevel: "standard",
    uiControl: "toggle",
  },
  {
    key: "inventory.count.spotCountEnabled",
    label: "Allow spot counts",
    type: "boolean",
    category: "mobile",
    scopes: ["organization", "warehouse", "role"],
    minimumPlan: "starter",
    feature: "mobile_stock_counts",
    defaultValue: true,
    invalidationMode: "client-cache",
    auditLevel: "standard",
    uiControl: "toggle",
  },
  {
    key: "inventory.count.defaultMode",
    label: "Default count mode",
    type: "enum",
    category: "mobile",
    scopes: ["organization", "warehouse", "role"],
    minimumPlan: "starter",
    feature: "mobile_stock_counts",
    defaultValue: "guided",
    invalidationMode: "future-transactions-only",
    auditLevel: "standard",
    uiControl: "select",
    options: ["blind", "guided", "spot", "recount"],
  },
  {
    key: "inventory.count.offlineRetentionDays",
    label: "Offline retention window",
    type: "number",
    category: "mobile",
    scopes: ["organization", "warehouse"],
    minimumPlan: "standard",
    feature: "offline_sync",
    defaultValue: 7,
    invalidationMode: "client-cache",
    auditLevel: "standard",
    uiControl: "number",
  },
  {
    key: "inventory.count.locationRequired",
    label: "Require count location",
    type: "boolean",
    category: "mobile",
    scopes: ["organization", "warehouse"],
    minimumPlan: "starter",
    feature: "mobile_stock_counts",
    defaultValue: false,
    invalidationMode: "future-transactions-only",
    auditLevel: "standard",
    uiControl: "toggle",
  },
  {
    key: "inventory.variance.thresholdPct",
    label: "Variance percentage threshold",
    type: "number",
    category: "variance",
    scopes: ["organization", "warehouse"],
    minimumPlan: "standard",
    feature: "advanced_variance_approvals",
    defaultValue: 10,
    invalidationMode: "future-transactions-only",
    auditLevel: "standard",
    uiControl: "number",
  },
  {
    key: "inventory.variance.thresholdValue",
    label: "Variance value threshold",
    type: "number",
    category: "variance",
    scopes: ["organization", "warehouse"],
    minimumPlan: "standard",
    feature: "advanced_variance_approvals",
    defaultValue: 0,
    invalidationMode: "future-transactions-only",
    auditLevel: "standard",
    uiControl: "number",
  },
  {
    key: "inventory.variance.requiresReasonCode",
    label: "Require variance reason codes",
    type: "boolean",
    category: "variance",
    scopes: ["organization", "warehouse"],
    minimumPlan: "standard",
    feature: "advanced_variance_approvals",
    defaultValue: true,
    invalidationMode: "future-transactions-only",
    auditLevel: "standard",
    uiControl: "toggle",
  },
  {
    key: "inventory.negativeStockRule",
    label: "Negative inventory rule",
    type: "enum",
    category: "inventory",
    scopes: ["organization", "warehouse"],
    minimumPlan: "starter",
    defaultValue: "block",
    invalidationMode: "future-transactions-only",
    auditLevel: "standard",
    uiControl: "select",
    options: ["block", "warn", "allow"],
  },
  {
    key: "subscription.failedPaymentGraceDays",
    label: "Failed payment grace period",
    type: "number",
    category: "subscription",
    scopes: ["organization"],
    minimumPlan: "starter",
    defaultValue: 7,
    invalidationMode: "client-cache",
    auditLevel: "sensitive",
    uiControl: "number",
  },
  {
    key: "branding.documentBrandingEnabled",
    label: "Enable branded documents",
    type: "boolean",
    category: "branding",
    scopes: ["organization"],
    minimumPlan: "growth",
    feature: "document_branding",
    defaultValue: false,
    invalidationMode: "client-cache",
    auditLevel: "standard",
    uiControl: "toggle",
  },
  {
    key: "security.requireTwoFactor",
    label: "Require two-factor authentication",
    type: "boolean",
    category: "security",
    scopes: ["organization", "role"],
    minimumPlan: "enterprise",
    defaultValue: false,
    invalidationMode: "client-cache",
    auditLevel: "sensitive",
    uiControl: "toggle",
  },
];

export function getConfigurationDefinitionsForPlan(planTier: unknown, flags: Record<string, boolean>) {
  const normalizedPlanTier = normalizeOrgPlanTier(planTier);
  return COMPANY_CONFIGURATION_REGISTRY.map((definition) => {
    const planAllowed =
      ORG_PLAN_TIERS.indexOf(normalizedPlanTier) >= ORG_PLAN_TIERS.indexOf(definition.minimumPlan);
    const featureAllowed = definition.feature ? flags[definition.feature] !== false : true;
    return {
      ...definition,
      enabled: planAllowed && featureAllowed,
      upgradeHint: definition.feature
        ? `Upgrade to ${definition.minimumPlan} or higher to use ${definition.label}.`
        : undefined,
    };
  });
}
