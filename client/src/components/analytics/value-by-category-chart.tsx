import React, { useMemo } from "react";
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
import { formatCurrency } from "@/lib/utils";
import type { InventoryItem } from "@shared/schema";
import type { Category } from "@shared/schema";

export function ValueByCategoryChart() {
  const { data: itemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const raw = await requestJson<InventoryItem[] | { data?: InventoryItem[] }>("GET", "/api/inventory");
      return Array.isArray(raw) ? raw : (raw as { data?: InventoryItem[] })?.data ?? [];
    },
  });
  const items = useMemo(() => (Array.isArray(itemsData) ? itemsData : []), [itemsData]);

  const { data: categoriesData } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const raw = await requestJson<Category[] | { data?: Category[] }>("GET", "/api/categories");
      return Array.isArray(raw) ? raw : (raw as { data?: Category[] })?.data ?? [];
    },
  });
  const categories = useMemo(() => (Array.isArray(categoriesData) ? categoriesData : []), [categoriesData]);

  const chartData = useMemo(() => {
    if (!items?.length || !categories?.length) return [];
    const byCategory: Record<number, { name: string; value: number }> = {};
    categories.forEach((c) => {
      byCategory[c.id] = { name: c.name, value: 0 };
    });
    byCategory[0] = { name: "Uncategorized", value: 0 };

    items.forEach((item) => {
      const catId = item.categoryId ?? 0;
      if (!byCategory[catId]) byCategory[catId] = { name: "Uncategorized", value: 0 };
      const cost = item.cost ?? 0;
      byCategory[catId].value += (item.quantity ?? 0) * cost;
    });

    return Object.entries(byCategory)
      .filter(([, v]) => v.value > 0)
      .map(([, v]) => ({ name: v.name.length > 10 ? `${v.name.slice(0, 10)}…` : v.name, fullName: v.name, value: v.value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [items, categories]);

  const isLoading = itemsLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Value by Category</CardTitle>
        <p className="text-sm text-muted-foreground">
          Inventory value (quantity × cost) grouped by category
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
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tickLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload?.[0]) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-background border border-border rounded-md shadow-md p-2">
                          <p className="font-medium">{d.fullName}</p>
                          <p className="text-primary">{formatCurrency(d.value)}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="value" fill="hsl(var(--chart-2, var(--primary)))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No inventory value by category. Add items with cost and quantity.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
