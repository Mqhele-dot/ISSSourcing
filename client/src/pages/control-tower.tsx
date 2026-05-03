import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  CircleDollarSign,
  FileWarning,
  Package,
  Ship,
  Truck,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { GasOpsCard } from "@/pages/control-tower/gas-ops-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataState } from "@/components/ui/data-state";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
import { requestJson } from "@/lib/queryClient";
import type { ControlTowerOverview } from "@/api/types";

export default function ControlTowerPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/control-tower/overview", "full-page"],
    queryFn: () => requestJson<ControlTowerOverview>("GET", "/api/control-tower/overview"),
  });

  const kpis = data?.kpis;
  const activity = data?.activity ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6" data-testid="control-tower-page">
      <PageHeader
        title="Control tower"
        titleTestId="page-title"
        subtitle="Operational KPIs, risk signals, and recent control-tower activity."
        breadcrumb={<span>Operations / Control tower</span>}
        actions={
          <div className="flex flex-wrap gap-2" data-tour="control-tower-shortcuts">
            <Button variant="outline" size="sm" asChild>
              <Link href={APP_ROUTES.operations.exceptions}>Exceptions</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={APP_ROUTES.operations.logistics}>Shipments</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={APP_ROUTES.procurement.orders}>Purchase orders</Link>
            </Button>
          </div>
        }
      />

      <ModuleTrainingPanel moduleId="control-tower" />

      <DataState
        loading={isLoading}
        error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
        data={data}
        isEmpty={() => false}
        emptyTitle="No overview"
        onRetry={() => void refetch()}
      >
        {() => (
          <>
            <div className="space-y-4" data-tour="control-tower-kpis">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Late / at-risk shipments</CardTitle>
                  <Ship className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{kpis?.lateShipments ?? 0}</p>
                  <p className="text-xs text-muted-foreground">From operations logistics model</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">POs awaiting action</CardTitle>
                  <Truck className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{kpis?.posAwaitingAction ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Open / approved / sent pipeline</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Low-stock SKUs</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{kpis?.lowStockSkus ?? 0}</p>
                  <p className="text-xs text-muted-foreground">At or below threshold</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Open exceptions (total)</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    {typeof kpis?.openExceptionsTotal === "number"
                      ? kpis.openExceptionsTotal
                      : kpis?.exceptionsBySeverity
                        ? Object.values(kpis.exceptionsBySeverity).reduce((a, n) => a + Number(n ?? 0), 0)
                        : 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Sum of open / in-progress cases</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Pending requisitions</CardTitle>
                  <FileWarning className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{kpis?.pendingRequisitions ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Draft or pending approval</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">In-transit shipments</CardTitle>
                  <Ship className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{kpis?.inTransitShipments ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Created, in transit, or delayed</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Overdue invoices</CardTitle>
                  <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{kpis?.overdueInvoices ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Status OVERDUE in AP</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Exceptions by severity</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {kpis?.exceptionsBySeverity && Object.keys(kpis.exceptionsBySeverity).length > 0 ? (
                    Object.entries(kpis.exceptionsBySeverity).map(([sev, count]) => (
                      <div key={sev} className="flex justify-between">
                        <span className="text-muted-foreground capitalize">{sev}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-xs">No open exception buckets</p>
                  )}
                </CardContent>
              </Card>
            </div>
            </div>

            <GasOpsCard />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" />
                  Recent activity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent control-tower events.</p>
                ) : (
                  <ul className="space-y-2">
                    {activity.slice(0, 40).map((row) => (
                      <li key={row.id} className="rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{row.title}</span>
                          <span className="text-xs text-muted-foreground">{row.eventType}</span>
                        </div>
                        {row.details ? <p className="mt-1 text-xs text-muted-foreground">{row.details}</p> : null}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </DataState>
    </div>
  );
}
