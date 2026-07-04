const ROUTE_MARKERS: Array<{ match: (path: string) => boolean; selectors: string[] }> = [
  { match: (path) => path === "/inventory", selectors: [`[data-testid="inventory-page"]`] },
  { match: (path) => path === "/inventory/warehouses" || path === "/warehouses", selectors: [`[data-testid="warehouses-page"]`] },
  { match: (path) => path === "/inventory/warehouse-operations" || path === "/warehouse-operations", selectors: [`[data-testid="warehouse-operations-page"]`] },
  { match: (path) => path === "/inventory/cycle-counts" || path === "/cycle-counts", selectors: [`[data-testid="cycle-counts-page"]`] },
  { match: (path) => path === "/inventory/reorder" || path === "/reorder", selectors: [`[data-testid="reorder-requests-page"]`] },
  { match: (path) => path === "/inventory/barcodes" || path === "/barcode-scanner", selectors: [`[data-testid="barcode-scanner-page"]`] },
  { match: (path) => path === "/m/home", selectors: [`[data-testid="mobile-hub-home-page"]`] },
  { match: (path) => path === "/m/tasks", selectors: [`[data-testid="mobile-hub-tasks-page"]`] },
  { match: (path) => path === "/m/counts", selectors: [`[data-testid="mobile-counts-page"]`] },
  { match: (path) => /^\/m\/counts\/[^/]+(?:\/review)?$/.test(path), selectors: [`[data-testid="mobile-count-session-page"]`] },
  { match: (path) => path === "/m/scan", selectors: [`[data-testid="barcode-scanner-page"]`] },
  { match: (path) => path === "/m/approvals", selectors: [`[data-testid="mobile-approvals-page"]`] },
  {
    match: (path) => path === "/m/receive" || /^\/m\/receive\/[^/]+$/.test(path),
    selectors: [`[data-testid="mobile-receive-queue"]`, `[data-testid="mobile-receive-detail"]`],
  },
  { match: (path) => path === "/m/pick", selectors: [`[data-testid="mobile-pick-page"]`] },
  { match: (path) => path === "/m/more", selectors: [`[data-testid="mobile-hub-more-page"]`] },
  { match: (path) => path.startsWith("/inventory/"), selectors: [`[data-testid="inventory-detail-page"]`] },
  { match: (path) => path.startsWith("/procurement/orders/"), selectors: [`[data-testid="po-detail-page"]`] },
  { match: (path) => path.startsWith("/procurement/orders") || path === "/orders" || path === "/purchase", selectors: [`[data-testid="purchase-orders-page"]`, `[data-testid="po-table"]`] },
  { match: (path) => path === "/procurement/requisitions/new" || path === "/requisitions/new", selectors: [`[data-testid="requisition-form-page"]`] },
  { match: (path) => /^\/procurement\/requisitions\/[^/]+$/.test(path) || /^\/requisitions\/[^/]+$/.test(path), selectors: [`[data-testid="requisition-form-page"]`] },
  { match: (path) => path.startsWith("/procurement/requisitions") || path.startsWith("/requisitions"), selectors: [`[data-testid="requisitions-page"]`] },
  { match: (path) => path === "/procurement/suppliers" || path === "/suppliers", selectors: [`[data-testid="suppliers-page"]`] },
  { match: (path) => path === "/procurement/contracts" || path === "/contracts", selectors: [`[data-testid="contracts-page"]`] },
  { match: (path) => path.startsWith("/supplier-portal") || path === "/procurement/supplier-portal", selectors: [`[data-testid="supplier-portal-page"]`] },
  { match: (path) => path.startsWith("/finance/accounts-payable"), selectors: [`[data-testid="accounts-payable-page"]`] },
  { match: (path) => path === "/reports" || path.startsWith("/analytics/reports"), selectors: [`[data-testid="reports-page"]`] },
  { match: (path) => path === "/export-center" || path === "/analytics/export-center", selectors: [`[data-testid="export-center-page"]`] },
  { match: (path) => path.startsWith("/analytics"), selectors: [`[data-testid="analytics-overview-page"]`, `[data-testid="reports-page"]`, `[data-testid="export-center-page"]`] },
  { match: (path) => path.startsWith("/admin/settings"), selectors: [`[data-testid="admin-settings-page"]`] },
  { match: (path) => path.startsWith("/admin/subscription"), selectors: [`[data-testid="subscription-admin-page"]`] },
  { match: (path) => path.startsWith("/admin/master-data"), selectors: [`[data-testid="master-data-page"]`] },
  { match: (path) => path.startsWith("/admin/document-extractor") || path.startsWith("/documents/extractor"), selectors: [`[data-testid="document-extractor-page"]`] },
  { match: (path) => path === "/admin/system-diagnostics", selectors: [`[data-testid="system-diagnostics-page"]`] },
  { match: (path) => path === "/operations/control-tower" || path === "/control-tower", selectors: [`[data-testid="control-tower-page"]`] },
  { match: (path) => path.startsWith("/get-educated"), selectors: [`[data-testid="get-educated-page"]`] },
];

export type RouteRenderHealth = {
  ok: boolean;
  route: string;
  message: string;
  matchedSelector?: string;
};

export function expectedSelectorsForRoute(routePath: string): string[] {
  const path = routePath.split("?")[0] ?? routePath;
  const routeContract = ROUTE_MARKERS.find((entry) => entry.match(path));
  return routeContract ? Array.from(new Set(routeContract.selectors)) : [];
}

export function checkRouteRenderHealth(route: string): RouteRenderHealth {
  if (typeof document === "undefined") {
    return { ok: true, route, message: "Document is not available." };
  }
  const selectors = expectedSelectorsForRoute(route);
  if (selectors.length === 0) {
    return { ok: true, route, message: "No route-specific marker contract is configured." };
  }
  for (const selector of selectors) {
    if (document.querySelector(selector)) {
      return {
        ok: true,
        route,
        message: "Expected route-specific page marker found.",
        matchedSelector: selector,
      };
    }
  }
  return {
    ok: false,
    route,
    message: `No route-specific page marker was visible for ${route} after delayed checks.`,
  };
}
