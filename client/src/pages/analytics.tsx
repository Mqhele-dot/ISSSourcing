import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import TutorialButton from "@/components/ui/tutorial-button";
import { TopItems } from "@/components/analytics/top-items";
import { InventoryValue } from "@/components/analytics/inventory-value";
import { StockUseChart } from "@/components/analytics/stock-use-chart";
import { ValueByCategoryChart } from "@/components/analytics/value-by-category-chart";
import { CustomGraphBuilder } from "@/components/dashboard/custom-graph-builder";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

/** Normalize API response to array (handles envelope or raw array); never throw */
async function fetchInventoryArray(): Promise<unknown[]> {
  try {
    const raw = await requestJson<unknown>("GET", "/api/inventory");
    if (Array.isArray(raw)) return raw;
    const data = (raw as { data?: unknown[] })?.data;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Fetch inventory stats for analytics; never throw */
async function fetchStatsSafe(): Promise<{ totalItems?: number; lowStockItems?: number; outOfStockItems?: number; inventoryValue?: number }> {
  try {
    const raw = await requestJson<unknown>("GET", "/api/inventory/stats");
    const unwrapped = (raw as { data?: unknown })?.data ?? raw;
    if (typeof unwrapped === "object" && unwrapped !== null) return unwrapped as { totalItems?: number; lowStockItems?: number; outOfStockItems?: number; inventoryValue?: number };
    return {};
  } catch {
    return {};
  }
}

/**
 * Dedicated Analytics page - consolidates all analytics components
 * with proper error handling and loading states. Sections render independently
 * so a single API failure does not block the rest of the page.
 */
export default function AnalyticsPage() {
  const { data: stats = {}, isError: statsError } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: fetchStatsSafe,
    retry: 2,
    staleTime: 30_000,
  });

  const { data: inventoryArray = [], isError: invError } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: fetchInventoryArray,
    retry: 2,
    staleTime: 30_000,
  });

  const hasDataError = statsError || invError;
  const hasNoData = !hasDataError && Array.isArray(inventoryArray) && inventoryArray.length === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Inventory value, demand trends, and custom reports"
        breadcrumb={<span>Dashboard / Analytics</span>}
        actions={<TutorialButton />}
      />

      {hasDataError && (
        <Alert variant="destructive">
          <AlertTitle>Data loading issue</AlertTitle>
          <AlertDescription>
            Some analytics may not load. Ensure the server is running and the database is configured.
          </AlertDescription>
        </Alert>
      )}

      {hasNoData && (
        <Alert>
          <AlertTitle>No inventory data yet</AlertTitle>
          <AlertDescription>
            Charts will appear once you add inventory items. Add items from Inventory or run the demo to seed data.
          </AlertDescription>
        </Alert>
      )}

      {!hasDataError && (stats.totalItems ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">SKUs</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{stats.totalItems}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Low stock</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {stats.lowStockItems ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Out of stock</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums text-destructive">{stats.outOfStockItems ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Inventory value</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{formatCurrency(stats.inventoryValue ?? 0)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stock Use & Value - each chart handles its own loading and errors */}
      <section id="analytics" className="scroll-mt-6">
        <h2 className="text-lg font-semibold mb-4">Stock Use & Value</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StockUseChart />
          <ValueByCategoryChart />
        </div>
      </section>

      {/* Custom Graphs */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Custom Graphs</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Build a custom chart from current data: choose a data source and chart type.
        </p>
        <CustomGraphBuilder />
      </section>

      {/* Analytics & Insights */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Analytics & Insights</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <TopItems />
          <InventoryValue />
        </div>
      </section>
    </div>
  );
}
