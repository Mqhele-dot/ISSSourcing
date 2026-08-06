import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const routes = read("client/src/lib/routes/app-routes.ts");
const router = read("client/src/router.tsx");
const sidebar = read("client/src/lib/routes/section-metadata.ts");
const page = read("client/src/pages/subscription.tsx");
const financeBilling = read("client/src/pages/billing.tsx");
const packageJson = JSON.parse(read("package.json"));

assert.match(routes, /subscription:\s*"\/admin\/subscription"/, "APP_ROUTES must expose /admin/subscription");
assert.match(router, /SubscriptionPage/, "Router must lazy-load SubscriptionPage");
assert.match(router, /APP_ROUTES\.admin\.subscription/, "Router must mount /admin/subscription");
assert.match(sidebar, /label:\s*"Subscription"/, "Admin navigation must include Subscription");

for (const endpoint of [
  "/api/subscription/plans",
  "/api/subscription/current",
  "/api/subscription/billing-portal",
  "/api/subscription/change-plan",
  "/api/subscription/start-trial",
  "/api/subscription/cancel",
  "/api/subscription/resume",
]) {
  assert.ok(page.includes(endpoint), `Subscription page must use ${endpoint}`);
}

assert.match(page, /Supplier billing and AP stay under Finance/, "SaaS billing must be visibly separated from AP billing");
assert.match(page, /usePermissions/, "Subscription page must load current user permissions");
assert.match(page, /settings",\s*"configure"/, "Subscription management must require settings:configure");
assert.match(
  page,
  /You need settings:configure permission to manage subscription/,
  "Subscription page must explain denied management actions",
);
assert.match(page, /subscription-permission-denied/, "Subscription page must render a permission denied state");
assert.match(page, /lockedFeatures/, "Subscription page must show locked feature explanations");
assert.match(page, /upgradeCta/, "Subscription page must show plan upgrade guidance");
assert.match(page, /canStartTrial[\s\S]*canCancel[\s\S]*canResume/, "Subscription lifecycle controls must derive enabled state from the current lifecycle");
assert.match(page, /Schedule subscription cancellation\?/, "Subscription cancellation must require explicit confirmation");
assert.doesNotMatch(financeBilling, /\/api\/subscription\/change-plan/, "/finance/billing must not manage SaaS plans");
assert.doesNotMatch(financeBilling, /\/api\/subscription\/start-trial/, "/finance/billing must not manage SaaS trials");

assert.equal(
  packageJson.scripts["test:subscription-plans"],
  "tsx scripts/test-subscription-plans.ts",
  "test:subscription-plans script missing",
);
assert.equal(
  packageJson.scripts["test:subscription-entitlements"],
  "tsx scripts/test-subscription-entitlements.ts",
  "test:subscription-entitlements script missing",
);
assert.equal(
  packageJson.scripts["test:subscription-ui-contracts"],
  "node scripts/test-subscription-ui-contracts.mjs",
  "test:subscription-ui-contracts script missing",
);
assert.equal(
  packageJson.scripts["test:subscription-runtime-flow"],
  "tsx scripts/test-subscription-runtime-flow.ts",
  "test:subscription-runtime-flow script missing",
);
assert.equal(
  packageJson.scripts["test:stripe-billing-readiness"],
  "node scripts/test-stripe-billing-readiness.mjs",
  "test:stripe-billing-readiness script missing",
);
assert.equal(
  packageJson.scripts["test:e2e:subscription"],
  "node scripts/run-playwright-e2e.mjs e2e/subscription-admin-workflow.spec.ts",
  "test:e2e:subscription script missing",
);
assert.match(
  packageJson.scripts["verify:release:e2e"],
  /test:e2e:subscription/,
  "verify:release:e2e must include subscription E2E proof",
);

console.log("Subscription UI contract passed.");
