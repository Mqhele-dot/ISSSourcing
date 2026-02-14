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
  id: number;
  name: string;
  sku: string;
  quantity: number;
  lowStockThreshold: number | null;
  location: string | null;
};
