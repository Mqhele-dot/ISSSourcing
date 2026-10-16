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
expectIncludes("quotation list expects quotation workspace", "/procurement/quotations", `[data-testid="quotations-page"]`);
expectIncludes("commercial quotation create expects builder", "/procurement/quotations/new", `[data-testid="commercial-quotation-builder"]`);
expectIncludes("supplier quotation capture expects sourcing form", "/procurement/quotations/supplier-new", `[data-testid="quotation-create-page"]`);
expectIncludes("commercial quotation list expects workspace", "/procurement/commercial-quotations", `[data-testid="commercial-quotations-page"]`);
expectIncludes("commercial quotation edit expects builder", "/procurement/commercial-quotations/42/edit", `[data-testid="commercial-quotation-builder"]`);
expectIncludes("commercial quotation detail expects detail", "/procurement/commercial-quotations/42", `[data-testid="commercial-quotation-detail"]`);
expectIncludes("quotation detail expects quotation review", "/procurement/quotations/42", `[data-testid="quotation-review-page"]`);
expectIncludes("procurement orders expects purchase orders page", "/procurement/orders", `[data-testid="purchase-orders-page"]`);
expectIncludes("procurement order detail expects PO detail page", "/procurement/orders/PO-TEST", `[data-testid="po-detail-page"]`);
expectIncludes("procurement contracts expects contracts page", "/procurement/contracts", `[data-testid="contracts-page"]`);
expectIncludes("warehouse operations has route marker", "/warehouse-operations", `[data-testid="warehouse-operations-page"]`);
expectIncludes("mobile home has route marker", "/m/home", `[data-testid="mobile-hub-home-page"]`);
expectIncludes("mobile tasks has route marker", "/m/tasks", `[data-testid="mobile-hub-tasks-page"]`);
expectIncludes("mobile counts list has route marker", "/m/counts", `[data-testid="mobile-counts-page"]`);
expectIncludes("mobile count detail has route marker", "/m/counts/42", `[data-testid="mobile-count-session-page"]`);
expectIncludes("mobile count review has route marker", "/m/counts/42/review", `[data-testid="mobile-count-session-page"]`);
expectIncludes("mobile scan has route marker", "/m/scan", `[data-testid="barcode-scanner-page"]`);
expectIncludes("mobile approvals has route marker", "/m/approvals", `[data-testid="mobile-approvals-page"]`);
expectIncludes("mobile receive queue has route marker", "/m/receive", `[data-testid="mobile-receive-queue"]`);
expectIncludes("mobile receive detail has route marker", "/m/receive/PO-42", `[data-testid="mobile-receive-detail"]`);
expectIncludes("mobile pick has route marker", "/m/pick", `[data-testid="mobile-pick-page"]`);
expectIncludes("mobile more has route marker", "/m/more", `[data-testid="mobile-hub-more-page"]`);
expectIncludes("master data has route marker", "/admin/master-data", `[data-testid="master-data-page"]`);
expectIncludes("company setup has route marker", "/admin/company-setup", `[data-testid="company-setup-page"]`);
expectEmpty("unknown routes return no configured contract", "/unknown-release-cleanup-route");

expectIncludes("system diagnostics has route marker", "/admin/system-diagnostics", `[data-testid="system-diagnostics-page"]`);

expectIncludes("control tower has route marker", "/operations/control-tower", `[data-testid="control-tower-page"]`);

console.log(`\nRoute diagnostics result: ${failures} failure(s)`);
exitTest(failures > 0 ? 1 : 0);
