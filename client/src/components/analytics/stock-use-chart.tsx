import React from "react";
import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface StockUsageItem {
  itemId: number;
  itemName: string;
  quantityUsed: number;
}

interface StockUsageData {
  byItem: StockUsageItem[];
  source?: "movements" | "on_hand";
}

export function StockUseChart() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/analytics/stock-usage?limit=10"],
    queryFn: async () => {
      try {
        const raw = await requestJson<StockUsageData>("GET", "/api/analytics/stock-usage?limit=10");
        const byItem = Array.isArray(raw?.byItem) ? raw.byItem : [];
        const source: "movements" | "on_hand" = raw?.source === "on_hand" ? "on_hand" : "movements";
        return { byItem, source };
      } catch {
        return { byItem: [], source: "movements" as const };
      }
    },
  });

  const chartData =
    data?.byItem?.map((row) => ({
      name: row.itemName.length > 12 ? `${row.itemName.slice(0, 12)}…` : row.itemName,
      fullName: row.itemName,
      usage: row.quantityUsed,
    })) ?? [];

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock Use (by quantity moved)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive text-sm">Error loading stock usage.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Use</CardTitle>
        <p className="text-sm text-muted-foreground">
          {data?.source === "on_hand"
            ? "Top SKUs by on-hand quantity (no outbound movements recorded yet — add sales/issues or use seeded adjustments)"
            : "Top items by outbound quantity (sales, issues, negative adjustments, damage, expiry)"}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : chartData.length > 0 ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 24 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  tickLine={false}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload?.[0]) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-background border border-border rounded-md shadow-md p-2">
                          <p className="font-medium truncate max-w-[200px]">{d.fullName}</p>
                          <p className="text-primary">Used: {d.usage} units</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="usage" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No stock usage data yet. Usage is tracked when items are sold or issued.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
