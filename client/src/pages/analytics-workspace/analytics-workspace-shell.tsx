import type { ReactNode } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { SectionNav } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { DataState } from "@/components/ui/data-state";
import { APP_ROUTES, type AnalyticsSectionSlug } from "@/lib/routes/app-routes";
import { ANALYTICS_NAV } from "./analytics-nav";
import type { AnalyticsKpiCard } from "./analytics-workspace-types";

type Props = {
  section: AnalyticsSectionSlug;
  cards: AnalyticsKpiCard[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  children: ReactNode;
};

export function AnalyticsWorkspaceShell({ section, cards, loading, error, onRetry, children }: Props) {
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
