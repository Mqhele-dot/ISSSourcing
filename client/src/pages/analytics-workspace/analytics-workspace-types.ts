export type InventoryStats = {
  inventoryValue?: number;
  totalItems?: number;
  lowStockItems?: number;
};

export type ControlTowerOverview = {
  kpis?: {
    lowStockSkus?: number;
    posAwaitingAction?: number;
    pendingRequisitions?: number;
    lateShipments?: number;
    inTransitShipments?: number;
    overdueInvoices?: number;
  };
};

export type ControlTowerDashboard = {
  kpis?: {
    lowStockItems?: number;
    openRequisitions?: number;
    delayedShipments?: number;
    inTransitShipments?: number;
    apInvoicesDueOrOverdue?: number;
  };
  procurementPipeline?: Array<{ id: string; count: number }>;
};

export type ApOverview = {
  outstandingAmount?: number;
  pendingApprovalCount?: number;
};

export type SpendAnalytics = {
  spendBySupplier?: Array<{ supplierName: string; totalSpend: number }>;
  supplierPerformance?: Array<{ supplierName: string; onTimeDeliveryRate: number }>;
};

export type AnalyticsKpiCard = {
  title: string;
  value: string;
  description: string;
  href: string;
  /** When set, KPI grid shows a non-blocking data-quality note (e.g. source query failed). */
  sourceWarning?: string;
  /** Distinguishes a real zero/metric from missing backend data. */
  valueState?: "ok" | "empty" | "unavailable";
};

export type AnalyticsWorkspaceQueryBundle = {
  inventoryStats: InventoryStats | undefined;
  controlTower: ControlTowerOverview | undefined;
  apOverview: ApOverview | undefined;
  spendAnalytics: SpendAnalytics | undefined;
};

/** When false, numeric KPIs from that source should not be presented as real zeros. */
export type AnalyticsWorkspaceSourceHealth = {
  inventoryStats: boolean;
  controlTower: boolean;
  apOverview: boolean;
  spendAnalytics: boolean;
};
