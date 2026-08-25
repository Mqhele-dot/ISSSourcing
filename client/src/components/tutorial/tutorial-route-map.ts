import { APP_ROUTES } from "@/lib/routes/app-routes";

export type PageTourMeta = { tourId: string; label: string };

/** First matching rule wins — order from most specific path to general. */
const RULES: { test: (path: string) => boolean; meta: PageTourMeta }[] = [
  {
    test: (p) => ([
      APP_ROUTES.inventory.reorder,
      APP_ROUTES.inventory.barcodeScanner,
      APP_ROUTES.inventory.warehouses,
      APP_ROUTES.inventory.cycleCounts,
      APP_ROUTES.inventory.warehouseOperations,
    ] as string[]).includes(p),
    meta: { tourId: "page-inventory", label: "Inventory" },
  },
  {
    test: (p) => /^\/inventory\/[^/]+$/.test(p),
    meta: { tourId: "page-inventory-detail", label: "This SKU" },
  },
  {
    test: (p) => {
      const m = p.match(/^\/procurement\/orders\/([^/]+)$/);
      if (!m) return false;
      const seg = m[1];
      return seg !== "requisitions" && seg !== "new";
    },
    meta: { tourId: "page-purchase-detail", label: "This PO" },
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
  { test: (p) => p === APP_ROUTES.inventory.root, meta: { tourId: "page-inventory", label: "Inventory" } },
  { test: (p) => p === APP_ROUTES.operations.exceptions, meta: { tourId: "page-exceptions", label: "Exceptions" } },
  { test: (p) => p === APP_ROUTES.operations.logistics, meta: { tourId: "page-logistics", label: "Logistics" } },
  {
    test: (p) =>
      p === APP_ROUTES.procurement.orders ||
      p === APP_ROUTES.procurement.requisitions ||
      p === "/purchase" ||
      p === "/orders" ||
      p.startsWith("/procurement/") ||
      p.startsWith("/purchase/") ||
      p.startsWith("/orders/"),
    meta: { tourId: "page-purchase", label: "Purchase" },
  },
  { test: (p) => p === APP_ROUTES.admin.integrations, meta: { tourId: "page-integrations", label: "Integrations" } },
  { test: (p) => p === APP_ROUTES.analytics.reports, meta: { tourId: "page-reports", label: "Reports" } },
  { test: (p) => p === APP_ROUTES.admin.documents, meta: { tourId: "page-documents", label: "Documents" } },
  {
    test: (p) => p === APP_ROUTES.analytics.procurement || p === "/supply-analytics",
    meta: { tourId: "page-supply-analytics", label: "Supply analytics" },
  },
  { test: (p) => p === APP_ROUTES.procurement.suppliers, meta: { tourId: "page-suppliers", label: "Suppliers" } },
  { test: (p) => p === APP_ROUTES.inventory.warehouses, meta: { tourId: "page-warehouses", label: "Warehouses" } },
  {
    test: (p) => p === APP_ROUTES.analytics.overview || p === "/dashboard",
    meta: { tourId: "page-dashboard", label: "Dashboard" },
  },
  {
    test: (p) =>
      p === APP_ROUTES.analytics.root ||
      p.startsWith(`${APP_ROUTES.analytics.root}/`) ||
      p === "/analytics",
    meta: { tourId: "page-analytics", label: "Analytics" },
  },
  { test: (p) => p === APP_ROUTES.admin.settings, meta: { tourId: "page-settings", label: "Settings" } },
  { test: (p) => p === APP_ROUTES.admin.workflows, meta: { tourId: "page-workflows", label: "Workflow governance" } },
  { test: (p) => p === APP_ROUTES.admin.companySetup, meta: { tourId: "page-company-setup", label: "Company setup" } },
  { test: (p) => p === APP_ROUTES.admin.userRoles, meta: { tourId: "page-users", label: "User roles" } },
  { test: (p) => p === APP_ROUTES.operations.controlTower, meta: { tourId: "page-control-tower", label: "Control tower" } },
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
  main: APP_ROUTES.analytics.overview,
  dashboard: APP_ROUTES.analytics.overview,
  inventory: APP_ROUTES.inventory.root,
  reports: APP_ROUTES.analytics.reports,
  analytics: APP_ROUTES.analytics.overview,
  suppliers: APP_ROUTES.procurement.suppliers,
  users: APP_ROUTES.admin.userRoles,
  settings: APP_ROUTES.admin.settings,
  database: APP_ROUTES.admin.settings,
  documents: APP_ROUTES.admin.documents,
  purchase: APP_ROUTES.procurement.orders,
  barcode: APP_ROUTES.inventory.barcodeScanner,
  sync: APP_ROUTES.admin.syncDashboard,
  billing: APP_ROUTES.finance.invoices,
  "setup-wizard": APP_ROUTES.analytics.overview,
  "page-home": "/",
  "page-control-tower": APP_ROUTES.operations.controlTower,
  "page-inventory": APP_ROUTES.inventory.root,
  "page-inventory-detail": APP_ROUTES.inventory.root,
  "page-exceptions": APP_ROUTES.operations.exceptions,
  "page-logistics": APP_ROUTES.operations.logistics,
  "page-purchase": APP_ROUTES.procurement.orders,
  "page-integrations": APP_ROUTES.admin.integrations,
  "page-reports": APP_ROUTES.analytics.reports,
  "page-documents": APP_ROUTES.admin.documents,
  "page-supply-analytics": APP_ROUTES.analytics.procurement,
  "page-suppliers": APP_ROUTES.procurement.suppliers,
  "page-warehouses": APP_ROUTES.inventory.warehouses,
  "page-analytics": APP_ROUTES.analytics.overview,
  "page-dashboard": APP_ROUTES.analytics.overview,
  "page-settings": APP_ROUTES.admin.settings,
  "page-company-setup": APP_ROUTES.admin.companySetup,
  "page-users": APP_ROUTES.admin.userRoles,
  "page-purchase-detail": APP_ROUTES.procurement.orders,
  "page-exception-detail": APP_ROUTES.operations.exceptions,
  "page-logistics-detail": APP_ROUTES.operations.logistics,
};
