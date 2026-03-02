import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import TutorialButton from "@/components/ui/tutorial-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { requestJson } from "@/lib/queryClient";
import { type InventoryItem } from "@shared/schema";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const demoInventory: InventoryItem[] = [
  { id: 9001, name: "Industrial Gloves", sku: "SAFE-GLV-001", lowStockThreshold: 40, onHand: 160, allocated: 20, available: 140, location: "A-01", quantity: 160, price: 4.2, categoryId: 1 },
  { id: 9002, name: "Hydraulic Pump", sku: "MECH-PMP-010", lowStockThreshold: 8, onHand: 22, allocated: 6, available: 16, location: "B-11", quantity: 22, price: 640, categoryId: 2 },
  { id: 9003, name: "Safety Helmet", sku: "SAFE-HLM-112", lowStockThreshold: 20, onHand: 96, allocated: 32, available: 64, location: "A-02", quantity: 96, price: 29.5, categoryId: 1 },
  { id: 9004, name: "Cable Reel", sku: "ELEC-CBL-201", lowStockThreshold: 12, onHand: 40, allocated: 10, available: 30, location: "C-04", quantity: 40, price: 120, categoryId: 3 },
  { id: 9005, name: "Forklift Tyre", sku: "OPS-TYR-221", lowStockThreshold: 6, onHand: 14, allocated: 2, available: 12, location: "D-09", quantity: 14, price: 180, categoryId: 4 },
];

export default function AnalyticsPage() {
  const [useDemoData, setUseDemoData] = useState(true);
  const [topN, setTopN] = useState("6");
  const [viewMode, setViewMode] = useState<"value" | "quantity">("value");

  const { data: liveInventory = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory"],
    queryFn: () => requestJson("GET", "/api/inventory"),
  });

  const inventory = useMemo(() => {
    if (Array.isArray(liveInventory) && liveInventory.length > 0) {
      return liveInventory;
    }
    return useDemoData ? demoInventory : [];
  }, [liveInventory, useDemoData]);

  const ranked = useMemo(() => {
    const n = Math.max(3, Math.min(20, Number(topN) || 6));
    return [...inventory]
      .map((item) => ({
        name: item.name,
        sku: item.sku,
        quantity: Number(item.quantity ?? item.onHand ?? 0),
        value: Number(item.price ?? 0) * Number(item.quantity ?? item.onHand ?? 0),
      }))
      .sort((a, b) => (viewMode === "value" ? b.value - a.value : b.quantity - a.quantity))
      .slice(0, n);
  }, [inventory, topN, viewMode]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inventory) {
      const key = `Category ${item.categoryId ?? 0}`;
      const value = Number(item.price ?? 0) * Number(item.quantity ?? item.onHand ?? 0);
      map.set(key, (map.get(key) ?? 0) + value);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [inventory]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Customizable demand and value insights with demo fallback data"
        actions={<TutorialButton pageName="analytics" />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Analytics controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="flex items-center gap-2">
            <Switch checked={useDemoData} onCheckedChange={setUseDemoData} id="demo-data" />
            <Label htmlFor="demo-data">Use demo data when live data is empty</Label>
          </div>
          <div>
            <Label htmlFor="top-n">Top items count</Label>
            <Input id="top-n" value={topN} onChange={(e) => setTopN(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={viewMode === "value"} onCheckedChange={(checked) => setViewMode(checked ? "value" : "quantity")} id="view-mode" />
            <Label htmlFor="view-mode">Rank by value (off = quantity)</Label>
          </div>
          <div className="text-sm text-muted-foreground flex items-center">Data rows: {inventory.length}</div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top inventory items</CardTitle></CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ranked}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" hide />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey={viewMode} fill="#2563eb" name={viewMode === "value" ? "Inventory value" : "Quantity"} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Value by category</CardTitle></CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={120} fill="#0ea5e9" label />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
