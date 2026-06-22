import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CircleDollarSign,
  GraduationCap,
  Package,
  RefreshCw,
  Ship,
  Truck,
  Warehouse,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { GasOpsCard } from "@/pages/control-tower/gas-ops-card";
import { Button } from "@/components/ui/button";
import { DataState } from "@/components/ui/data-state";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
import { fetchControlTowerDashboard } from "@/api/client";
import type { ControlTowerDashboardData } from "@/api/types";
import { useReportingMoney } from "@/hooks/use-reporting-money";
import { DashboardKpiCard } from "@/components/dashboard/dashboard-kpi-card";
import { ControlTowerChartsSection } from "@/components/dashboard/control-tower-charts";
import { NeedsAttentionPanel } from "@/components/dashboard/needs-attention-panel";
import { RecentActivityPanel } from "@/components/dashboard/recent-activity-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";

export default function ControlTowerPage() {
  const { formatMoney } = useReportingMoney();
  const [trendDays, setTrendDays] = useState<7 | 30 | 90>(7);
  const [businessArea, setBusinessArea] = useState("all");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["/api/dashboard/control-tower", trendDays, businessArea],
    queryFn: () => fetchControlTowerDashboard({ days: trendDays, area: businessArea }),
    staleTime: 45_000,
    refetchOnWindowFocus: false,
    gcTime: 5 * 60_000,
  });

  const refreshedLabel = useMemo(() => {
    if (!data?.generatedAt) return "—";
    try {
      return formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true });
    } catch {
      return "—";
    }
  }, [data?.generatedAt]);

  const showInitialSkeleton = isLoading && !data && !isError;

  return (
    <div className="mx-auto max-w-7xl space-y-6" data-testid="control-tower-page">
      <PageHeader
        title="Control Tower"
        titleTestId="page-title"
        subtitle="Live overview of inventory, procurement, logistics, finance, and operational risk."
        breadcrumb={<span>Operations / Control tower</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              Last refreshed {refreshedLabel}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="dashboard-refresh-button"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="default" size="sm" asChild>
              <Link href={APP_ROUTES.training.getEducatedModule("control-tower")}>
                <GraduationCap className="mr-1 h-4 w-4" />
                Get Educated: Control Tower
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={APP_ROUTES.operations.exceptions}>Exceptions</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={APP_ROUTES.operations.logistics}>Shipments</Link>
            </Button>
          </div>
        }
      />

      <ModuleTrainingPanel moduleId="control-tower" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Trend window</span>
          <Select
            value={String(trendDays)}
            onValueChange={(v) => setTrendDays(Number(v) as 7 | 30 | 90)}
          >
            <SelectTrigger className="w-[140px]" data-testid="dashboard-date-range-filter">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Focus</span>
          <Select value={businessArea} onValueChange={setBusinessArea}>
            <SelectTrigger className="w-[180px]" data-testid="dashboard-business-area-filter">
              <SelectValue placeholder="Area" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All areas</SelectItem>
              <SelectItem value="inventory">Inventory</SelectItem>
              <SelectItem value="procurement">Procurement</SelectItem>
              <SelectItem value="logistics">Logistics</SelectItem>
              <SelectItem value="finance">Finance</SelectItem>
              <SelectItem value="operations">Operations</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Charts summarize operational data and are not a replacement for detailed module records. See{" "}
        <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.admin.systemDiagnostics}>
          System Diagnostics
        </Link>{" "}
        if responses are slow or incomplete.
      </p>

      {data?.meta?.dataFreshness && Object.keys(data.meta.dataFreshness).length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="control-tower-data-freshness">
          Snapshot times:{" "}
          {Object.entries(data.meta.dataFreshness)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v ? new Date(String(v)).toLocaleTimeString() : ""}`)
            .join(" · ")}
        </p>
      ) : null}

      {showInitialSkeleton ? (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="control-tower-loading-skeleton"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-muted/50" />
          ))}
        </div>
      ) : null}

      {!showInitialSkeleton ? (
      <DataState
        loading={false}
        error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
        data={data ?? null}
        isEmpty={() => false}
        emptyTitle="No dashboard data"
        onRetry={() => void refetch()}
        errorAction={
          <Button variant="link" className="h-auto px-0" asChild>
            <Link href={APP_ROUTES.admin.systemDiagnostics}>System Diagnostics</Link>
          </Button>
        }
      >
        {(payload: ControlTowerDashboardData) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardKpiCard
                testId="dashboard-kpi-inventory-value"
                title="Inventory value (est.)"
                value={formatMoney(payload.kpis.inventoryValue)}
                description={payload.meta.valueBasisLabel}
                href={APP_ROUTES.inventory.root}
                status="neutral"
                trendLabel={
                  payload.kpis.inventoryValueTrendPct != null
                    ? `Δ ${payload.kpis.inventoryValueTrendPct}% vs prior`
                    : "Trend not available yet"
                }
                icon={<CircleDollarSign className="h-4 w-4" />}
              />
              <DashboardKpiCard
                testId="dashboard-kpi-low-stock"
                title="Low stock items"
                value={payload.kpis.lowStockItems ?? 0}
                description="At or below reorder threshold"
                href={`${APP_ROUTES.inventory.root}?lowStock=1`}
                status={(payload.kpis.lowStockItems ?? 0) > 0 ? "warn" : "good"}
                icon={<Package className="h-4 w-4" />}
              />
              <DashboardKpiCard
                testId="dashboard-kpi-open-requisitions"
                title="Open requisitions"
                value={payload.kpis.openRequisitions ?? 0}
                description="Draft and pending approval"
                href={APP_ROUTES.procurement.requisitions}
                status="neutral"
                icon={<Warehouse className="h-4 w-4" />}
              />
              <DashboardKpiCard
                testId="dashboard-kpi-open-pos"
                title="Open purchase orders"
                value={payload.kpis.openPurchaseOrders ?? 0}
                description="Not yet received / closed"
                href={APP_ROUTES.procurement.orders}
                status="neutral"
                icon={<Truck className="h-4 w-4" />}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardKpiCard
                testId="dashboard-kpi-delayed-shipments"
                title="Shipments delayed"
                value={payload.kpis.delayedShipments ?? 0}
                description="Past ETA, not delivered (PO-scoped)"
                href={APP_ROUTES.operations.logistics}
                status={(payload.kpis.delayedShipments ?? 0) > 0 ? "critical" : "good"}
                icon={<Ship className="h-4 w-4" />}
              />
              <DashboardKpiCard
                testId="dashboard-kpi-ap-due"
                title="AP due / overdue"
                value={payload.kpis.apInvoicesDueOrOverdue ?? 0}
                description="Supplier invoices needing payment attention"
                href={APP_ROUTES.finance.accountsPayable}
                status={(payload.kpis.apInvoicesDueOrOverdue ?? 0) > 0 ? "warn" : "good"}
                icon={<Building2 className="h-4 w-4" />}
              />
              <DashboardKpiCard
                testId="dashboard-kpi-exceptions"
                title="Operational exceptions"
                value={payload.kpis.operationalExceptions ?? 0}
                description="Open or in progress"
                href={APP_ROUTES.operations.exceptions}
                status={(payload.kpis.operationalExceptions ?? 0) > 0 ? "warn" : "good"}
                icon={<AlertTriangle className="h-4 w-4" />}
              />
              <DashboardKpiCard
                testId="dashboard-kpi-supplier-risk"
                title="Supplier risk alerts"
                value={payload.kpis.supplierRiskAlerts ?? 0}
                description="Suppliers with late inbound loads in scope"
                href={APP_ROUTES.procurement.suppliers}
                status={(payload.kpis.supplierRiskAlerts ?? 0) > 0 ? "warn" : "good"}
                icon={<AlertTriangle className="h-4 w-4" />}
              />
            </div>

            <ControlTowerChartsSection
              data={payload}
              loading={false}
              error={null}
              onRetry={() => void refetch()}
              area={businessArea}
              formatMoney={formatMoney}
            />

            <NeedsAttentionPanel items={payload.needsAttention} areaFilter={businessArea} />

            <RecentActivityPanel items={payload.recentActivity.slice(0, 10)} />

            {(payload.spotlight.delayedShipments.length > 0 ||
              payload.spotlight.oldestOpenExceptions.length > 0 ||
              payload.spotlight.supplierRisks.length > 0) && (
              <div className="grid gap-4 lg:grid-cols-3" data-testid="control-tower-spotlight">
                {payload.spotlight.delayedShipments.length > 0 && (
                  <Card data-testid="control-tower-spotlight-shipments">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Most delayed shipments</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {payload.spotlight.delayedShipments.map((row) => (
                        <div
                          key={row.id}
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                        >
                          <div>
                            <Link className="font-medium text-primary underline-offset-4 hover:underline" href={row.href}>
                              #{row.id} · PO {row.poNumber}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {row.carrier || "—"} · {row.driftMinutes}m past ETA
                            </p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {payload.spotlight.oldestOpenExceptions.length > 0 && (
                  <Card data-testid="control-tower-spotlight-exceptions">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Oldest open exceptions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {payload.spotlight.oldestOpenExceptions.map((row) => (
                        <div
                          key={row.id}
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                        >
                          <div>
                            <Link className="font-medium text-primary underline-offset-4 hover:underline" href={row.href}>
                              {row.title}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {row.type} · {row.agedHours}h open · {row.severity}
                            </p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {payload.spotlight.supplierRisks.length > 0 && (
                  <Card data-testid="control-tower-spotlight-supplier-risks">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Supplier risk spotlight</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {payload.spotlight.supplierRisks.map((row) => (
                        <div
                          key={row.supplierId}
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                        >
                          <div>
                            <Link
                              className="font-medium text-primary underline-offset-4 hover:underline"
                              href={row.href}
                            >
                              {row.name}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              Late loads: {row.lateShipments}
                              {row.openExceptions > 0 ? ` · Open exceptions: ${row.openExceptions}` : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {payload.meta.partialFailures && payload.meta.partialFailures.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="control-tower-partial-failures">
                Some dashboard sections used fallbacks:{" "}
                {payload.meta.partialFailures.map((f) => f.area).join(", ")}
              </p>
            )}

            <GasOpsCard />
          </>
        )}
      </DataState>
      ) : null}
    </div>
  );
}
