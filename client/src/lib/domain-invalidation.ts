/**
 * Cross-cutting React Query invalidation by business domain.
 * Invalidates canonical `qk.*` roots (for future hooks) and legacy `/api/...` keys used across the app.
 */
import type { QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import {
  PO_ENVELOPE_QUERY_ROOT,
  PO_OPERATIONAL_DETAIL_QUERY_ROOT,
} from "@/features/purchase-orders/lib/query-keys";

/** Documented legacy roots mirrored in helpers (dual-key / migration aid). */
export const LEGACY_QUERY_PREFIXES = {
  suppliers: ["/api/suppliers"],
  contracts: ["/api/contracts"],
  requisitions: ["/api/purchase-requisitions"],
  purchaseOrderRecords: ["/api/procurement/purchase-orders/records"],
  purchaseOrderRecordItems: ["/api/procurement/purchase-orders/records/items"],
  purchaseOrdersOperational: ["/api/procurement/purchase-orders"],
  purchaseOrdersLegacy: ["/api/purchase-orders"],
  inventory: ["/api/inventory"],
  inventoryLowStock: ["/api/inventory/low-stock"],
  inventoryStats: ["/api/inventory/stats"],
  invoices: ["/api/invoices"],
  payments: ["/api/payments"],
  logisticsShipments: ["/api/logistics/shipments"],
  carriers: ["/api/carriers"],
  warehouses: ["/api/warehouses"],
  inventoryAllocations: ["/api/inventory-allocations"],
  inventoryBatches: ["/api/inventory-batches"],
  inventorySerials: ["/api/inventory-serials"],
  stockMovements: ["/api/stock-movements"],
  warehouseInventory: ["/api/warehouse-inventory"],
  controlTowerOverview: ["/api/control-tower/overview"],
  controlTowerDashboard: ["/api/dashboard/control-tower"],
  reportsAnalytics: ["/api/reports/analytics"],
  apOverview: ["/api/ap/overview"],
  apCaptures: ["/api/ap/captures"],
  apApprovalQueue: ["/api/ap/approval-queue"],
  apExceptions: ["/api/ap/exceptions"],
  apPaymentBatches: ["/api/ap/payment-batches"],
  apInvoices: ["/api/ap/invoices"],
  notifications: ["/api/notifications"],
  exceptions: ["/api/exceptions"],
} as const;

const AP_WORKSPACE_PREFIXES: readonly (readonly string[])[] = [
  LEGACY_QUERY_PREFIXES.apOverview,
  LEGACY_QUERY_PREFIXES.apCaptures,
  LEGACY_QUERY_PREFIXES.apApprovalQueue,
  LEGACY_QUERY_PREFIXES.apExceptions,
  LEGACY_QUERY_PREFIXES.apPaymentBatches,
  LEGACY_QUERY_PREFIXES.apInvoices,
];

function invalidateKeyPrefix(queryClient: QueryClient, prefix: readonly string[]): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: [...prefix], exact: false });
}

async function invalidateMany(queryClient: QueryClient, prefixes: readonly (readonly string[])[]): Promise<void> {
  await Promise.all(prefixes.map((p) => invalidateKeyPrefix(queryClient, p)));
}

const dashboardsAndAnalyticsPrefixes: readonly (readonly string[])[] = [
  qk.controlTower as unknown as readonly string[],
  qk.analytics as unknown as readonly string[],
  qk.reports as unknown as readonly string[],
  LEGACY_QUERY_PREFIXES.inventoryStats,
  LEGACY_QUERY_PREFIXES.controlTowerOverview,
  LEGACY_QUERY_PREFIXES.controlTowerDashboard,
  LEGACY_QUERY_PREFIXES.reportsAnalytics,
  LEGACY_QUERY_PREFIXES.apOverview,
  qk.notifications as unknown as readonly string[],
  LEGACY_QUERY_PREFIXES.notifications,
  LEGACY_QUERY_PREFIXES.exceptions,
];

const poLegacyPrefixes: readonly (readonly string[])[] = [
  LEGACY_QUERY_PREFIXES.purchaseOrderRecords,
  LEGACY_QUERY_PREFIXES.purchaseOrderRecordItems,
  LEGACY_QUERY_PREFIXES.purchaseOrdersOperational,
  LEGACY_QUERY_PREFIXES.purchaseOrdersLegacy,
  [PO_ENVELOPE_QUERY_ROOT],
  [PO_OPERATIONAL_DETAIL_QUERY_ROOT],
];

export type MasterDataDomainKind =
  | "currencies"
  | "taxCodes"
  | "paymentTerms"
  | "incoterms"
  | "departments"
  | "unitsOfMeasure"
  | "commodityCodes"
  | "warehouses"
  | "carriers"
  | "general";

export function masterDataKindForEndpoint(endpoint: string): MasterDataDomainKind {
  switch (endpoint) {
    case "/api/currencies":
      return "currencies";
    case "/api/tax-codes":
      return "taxCodes";
    case "/api/payment-terms":
      return "paymentTerms";
    case "/api/incoterms":
      return "incoterms";
    case "/api/departments":
      return "departments";
    case "/api/units-of-measure":
      return "unitsOfMeasure";
    case "/api/commodity-codes":
      return "commodityCodes";
    case "/api/warehouses":
      return "warehouses";
    case "/api/carriers":
      return "carriers";
    default:
      return "general";
  }
}

export function invalidateMasterDataDomainForEndpoint(queryClient: QueryClient, endpoint: string): Promise<void> {
  return invalidateMasterDataDomain(queryClient, masterDataKindForEndpoint(endpoint));
}

/** Master-data CRUD: refresh dependent procurement, inventory, AP, and dashboard surfaces. */
export async function invalidateMasterDataDomain(
  queryClient: QueryClient,
  kind: MasterDataDomainKind = "general",
): Promise<void> {
  const tasks: Promise<unknown>[] = [invalidateKeyPrefix(queryClient, qk.masterData)];

  const commercialPoDeps: readonly (readonly string[])[] = [
    ...poLegacyPrefixes,
    LEGACY_QUERY_PREFIXES.suppliers,
    LEGACY_QUERY_PREFIXES.requisitions,
    ...AP_WORKSPACE_PREFIXES,
    LEGACY_QUERY_PREFIXES.invoices,
    LEGACY_QUERY_PREFIXES.payments,
    ...dashboardsAndAnalyticsPrefixes,
  ];

  const inventoryDeps: readonly (readonly string[])[] = [
    [...qk.inventory],
    LEGACY_QUERY_PREFIXES.inventory,
    LEGACY_QUERY_PREFIXES.inventoryLowStock,
    LEGACY_QUERY_PREFIXES.inventoryStats,
    ["/api/categories"],
    ...poLegacyPrefixes,
    ...dashboardsAndAnalyticsPrefixes,
  ];

  switch (kind) {
    case "currencies":
    case "paymentTerms":
    case "incoterms":
    case "departments":
      tasks.push(invalidateMany(queryClient, commercialPoDeps));
      break;
    case "taxCodes":
      tasks.push(
        invalidateMany(queryClient, [
          ...AP_WORKSPACE_PREFIXES,
          LEGACY_QUERY_PREFIXES.invoices,
          LEGACY_QUERY_PREFIXES.payments,
          ...poLegacyPrefixes,
          ...dashboardsAndAnalyticsPrefixes,
        ]),
      );
      break;
    case "unitsOfMeasure":
    case "commodityCodes":
      tasks.push(invalidateMany(queryClient, inventoryDeps));
      break;
    case "warehouses":
      tasks.push(
        invalidateMany(queryClient, [
          LEGACY_QUERY_PREFIXES.warehouses,
          [...qk.inventory],
          LEGACY_QUERY_PREFIXES.inventory,
          LEGACY_QUERY_PREFIXES.inventoryLowStock,
          LEGACY_QUERY_PREFIXES.inventoryStats,
          ...poLegacyPrefixes,
          ...dashboardsAndAnalyticsPrefixes,
        ]),
      );
      break;
    case "carriers":
      tasks.push(
        invalidateMany(queryClient, [
          LEGACY_QUERY_PREFIXES.carriers,
          LEGACY_QUERY_PREFIXES.logisticsShipments,
          ...poLegacyPrefixes,
          ...dashboardsAndAnalyticsPrefixes,
        ]),
      );
      break;
    case "general":
      tasks.push(invalidateMany(queryClient, [...commercialPoDeps, ...inventoryDeps]));
      break;
  }

  await Promise.all(tasks);
}

export async function invalidateSupplierDomain(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateKeyPrefix(queryClient, qk.suppliers),
    invalidateMany(queryClient, [
      LEGACY_QUERY_PREFIXES.suppliers,
      LEGACY_QUERY_PREFIXES.contracts,
      LEGACY_QUERY_PREFIXES.requisitions,
      ...poLegacyPrefixes,
      ...AP_WORKSPACE_PREFIXES,
      ...dashboardsAndAnalyticsPrefixes,
    ]),
  ]);
}

export async function invalidateContractDomain(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateKeyPrefix(queryClient, qk.contracts),
    invalidateMany(queryClient, [
      LEGACY_QUERY_PREFIXES.contracts,
      LEGACY_QUERY_PREFIXES.suppliers,
      ...poLegacyPrefixes,
      ...dashboardsAndAnalyticsPrefixes,
    ]),
  ]);
}

/** Inventory quantity/item master changes: refresh procurement, logistics, AP, and dashboards (inventory drives PO receive and matching). */
export async function invalidateInventoryDomain(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateKeyPrefix(queryClient, qk.inventory),
    invalidateMany(queryClient, [
      LEGACY_QUERY_PREFIXES.inventory,
      LEGACY_QUERY_PREFIXES.inventoryLowStock,
      LEGACY_QUERY_PREFIXES.inventoryStats,
      ["/api/inventory/out-of-stock"],
      ["/api/inventory/expiring"],
      ["/api/categories"],
      LEGACY_QUERY_PREFIXES.warehouses,
      LEGACY_QUERY_PREFIXES.inventoryAllocations,
      LEGACY_QUERY_PREFIXES.inventoryBatches,
      LEGACY_QUERY_PREFIXES.inventorySerials,
      LEGACY_QUERY_PREFIXES.stockMovements,
      LEGACY_QUERY_PREFIXES.warehouseInventory,
      ...poLegacyPrefixes,
      LEGACY_QUERY_PREFIXES.requisitions,
      LEGACY_QUERY_PREFIXES.logisticsShipments,
      ...AP_WORKSPACE_PREFIXES,
      LEGACY_QUERY_PREFIXES.invoices,
      LEGACY_QUERY_PREFIXES.payments,
      ...dashboardsAndAnalyticsPrefixes,
    ]),
  ]);
}

export async function invalidatePurchaseOrderDomain(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateKeyPrefix(queryClient, qk.purchaseOrders),
    invalidateMany(queryClient, [
      ...poLegacyPrefixes,
      [...qk.inventory],
      LEGACY_QUERY_PREFIXES.inventory,
      LEGACY_QUERY_PREFIXES.inventoryStats,
      LEGACY_QUERY_PREFIXES.logisticsShipments,
      LEGACY_QUERY_PREFIXES.requisitions,
      ...AP_WORKSPACE_PREFIXES,
      ...dashboardsAndAnalyticsPrefixes,
    ]),
  ]);
}

export async function invalidateRequisitionDomain(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateKeyPrefix(queryClient, qk.requisitions),
    invalidateMany(queryClient, [
      LEGACY_QUERY_PREFIXES.requisitions,
      ...poLegacyPrefixes,
      ...dashboardsAndAnalyticsPrefixes,
    ]),
  ]);
}

export async function invalidateInvoiceDomain(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateKeyPrefix(queryClient, qk.invoices),
    invalidateKeyPrefix(queryClient, qk.ap),
    invalidateMany(queryClient, [
      ...AP_WORKSPACE_PREFIXES,
      LEGACY_QUERY_PREFIXES.payments,
      ...poLegacyPrefixes,
      ...dashboardsAndAnalyticsPrefixes,
    ]),
  ]);
}

export async function invalidateLogisticsDomain(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateKeyPrefix(queryClient, qk.logistics),
    invalidateMany(queryClient, [
      LEGACY_QUERY_PREFIXES.logisticsShipments,
      LEGACY_QUERY_PREFIXES.carriers,
      LEGACY_QUERY_PREFIXES.inventoryStats,
      ...poLegacyPrefixes,
      ...dashboardsAndAnalyticsPrefixes,
    ]),
  ]);
}

/** After PO receive: inventory, logistics, AP, and related dashboards refresh together. */
export async function invalidateAfterOperationalReceive(queryClient: QueryClient): Promise<void> {
  await Promise.all([invalidateInventoryDomain(queryClient), invalidateLogisticsDomain(queryClient), invalidateInvoiceDomain(queryClient)]);
}

/** Shipment mutations affect operational PO shipment lists as well as logistics queries. */
export async function invalidateLogisticsAndPurchaseOrders(queryClient: QueryClient): Promise<void> {
  await Promise.all([invalidateLogisticsDomain(queryClient), invalidatePurchaseOrderDomain(queryClient)]);
}
