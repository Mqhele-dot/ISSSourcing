/**
 * Canonical React Query key roots for domain-scoped invalidation.
 * Hooks can migrate to these prefixes over time; domain helpers also invalidate legacy `/api/...` keys.
 */
export const qk = {
  masterData: ["qk", "masterData"] as const,
  suppliers: ["qk", "suppliers"] as const,
  contracts: ["qk", "contracts"] as const,
  requisitions: ["qk", "requisitions"] as const,
  purchaseOrders: ["qk", "purchaseOrders"] as const,
  inventory: ["qk", "inventory"] as const,
  invoices: ["qk", "invoices"] as const,
  ap: ["qk", "ap"] as const,
  logistics: ["qk", "logistics"] as const,
  controlTower: ["qk", "controlTower"] as const,
  analytics: ["qk", "analytics"] as const,
  reports: ["qk", "reports"] as const,
  notifications: ["qk", "notifications"] as const,
} as const;

/** Inventory catalog list; domain invalidation uses `qk.inventory` prefix (exact: false). */
export const inventoryCatalogQueryKey = [...qk.inventory, "catalog"] as const;

/** Reports page — canonical keys; legacy `/api/...` roots remain valid via `invalidateMany` / domain helpers. */
export const reportsKeys = {
  procurementPurchaseOrderRecords: [...qk.reports, "procurementPurchaseOrderRecords"] as const,
} as const;
