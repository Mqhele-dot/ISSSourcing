import { APP_ROUTES, type AnalyticsSectionSlug } from "@/lib/routes/app-routes";
import type { AnalyticsKpiCard, AnalyticsWorkspaceQueryBundle } from "./analytics-workspace-types";

export function buildAnalyticsSectionCards(
  section: AnalyticsSectionSlug,
  { inventoryStats, controlTower, apOverview, spendAnalytics }: AnalyticsWorkspaceQueryBundle,
  formatMoney: (value: number | null | undefined) => string,
): AnalyticsKpiCard[] {
  const kpis = controlTower?.kpis ?? {};
  switch (section) {
    case "inventory":
      return [
        {
          title: "Inventory value",
          value: formatMoney(Number(inventoryStats?.inventoryValue ?? 0)),
          description: "BI measure for on-hand stock value.",
          href: APP_ROUTES.analytics.reportSection("value"),
        },
        {
          title: "Tracked SKUs",
          value: String(inventoryStats?.totalItems ?? 0),
          description: "Active inventory master records.",
          href: APP_ROUTES.inventory.root,
        },
        {
          title: "Low-stock items",
          value: String(kpis.lowStockSkus ?? inventoryStats?.lowStockItems ?? 0),
          description: "Threshold breaches ready for replenishment.",
          href: APP_ROUTES.analytics.reportSection("low-stock"),
        },
      ];
    case "procurement":
      return [
        {
          title: "POs awaiting action",
          value: String(kpis.posAwaitingAction ?? 0),
          description: "Orders still open, approved, or ready to send.",
          href: APP_ROUTES.procurement.orders,
        },
        {
          title: "Pending requisitions",
          value: String(kpis.pendingRequisitions ?? 0),
          description: "Demand requests waiting for procurement review.",
          href: APP_ROUTES.procurement.requisitions,
        },
        {
          title: "Top supplier spend",
          value: spendAnalytics?.spendBySupplier?.[0]
            ? `${spendAnalytics.spendBySupplier[0].supplierName} (${formatMoney(spendAnalytics.spendBySupplier[0].totalSpend)})`
            : "No spend data",
          description: "Lead supplier by current spend in the BI model.",
          href: APP_ROUTES.analytics.reports,
        },
      ];
    case "finance":
      return [
        {
          title: "Outstanding AP",
          value: formatMoney(Number(apOverview?.outstandingAmount ?? 0)),
          description: "Current unpaid accounts payable exposure.",
          href: APP_ROUTES.finance.accountsPayableIntake,
        },
        {
          title: "Pending AP approvals",
          value: String(apOverview?.pendingApprovalCount ?? 0),
          description: "Invoices still waiting for approval policy completion.",
          href: APP_ROUTES.finance.accountsPayableApprovals,
        },
        {
          title: "Overdue invoices",
          value: String(kpis.overdueInvoices ?? 0),
          description: "Invoices currently past due date in AP.",
          href: APP_ROUTES.analytics.reportSection("invoices"),
        },
      ];
    case "logistics":
      return [
        {
          title: "Late shipments",
          value: String(kpis.lateShipments ?? 0),
          description: "Late or at-risk shipments from control tower monitoring.",
          href: APP_ROUTES.operations.logistics,
        },
        {
          title: "In transit",
          value: String(kpis.inTransitShipments ?? 0),
          description: "Shipments currently moving through the network.",
          href: APP_ROUTES.operations.logistics,
        },
        {
          title: "Supplier performance lead",
          value: spendAnalytics?.supplierPerformance?.[0]
            ? `${spendAnalytics.supplierPerformance[0].supplierName} (${spendAnalytics.supplierPerformance[0].onTimeDeliveryRate.toFixed(1)}%)`
            : "No supplier performance data",
          description: "Top on-time supplier from procurement analytics.",
          href: APP_ROUTES.analytics.procurement,
        },
      ];
    case "overview":
    default:
      return [
        {
          title: "Inventory position",
          value: formatMoney(Number(inventoryStats?.inventoryValue ?? 0)),
          description: "Unified inventory value KPI from the registry.",
          href: APP_ROUTES.analytics.inventory,
        },
        {
          title: "Procurement flow",
          value: String(kpis.posAwaitingAction ?? 0),
          description: "Orders awaiting procurement action.",
          href: APP_ROUTES.analytics.procurement,
        },
        {
          title: "Finance exposure",
          value: formatMoney(Number(apOverview?.outstandingAmount ?? 0)),
          description: "Current AP exposure and approval backlog.",
          href: APP_ROUTES.analytics.finance,
        },
        {
          title: "Network execution",
          value: String(kpis.lateShipments ?? 0),
          description: "Late or at-risk logistics signals.",
          href: APP_ROUTES.analytics.logistics,
        },
      ];
  }
}
