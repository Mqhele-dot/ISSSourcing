import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { requestJson } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchSpendAnalytics } from "@/api/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

  const { data: expiring = [], isLoading: expiringLoading } = useQuery({
    queryKey: ["/api/inventory/expiring", 30],
    queryFn: () =>
      requestJson<Array<{ id: number; sku: string; name: string; expiryDate?: string | null }>>(
        "GET",
        "/api/inventory/expiring?days=30",
      ),
  });

  const { data: insightsPayload, isLoading: insightsLoading } = useQuery({
    queryKey: ["/api/analytics/supply-insights"],
    queryFn: () =>
      requestJson<{
        generatedAt: string;
        insights: Array<{
          id: string;
          severity: string;
          title: string;
          detail: string;
          href?: string;
        }>;
      }>("GET", "/api/analytics/supply-insights"),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Supply Analytics"
        subtitle="Spend, turnover, supplier performance, and warehouse utilization views."
      />

      <Card data-tour="supply-insights">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Operational insights</CardTitle>
            <Badge variant="secondary">Rule-based (no LLM)</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Heuristic signals from control-tower KPIs. For optional generative AI later, plug a model behind a
            dedicated endpoint.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {insightsLoading ? (
            <div className="text-sm text-muted-foreground">Loading insights…</div>
          ) : (
            (insightsPayload?.insights ?? []).map((row) => (
              <div
                key={row.id}
                className="rounded-lg border p-3 text-sm"
                data-severity={row.severity}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{row.title}</span>
                  <Badge
                    variant={
                      row.severity === "critical"
                        ? "destructive"
                        : row.severity === "warning"
                          ? "default"
                          : "outline"
                    }
                    className="capitalize"
                  >
                    {row.severity}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{row.detail}</p>
                {row.href ? (
                  <Link href={row.href} className="mt-2 inline-block text-primary text-xs font-medium underline">
                    Open →
                  </Link>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card data-tour="supply-filters">
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

      <Card data-tour="supply-expiring">
        <CardHeader>
          <CardTitle>Expiring inventory (30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {expiringLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : expiring.length === 0 ? (
            <div className="text-sm text-muted-foreground">No items with expiry in this window.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {expiring.slice(0, 15).map((row) => (
                <li key={row.id} className="flex justify-between gap-2">
                  <span>
                    {row.sku} — {row.name}
                  </span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
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

        <Card>
          <CardHeader>
            <CardTitle>Exception analytics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.exceptionSummary ?? []).slice(0, 8).map((row) => (
              <div key={row.type} className="flex items-center justify-between text-sm">
                <span>{row.type}</span>
                <span>{row.openCount}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
