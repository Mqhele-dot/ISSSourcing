import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import type { ApOverview, ControlTowerOverview, InventoryStats, SpendAnalytics } from "./analytics-workspace-types";

export function useAnalyticsWorkspaceQueries() {
  const {
    data: inventoryStats,
    isLoading: inventoryLoading,
    isError: inventoryError,
    error: inventoryErr,
    refetch: refetchInventory,
  } = useQuery({
    queryKey: ["/api/inventory/stats", "analytics-workspace"],
    queryFn: () => requestJson<InventoryStats>("GET", "/api/inventory/stats"),
  });

  const { data: controlTower } = useQuery({
    queryKey: ["/api/control-tower/overview", "analytics-workspace"],
    queryFn: () => requestJson<ControlTowerOverview>("GET", "/api/control-tower/overview"),
  });

  const { data: apOverview } = useQuery({
    queryKey: ["/api/ap/overview", "analytics-workspace"],
    queryFn: () => requestJson<ApOverview>("GET", "/api/ap/overview"),
  });

  const { data: spendAnalytics } = useQuery({
    queryKey: ["/api/reports/analytics", "analytics-workspace"],
    queryFn: () => requestJson<SpendAnalytics>("GET", "/api/reports/analytics"),
  });

  return {
    inventoryStats,
    controlTower,
    apOverview,
    spendAnalytics,
    isLoading: inventoryLoading,
    isError: inventoryError,
    error: inventoryErr,
    refetch: refetchInventory,
  };
}
