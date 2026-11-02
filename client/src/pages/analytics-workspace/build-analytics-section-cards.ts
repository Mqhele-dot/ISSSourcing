import { APP_ROUTES, type AnalyticsSectionSlug } from "@/lib/routes/app-routes";
import type {
  AnalyticsKpiCard,
  AnalyticsWorkspaceQueryBundle,
  AnalyticsWorkspaceSourceHealth,
} from "./analytics-workspace-types";

const defaultHealth: AnalyticsWorkspaceSourceHealth = {
  inventoryStats: true,
  controlTower: true,
  apOverview: true,
  spendAnalytics: true,
};

function warn(health: AnalyticsWorkspaceSourceHealth, key: keyof AnalyticsWorkspaceSourceHealth): string | undefined {
  return health[key] ? undefined : "This figure may be incomplete — the source data request failed.";
}

export function buildAnalyticsSectionCards(
  section: AnalyticsSectionSlug,
  { inventoryStats, controlTower, apOverview, spendAnalytics }: AnalyticsWorkspaceQueryBundle,
  formatMoney: (value: number | null | undefined) => string,
  health: AnalyticsWorkspaceSourceHealth = defaultHealth,
): AnalyticsKpiCard[] {
  const kpis = controlTower?.kpis ?? {};
  switch (section) {
    case "inventory": {
      let lowStockVal: string;
      let lowStockWarn: string | undefined;
      if (!health.controlTower && !health.inventoryStats) {
        lowStockVal = "—";
        lowStockWarn = "Low-stock KPI needs inventory stats or control tower.";
      } else if (health.controlTower && kpis.lowStockSkus != null) {
        lowStockVal = String(kpis.lowStockSkus);
      } else {
        lowStockVal = String(inventoryStats?.lowStockItems ?? 0);
      }

      return [
        {
          title: "Inventory value",
          value: health.inventoryStats ? formatMoney(Number(inventoryStats?.inventoryValue ?? 0)) : "—",
          description: "On-hand stock value (BI view).",
          href: APP_ROUTES.analytics.reportSection("value"),
          sourceWarning: warn(health, "inventoryStats"),
          valueState: health.inventoryStats ? "ok" : "unavailable",
        },
        {
          title: "Tracked SKUs",
          value: health.inventoryStats ? String(inventoryStats?.totalItems ?? 0) : "—",
          description: "Active SKU rows in master data.",
          href: APP_ROUTES.inventory.root,
          sourceWarning: warn(health, "inventoryStats"),
          valueState: health.inventoryStats ? "ok" : "unavailable",
        },
        {
          title: "Low-stock items",
          value: lowStockVal,
          description: "Below replenishment threshold.",
          href: APP_ROUTES.analytics.reportSection("low-stock"),
          sourceWarning: lowStockWarn ?? undefined,
          valueState: lowStockVal === "—" ? "unavailable" : "ok",
        },
      ];
    }
    case "procurement":
      return [
        {
          title: "POs awaiting action",
          value: health.controlTower ? String(kpis.posAwaitingAction ?? 0) : "—",
          description: "Open / approved / ready-to-send POs.",
          href: APP_ROUTES.procurement.orders,
          sourceWarning: warn(health, "controlTower"),
          valueState: health.controlTower ? "ok" : "unavailable",
        },
        {
          title: "Pending requisitions",
          value: health.controlTower ? String(kpis.pendingRequisitions ?? 0) : "—",
          description: "Requisitions waiting on procurement.",
          href: APP_ROUTES.procurement.requisitions,
          sourceWarning: warn(health, "controlTower"),
          valueState: health.controlTower ? "ok" : "unavailable",
        },
        {
          title: "Top supplier spend",
          value:"Unavailable",
          description: "Supplier spend requires dated reporting-currency evidence; legacy document totals are not used.",
          href: APP_ROUTES.analytics.reports,
          sourceWarning: warn(health, "spendAnalytics"),
          valueState: "unavailable",
        },
      ];
    case "finance":
      return [
        {
          title: "Outstanding AP",
          value: "Unavailable",
          description: "Review approved outstanding obligations and historical coverage in shared AP reporting. Missing evidence is not zero.",
          href: "/finance/accounts-payable/aging",
          sourceWarning: warn(health, "apOverview"),
          valueState: "unavailable",
        },
        {
          title: "Pending AP approvals",
          value: health.apOverview ? String(apOverview?.pendingApprovalCount ?? 0) : "—",
          description: "Invoices awaiting approval policy.",
          href: APP_ROUTES.finance.accountsPayableApprovals,
          sourceWarning: warn(health, "apOverview"),
          valueState: health.apOverview ? "ok" : "unavailable",
        },
        {
          title: "Due or overdue invoices",
          value: health.controlTower ? String(kpis.overdueInvoices ?? 0) : "—",
          description: "Past due, due today, or due within seven days in AP.",
          href: APP_ROUTES.analytics.reportSection("invoices"),
          sourceWarning: warn(health, "controlTower"),
          valueState: health.controlTower ? "ok" : "unavailable",
        },
      ];
    case "logistics":
      return [
        {
          title: "Late shipments",
          value: health.controlTower ? String(kpis.lateShipments ?? 0) : "—",
          description: "Late / at-risk (control tower).",
          href: APP_ROUTES.operations.logistics,
          sourceWarning: warn(health, "controlTower"),
          valueState: health.controlTower ? "ok" : "unavailable",
        },
        {
          title: "In transit",
          value: health.controlTower ? String(kpis.inTransitShipments ?? 0) : "—",
          description: "Currently in transit.",
          href: APP_ROUTES.operations.logistics,
          sourceWarning: warn(health, "controlTower"),
          valueState: health.controlTower ? "ok" : "unavailable",
        },
        {
          title: "Supplier performance lead",
          value:
            health.spendAnalytics && spendAnalytics?.supplierPerformance?.[0]
              ? `${spendAnalytics.supplierPerformance[0].supplierName} (${spendAnalytics.supplierPerformance[0].onTimeDeliveryRate.toFixed(1)}%)`
              : health.spendAnalytics
                ? "No supplier performance data"
                : "—",
          description: "Best on-time % from analytics feed.",
          href: APP_ROUTES.analytics.procurement,
          sourceWarning: warn(health, "spendAnalytics"),
          valueState: !health.spendAnalytics
            ? "unavailable"
            : spendAnalytics?.supplierPerformance?.[0]
              ? "ok"
              : "empty",
        },
      ];
    case "overview":
    default:
      return [
        {
          title: "Inventory position",
          value: health.inventoryStats ? formatMoney(Number(inventoryStats?.inventoryValue ?? 0)) : "—",
          description: "Stock on hand value.",
          href: APP_ROUTES.analytics.inventory,
          sourceWarning: warn(health, "inventoryStats"),
          valueState: health.inventoryStats ? "ok" : "unavailable",
        },
        {
          title: "Procurement flow",
          value: health.controlTower ? String(kpis.posAwaitingAction ?? 0) : "—",
          description: "Open PO actions.",
          href: APP_ROUTES.analytics.procurement,
          sourceWarning: warn(health, "controlTower"),
          valueState: health.controlTower ? "ok" : "unavailable",
        },
        {
          title: "Finance exposure",
          value: "Unavailable",
          description: "Use shared AP reporting for approved outstanding obligations; legacy exposure is not a verified balance.",
          href: "/finance/accounts-payable/aging",
          sourceWarning: warn(health, "apOverview"),
          valueState: "unavailable",
        },
        {
          title: "Network execution",
          value: health.controlTower ? String(kpis.lateShipments ?? 0) : "—",
          description: "Late or at-risk shipments.",
          href: APP_ROUTES.analytics.logistics,
          sourceWarning: warn(health, "controlTower"),
          valueState: health.controlTower ? "ok" : "unavailable",
        },
      ];
  }
}
