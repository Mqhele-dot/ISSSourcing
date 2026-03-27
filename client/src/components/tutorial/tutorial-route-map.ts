export type PageTourMeta = { tourId: string; label: string };

/** First matching rule wins — order from most specific path to general. */
const RULES: { test: (path: string) => boolean; meta: PageTourMeta }[] = [
  {
    test: (p) => /^\/inventory\/[^/]+$/.test(p),
    meta: { tourId: "page-inventory-detail", label: "This SKU" },
  },
  {
    test: (p) => {
      const m = p.match(/^\/(?:purchase|orders)\/([^/]+)$/);
      if (!m) return false;
      const seg = m[1];
      return seg !== "requisitions" && seg !== "new";
    },
    meta: { tourId: "page-purchase-detail", label: "This PO" },
  },
  {
    test: (p) => /^\/exceptions\/[^/]+$/.test(p),
    meta: { tourId: "page-exception-detail", label: "This exception" },
  },
  {
    test: (p) => /^\/logistics\/[^/]+$/.test(p),
    meta: { tourId: "page-logistics-detail", label: "This shipment" },
  },
  { test: (p) => p === "/inventory", meta: { tourId: "page-inventory", label: "Inventory" } },
  { test: (p) => p === "/exceptions", meta: { tourId: "page-exceptions", label: "Exceptions" } },
  { test: (p) => p === "/logistics", meta: { tourId: "page-logistics", label: "Logistics" } },
  {
    test: (p) =>
      p === "/purchase" ||
      p === "/orders" ||
      p.startsWith("/purchase/") ||
      p.startsWith("/orders/"),
    meta: { tourId: "page-purchase", label: "Purchase" },
  },
  { test: (p) => p === "/integrations", meta: { tourId: "page-integrations", label: "Integrations" } },
  { test: (p) => p === "/reports", meta: { tourId: "page-reports", label: "Reports" } },
  { test: (p) => p === "/documents", meta: { tourId: "page-documents", label: "Documents" } },
  { test: (p) => p === "/supply-analytics", meta: { tourId: "page-supply-analytics", label: "Supply analytics" } },
  { test: (p) => p === "/suppliers", meta: { tourId: "page-suppliers", label: "Suppliers" } },
  { test: (p) => p === "/warehouses", meta: { tourId: "page-warehouses", label: "Warehouses" } },
  { test: (p) => p === "/analytics", meta: { tourId: "page-analytics", label: "Analytics" } },
  { test: (p) => p === "/dashboard", meta: { tourId: "page-dashboard", label: "Dashboard" } },
  { test: (p) => p === "/settings", meta: { tourId: "page-settings", label: "Settings" } },
  { test: (p) => p === "/user-roles", meta: { tourId: "page-users", label: "User roles" } },
  { test: (p) => p === "/control-tower", meta: { tourId: "page-control-tower", label: "Control tower" } },
  { test: (p) => p === "/", meta: { tourId: "page-home", label: "Overview" } },
];

export function normalizeAppPath(pathname: string): string {
  const raw = pathname.split("?")[0] || "/";
  if (raw === "/") return "/";
  return raw.replace(/\/$/, "") || "/";
}

/** Whether we should navigate before starting a tour (avoids kicking users off detail URLs under the same prefix). */
export function needsNavigateForTour(currentPath: string, targetRoute: string): boolean {
  const p = normalizeAppPath(currentPath);
  const t = normalizeAppPath(targetRoute);
  if (t === "/") return p !== "/";
  return !(p === t || p.startsWith(`${t}/`));
}

export function getPageTourForPath(pathname: string): PageTourMeta | null {
  const p = normalizeAppPath(pathname);
  for (const rule of RULES) {
    if (rule.test(p)) return rule.meta;
  }
  return null;
}

export function pageTourStorageKey(tourId: string) {
  return `invtrack:pageTourDismissed:${tourId}`;
}

/** First path segment to open before starting a tour from the help menu. */
export const TOUR_START_ROUTES: Record<string, string> = {
  "full-app": "/",
  main: "/dashboard",
  dashboard: "/dashboard",
  inventory: "/inventory",
  reports: "/reports",
  analytics: "/analytics",
  suppliers: "/suppliers",
  users: "/user-roles",
  settings: "/settings",
  database: "/settings",
  documents: "/documents",
  purchase: "/purchase",
  barcode: "/barcode-scanner",
  sync: "/sync-dashboard",
  billing: "/billing",
  "setup-wizard": "/dashboard",
  "page-home": "/",
  "page-control-tower": "/control-tower",
  "page-inventory": "/inventory",
  "page-inventory-detail": "/inventory",
  "page-exceptions": "/exceptions",
  "page-logistics": "/logistics",
  "page-purchase": "/purchase",
  "page-integrations": "/integrations",
  "page-reports": "/reports",
  "page-documents": "/documents",
  "page-supply-analytics": "/supply-analytics",
  "page-suppliers": "/suppliers",
  "page-warehouses": "/warehouses",
  "page-analytics": "/analytics",
  "page-dashboard": "/dashboard",
  "page-settings": "/settings",
  "page-users": "/user-roles",
  "page-purchase-detail": "/purchase",
  "page-exception-detail": "/exceptions",
  "page-logistics-detail": "/logistics",
};
