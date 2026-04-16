import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { SectionNav } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { DataState } from "@/components/ui/data-state";
import { useReportingMoney } from "@/hooks/use-reporting-money";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { ANALYTICS_NAV, getAnalyticsSection } from "./analytics-nav";
import { AnalyticsBoundaryMap } from "./analytics-boundary-map";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsKpiRegistryPanel } from "./analytics-kpi-registry-panel";
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
    <PageShell variant="analytics-mode">
      <PageHeader
        title="Analytics workspace"
        subtitle="Business intelligence, saved reports, and export execution under one navigation model."
        breadcrumb={<span>Analytics</span>}
        actions={
          <div
            className="flex flex-wrap gap-2"
            id={section === "overview" ? "dashboard-actions" : undefined}
          >
            <Button asChild size="sm" variant="outline">
              <Link href={APP_ROUTES.operations.controlTower}>Open control tower</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={APP_ROUTES.analytics.exportCenter}>Export center</Link>
            </Button>
          </div>
        }
      />

      <SectionNav items={[...ANALYTICS_NAV]} />

      <DataState
        loading={isLoading}
        error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
        data={cards}
        isEmpty={() => false}
        emptyTitle="No analytics"
        onRetry={() => void refetch()}
      >
        {() => (
          <>
            <AnalyticsKpiGrid cards={cards} section={section} />
            <AnalyticsBoundaryMap section={section} />
            <AnalyticsKpiRegistryPanel section={section} />
          </>
        )}
      </DataState>
    </PageShell>
  );
}
