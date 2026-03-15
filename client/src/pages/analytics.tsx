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
  const { isError: statsError } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: fetchStatsSafe,
    retry: 2,
    staleTime: 30_000,
  });

  const { isError: invError } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: fetchInventoryArray,
    retry: 2,
    staleTime: 30_000,
  });

  const hasDataError = statsError || invError;

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
