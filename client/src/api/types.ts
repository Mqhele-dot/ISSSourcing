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
  lowStockThreshold: number;
  onHand: number;
  allocated: number;
  available: number;
  location: string | null;
  updatedAt?: string | Date | null;
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
};

export type ShipmentTimelineEvent = {
  id: number;
  status: string;
  note: string | null;
  eventAt: string | null;
};

export type ShipmentDetail = ShipmentListItem & {
  timeline: ShipmentTimelineEvent[];
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
    lateShipments: number;
    posAwaitingAction: number;
    lowStockSkus: number;
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

export type ActivityItem = ControlTowerOverview["activity"][number];

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
