/**
 * Analytics workspace loads four JSON sources in parallel. Each analytics **section** depends on a subset
 * (see `criticalSourcesForSection`): failures there block the shell only when *all* critical sources for that
 * section fail. Other sections may still render with partial data; card builders use `health` to avoid
 * misleading zeros when a source is down.
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessageWithRequestId, requestJson } from "@/lib/queryClient";
import type { AnalyticsSectionSlug } from "@/lib/routes/app-routes";
import type { ApOverview, ControlTowerDashboard, ControlTowerOverview, InventoryStats, SpendAnalytics } from "./analytics-workspace-types";

export type AnalyticsSourceId = "inventoryStats" | "controlTower" | "apOverview" | "spendAnalytics";

function criticalSourcesForSection(section: AnalyticsSectionSlug): AnalyticsSourceId[] {
  switch (section) {
    case "overview":
      return ["inventoryStats", "controlTower", "apOverview", "spendAnalytics"];
    case "inventory":
      return ["inventoryStats"];
    case "procurement":
      return ["controlTower", "spendAnalytics"];
    case "finance":
      return ["apOverview", "controlTower"];
    case "logistics":
      return ["controlTower", "spendAnalytics"];
    default:
      return [];
  }
}

const SOURCE_LABEL: Record<AnalyticsSourceId, string> = {
  inventoryStats: "Inventory stats",
  controlTower: "Control tower",
  apOverview: "AP overview",
  spendAnalytics: "Spend analytics",
};

export function useAnalyticsWorkspaceQueries(section: AnalyticsSectionSlug) {
  const inventoryQuery = useQuery({
    queryKey: ["/api/inventory/stats", "analytics-workspace"],
    queryFn: () => requestJson<InventoryStats>("GET", "/api/inventory/stats"),
    throwOnError: false,
  });

  const controlTowerQuery = useQuery({
    queryKey: ["/api/dashboard/control-tower", "analytics-workspace"],
    queryFn: async (): Promise<ControlTowerOverview> => {
      const dashboard = await requestJson<ControlTowerDashboard>("GET", "/api/dashboard/control-tower?trendDays=7&businessArea=all");
      const pipeline = new Map((dashboard.procurementPipeline ?? []).map((entry) => [entry.id, Number(entry.count)]));
      return {
        kpis: {
          lowStockSkus: Number(dashboard.kpis?.lowStockItems ?? 0),
          posAwaitingAction: Number(pipeline.get("po_approved") ?? 0),
          pendingRequisitions: Number(dashboard.kpis?.openRequisitions ?? 0),
          lateShipments: Number(dashboard.kpis?.delayedShipments ?? 0),
          inTransitShipments: Number(dashboard.kpis?.inTransitShipments ?? 0),
          overdueInvoices: Number(dashboard.kpis?.apInvoicesDueOrOverdue ?? 0),
        },
      };
    },
    throwOnError: false,
  });

  const apOverviewQuery = useQuery({
    queryKey: ["/api/ap/overview", "analytics-workspace"],
    queryFn: () => requestJson<ApOverview>("GET", "/api/ap/overview"),
    throwOnError: false,
  });

  const spendAnalyticsQuery = useQuery({
    queryKey: ["/api/reports/analytics", "analytics-workspace"],
    queryFn: () => requestJson<SpendAnalytics>("GET", "/api/reports/analytics"),
    throwOnError: false,
  });

  const bySource = useMemo(
    () => ({
      inventoryStats: inventoryQuery,
      controlTower: controlTowerQuery,
      apOverview: apOverviewQuery,
      spendAnalytics: spendAnalyticsQuery,
    }),
    [inventoryQuery, controlTowerQuery, apOverviewQuery, spendAnalyticsQuery],
  );

  const critical = useMemo(() => criticalSourcesForSection(section), [section]);

  const shellState = useMemo(() => {
    if (critical.length === 0) {
      return {
        loading: false,
        blockingError: null as Error | null,
        someFailed: false,
        failedLabels: [] as string[],
        allFailed: false,
      };
    }

    const loading = critical.some((key) => bySource[key].isLoading);
    const failedKeys = critical.filter((key) => bySource[key].isError);
    const allFailed = failedKeys.length === critical.length && critical.length > 0;
    const failedLabels = failedKeys.map((k) => SOURCE_LABEL[k]);

    const firstErr = failedKeys[0] ? bySource[failedKeys[0]].error : null;
    const blockingError =
      allFailed && firstErr
        ? new Error(
            [
              failedLabels.length ? `Analytics unavailable (${failedLabels.join(", ")}).` : null,
              errorMessageWithRequestId(firstErr),
            ]
              .filter(Boolean)
              .join(" "),
          )
        : null;

    return {
      loading,
      blockingError,
      someFailed: failedKeys.length > 0,
      failedLabels,
      allFailed,
    };
  }, [critical, bySource]);

  const health = useMemo(
    () => ({
      inventoryStats: !inventoryQuery.isError,
      controlTower: !controlTowerQuery.isError,
      apOverview: !apOverviewQuery.isError,
      spendAnalytics: !spendAnalyticsQuery.isError,
    }),
    [
      inventoryQuery.isError,
      controlTowerQuery.isError,
      apOverviewQuery.isError,
      spendAnalyticsQuery.isError,
    ],
  );

  const refetchForSection = useCallback(() => {
    void Promise.all(critical.map((key) => bySource[key].refetch()));
  }, [critical, bySource]);

  const refetchAllAnalytics = useCallback(() => {
    void Promise.all([
      inventoryQuery.refetch(),
      controlTowerQuery.refetch(),
      apOverviewQuery.refetch(),
      spendAnalyticsQuery.refetch(),
    ]);
  }, [inventoryQuery, controlTowerQuery, apOverviewQuery, spendAnalyticsQuery]);

  const sourceStatuses = useMemo(
    () =>
      (["inventoryStats", "controlTower", "apOverview", "spendAnalytics"] as const).map((id) => ({
        id,
        label: SOURCE_LABEL[id],
        isLoading: bySource[id].isLoading,
        isError: bySource[id].isError,
      })),
    [bySource],
  );

  return {
    inventoryStats: inventoryQuery.data,
    controlTower: controlTowerQuery.data,
    apOverview: apOverviewQuery.data,
    spendAnalytics: spendAnalyticsQuery.data,
    health,
    queries: bySource,
    sourceStatuses,
    shell: {
      loading: shellState.loading,
      error: shellState.blockingError,
      someFailed: shellState.someFailed && !shellState.allFailed,
      failedLabels: shellState.failedLabels,
      refetch: refetchForSection,
      refetchAll: refetchAllAnalytics,
    },
  };
}
