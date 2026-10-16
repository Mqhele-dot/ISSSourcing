import { lazy, Suspense, useMemo } from "react";
import { useLocation } from "wouter";
import { useReportingMoney } from "@/hooks/use-reporting-money";
import { getAnalyticsSection } from "./analytics-nav";
import { AnalyticsBoundaryMap } from "./analytics-boundary-map";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsKpiRegistryPanel } from "./analytics-kpi-registry-panel";
import { AnalyticsWorkspaceShell } from "./analytics-workspace-shell";
import { buildAnalyticsSectionCards } from "./build-analytics-section-cards";
import { useAnalyticsWorkspaceQueries } from "./use-analytics-workspace-queries";

const AnalyticsWorkspaceCharts = lazy(() =>
  import("./analytics-workspace-charts").then((module) => ({
    default: module.AnalyticsWorkspaceCharts,
  })),
);

function AnalyticsVisualsFallback() {
  return (
    <section className="space-y-3" aria-busy="true" aria-live="polite">
      <div>
        <h2 className="text-lg font-semibold">Visual summaries</h2>
        <p className="text-sm text-muted-foreground">Loading charts without delaying the rest of the workspace…</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2" data-testid="analytics-visuals-loading">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-72 animate-pulse rounded-lg border bg-muted/30" />
        ))}
      </div>
    </section>
  );
}

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
        <Suspense fallback={<AnalyticsVisualsFallback />}>
          <AnalyticsWorkspaceCharts
            section={section}
            bundle={{ inventoryStats, controlTower, apOverview, spendAnalytics }}
            health={health}
            formatMoney={formatMoney}
            loading={shell.loading}
          />
        </Suspense>
        <AnalyticsBoundaryMap section={section} />
        <AnalyticsKpiRegistryPanel section={section} />
      </>
    </AnalyticsWorkspaceShell>
  );
}
