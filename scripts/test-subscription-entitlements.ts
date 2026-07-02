import assert from "node:assert/strict";
import fs from "node:fs";
import { getOrgPlanLimits, resolveOrgFeatureFlags } from "../server/org-feature-registry.ts";
import { buildUsageSummaries, getSubscriptionWriteAccessDecision } from "../server/subscription-enforcement.ts";

const starterLimits = getOrgPlanLimits("starter");
assert.equal(starterLimits.users, 3, "Starter must allow 3 users");
assert.equal(starterLimits.warehouses, 1, "Starter must allow 1 warehouse");
assert.equal(starterLimits.skus, 5000, "Starter must allow 5,000 SKUs");

const enterpriseLimits = getOrgPlanLimits("enterprise");
assert.equal(enterpriseLimits.users, null, "Enterprise users should be unlimited");
assert.equal(enterpriseLimits.warehouses, null, "Enterprise warehouses should be unlimited");
assert.equal(enterpriseLimits.skus, null, "Enterprise SKUs should be unlimited");

const starterFlags = resolveOrgFeatureFlags({ planTier: "starter", featureFlags: {} });
assert.equal(starterFlags.exports, false, "Starter must not include exports");
assert.equal(starterFlags.offline_sync, false, "Starter must not include offline sync");
assert.equal(starterFlags.mobile_stock_counts, true, "Starter must include online mobile stock counts");

const standardFlags = resolveOrgFeatureFlags({ planTier: "standard", featureFlags: {} });
assert.equal(standardFlags.exports, true, "Standard must include exports");
assert.equal(standardFlags.offline_sync, true, "Standard must include offline sync");
assert.equal(standardFlags.advanced_variance_approvals, true, "Standard must include advanced variance approvals");

const growthFlags = resolveOrgFeatureFlags({ planTier: "growth", featureFlags: {} });
assert.equal(growthFlags.analytics, true, "Growth must include analytics");
assert.equal(growthFlags.api_access, true, "Growth must include API access");
assert.equal(growthFlags.document_branding, true, "Growth must include document branding");

const usage = buildUsageSummaries(starterLimits, { users: 3, warehouses: 1, skus: 5000 });
assert.equal(usage.find((entry) => entry.key === "users")?.atLimit, true, "Starter 4th user should be blocked by API guard");
assert.equal(
  usage.find((entry) => entry.key === "warehouses")?.atLimit,
  true,
  "Starter 2nd warehouse should be blocked by API guard",
);

const expiredTrial = getSubscriptionWriteAccessDecision({
  stripeStatus: "trialing",
  currentPeriodEnd: new Date(Date.now() - 60_000),
});
assert.equal(expiredTrial.allowed, false, "Expired trial must block paid workflow writes");
assert.equal(expiredTrial.code, "TRIAL_EXPIRED");

const pastDue = getSubscriptionWriteAccessDecision({ stripeStatus: "past_due" });
assert.equal(pastDue.allowed, true, "Past due remains in billing grace");
assert.equal(pastDue.code, "ACTIVE");

const inactive = getSubscriptionWriteAccessDecision({ stripeStatus: "canceled" });
assert.equal(inactive.allowed, false, "Canceled subscription must block paid workflow writes");
assert.equal(inactive.code, "SUBSCRIPTION_INACTIVE");

const orgFeaturesSource = fs.readFileSync("server/org-features.ts", "utf8");
const planLimitSource = fs.readFileSync("server/plan-limit-service.ts", "utf8");
assert.match(orgFeaturesSource, /FEATURE_NOT_INCLUDED/, "Feature-gated endpoints must return FEATURE_NOT_INCLUDED");
assert.match(planLimitSource, /PLAN_LIMIT_REACHED/, "Plan limit endpoints must return PLAN_LIMIT_REACHED");

console.log("Subscription entitlement contract passed.");
