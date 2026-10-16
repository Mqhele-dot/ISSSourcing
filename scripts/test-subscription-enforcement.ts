import assert from "node:assert/strict";
import {
  buildSubscriptionDiagnostics,
  getSubscriptionAccessStatus,
  getSubscriptionWriteAccessDecision,
} from "../server/subscription-enforcement.ts";

const active = getSubscriptionAccessStatus({ stripeStatus: "active" });
assert.equal(active.code, "ACTIVE");
assert.equal(active.restricted, false);

const grace = getSubscriptionAccessStatus({ stripeStatus: "past_due" });
assert.equal(grace.code, "BILLING_GRACE");
assert.equal(grace.restricted, false);

const expiredTrial = getSubscriptionAccessStatus({
  stripeStatus: "trialing",
  currentPeriodEnd: "2020-01-01T00:00:00.000Z",
});
assert.equal(expiredTrial.code, "TRIAL_EXPIRED");
assert.equal(expiredTrial.restricted, true);

const expiredTrialWrite = getSubscriptionWriteAccessDecision({
  stripeStatus: "trialing",
  currentPeriodEnd: "2020-01-01T00:00:00.000Z",
});
assert.equal(expiredTrialWrite.allowed, false);
assert.equal(expiredTrialWrite.code, "TRIAL_EXPIRED");
assert.match(expiredTrialWrite.hint ?? "", /Upgrade the subscription/i);

const inactiveWrite = getSubscriptionWriteAccessDecision({
  stripeStatus: "canceled",
});
assert.equal(inactiveWrite.allowed, false);
assert.equal(inactiveWrite.code, "SUBSCRIPTION_INACTIVE");

const activeWrite = getSubscriptionWriteAccessDecision({
  stripeStatus: "active",
});
assert.equal(activeWrite.allowed, true);
assert.equal(activeWrite.code, "ACTIVE");

const limits = buildSubscriptionDiagnostics({
  planTier: "starter",
  limits: { users: 3, warehouses: 1, skus: 5000 },
  usage: { users: 4, warehouses: 1, skus: 1200 },
  stripeStatus: "active",
});

assert.equal(limits.usageStatus.code, "USAGE_LIMIT_REACHED");
assert.equal(limits.usageStatus.withinLimits, false);
assert.deepEqual(limits.usageStatus.overLimitKeys, ["users"]);
assert.ok(limits.upgradeHints.some((hint) => hint.includes("users")));

console.log("subscription enforcement tests passed");
