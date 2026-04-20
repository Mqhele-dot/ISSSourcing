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
import { APP_ROUTES } from "../client/src/lib/routes/app-routes.ts";

function main() {
  assert.equal(APP_ROUTES.procurement.supplier(42), "/procurement/suppliers/42");
  assert.equal(inferActionErrorSeverity("POST", 200), "mutation");
  assert.equal(inferActionErrorSeverity("GET", 404), "background");
  assert.equal(inferActionErrorSeverity("GET", 502), "blocking");

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
  assert.equal(pickLatestForFab([bgRecord])?.id, undefined);
  assert.equal(pickLatestForFab([bgRecord, mutationRecord])?.id, "m1");

  console.log("test-stabilization-client: all checks passed");
}

main();
