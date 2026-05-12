export type ApiErrorPayload = {
  code: string;
  message: string;
  hint?: string;
  details?: unknown;
};

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
};

export type ApiErrorResponse = {
  ok: false;
  error: ApiErrorPayload;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export type DemoDataSummary = {
  users: number;
  warehouses: number;
  suppliers: number;
  items: number;
  settings: number;
};

export type TutorialStatus = {
  systemStatus: "ok" | "degraded";
  demoReady: boolean;
};

export type TutorialStartResult = {
  systemStatus: "ok" | "degraded";
  plan: {
    suggestedSku?: string;
    exceptionId?: number;
    poNumber?: string;
    shipmentId?: number;
  };
};

export type HealthCheck = {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  timestamp: string;
};

export type DeepHealthCheck = HealthCheck & {
  responseTimeMs: number;
  migrationsStatus: "schema_ok" | "schema_incomplete";
  checks: {
    database: {
      ok: boolean;
      error: string | null;
    };
    schema: {
      ok: boolean;
      missingTables: string[];
      status: "schema_ok" | "schema_incomplete";
    };
    seed: DemoDataSummary;
  };
};

export type InventoryListItem = {
  id?: number;
  name: string;
  sku: string;
  categoryId?: number | null;
  quantity?: number;
  price?: number;
  lowStockThreshold: number;
  onHand: number;
  allocated: number;
  available: number;
  location: string | null;
  updatedAt?: string | Date | null;
  expiryDate?: string | Date | null;
  manufacturingDate?: string | Date | null;
};

export type InventoryItem = InventoryListItem;

export type InventoryDetail = {
  item: InventoryListItem;
  positions: Array<{
    location: string;
    onHand: number;
    allocated: number;
    available: number;
    updatedAt: string | null;
  }>;
  movements: Array<{
    id: number;
    location: string;
    delta: number;
    reason: string;
    ref: string | null;
    createdBy: string | null;
    createdAt: string | null;
  }>;
  summary: {
    onHand: number;
    allocated: number;
    available: number;
  };
};

/** Flat shape returned by GET /api/inventory/:sku and fetchInventoryDetail */
export type InventoryDetailBySku = {
  id: number;
  sku: string;
  name: string;
  summary: { onHand: number; allocated: number; available: number };
  positions: InventoryDetail["positions"];
  movements: InventoryDetail["movements"];
  location?: string | null;
};

export type PurchaseOrderListItem = {
  id: number;
  poNumber: string;
  supplierId: number;
  supplierName: string | null;
  status: string;
  requestedDate: string | null;
  createdAt: string | null;
  totalAmount: number;
  linesCount: number;
  qtyOrdered: number;
  qtyReceived: number;
  receivedProgress: number;
};

export type PurchaseOrderDetailLine = {
  id: number;
  itemId: number;
  sku: string;
  itemName: string;
  /** From inventory master (supplier part #) */
  supplierPartNumber?: string | null;
  /** HS / commodity code from inventory master */
  commodityCode?: string | null;
  commodityDescription?: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  unitPrice: number;
  expectedRemaining: number;
};

export type PurchaseOrderShipment = {
  id: number;
  carrier: string | null;
  status: string;
  eta: string | null;
  driftMinutes: number;
  updatedAt: string | null;
  trackingNumber?: string | null;
};

export type PurchaseOrderDetail = {
  id: number;
  poNumber: string;
  supplierId: number;
  supplierName: string | null;
  status: string;
  requestedDate: string | null;
  createdAt: string | null;
  totalAmount: number;
  lines: PurchaseOrderDetailLine[];
  shipments: PurchaseOrderShipment[];
  progress: {
    qtyOrdered: number;
    qtyReceived: number;
    percent: number;
  };
};

export type PurchaseOrder = PurchaseOrderDetail;

export type SupplierPortalInvoice = {
  id: number;
  invoiceNumber: string;
  purchaseOrderId: number | null;
  supplierId: number | null;
  status: string;
  total: number;
  dueAmount: number | null;
  paidAmount: number | null;
  issueDate: string | null;
  dueDate: string | null;
  createdAt: string | null;
};

export type PurchaseReceiveResult = {
  order: PurchaseOrderDetail;
  inventoryChanges: Array<{
    sku: string;
    location: string;
    delta: number;
    available: number;
    onHand: number;
  }>;
  shipmentUpdates: Array<{
    shipmentId: number;
    toStatus: string;
  }>;
  mismatchExceptions: Array<{
    id: number;
    sku: string;
    created: boolean;
  }>;
  changed: {
    inventoryChanges: number;
    shipmentUpdates: number;
    mismatchExceptions: number;
  };
};

export type ShipmentListItem = {
  id: number;
  poNumber: string;
  carrier: string | null;
  status: string;
  eta: string | null;
  driftMinutes: number;
  createdAt: string | null;
  updatedAt: string | null;
  atRisk: boolean;
  trackingNumber?: string | null;
};

export type ShipmentTimelineEvent = {
  id: number;
  status: string;
  note: string | null;
  eventAt: string | null;
};

export type ShipmentDetail = ShipmentListItem & {
  timeline: ShipmentTimelineEvent[];
  riskBucket?: "late" | "no_eta" | "due_soon" | "exception" | "on_time";
  supplierId?: number | null;
  supplierName?: string | null;
  purchaseOrderId?: number | null;
  relatedException?: { id: number; status: string; title: string; type: string } | null;
  updatedAtFormatted?: string | null;
};

export type Shipment = ShipmentDetail;

export type OperationalException = {
  id: number;
  type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  relatedRefs: Record<string, unknown>;
  assignee: string | null;
  slaHours: number;
  comments: Array<Record<string, unknown>>;
  createdAt: string | null;
  updatedAt: string | null;
  /** Canonical code (normalized from legacy `type` when missing in stored context). */
  exceptionCode?: string;
  /** Business area inferred from type / stored context. */
  area?: string;
  /** Hours since `createdAt`. */
  agedHours?: number;
  /** SLA clock vs open/in_progress status. */
  slaStatus?: "ok" | "due" | "breached" | "n/a";
  /** Short line built from denormalized context (PO / shipment / SKU). */
  relatedSummary?: string | null;
};

export type ExceptionCase = OperationalException;

export type IntegrationRun = {
  id: number;
  connector: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
};

export type ControlTowerOverview = {
  kpis: {
    exceptionsBySeverity: Record<string, number>;
    openExceptionsTotal?: number;
    lateShipments: number;
    posAwaitingAction: number;
    lowStockSkus: number;
    pendingRequisitions?: number;
    inTransitShipments?: number;
    overdueInvoices?: number;
  };
  activity: Array<{
    id: number;
    eventType: string;
    title: string;
    details: string | null;
    relatedRefs: Record<string, unknown>;
    createdAt: string | null;
  }>;
};

/** GET /api/dashboard/control-tower aggregated payload */
export type ControlTowerDashboardData = {
  generatedAt: string;
  meta: {
    organizationId: number;
    trendDays: number;
    valueBasisLabel: string;
    businessArea: string;
    queryMs?: number;
    dataFreshness?: Partial<Record<
      | "inventory"
      | "purchaseOrders"
      | "shipments"
      | "invoices"
      | "exceptions"
      | "activity"
      | "requisitions",
      string | null
    >>;
    partialFailures?: Array<{
      area: string;
      code: string;
      message: string;
      fallbackUsed: boolean;
    }>;
    filtersApplied?: Record<string, string | number | boolean | null>;
  };
  kpis: {
    inventoryValue: number;
    inventoryValueTrendPct: number | null;
    lowStockItems: number;
    openRequisitions: number;
    openPurchaseOrders: number;
    delayedShipments: number;
    apInvoicesDueOrOverdue: number;
    operationalExceptions: number;
    supplierRiskAlerts: number;
  };
  procurementPipeline: Array<{
    id: string;
    label: string;
    count: number;
    href: string;
    area: "procurement";
  }>;
  inventoryHealth: Array<{ id: string; label: string; count: number; href: string }>;
  stockValueByCategory: Array<{ category: string; value: number }>;
  apAging: Array<{ bucket: string; label: string; count: number; amount: number }>;
  logisticsRisk: Array<{ id: string; label: string; count: number; href: string }>;
  supplierPerformance: Array<{
    supplierId: number;
    name: string;
    riskScore: number;
    lateShipments: number;
    openExceptions: number;
  }>;
  operationsTrend: Array<{
    date: string;
    requisitions: number;
    purchaseOrders: number;
    receiving: number;
    invoices: number;
    exceptions: number;
  }>;
  needsAttention: Array<{
    id: string;
    title: string;
    severity: "low" | "medium" | "high";
    reason: string;
    href: string;
    area: string;
  }>;
  recentActivity: Array<{
    id: number;
    action: string;
    entityType: string;
    entityId: string;
    actor: string;
    createdAt: string | null;
    summary: string;
  }>;
  spotlight: {
    delayedShipments: Array<{
      id: number;
      poNumber: string;
      carrier: string | null;
      eta: string | null;
      driftMinutes: number;
      href: string;
    }>;
    oldestOpenExceptions: Array<{
      id: number;
      type: string;
      title: string;
      agedHours: number;
      severity: string;
      href: string;
    }>;
    supplierRisks: Array<{
      supplierId: number;
      name: string;
      lateShipments: number;
      openExceptions: number;
      href: string;
    }>;
  };
};

export type ActivityItem = ControlTowerOverview["activity"][number];

export type GasDashboardSummary = {
  productCount: number;
  openExchanges: number;
  profilesDueForTest30d: number;
};

export type GasComplianceAlertsResult = {
  notificationsSent: number;
  dueWithin30d: number;
  blocked: number;
};

/** POST /api/mobile/scan/resolve — union of possible resolutions */
export type MobileScanResolveResult =
  | {
      kind: "item";
      intent: string | null;
      item: { id: number; sku: string; name: string } | null;
      barcode: { id: number; value: string };
      nextActions: string[];
    }
  | {
      kind: "asset";
      intent: string | null;
      asset: {
        id: number;
        assetType: string;
        serialNumber: string | null;
        status: string | null;
      };
      nextActions: string[];
    }
  | { kind: "unknown"; intent: string | null; value: string; nextActions: string[] };

export type ActivityRecord = {
  id: number;
  createdAt: string | null;
  actor: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: Record<string, unknown>;
};

export type DemoWalkthroughResult = {
  steps: Array<{
    id: string;
    label: string;
    completed: boolean;
    details?: string;
  }>;
  context: {
    sku: string;
    poNumber: string;
    shipmentId: number;
    exceptionId: number | null;
  };
  links: {
    inventory: string;
    purchase: string;
    logistics: string;
    exception: string | null;
  };
};
