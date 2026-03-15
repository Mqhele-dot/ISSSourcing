import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchSpendAnalytics } from "@/api/client";

export default function SupplyAnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/analytics"],
    queryFn: fetchSpendAnalytics,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Supply Analytics"
        subtitle="Spend, turnover, supplier performance, and warehouse utilization views."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Spend by supplier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : (
              (data?.spendBySupplier ?? []).slice(0, 8).map((row) => (
                <div key={row.supplierName} className="flex items-center justify-between text-sm">
                  <span>{row.supplierName}</span>
                  <span>{row.totalSpend.toFixed(2)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory turnover</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.inventoryTurnover ?? []).slice(0, 8).map((row) => (
              <div key={row.sku} className="flex items-center justify-between text-sm">
                <span>{row.sku}</span>
                <span>{row.turnover.toFixed(2)}x</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Warehouse utilization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.warehouseUtilization ?? []).slice(0, 8).map((row) => (
              <div key={row.warehouseName} className="flex items-center justify-between text-sm">
                <span>{row.warehouseName}</span>
                <span>{row.utilization.toFixed(1)}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
