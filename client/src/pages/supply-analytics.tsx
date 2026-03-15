import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchSpendAnalytics } from "@/api/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function SupplyAnalyticsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "", departmentId: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/analytics", applied.from, applied.to, applied.departmentId],
    queryFn: () =>
      fetchSpendAnalytics({
        from: applied.from || undefined,
        to: applied.to || undefined,
        departmentId: applied.departmentId ? Number(applied.departmentId) : undefined,
      }),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Supply Analytics"
        subtitle="Spend, turnover, supplier performance, and warehouse utilization views."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="analytics-from">From</Label>
            <Input id="analytics-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-to">To</Label>
            <Input id="analytics-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-dept">Department ID</Label>
            <Input
              id="analytics-dept"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => setApplied({ from, to, departmentId })}>Apply</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

        <Card>
          <CardHeader>
            <CardTitle>Supplier performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.supplierPerformance ?? []).slice(0, 8).map((row) => (
              <div key={row.supplierName} className="flex items-center justify-between text-sm">
                <span>{row.supplierName}</span>
                <span>{row.onTimeDeliveryRate.toFixed(1)}% ({row.ordersMeasured})</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
