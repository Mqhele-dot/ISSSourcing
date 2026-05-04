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
    health,
    shell,
    sourceStatuses,
  } = useAnalyticsWorkspaceQueries(section);

  const cards = useMemo(
    () =>
      buildAnalyticsSectionCards(
        section,
        { inventoryStats, controlTower, apOverview, spendAnalytics },
        formatMoney,
        health,
      ),
    [section, inventoryStats, controlTower, apOverview, spendAnalytics, formatMoney, health],
  );

  return (
    <AnalyticsWorkspaceShell
      section={section}
      cards={cards}
      loading={shell.loading}
      error={shell.error}
      partialFailure={
        shell.someFailed
          ? {
              labels: shell.failedLabels,
              onRetry: () => void shell.refetch(),
            }
          : undefined
      }
      onRetry={() => void shell.refetch()}
      sourceStatuses={sourceStatuses}
      onRetryAllFeeds={() => void shell.refetchAll()}
    >
      <>
        <AnalyticsKpiGrid cards={cards} section={section} />
        <AnalyticsBoundaryMap section={section} />
        <AnalyticsKpiRegistryPanel section={section} />
      </>
    </AnalyticsWorkspaceShell>
  );
}
