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
};

export type AnalyticsWorkspaceQueryBundle = {
  inventoryStats: InventoryStats | undefined;
  controlTower: ControlTowerOverview | undefined;
  apOverview: ApOverview | undefined;
  spendAnalytics: SpendAnalytics | undefined;
};
