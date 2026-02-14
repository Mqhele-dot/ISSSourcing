import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, Boxes, Clock3, PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataState } from "@/components/ui/data-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { fetchControlTowerOverview, type ControlTowerOverview } from "@/api/client";

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

type KpiCardProps = {
  title: string;
  value: string | number;
  href: string;
  icon: ReactNode;
};

function KpiCard({ title, value, href, icon }: KpiCardProps) {
  return (
    <Link href={href}>
      <Card className="cursor-pointer transition-colors hover:bg-accent/40">
        <CardContent className="flex items-center justify-between pt-6">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-semibold">{value}</p>
          </div>
          <div className="text-primary">{icon}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function HomePage() {
  const fetcher = async (): Promise<ControlTowerOverview> => fetchControlTowerOverview();
  const { loading, error, data, refetch } = useAsyncResource(fetcher);

  const openExceptions = data
    ? Object.values(data.kpis.exceptionsBySeverity).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Control Tower"
        subtitle="Operational command center"
        breadcrumb={<span>Overview / Control Tower</span>}
        actions={
          <Button variant="outline" onClick={refetch}>
            Refresh
          </Button>
        }
      />

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={() => false}
        emptyTitle="No dashboard data available"
        onRetry={refetch}
      >
        {(overview) => (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title="Open exceptions"
                value={openExceptions}
                href="/exceptions?status=open"
                icon={<AlertTriangle className="h-8 w-8" />}
              />
              <KpiCard
                title="Late shipments"
                value={overview.kpis.lateShipments}
                href="/logistics?status=in_transit"
                icon={<Clock3 className="h-8 w-8" />}
              />
              <KpiCard
                title="POs awaiting action"
                value={overview.kpis.posAwaitingAction}
                href="/orders?status=approved"
                icon={<PackageCheck className="h-8 w-8" />}
              />
              <KpiCard
                title="Low stock SKUs"
                value={overview.kpis.lowStockSkus}
                href="/inventory?low=true"
                icon={<Boxes className="h-8 w-8" />}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Recent activity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {overview.activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent activity events.</p>
                  ) : (
                    overview.activity.map((event) => (
                      <div key={event.id} className="rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-4">
                          <p className="font-medium">{event.title}</p>
                          <Badge variant="outline">{event.eventType}</Badge>
                        </div>
                        {event.details ? (
                          <p className="mt-1 text-sm text-muted-foreground">{event.details}</p>
                        ) : null}
                        <p className="mt-2 text-xs text-muted-foreground">{formatDate(event.createdAt)}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Exception severity mix</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {Object.entries(overview.kpis.exceptionsBySeverity).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No open exceptions.</p>
                  ) : (
                    Object.entries(overview.kpis.exceptionsBySeverity).map(([severity, count]) => (
                      <Link key={severity} href={`/exceptions?severity=${encodeURIComponent(severity)}&status=open`}>
                        <div className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-accent/40">
                          <span className="capitalize">{severity}</span>
                          <Badge variant="outline">{count}</Badge>
                        </div>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </DataState>
    </div>
  );
}
