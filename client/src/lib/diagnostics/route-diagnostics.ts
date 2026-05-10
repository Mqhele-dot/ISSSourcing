const ROUTE_MARKERS: Array<{ match: (path: string) => boolean; selectors: string[] }> = [
  { match: (path) => path === "/inventory", selectors: [`[data-testid="inventory-page"]`] },
  { match: (path) => path.startsWith("/inventory/"), selectors: [`[data-testid="inventory-detail-page"]`] },
  { match: (path) => path.startsWith("/procurement/orders/"), selectors: [`[data-testid="po-detail-page"]`] },
  { match: (path) => path.startsWith("/procurement/orders") || path === "/orders" || path === "/purchase", selectors: [`[data-testid="purchase-orders-page"]`, `[data-testid="po-table"]`] },
  { match: (path) => path.startsWith("/procurement/requisitions") || path.startsWith("/requisitions"), selectors: [`[data-testid="requisitions-page"]`] },
  { match: (path) => path.startsWith("/supplier-portal"), selectors: [`[data-testid="supplier-portal-page"]`] },
  { match: (path) => path.startsWith("/finance/accounts-payable"), selectors: [`[data-testid="accounts-payable-page"]`] },
  { match: (path) => path.startsWith("/analytics"), selectors: [`[data-testid="analytics-overview-page"]`, `[data-testid="reports-page"]`, `[data-testid="export-center-page"]`] },
  { match: (path) => path.startsWith("/admin/settings"), selectors: [`[data-testid="admin-settings-page"]`] },
  { match: (path) => path === "/admin/system-diagnostics", selectors: [`[data-testid="system-diagnostics-page"]`] },
  { match: (path) => path.startsWith("/get-educated"), selectors: [`[data-testid="get-educated-page"]`] },
];

export type RouteRenderHealth = {
  ok: boolean;
  route: string;
  message: string;
  matchedSelector?: string;
};

function expectedSelectorsForRoute(routePath: string): string[] {
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
    message: `No route-specific page marker was visible after 8 seconds for ${route}.`,
  };
}
