import { useQuery } from "@tanstack/react-query";
import { normalizeApiList, requestJson } from "@/lib/queryClient";
import { PROCUREMENT_PURCHASE_ORDER_RECORDS_PATH } from "@/api/procurement-purchase-order-paths";
import type {
  Category,
  InventoryItem,
  InventoryStats,
  Warehouse,
  Supplier,
  PurchaseOrder,
  PurchaseRequisition,
  ReorderRequest,
  Project,
} from "@shared/schema";

/**
 * Data hooks for the reports page (split from monolithic reports.tsx).
 */
export function useReportsPageData() {
  const {
    data: inventoryItems,
    isLoading: itemsLoading,
    isError: itemsError,
    error: itemsErrorDetail,
    refetch: refetchInventory,
  } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/inventory");
      return normalizeApiList<InventoryItem>(raw);
    },
  });

  const { data: lowStockItems, isLoading: lowStockLoading } = useQuery({
    queryKey: ["/api/inventory/low-stock"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/inventory/low-stock");
      return normalizeApiList<InventoryItem>(raw);
    },
    throwOnError: false,
  });

  const { data: categories } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/categories");
      return normalizeApiList<Category>(raw);
    },
    throwOnError: false,
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: async () => {
      const rawStats = await requestJson<Partial<InventoryStats>>("GET", "/api/inventory/stats");
      return {
        totalItems: Number(rawStats?.totalItems ?? 0),
        lowStockItems: Number(rawStats?.lowStockItems ?? 0),
        outOfStockItems: Number(rawStats?.outOfStockItems ?? 0),
        inventoryValue: Number(rawStats?.inventoryValue ?? 0),
      } as InventoryStats;
    },
    throwOnError: false,
  });

  const { data: warehouses } = useQuery({
    queryKey: ["/api/warehouses"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/warehouses");
      return normalizeApiList<Warehouse>(raw);
    },
    throwOnError: false,
  });

  const { data: suppliers } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/suppliers");
      return normalizeApiList<Supplier>(raw);
    },
    throwOnError: false,
  });

  const { data: purchaseOrders, isLoading: poLoading } = useQuery({
    queryKey: ["/api/procurement/purchase-orders/records"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", PROCUREMENT_PURCHASE_ORDER_RECORDS_PATH);
      return normalizeApiList<PurchaseOrder>(raw);
    },
    throwOnError: false,
  });

  const { data: purchaseRequisitions, isLoading: requisitionsLoading } = useQuery({
    queryKey: ["/api/purchase-requisitions"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/purchase-requisitions");
      return normalizeApiList<PurchaseRequisition>(raw);
    },
    throwOnError: false,
  });

  const { data: reorderRequests, isLoading: reorderLoading } = useQuery({
    queryKey: ["/api/reorder-requests"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/reorder-requests");
      return normalizeApiList<ReorderRequest>(raw);
    },
    throwOnError: false,
  });

  const { data: extensionProjects } = useQuery({
    queryKey: ["/api/extensions/projects"],
    queryFn: async () => {
      try {
        const raw = await requestJson<unknown>("GET", "/api/extensions/projects");
        return normalizeApiList<Project>(raw);
      } catch {
        return [] as Project[];
      }
    },
    throwOnError: false,
  });

  const safeInventoryItems = Array.isArray(inventoryItems) ? inventoryItems : [];
  const safeLowStockItems = Array.isArray(lowStockItems) ? lowStockItems : [];
  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeWarehouses = Array.isArray(warehouses) ? warehouses : [];
  const safeSuppliers = Array.isArray(suppliers) ? suppliers : [];
  const safePurchaseOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  const safePurchaseRequisitions = Array.isArray(purchaseRequisitions) ? purchaseRequisitions : [];
  const safeReorderRequests = Array.isArray(reorderRequests) ? reorderRequests : [];
  const safeProjects = Array.isArray(extensionProjects)
    ? extensionProjects.map((p) => ({ id: p.id, code: p.code, name: p.name }))
    : [];

  return {
    safeInventoryItems,
    safeLowStockItems,
    safeCategories,
    safeWarehouses,
    safeSuppliers,
    safePurchaseOrders,
    safePurchaseRequisitions,
    safeReorderRequests,
    safeProjects,
    poLoading,
    requisitionsLoading,
    reorderLoading,
    stats,
    itemsLoading,
    itemsError,
    itemsErrorDetail,
    refetchInventory,
    lowStockLoading,
  };
}
