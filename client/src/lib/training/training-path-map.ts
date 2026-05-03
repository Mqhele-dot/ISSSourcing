import { APP_ROUTES } from "@/lib/routes/app-routes";

/** Map current pathname to training module id for contextual panel + Tutorial button. */
export function pathToTrainingModuleId(pathname: string): string | null {
  const raw = pathname.split("?")[0] || "/";
  const p = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;

  if (p === "/" || p === APP_ROUTES.operations.controlTower) return "control-tower";
  if (p === APP_ROUTES.inventory.root || p.startsWith(`${APP_ROUTES.inventory.root}/`)) {
    if (p === APP_ROUTES.inventory.warehouses || p.startsWith(`${APP_ROUTES.inventory.warehouses}/`)) return "warehouses";
    if (p === APP_ROUTES.inventory.warehouseOperations) return "warehouse-operations";
    if (p === APP_ROUTES.inventory.cycleCounts) return "cycle-counts";
    if (p === APP_ROUTES.inventory.reorder) return "reorder-requests";
    if (p === APP_ROUTES.inventory.barcodeScanner) return "barcode-scanner";
    return "inventory";
  }

  if (
    p === APP_ROUTES.procurement.orders ||
    p.startsWith(`${APP_ROUTES.procurement.orders}/`) ||
    p === "/purchase" ||
    p.startsWith("/purchase/") ||
    p === "/orders" ||
    p.startsWith("/orders/")
  ) {
    if (p.includes("requisitions")) return "requisitions";
    return "purchase-orders";
  }

  if (p === APP_ROUTES.procurement.suppliers || p.startsWith(`${APP_ROUTES.procurement.suppliers}/`)) return "suppliers";
  if (p === APP_ROUTES.procurement.contracts) return "contracts";

  if (p.startsWith(`${APP_ROUTES.finance.accountsPayable}/`) || p === APP_ROUTES.finance.accountsPayable) {
    if (p.includes("/payments")) return "payments";
    return "accounts-payable";
  }

  if (p === APP_ROUTES.analytics.overview || p === "/dashboard") return "analytics";
  if (
    p === APP_ROUTES.analytics.reports ||
    p.startsWith(`${APP_ROUTES.analytics.reports}/`) ||
    p === "/reports" /* legacy */
  ) {
    return "reports";
  }
  if (p.startsWith(APP_ROUTES.analytics.root + "/") || p === APP_ROUTES.analytics.root) {
    return "analytics";
  }

  if (p === APP_ROUTES.admin.settings || p.startsWith(`${APP_ROUTES.admin.settings}/`)) return "admin-settings";
  if (p === APP_ROUTES.admin.systemDiagnostics) return "system-diagnostics";

  return null;
}
