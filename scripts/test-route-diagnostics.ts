import { exitTest } from "./test-exit.ts";
import { expectedSelectorsForRoute } from "../client/src/lib/diagnostics/route-diagnostics.ts";

let failures = 0;

function expectIncludes(name: string, route: string, selector: string) {
  const selectors = expectedSelectorsForRoute(route);
  if (selectors.includes(selector)) {
    console.log("  ✓ %s", name);
    return;
  }
  failures += 1;
  console.log("  ✗ %s -> expected %s in %j", name, selector, selectors);
}

function expectExcludes(name: string, route: string, selector: string) {
  const selectors = expectedSelectorsForRoute(route);
  if (!selectors.includes(selector)) {
    console.log("  ✓ %s", name);
    return;
  }
  failures += 1;
  console.log("  ✗ %s -> did not expect %s in %j", name, selector, selectors);
}

function expectEmpty(name: string, route: string) {
  const selectors = expectedSelectorsForRoute(route);
  if (selectors.length === 0) {
    console.log("  ✓ %s", name);
    return;
  }
  failures += 1;
  console.log("  ✗ %s -> expected no contract, got %j", name, selectors);
}

console.log("Route diagnostics contract tests\n");

expectExcludes("app-shell is not a success marker", "/procurement/requisitions", `[data-testid="app-shell"]`);
expectExcludes("page-title is not enough", "/procurement/requisitions", `[data-testid="page-title"]`);
expectIncludes("requisition new expects form page", "/procurement/requisitions/new", `[data-testid="requisition-form-page"]`);
expectIncludes("requisition list expects requisitions page", "/procurement/requisitions", `[data-testid="requisitions-page"]`);
expectIncludes("supplier portal expects supplier portal page", "/supplier-portal", `[data-testid="supplier-portal-page"]`);
expectIncludes("procurement orders expects purchase orders page", "/procurement/orders", `[data-testid="purchase-orders-page"]`);
expectIncludes("procurement order detail expects PO detail page", "/procurement/orders/PO-TEST", `[data-testid="po-detail-page"]`);
expectIncludes("warehouse operations has route marker", "/warehouse-operations", `[data-testid="warehouse-operations-page"]`);
expectIncludes("master data has route marker", "/admin/master-data", `[data-testid="master-data-page"]`);
expectEmpty("unknown routes return no configured contract", "/unknown-release-cleanup-route");

expectIncludes("system diagnostics has route marker", "/admin/system-diagnostics", `[data-testid="system-diagnostics-page"]`);

console.log(`\nRoute diagnostics result: ${failures} failure(s)`);
exitTest(failures > 0 ? 1 : 0);
