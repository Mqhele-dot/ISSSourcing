type RouteImporter = () => Promise<unknown>;

const routeImporters: Array<[prefix: string, load: RouteImporter]> = [
  ["/operations/control-tower", () => import("@/pages/control-tower")],
  ["/operations/logistics", () => import("@/pages/logistics")],
  ["/operations", () => import("@/pages/operations-overview-page")],
  ["/inventory/reorder", () => import("@/pages/reorder")],
  ["/inventory", () => import("@/pages/inventory")],
  ["/procurement/orders", () => import("@/pages/orders")],
  ["/procurement/overview", () => import("@/pages/procurement-overview")],
  ["/procurement/receiving", () => import("@/pages/procurement-receiving")],
  ["/procurement/settings", () => import("@/pages/procurement-settings")],
  ["/procurement/requisitions", () => import("@/pages/requisitions")],
  ["/procurement/sourcing", () => import("@/pages/sourcing")],
  ["/finance/accounts-payable", () => import("@/pages/accounts-payable")],
  ["/finance/invoices", () => import("@/pages/invoices")],
  ["/analytics/reports", () => import("@/pages/reports")],
  ["/admin/master-data", () => import("@/pages/master-data")],
  ["/admin/settings", () => import("@/pages/settings")],
  ["/admin/workflows", () => import("@/pages/workflow-governance")],
  ["/admin/system-diagnostics", () => import("@/pages/system-diagnostics-page")],
];

const loaded = new Set<RouteImporter>();

export function prefetchRouteChunk(path: string): void {
  const pathname = path.split("?", 1)[0];
  const match = routeImporters.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!match || loaded.has(match[1])) return;
  loaded.add(match[1]);
  void match[1]().catch(() => loaded.delete(match[1]));
}

export function prefetchPrimaryRouteChunks(): void {
  for (const path of [
    "/operations/control-tower",
    "/inventory",
    "/procurement/requisitions",
    "/procurement/overview",
    "/finance/accounts-payable",
    "/finance/invoices",
    "/analytics/reports",
    "/admin/master-data",
    "/admin/settings",
    "/inventory/reorder",
  ]) prefetchRouteChunk(path);
}
