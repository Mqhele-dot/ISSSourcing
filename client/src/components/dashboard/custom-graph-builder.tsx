import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import type { InventoryItem, InventoryStats, Category } from "@shared/schema";

const DATA_SOURCES = [
  { id: "value-by-category", label: "Value by category", description: "Inventory value (qty × cost) per category" },
  { id: "count-by-category", label: "Item count by category", description: "Number of SKUs per category" },
  { id: "stock-usage", label: "Stock usage", description: "Top items by quantity used (sales/issues)" },
  { id: "inventory-overview", label: "Inventory overview", description: "Totals: items, low stock, out of stock, value" },
  { id: "top-value-items", label: "Top items by value", description: "Highest value items (qty × cost)" },
] as const;

const CHART_TYPES = [
  { id: "bar", label: "Bar (vertical)" },
  { id: "bar-horizontal", label: "Bar (horizontal)" },
  { id: "line", label: "Line" },
  { id: "pie", label: "Pie" },
] as const;

type DataSourceId = (typeof DATA_SOURCES)[number]["id"];
type ChartTypeId = (typeof CHART_TYPES)[number]["id"];

import { requestJson } from "@/lib/queryClient";

const CHART_COLORS = [
  "hsl(var(--chart-1, 220 70% 50%))",
  "hsl(var(--chart-2, 160 60% 45%))",
  "hsl(var(--chart-3, 30 80% 55%))",
  "hsl(var(--chart-4, 280 65% 60%))",
  "hsl(var(--chart-5, 340 75% 55%))",
  "hsl(var(--primary))",
];

export function CustomGraphBuilder() {
  const [dataSource, setDataSource] = useState<DataSourceId>("value-by-category");
  const [chartType, setChartType] = useState<ChartTypeId>("bar");
  const [limit, setLimit] = useState(10);

  const { data: inventoryData, isLoading: invLoading } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: () => requestJson<InventoryItem[]>("GET", "/api/inventory"),
  });
  const inventory = Array.isArray(inventoryData) ? inventoryData : [];

  const { data: categoriesData, isLoading: catLoading } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: () => requestJson<Category[]>("GET", "/api/categories"),
  });
  const categories = Array.isArray(categoriesData) ? categoriesData : [];

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: () => requestJson<InventoryStats>("GET", "/api/inventory/stats"),
  });

  const { data: stockUsageData, isLoading: usageLoading } = useQuery({
    queryKey: ["/api/analytics/stock-usage", limit],
    queryFn: async () => {
      const json = await requestJson<{ byItem?: { itemId: number; itemName: string; quantityUsed: number }[] }>("GET", `/api/analytics/stock-usage?limit=${limit}`);
      return json?.byItem ?? [];
    },
  });
  const stockUsage = Array.isArray(stockUsageData) ? stockUsageData : [];

  const chartData = useMemo(() => {
    const items = Array.isArray(inventory) ? inventory : [];
    const cats = Array.isArray(categories) ? categories : [];

    if (dataSource === "value-by-category") {
      const byCat: Record<number, { name: string; value: number }> = {};
      cats.forEach((c) => { byCat[c.id] = { name: c.name, value: 0 }; });
      byCat[0] = { name: "Uncategorized", value: 0 };
      items.forEach((item) => {
        const cid = item.categoryId ?? 0;
        if (!byCat[cid]) byCat[cid] = { name: "Uncategorized", value: 0 };
        byCat[cid].value += (item.quantity ?? 0) * (item.cost ?? 0);
      });
      return Object.entries(byCat)
        .filter(([, v]) => v.value > 0)
        .map(([, v]) => ({ name: v.name.length > 14 ? `${v.name.slice(0, 14)}…` : v.name, fullName: v.name, value: v.value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
    }

    if (dataSource === "count-by-category") {
      const byCat: Record<number, { name: string; count: number }> = {};
      cats.forEach((c) => { byCat[c.id] = { name: c.name, count: 0 }; });
      byCat[0] = { name: "Uncategorized", count: 0 };
      items.forEach((item) => {
        const cid = item.categoryId ?? 0;
        if (!byCat[cid]) byCat[cid] = { name: "Uncategorized", count: 0 };
        byCat[cid].count += 1;
      });
      return Object.entries(byCat)
        .filter(([, v]) => v.count > 0)
        .map(([, v]) => ({ name: v.name.length > 14 ? `${v.name.slice(0, 14)}…` : v.name, fullName: v.name, value: v.count }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
    }

    if (dataSource === "stock-usage") {
      const byItem = Array.isArray(stockUsage) ? stockUsage : [];
      return byItem.map((row) => ({
        name: row.itemName.length > 14 ? `${row.itemName.slice(0, 14)}…` : row.itemName,
        fullName: row.itemName,
        value: row.quantityUsed,
      }));
    }

    if (dataSource === "inventory-overview" && stats) {
      return [
        { name: "Total items", value: stats.totalItems ?? 0 },
        { name: "Low stock", value: stats.lowStockItems ?? 0 },
        { name: "Out of stock", value: stats.outOfStockItems ?? 0 },
        { name: "Inv. value (k)", value: Math.round((stats.inventoryValue ?? 0) / 1000) },
      ];
    }

    if (dataSource === "top-value-items") {
      const withValue = items
        .map((item) => ({
          name: item.name,
          fullName: item.name,
          value: (item.quantity ?? 0) * (item.cost ?? 0),
        }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit)
        .map((d) => ({ ...d, name: d.name.length > 14 ? `${d.name.slice(0, 14)}…` : d.name }));
      return withValue;
    }

    return [];
  }, [dataSource, inventory, categories, stats, stockUsage, limit]);

  const valueLabel = dataSource === "value-by-category" || dataSource === "top-value-items"
    ? "Value"
    : dataSource === "inventory-overview"
      ? "Count / Value (k)"
      : "Count";
  const isLoading =
    (dataSource === "value-by-category" || dataSource === "count-by-category" || dataSource === "top-value-items") && (invLoading || catLoading) ||
    (dataSource === "inventory-overview" && statsLoading) ||
    (dataSource === "stock-usage" && usageLoading);

  const renderChart = () => {
    if (isLoading) return <Skeleton className="h-[320px] w-full rounded-lg" />;
    if (!chartData.length) {
      return (
        <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed bg-muted/30 text-sm text-muted-foreground">
          No data for this selection. Try another data source or add inventory.
        </div>
      );
    }

    const isPie = chartType === "pie";
    const isBarHorizontal = chartType === "bar-horizontal";
    const isCurrency = dataSource === "value-by-category" || dataSource === "top-value-items";
    const formatTick = (v: number) =>
      isCurrency && dataSource !== "inventory-overview" ? formatCurrency(v) : String(v);

    const commonTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { fullName?: string; name: string; value: number } }[] }) => {
      if (!active || !payload?.[0]) return null;
      const d = payload[0].payload;
      const label = d.fullName ?? d.name;
      const val = isCurrency && dataSource !== "inventory-overview" ? formatCurrency(d.value) : d.value;
      return (
        <div className="rounded-md border bg-background px-3 py-2 shadow-md">
          <p className="font-medium truncate max-w-[220px]">{label}</p>
          <p className="text-primary">{val}</p>
        </div>
      );
    };

    if (chartType === "pie") {
      return (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={commonTooltip} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (isBarHorizontal) {
      return (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" tickLine={false} tickFormatter={dataSource === "inventory-overview" ? undefined : formatTick} />
              <YAxis type="category" dataKey="name" width={100} tickLine={false} tick={{ fontSize: 11 }} />
              <Tooltip content={commonTooltip} />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name={valueLabel} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (chartType === "line") {
      return (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" tickLine={false} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} tickFormatter={(v) => formatTick(v)} />
              <Tooltip content={commonTooltip} />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} name={valueLabel} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return (
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" tickLine={false} tick={{ fontSize: 11 }} />
            <YAxis tickLine={false} tickFormatter={(v) => formatTick(v)} />
            <Tooltip content={commonTooltip} />
            <Bar dataKey="value" fill="hsl(var(--chart-2, var(--primary)))" radius={[4, 4, 0, 0]} name={valueLabel} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom graph</CardTitle>
        <p className="text-sm text-muted-foreground">
          Build a chart from current inventory, categories, stock usage, or overview stats.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Data source</Label>
            <Select value={dataSource} onValueChange={(v) => setDataSource(v as DataSourceId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATA_SOURCES.map((ds) => (
                  <SelectItem key={ds.id} value={ds.id}>
                    {ds.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Chart type</Label>
            <Select value={chartType} onValueChange={(v) => setChartType(v as ChartTypeId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_TYPES.map((ct) => (
                  <SelectItem key={ct.id} value={ct.id}>
                    {ct.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(dataSource === "value-by-category" || dataSource === "count-by-category" || dataSource === "stock-usage" || dataSource === "top-value-items") && (
            <div className="space-y-2">
              <Label>Top N</Label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 15, 20].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {renderChart()}
      </CardContent>
    </Card>
  );
}
