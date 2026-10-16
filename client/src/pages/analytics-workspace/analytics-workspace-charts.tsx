import { useMemo } from "react";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_ROUTES, type AnalyticsSectionSlug } from "@/lib/routes/app-routes";
import type {
  AnalyticsWorkspaceQueryBundle,
  AnalyticsWorkspaceSourceHealth,
} from "./analytics-workspace-types";

/** Visual cap for chart density; copy discloses total supplier count when higher. */
const SPEND_SUPPLIER_CHART_CAP = 40;

type Props = {
  section: AnalyticsSectionSlug;
  bundle: AnalyticsWorkspaceQueryBundle;
  health: AnalyticsWorkspaceSourceHealth;
  formatMoney: (value: number | null | undefined) => string;
  loading: boolean;
};

export function AnalyticsWorkspaceCharts({ section, bundle, health, formatMoney, loading }: Props) {
  const spendSeries = useMemo(() => {
    const rows = bundle.spendAnalytics?.spendBySupplier ?? [];
    if (!rows.length) {
      return { chart: [] as { name: string; spend: number }[], total: 0, shown: 0 };
    }
    const sorted = [...rows].sort((a, b) => Number(b.totalSpend ?? 0) - Number(a.totalSpend ?? 0));
    const total = sorted.length;
    const top = sorted.slice(0, SPEND_SUPPLIER_CHART_CAP);
    return {
      chart: top.map((r) => ({ name: r.supplierName, spend: Number(r.totalSpend ?? 0) })),
      total,
      shown: top.length,
    };
  }, [bundle.spendAnalytics?.spendBySupplier]);

  const logisticsBars = useMemo(() => {
    const k = bundle.controlTower?.kpis;
    if (!k) return [];
    return [
      { name: "Late / at-risk", value: Number(k.lateShipments ?? 0) },
      { name: "In transit", value: Number(k.inTransitShipments ?? 0) },
    ];
  }, [bundle.controlTower?.kpis]);

  const inventorySplit = useMemo(() => {
    const inv = bundle.inventoryStats;
    if (!inv) return [];
    const low = Number(inv.lowStockItems ?? 0);
    const tot = Number(inv.totalItems ?? 0);
    const rest = Math.max(0, tot - low);
    return [
      { name: "Low stock", value: low },
      { name: "Other SKUs", value: rest },
    ];
  }, [bundle.inventoryStats]);

  if (loading) {
    return (
      <section className="space-y-3" aria-busy="true" aria-live="polite">
        <div>
          <h2 className="text-lg font-semibold">Visual summaries</h2>
          <p className="text-sm text-muted-foreground">Building charts from the latest tenant data…</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2" data-testid="analytics-charts-skeleton">
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      </section>
    );
  }

  const showSpend = (section === "overview" || section === "procurement") && health.spendAnalytics;
  const showLogisticsBars =
    (section === "logistics" || section === "overview") && health.controlTower && logisticsBars.length > 0;
  const showInventorySplit =
    (section === "inventory" || section === "overview") &&
    health.inventoryStats &&
    inventorySplit.some((r) => r.value > 0);

  if (!showSpend && !showLogisticsBars && !showInventorySplit) {
    return (
      <Card data-testid="analytics-workspace-charts">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            Charts appear when spend, inventory, or control tower feeds return data for this section.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="analytics-visual-summaries-title">
      <div>
        <h2 id="analytics-visual-summaries-title" className="text-lg font-semibold">Visual summaries</h2>
        <p className="text-sm text-muted-foreground">
          Interactive charts summarize supplier spend, inventory health, and shipment risk. Use each card's link for the underlying records.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2" data-testid="analytics-workspace-charts">
      {showSpend ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">Spend by supplier</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href={APP_ROUTES.analytics.reports}>Reports</Link>
            </Button>
          </CardHeader>
          <CardContent className="h-72 pt-2">
            {spendSeries.chart.length === 0 ? (
              <p className="text-sm text-muted-foreground">No supplier spend rows for this view.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  Showing {spendSeries.shown} supplier{spendSeries.shown === 1 ? "" : "s"}
                  {spendSeries.total > spendSeries.shown
                    ? ` (top ${SPEND_SUPPLIER_CHART_CAP} of ${spendSeries.total} — use Reports for full tables and exports)`
                    : ""}
                  .
                </p>
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart layout="vertical" data={spendSeries.chart} margin={{ left: 4, right: 12, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tickFormatter={(v) => formatMoney(Number(v))} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => formatMoney(value)} />
                    <Bar dataKey="spend" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {showInventorySplit ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">Low stock vs other SKUs</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href={APP_ROUTES.inventory.root}>Inventory</Link>
            </Button>
          </CardHeader>
          <CardContent className="h-72 pt-2">
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={inventorySplit} margin={{ left: 4, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : null}

      {showLogisticsBars ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">Shipment signals</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href={APP_ROUTES.operations.logistics}>Logistics</Link>
            </Button>
          </CardHeader>
          <CardContent className="h-72 pt-2">
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={logisticsBars} margin={{ left: 4, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : null}
      </div>
    </section>
  );
}
