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
};
