/**
 * Fast regression checks for InvTrack client stabilization (no browser, no server).
 * Run: npm run test:stabilization-client
 */
import assert from "node:assert/strict";
import {
  actionErrorStore,
  inferActionErrorSeverity,
  pickLatestForFab,
} from "../client/src/lib/action-error-store.ts";
import { shouldSuppressGlobalError } from "../client/src/lib/queryClient.ts";
import { createReportingMoneyFormatter } from "../client/src/lib/format/reporting-money.ts";
import { deriveAppReadinessPhase } from "../client/src/lib/app-readiness-state.ts";
import { APP_ROUTES } from "../client/src/lib/routes/app-routes.ts";
import {
  APP_NAV_SECTIONS,
  COMMAND_MENU_SECONDARY_GROUPS,
  SIDEBAR_ADMIN_SECONDARY_GROUPS,
} from "../client/src/lib/routes/section-metadata.ts";
import {
  parseSupplierRouteId,
  SUPPLIER_DETAIL_ROUTE_PATTERN,
} from "../client/src/lib/supplier-detail-route.ts";

const MOBILE_PATH = /^\/m(\/|$)/;

function main() {
  const operationsSection = APP_NAV_SECTIONS.find((s) => s.key === "operations");
  assert.ok(operationsSection, "operations section exists");
  for (const item of operationsSection!.items) {
    assert.equal(
      MOBILE_PATH.test(item.path),
      false,
      `operations primary nav must not point at mobile shell: ${item.label} -> ${item.path}`,
    );
    assert.notEqual(
      item.label,
      "Mobile hub",
      "legacy Mobile hub label must not appear in primary operations nav",
    );
  }
  const frontline = COMMAND_MENU_SECONDARY_GROUPS.find((g) => g.heading.includes("Frontline"));
  assert.ok(frontline?.items.some((i) => i.label === "Mobile workflows launcher"));
  assert.ok(SIDEBAR_ADMIN_SECONDARY_GROUPS.length >= 3);
  for (const g of SIDEBAR_ADMIN_SECONDARY_GROUPS) {
    assert.ok(g.heading.startsWith("Admin"));
  }

  assert.equal(APP_ROUTES.procurement.supplier(42), "/procurement/suppliers/42");
  assert.equal(APP_ROUTES.procurement.supplier(":id"), SUPPLIER_DETAIL_ROUTE_PATTERN);
  assert.deepEqual(parseSupplierRouteId("42"), { ok: true, id: 42 });
  assert.deepEqual(parseSupplierRouteId("0"), { ok: false });
  assert.deepEqual(parseSupplierRouteId("-1"), { ok: false });
  assert.deepEqual(parseSupplierRouteId("abc"), { ok: false });
  assert.deepEqual(parseSupplierRouteId(undefined), { ok: false });

  assert.equal(
    deriveAppReadinessPhase({
      readyPending: false,
      readyError: false,
      readyData: undefined,
      setupQueryActive: true,
      setupPending: false,
      setupError: true,
      setupFetched: true,
      setupData: undefined,
    }),
    "setup_check_temporarily_failed",
  );
  assert.equal(
    deriveAppReadinessPhase({
      readyPending: false,
      readyError: false,
      readyData: { productBootstrap: { organizationCount: 0, needsFirstRunOnboarding: true } } as any,
      setupQueryActive: true,
      setupPending: false,
      setupError: false,
      setupFetched: true,
      setupData: { onboarding: { required: false } } as any,
    }),
    "first_run_required",
  );
  assert.equal(
    deriveAppReadinessPhase({
      readyPending: false,
      readyError: false,
      readyData: undefined,
      setupQueryActive: false,
      setupPending: false,
      setupError: false,
      setupFetched: false,
      setupData: undefined,
    }),
    "pending",
  );
  assert.equal(
    deriveAppReadinessPhase({
      readyPending: false,
      readyError: false,
      readyData: undefined,
      setupQueryActive: true,
      setupPending: false,
      setupError: false,
      setupFetched: false,
      setupData: undefined,
    }),
    "pending",
  );

  const gbp = createReportingMoneyFormatter("GBP");
  const gbpText = gbp.formatMoney(99.99);
  assert.ok(!gbpText.includes("USD"), `expected no USD in GBP format: ${gbpText}`);
  assert.equal(inferActionErrorSeverity("POST", 200), "mutation");
  assert.equal(inferActionErrorSeverity("GET", 404), "background");
  assert.equal(inferActionErrorSeverity("GET", 502), "important_warning");

  assert.equal(shouldSuppressGlobalError("GET", undefined, "/api/setup/status"), true);
  assert.equal(shouldSuppressGlobalError("GET", 500, "/api/setup/status"), true);
  assert.equal(shouldSuppressGlobalError("GET", 408, "/api/inventory"), true);
  assert.equal(shouldSuppressGlobalError("POST", 500, "/api/setup/status"), false);
  assert.equal(shouldSuppressGlobalError("GET", 401, "/api/user"), true);
  assert.equal(shouldSuppressGlobalError("GET", 403, "/api/inventory"), false);

  const eur = createReportingMoneyFormatter("EUR");
  const eurText = eur.formatMoney(1234.56);
  assert.ok(!eurText.includes("USD"), `expected no USD in formatted amount: ${eurText}`);
  assert.ok(/\d/.test(eurText), `expected digits in formatted amount: ${eurText}`);

  actionErrorStore.clearAll();
  const base = {
    method: "GET",
    endpoint: "/api/__stabilization_test__/probe",
    reason: "probe failure",
  };
  actionErrorStore.push({ ...base });
  actionErrorStore.push({ ...base });
  const list = actionErrorStore.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.occurrenceCount, 2);

  const mutationRecord = {
    id: "m1",
    timestamp: new Date().toISOString(),
    severity: "mutation" as const,
    method: "POST",
    endpoint: "/api/x",
    reason: "fail",
  };
  const bgRecord = {
    id: "b1",
    timestamp: new Date().toISOString(),
    severity: "background" as const,
    method: "GET",
    endpoint: "/api/y",
    reason: "noise",
  };
  const warnRecord = {
    id: "w1",
    timestamp: new Date().toISOString(),
    severity: "important_warning" as const,
    method: "GET",
    endpoint: "/api/z",
    reason: "502",
    status: 502,
  };
  assert.equal(pickLatestForFab([bgRecord])?.id, undefined);
  assert.equal(pickLatestForFab([warnRecord])?.id, undefined);
  assert.equal(pickLatestForFab([bgRecord, mutationRecord])?.id, "m1");

  console.log("test-stabilization-client: all checks passed");
}

main();
