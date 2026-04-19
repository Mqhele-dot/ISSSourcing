import { useMemo } from "react";
import { useLocation } from "wouter";
import { useReportingMoney } from "@/hooks/use-reporting-money";
import { getAnalyticsSection } from "./analytics-nav";
import { AnalyticsBoundaryMap } from "./analytics-boundary-map";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsKpiRegistryPanel } from "./analytics-kpi-registry-panel";
import { AnalyticsWorkspaceShell } from "./analytics-workspace-shell";
import { buildAnalyticsSectionCards } from "./build-analytics-section-cards";
import { useAnalyticsWorkspaceQueries } from "./use-analytics-workspace-queries";

export default function AnalyticsWorkspacePage() {
  const [location] = useLocation();
  const section = getAnalyticsSection(location);
  const { formatMoney } = useReportingMoney();

  const {
    inventoryStats,
    controlTower,
    apOverview,
    spendAnalytics,
    isLoading,
    isError,
    error,
    refetch,
  } = useAnalyticsWorkspaceQueries();

  const cards = useMemo(
    () =>
      buildAnalyticsSectionCards(
        section,
        { inventoryStats, controlTower, apOverview, spendAnalytics },
        formatMoney,
      ),
    [
      section,
      inventoryStats,
      controlTower,
      apOverview,
      spendAnalytics,
      formatMoney,
    ],
  );

  return (
    <AnalyticsWorkspaceShell
      section={section}
      cards={cards}
      loading={isLoading}
      error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
      onRetry={() => void refetch()}
    >
      <>
        <AnalyticsKpiGrid cards={cards} section={section} />
        <AnalyticsBoundaryMap section={section} />
        <AnalyticsKpiRegistryPanel section={section} />
      </>
    </AnalyticsWorkspaceShell>
  );
}
