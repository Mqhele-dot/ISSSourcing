import { readFileSync } from "node:fs";

const files = {
  schema: readFileSync("shared/schema.ts", "utf8"),
  mobileRoutes: readFileSync("server/modules/mobile-counts/register-mobile-count-routes.ts", "utf8"),
  mobileService: readFileSync("server/modules/mobile-counts/mobile-count-service.ts", "utf8"),
  syncRoutes: readFileSync("server/modules/sync/register-sync-routes.ts", "utf8"),
  orgRoutes: readFileSync("server/modules/organization/register-organization-routes.ts", "utf8"),
  securityMiddleware: readFileSync("server/bootstrap/security-middleware.ts", "utf8"),
  planLimits: readFileSync("server/plan-limit-service.ts", "utf8"),
  inventoryRoutes: readFileSync("server/modules/inventory/register-inventory-routes.ts", "utf8"),
  warehouseRoutes: readFileSync("server/modules/warehouses/register-warehouse-routes.ts", "utf8"),
  registry: readFileSync("server/org-feature-registry.ts", "utf8"),
  configRegistry: readFileSync("server/company-configuration-registry.ts", "utf8"),
  router: readFileSync("client/src/router.tsx", "utf8"),
  appRoutes: readFileSync("client/src/lib/routes/app-routes.ts", "utf8"),
  mobilePage: readFileSync("client/src/pages/mobile-counts.tsx", "utf8"),
  securitySettingsForm: readFileSync("client/src/components/settings/security-settings-form.tsx", "utf8"),
  serviceWorker: readFileSync("client/public/sw.js", "utf8"),
  offlineQueue: readFileSync("client/src/lib/offline-queue.ts", "utf8"),
  syncValidators: readFileSync("server/modules/sync/validators.ts", "utf8"),
  warehouseTransferRoutes: readFileSync("server/routes/warehouse-transfer-routes.ts", "utf8"),
  warehouseTransferPage: readFileSync("client/src/pages/multi-warehouse-transfers.tsx", "utf8"),
  paymentDialog: readFileSync("client/src/components/billing/payment-dialog.tsx", "utf8"),
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
      files.schema.includes("failureReason") &&
      files.schema.includes("appliedAt") &&
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
    name: "mobile counts are scan-first with location capture",
    ok:
      files.mobileRoutes.includes('"/api/mobile/scan/resolve"') &&
      files.mobileService.includes("resolveMobileCountScanValue") &&
      files.mobileService.includes("SCAN_VALUE_AMBIGUOUS") &&
      files.mobileService.includes("COUNT_LOCATION_REQUIRED") &&
      files.mobilePage.includes("Item fallback") &&
      files.mobilePage.includes("binCode"),
  },
  {
    name: "offline sync replays count mutations and preserves failures",
    ok:
      files.syncRoutes.includes("addMobileCountLine") &&
      files.syncRoutes.includes("submitMobileCountSession") &&
      files.syncRoutes.includes("mobile_count_spot") &&
      files.syncRoutes.includes("status: \"failed\"") &&
      files.syncRoutes.includes("results") &&
      files.offlineQueue.includes("applyFlushResults") &&
      files.offlineQueue.includes("replaceOfflineQueue") &&
      files.offlineQueue.includes("retryCount: (item.retryCount ?? 0) + 1") &&
      files.mobilePage.includes("mobile_count_submit") &&
      files.mobilePage.includes("Count submit queued offline"),
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
    name: "plan limits are enforced on backend writes",
    ok:
      files.planLimits.includes("USAGE_LIMIT_REACHED") &&
      files.inventoryRoutes.includes("ensurePlanLimitAllowsCreate") &&
      files.warehouseRoutes.includes("ensurePlanLimitAllowsCreate") &&
      files.registry.includes("starter: { users: 3, warehouses: 1, skus: 5000 }"),
  },
  {
    name: "subscription snapshot exposes access and usage diagnostics",
    ok:
      files.orgRoutes.includes("usageStatus") &&
      files.orgRoutes.includes("usageLimits") &&
      files.orgRoutes.includes("upgradeHints") &&
      files.orgRoutes.includes("access: diagnostics.access"),
  },
  {
    name: "Stripe webhooks verify signatures before entitlement processing",
    ok:
      files.securityMiddleware.includes("rawBody") &&
      files.orgRoutes.includes("stripe.webhooks.constructEvent") &&
      files.orgRoutes.includes("signatureState = \"verified\"") &&
      files.orgRoutes.includes("billingSubscriptions") &&
      files.orgRoutes.includes("checkout.sessions.create") &&
      files.orgRoutes.includes("billingPortal.sessions.create"),
  },
  {
    name: "company configuration center is registry-backed and plan-aware",
    ok:
      files.configRegistry.includes("COMPANY_CONFIGURATION_REGISTRY") &&
      files.configRegistry.includes("inventory.count.blindMode") &&
      files.configRegistry.includes("inventory.count.locationRequired") &&
      files.configRegistry.includes("inventory.variance.thresholdValue") &&
      files.mobileService.includes("inventory.variance.thresholdPct") &&
      files.configRegistry.includes("getConfigurationDefinitionsForPlan") &&
      files.orgRoutes.includes('"/api/company-configuration"'),
  },
  {
    name: "security settings form uses persisted policy instead of fake save",
    ok:
      files.securitySettingsForm.includes('"/api/company-configuration"') &&
      files.securitySettingsForm.includes("security.requireTwoFactor") &&
      files.securitySettingsForm.includes("Organization Security Policy") &&
      !files.securitySettingsForm.includes('console.log("Security settings submitted:') &&
      !files.securitySettingsForm.includes("In a real implementation"),
  },
  {
    name: "service worker caches mobile count shell",
    ok: files.serviceWorker.includes('"/m/counts"') && files.serviceWorker.includes("INVTRACK_OFFLINE_QUEUE_STATUS"),
  },
  {
    name: "package exposes upgrade regression test",
    ok: files.packageJson.includes('"test:invtrack-upgrade-plan"'),
  },
  {
    name: "warehouse transfers do not fabricate persistence",
    ok:
      files.warehouseTransferRoutes.includes("sendWarehouseTransfersUnavailable") &&
      files.warehouseTransferRoutes.includes("FEATURE_DISABLED") &&
      !files.warehouseTransferRoutes.includes("Math.random") &&
      !files.warehouseTransferRoutes.includes("For now, return empty array") &&
      files.warehouseTransferPage.includes("Warehouse transfers are planned") &&
      files.warehouseTransferPage.includes("disabled={transfersUnavailable}"),
  },
  {
    name: "card payment dialog does not fake Stripe processing",
    ok:
      files.paymentDialog.includes("Hosted card payment not available here") &&
      files.paymentDialog.includes("processed externally") &&
      !files.paymentDialog.includes("would be initiated here") &&
      !files.paymentDialog.includes("recording as a manual payment"),
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
