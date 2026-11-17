import { APP_ROUTES } from "@/lib/routes/app-routes";

export type KpiRegistryEntry = {
  id: string;
  domain: "overview" | "inventory" | "procurement" | "finance" | "logistics";
  title: string;
  description: string;
  sourceKey: string;
  allowedFilters: string[];
  drilldownRoute: string;
  exportDatasetKey: string;
};

export const KPI_REGISTRY: KpiRegistryEntry[] = [
  {
    id: "inventory-value",
    domain: "inventory",
    title: "Inventory value",
    description: "Current stock value across all tracked inventory.",
    sourceKey: "/api/inventory/stats.inventoryValue",
    allowedFilters: ["categoryId", "warehouseId"],
    drilldownRoute: APP_ROUTES.analytics.reportSection("value"),
    exportDatasetKey: "inventory",
  },
  {
    id: "low-stock-skus",
    domain: "inventory",
    title: "Low-stock SKUs",
    description: "SKUs at or below their reorder threshold.",
    sourceKey: "/api/control-tower/overview.kpis.lowStockSkus",
    allowedFilters: ["warehouseId", "categoryId"],
    drilldownRoute: APP_ROUTES.analytics.reportSection("low-stock"),
    exportDatasetKey: "inventory",
  },
  {
    id: "pending-requisitions",
    domain: "procurement",
    title: "Pending requisitions",
    description: "Requisitions waiting for procurement action.",
    sourceKey: "/api/control-tower/overview.kpis.pendingRequisitions",
    allowedFilters: ["status", "projectId", "supplierId"],
    drilldownRoute: APP_ROUTES.procurement.requisitions,
    exportDatasetKey: "purchase_requisitions",
  },
  {
    id: "po-awaiting-action",
    domain: "procurement",
    title: "POs awaiting action",
    description: "Purchase orders still in the open approval or send pipeline.",
    sourceKey: "/api/control-tower/overview.kpis.posAwaitingAction",
    allowedFilters: ["status", "supplierId", "projectId"],
    drilldownRoute: APP_ROUTES.procurement.orders,
    exportDatasetKey: "purchase_orders",
  },
  {
    id: "outstanding-ap",
    domain: "finance",
    title: "Outstanding AP",
    description: "Current unpaid accounts payable exposure.",
    sourceKey: "/api/ap/overview.outstandingAmount",
    allowedFilters: ["status", "supplierId", "dueDate"],
    drilldownRoute: APP_ROUTES.finance.accountsPayablePayments,
    exportDatasetKey: "invoices",
  },
  {
    id: "overdue-invoices",
    domain: "finance",
    title: "Overdue invoices",
    description: "Supplier invoices that have passed the due date.",
    sourceKey: "/api/control-tower/overview.kpis.overdueInvoices",
    allowedFilters: ["supplierId", "status"],
    drilldownRoute: APP_ROUTES.finance.accountsPayableApprovals,
    exportDatasetKey: "invoices",
  },
  {
    id: "late-shipments",
    domain: "logistics",
    title: "Late or at-risk shipments",
    description: "Shipments with delay or lateness risk signals.",
    sourceKey: "/api/control-tower/overview.kpis.lateShipments",
    allowedFilters: ["carrier", "risk"],
    drilldownRoute: APP_ROUTES.operations.logistics,
    exportDatasetKey: "shipments",
  },
  {
    id: "in-transit-shipments",
    domain: "logistics",
    title: "In-transit shipments",
    description: "Operational shipments currently moving through the network.",
    sourceKey: "/api/control-tower/overview.kpis.inTransitShipments",
    allowedFilters: ["carrier", "status"],
    drilldownRoute: APP_ROUTES.operations.logistics,
    exportDatasetKey: "shipments",
  },
];
