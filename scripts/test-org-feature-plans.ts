import assert from "node:assert/strict";
import {
  buildOrgFeatureAvailability,
  normalizeOrgPlanTier,
  resolveOrgFeatureFlags,
} from "../server/org-feature-registry.ts";

assert.equal(normalizeOrgPlanTier("starter"), "starter");
assert.equal(normalizeOrgPlanTier("professional"), "growth");
assert.equal(normalizeOrgPlanTier("unknown-tier"), "standard");

const starterDefaults = resolveOrgFeatureFlags({ planTier: "starter", featureFlags: {} });
assert.equal(starterDefaults.exports, false);
assert.equal(starterDefaults.offline_sync, false);
assert.equal(starterDefaults.extensions, false);
assert.equal(starterDefaults.gas, false);

const standardDefaults = resolveOrgFeatureFlags({ planTier: "standard", featureFlags: {} });
assert.equal(standardDefaults.exports, true);
assert.equal(standardDefaults.offline_sync, true);
assert.equal(standardDefaults.extensions, true);
assert.equal(standardDefaults.gas, true);

const explicitOverride = resolveOrgFeatureFlags({
  planTier: "starter",
  featureFlags: { exports: true, offline_sync: false, custom_capability: false },
});
assert.equal(explicitOverride.exports, true);
assert.equal(explicitOverride.offline_sync, false);
assert.equal(explicitOverride.custom_capability, false);

const availability = buildOrgFeatureAvailability({
  planTier: "starter",
  featureFlags: { exports: true },
});
const exportsEntry = availability.find((entry) => entry.key === "exports");
assert.ok(exportsEntry);
assert.equal(exportsEntry.enabled, true);
assert.equal(exportsEntry.overridden, true);
assert.equal(exportsEntry.minimumPlan, "standard");

console.log("org feature plan tests passed");
