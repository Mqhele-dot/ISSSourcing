import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assertContains(path, pattern, message) {
  assert.match(read(path), pattern, message);
}

function assertNotContains(path, pattern, message) {
  assert.doesNotMatch(read(path), pattern, message);
}

assertContains(
  "client/src/lib/diagnostics/route-diagnostics.ts",
  /\/procurement\/contracts[\s\S]*contracts-page/,
  "contracts route must have a route-health marker contract",
);
assertContains(
  "client/src/router.tsx",
  /APP_ROUTES\.procurement\.contracts[\s\S]*ContractsPage/,
  "contracts route must remain registered with the router",
);
assertContains(
  "client/src/app/route-loading-boundary.tsx",
  /Reload fresh assets[\s\S]*reloadWithCacheBust/,
  "route chunk failures must offer cache-busted recovery guidance",
);

assertContains(
  "server/modules/reorder/register-reorder-routes.ts",
  /REORDER_ITEM_MISSING[\s\S]*reorderRequestId[\s\S]*itemId/,
  "reorder conversion must return structured missing item details",
);
assertContains(
  "client/src/pages/reorder.tsx",
  /REORDER_ITEM_MISSING[\s\S]*Open item/,
  "reorder UI must show missing linked item repair guidance",
);

assertContains(
  "server/modules/rbac/register-rbac-routes.ts",
  /alreadyRemoved:\s*true/,
  "custom role permission double-delete must be idempotent",
);
assertContains(
  "client/src/components/user/role-manager.tsx",
  /invalidateQueries\(\{ queryKey: \["\/api\/custom-roles", variables\.roleId, "permissions"\]/,
  "custom role UI must refetch permissions after removal",
);

assertContains(
  "client/src/lib/queryClient.ts",
  /CONTROLLED_BUSINESS_RULE_CODES[\s\S]*SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED[\s\S]*REORDER_ITEM_MISSING[\s\S]*PLAN_LIMIT_REACHED[\s\S]*FEATURE_NOT_INCLUDED[\s\S]*SUBSCRIPTION_INACTIVE[\s\S]*TRIAL_EXPIRED[\s\S]*PAYMENT_BATCH_SELF_APPROVAL_BLOCKED[\s\S]*controlledBusinessRule[\s\S]*\?\s*"info"/,
  "expected business-rule responses must be treated as controlled validation/info diagnostics",
);
assertContains(
  "client/src/lib/queryClient.ts",
  /alreadyRemoved[\s\S]*controlledBusinessRule[\s\S]*return;/,
  "idempotent alreadyRemoved permission deletes must not become unresolved action failures",
);

assertContains(
  "client/src/pages/control-tower/gas-ops-card.tsx",
  /GAS_SUMMARY_TIMEOUT_MS[\s\S]*gas-ops-unavailable/,
  "gas dashboard timeout must degrade without blocking control tower",
);

assertContains(
  "client/src/lib/electron-bridge.ts",
  /VITE_ELECTRON_BRIDGE_DEBUG[\s\S]*warnElectronBridge/,
  "ElectronBridge warnings must be debug gated in normal browser mode",
);
assertNotContains(
  "client/src/lib/electron-bridge.ts",
  /console\.warn\('Creating ElectronBridge in non-Electron environment'\)/,
  "ElectronBridge constructor must not warn loudly in browser mode",
);

for (const path of [
  "client/public/manifest.webmanifest",
  "client/src/pages/subscription.tsx",
  "docs/subscription-plans.md",
  "docs/production-approval-evidence.md",
  "electron/main.js",
  "electron/ipc-handlers.js",
  "shared/schema.ts",
]) {
  assertNotContains(path, /InvTrack/, `${path} must use ISSSourcing branding`);
  assertContains(path, /ISSSourcing/, `${path} should contain ISSSourcing branding`);
}

assertContains(
  "server/plan-limit-service.ts",
  /countOrganizationUsers[\s\S]*organization_members/,
  "subscription user limit must count organization users, not global users",
);
assertContains(
  "server/auth.ts",
  /createdOrganization[\s\S]*role: "owner"/,
  "public registration must create a new tenant and owner membership",
);
assertContains(
  "server/modules/organization/register-organization-routes.ts",
  /\/api\/organization\/members[\s\S]*ensureTwoFactorAuthenticated[\s\S]*countOrganizationUsers\(organizationId\)[\s\S]*ORGANIZATION_MEMBER_ADDED/,
  "organization membership creation must enforce 2FA, tenant plan limits, and audit evidence",
);

console.log("live diagnostics regression source checks passed");
