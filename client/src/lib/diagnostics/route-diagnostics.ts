const KNOWN_PAGE_ROOTS = [
  "inventory-page",
  "purchase-orders-page",
  "accounts-payable-page",
  "analytics-overview-page",
  "admin-settings-page",
  "system-diagnostics-page",
  "get-educated-page",
];

export type RouteRenderHealth = {
  ok: boolean;
  route: string;
  message: string;
  matchedSelector?: string;
};

function expectedSelectorsForRoute(route: string): string[] {
  const path = route.split("?")[0] ?? route;
  const selectors = [`[data-testid="page-title"]`, `[data-testid="app-shell"]`];

  if (path === "/inventory") selectors.unshift(`[data-testid="inventory-page"]`);
  if (path.startsWith("/procurement/orders")) selectors.unshift(`[data-testid="purchase-orders-page"]`);
  if (path.startsWith("/finance/accounts-payable")) selectors.unshift(`[data-testid="accounts-payable-page"]`);
  if (path.startsWith("/analytics")) selectors.unshift(`[data-testid="analytics-overview-page"]`);
  if (path.startsWith("/admin/settings")) selectors.unshift(`[data-testid="admin-settings-page"]`);
  if (path === "/admin/system-diagnostics") selectors.unshift(`[data-testid="system-diagnostics-page"]`);
  if (path.startsWith("/get-educated")) selectors.unshift(`[data-testid="get-educated-page"]`);
  selectors.push(...KNOWN_PAGE_ROOTS.map((id) => `[data-testid="${id}"]`));
  return Array.from(new Set(selectors));
}

export function checkRouteRenderHealth(route: string): RouteRenderHealth {
  if (typeof document === "undefined") {
    return { ok: true, route, message: "Document is not available." };
  }
  for (const selector of expectedSelectorsForRoute(route)) {
    if (document.querySelector(selector)) {
      return {
        ok: true,
        route,
        message: "Expected page marker found.",
        matchedSelector: selector,
      };
    }
  }
  return {
    ok: false,
    route,
    message: `No known page marker was visible after 8 seconds for ${route}.`,
  };
}
