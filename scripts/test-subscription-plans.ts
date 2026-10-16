import assert from "node:assert/strict";
import {
  ORG_FEATURE_CATALOG,
  ORG_PLAN_LIMITS,
  isFeatureIncludedInPlan,
} from "../server/org-feature-registry.ts";
import { getSubscriptionPlanCatalog } from "../server/subscription-plan-catalog.ts";

const plans = getSubscriptionPlanCatalog();
assert.equal(plans.length, 4, "Expected four subscription plans");
assert.deepEqual(plans.map((plan) => plan.tier), ["starter", "standard", "growth", "enterprise"]);

for (const plan of plans) {
  assert.equal(plan.limits.users, ORG_PLAN_LIMITS[plan.tier].users, `${plan.tier} user limit should match registry`);
  assert.equal(
    plan.limits.warehouses,
    ORG_PLAN_LIMITS[plan.tier].warehouses,
    `${plan.tier} warehouse limit should match registry`,
  );
  assert.equal(plan.limits.skus, ORG_PLAN_LIMITS[plan.tier].skus, `${plan.tier} SKU limit should match registry`);
  assert.ok(plan.displayName, `${plan.tier} displayName missing`);
  assert.ok(plan.description, `${plan.tier} description missing`);
  assert.ok(plan.idealCustomer, `${plan.tier} ideal customer missing`);
  assert.ok(plan.monthlyPrice, `${plan.tier} monthly price label missing`);
  assert.ok(plan.annualPrice, `${plan.tier} annual price label missing`);
  assert.ok(plan.upgradeCta, `${plan.tier} upgrade CTA missing`);
  assert.ok(plan.supportLevel, `${plan.tier} support level missing`);
}

const starter = plans.find((plan) => plan.tier === "starter");
const standard = plans.find((plan) => plan.tier === "standard");
const growth = plans.find((plan) => plan.tier === "growth");
const enterprise = plans.find((plan) => plan.tier === "enterprise");
assert.ok(starter && standard && growth && enterprise, "All plans must exist");

for (const feature of ["core_procurement", "inventory", "receiving", "ap_basics", "mobile_stock_counts"]) {
  assert.ok(starter.includedFeatures.includes(feature), `Starter must include ${feature}`);
}
for (const feature of ["exports", "offline_sync", "industry_extensions", "advanced_variance_approvals"]) {
  assert.ok(standard.includedFeatures.includes(feature), `Standard must include ${feature}`);
}
for (const feature of ["analytics", "api_access", "document_branding", "integration_runs"]) {
  assert.ok(growth.includedFeatures.includes(feature), `Growth must include ${feature}`);
}
for (const feature of ["sso", "warehouse_limit_overrides", "custom_enterprise_controls"]) {
  assert.ok(enterprise.includedFeatures.includes(feature), `Enterprise must include ${feature}`);
}

assert.equal(isFeatureIncludedInPlan("starter", "exports"), false, "Starter should not include exports");
assert.equal(isFeatureIncludedInPlan("standard", "exports"), true, "Standard should include exports");
assert.equal(isFeatureIncludedInPlan("growth", "api_access"), true, "Growth should include API access");
assert.equal(isFeatureIncludedInPlan("enterprise", "sso"), true, "Enterprise should include SSO");

for (const feature of Object.keys(ORG_FEATURE_CATALOG)) {
  assert.ok(
    enterprise.includedFeatures.includes(feature) || enterprise.lockedFeatures.includes(feature),
    `Catalog feature ${feature} must be represented in Enterprise matrix`,
  );
}

console.log("Subscription plan catalog contract passed.");
