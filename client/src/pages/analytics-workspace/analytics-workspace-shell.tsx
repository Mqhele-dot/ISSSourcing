import type { ReactNode } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { SectionNav } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { DataState } from "@/components/ui/data-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { APP_ROUTES, type AnalyticsSectionSlug } from "@/lib/routes/app-routes";
import { ANALYTICS_NAV } from "./analytics-nav";
import type { AnalyticsKpiCard } from "./analytics-workspace-types";

type Props = {
  section: AnalyticsSectionSlug;
  cards: AnalyticsKpiCard[];
  loading: boolean;
  error: Error | null;
  /** Some analytics sources failed while others succeeded — show inline retry for this section. */
  partialFailure?: { labels: string[]; onRetry: () => void };
  onRetry: () => void;
  children: ReactNode;
};

export function AnalyticsWorkspaceShell({
  section,
  cards,
  loading,
  error,
  partialFailure,
  onRetry,
  children,
}: Props) {
  return (
    <PageShell variant="analytics-mode" data-testid={section === "overview" ? "analytics-overview-page" : undefined}>
      <PageHeader
        title="Analytics workspace"
        titleTestId={section === "overview" ? "page-title" : undefined}
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

      {partialFailure && partialFailure.labels.length > 0 ? (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <AlertTitle>Partial analytics load</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              These sources did not load: {partialFailure.labels.join(", ")}. Other KPIs below may still be usable.
            </span>
            <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={partialFailure.onRetry}>
              Retry section data
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <DataState
        loading={loading}
        error={error}
        data={cards}
        isEmpty={() => false}
        emptyTitle="No analytics"
        onRetry={() => void onRetry()}
      >
        {() => children}
      </DataState>
    </PageShell>
  );
}
