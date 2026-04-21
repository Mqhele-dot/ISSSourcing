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
          description: "BI measure for on-hand stock value.",
          href: APP_ROUTES.analytics.reportSection("value"),
          sourceWarning: warn(health, "inventoryStats"),
        },
        {
          title: "Tracked SKUs",
          value: health.inventoryStats ? String(inventoryStats?.totalItems ?? 0) : "—",
          description: "Active inventory master records.",
          href: APP_ROUTES.inventory.root,
          sourceWarning: warn(health, "inventoryStats"),
        },
        {
          title: "Low-stock items",
          value: lowStockVal,
          description: "Threshold breaches ready for replenishment.",
          href: APP_ROUTES.analytics.reportSection("low-stock"),
          sourceWarning: lowStockWarn ?? undefined,
        },
      ];
    }
    case "procurement":
      return [
        {
          title: "POs awaiting action",
          value: health.controlTower ? String(kpis.posAwaitingAction ?? 0) : "—",
          description: "Orders still open, approved, or ready to send.",
          href: APP_ROUTES.procurement.orders,
          sourceWarning: warn(health, "controlTower"),
        },
        {
          title: "Pending requisitions",
          value: health.controlTower ? String(kpis.pendingRequisitions ?? 0) : "—",
          description: "Demand requests waiting for procurement review.",
          href: APP_ROUTES.procurement.requisitions,
          sourceWarning: warn(health, "controlTower"),
        },
        {
          title: "Top supplier spend",
          value:
            health.spendAnalytics && spendAnalytics?.spendBySupplier?.[0]
              ? `${spendAnalytics.spendBySupplier[0].supplierName} (${formatMoney(spendAnalytics.spendBySupplier[0].totalSpend)})`
              : health.spendAnalytics
                ? "No spend data"
                : "—",
          description: "Lead supplier by current spend in the BI model.",
          href: APP_ROUTES.analytics.reports,
          sourceWarning: warn(health, "spendAnalytics"),
        },
      ];
    case "finance":
      return [
        {
          title: "Outstanding AP",
          value: health.apOverview ? formatMoney(Number(apOverview?.outstandingAmount ?? 0)) : "—",
          description: "Current unpaid accounts payable exposure.",
          href: APP_ROUTES.finance.accountsPayableIntake,
          sourceWarning: warn(health, "apOverview"),
        },
        {
          title: "Pending AP approvals",
          value: health.apOverview ? String(apOverview?.pendingApprovalCount ?? 0) : "—",
          description: "Invoices still waiting for approval policy completion.",
          href: APP_ROUTES.finance.accountsPayableApprovals,
          sourceWarning: warn(health, "apOverview"),
        },
        {
          title: "Overdue invoices",
          value: health.controlTower ? String(kpis.overdueInvoices ?? 0) : "—",
          description: "Invoices currently past due date in AP.",
          href: APP_ROUTES.analytics.reportSection("invoices"),
          sourceWarning: warn(health, "controlTower"),
        },
      ];
    case "logistics":
      return [
        {
          title: "Late shipments",
          value: health.controlTower ? String(kpis.lateShipments ?? 0) : "—",
          description: "Late or at-risk shipments from control tower monitoring.",
          href: APP_ROUTES.operations.logistics,
          sourceWarning: warn(health, "controlTower"),
        },
        {
          title: "In transit",
          value: health.controlTower ? String(kpis.inTransitShipments ?? 0) : "—",
          description: "Shipments currently moving through the network.",
          href: APP_ROUTES.operations.logistics,
          sourceWarning: warn(health, "controlTower"),
        },
        {
          title: "Supplier performance lead",
          value:
            health.spendAnalytics && spendAnalytics?.supplierPerformance?.[0]
              ? `${spendAnalytics.supplierPerformance[0].supplierName} (${spendAnalytics.supplierPerformance[0].onTimeDeliveryRate.toFixed(1)}%)`
              : health.spendAnalytics
                ? "No supplier performance data"
                : "—",
          description: "Top on-time supplier from procurement analytics.",
          href: APP_ROUTES.analytics.procurement,
          sourceWarning: warn(health, "spendAnalytics"),
        },
      ];
    case "overview":
    default:
      return [
        {
          title: "Inventory position",
          value: health.inventoryStats ? formatMoney(Number(inventoryStats?.inventoryValue ?? 0)) : "—",
          description: "Unified inventory value KPI from the registry.",
          href: APP_ROUTES.analytics.inventory,
          sourceWarning: warn(health, "inventoryStats"),
        },
        {
          title: "Procurement flow",
          value: health.controlTower ? String(kpis.posAwaitingAction ?? 0) : "—",
          description: "Orders awaiting procurement action.",
          href: APP_ROUTES.analytics.procurement,
          sourceWarning: warn(health, "controlTower"),
        },
        {
          title: "Finance exposure",
          value: health.apOverview ? formatMoney(Number(apOverview?.outstandingAmount ?? 0)) : "—",
          description: "Current AP exposure and approval backlog.",
          href: APP_ROUTES.analytics.finance,
          sourceWarning: warn(health, "apOverview"),
        },
        {
          title: "Network execution",
          value: health.controlTower ? String(kpis.lateShipments ?? 0) : "—",
          description: "Late or at-risk logistics signals.",
          href: APP_ROUTES.analytics.logistics,
          sourceWarning: warn(health, "controlTower"),
        },
      ];
  }
}
