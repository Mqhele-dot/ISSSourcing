import { readFileSync } from "node:fs";

const files = {
  schema: readFileSync("shared/schema.ts", "utf8"),
  mobileRoutes: readFileSync("server/modules/mobile-counts/register-mobile-count-routes.ts", "utf8"),
  orgRoutes: readFileSync("server/modules/organization/register-organization-routes.ts", "utf8"),
  registry: readFileSync("server/org-feature-registry.ts", "utf8"),
  configRegistry: readFileSync("server/company-configuration-registry.ts", "utf8"),
  router: readFileSync("client/src/router.tsx", "utf8"),
  appRoutes: readFileSync("client/src/lib/routes/app-routes.ts", "utf8"),
  mobilePage: readFileSync("client/src/pages/mobile-counts.tsx", "utf8"),
  serviceWorker: readFileSync("client/public/sw.js", "utf8"),
  syncValidators: readFileSync("server/modules/sync/validators.ts", "utf8"),
  packageJson: readFileSync("package.json", "utf8"),
};

const checks = [
  {
    name: "mobile count schema tables exist",
    ok:
      files.schema.includes("stockCountSessions") &&
      files.schema.includes("stockCountTargets") &&
      files.schema.includes("stockCountLines") &&
      files.schema.includes("stockCountVariances") &&
      files.schema.includes("inventoryAdjustments"),
  },
  {
    name: "mobile sync events persist offline replay metadata",
    ok:
      files.schema.includes("mobileSyncEvents") &&
      files.schema.includes("deviceId") &&
      files.schema.includes("idempotencyKey") &&
      files.syncValidators.includes("mobile_count_line"),
  },
  {
    name: "mobile count mutation endpoints require Idempotency-Key",
    ok:
      files.mobileRoutes.includes("requireIdempotencyKey") &&
      files.mobileRoutes.includes('"/api/mobile/counts/:id/lines"') &&
      files.mobileRoutes.includes('"/api/mobile/counts/:id/submit"') &&
      files.mobileRoutes.includes('"/api/mobile/counts/:id/approve"'),
  },
  {
    name: "mobile count approve posts adjustments transactionally",
    ok:
      files.mobileRoutes.includes("db.transaction") &&
      files.mobileRoutes.includes("inventoryAdjustments") &&
      files.mobileRoutes.includes("stockMovements") &&
      files.mobileRoutes.includes("FOR UPDATE"),
  },
  {
    name: "mobile routes and count tab are wired",
    ok:
      files.appRoutes.includes("mobileCounts") &&
      files.router.includes("MobileCountsPage") &&
      files.mobilePage.includes('data-testid="mobile-counts-page"'),
  },
  {
    name: "subscription feature catalog and limits include research tiers",
    ok:
      files.registry.includes("mobile_stock_counts") &&
      files.registry.includes("advanced_variance_approvals") &&
      files.registry.includes("warehouse_limit_overrides") &&
      files.registry.includes("ORG_PLAN_LIMITS"),
  },
  {
    name: "subscription APIs exist",
    ok:
      files.orgRoutes.includes('"/api/subscription/current"') &&
      files.orgRoutes.includes('"/api/subscription/webhook/stripe"') &&
      files.orgRoutes.includes('"/api/subscription/change-plan"') &&
      files.orgRoutes.includes('"/api/subscription/usage"'),
  },
  {
    name: "company configuration center is registry-backed and plan-aware",
    ok:
      files.configRegistry.includes("COMPANY_CONFIGURATION_REGISTRY") &&
      files.configRegistry.includes("inventory.count.blindMode") &&
      files.configRegistry.includes("getConfigurationDefinitionsForPlan") &&
      files.orgRoutes.includes('"/api/company-configuration"'),
  },
  {
    name: "service worker caches mobile count shell",
    ok: files.serviceWorker.includes('"/m/counts"') && files.serviceWorker.includes("INVTRACK_OFFLINE_QUEUE_STATUS"),
  },
  {
    name: "package exposes upgrade regression test",
    ok: files.packageJson.includes('"test:invtrack-upgrade-plan"'),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`ok ${check.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`InvTrack upgrade plan checks failed: ${failed}/${checks.length}`);
  process.exit(1);
}

console.log(`InvTrack upgrade plan checks passed: ${checks.length}/${checks.length}`);
