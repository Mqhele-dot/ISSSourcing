import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Settings2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { requestJson } from "@/lib/queryClient";

export interface CustomKPI {
  id?: string;
  name: string;
  description?: string;
  metric: "revenue" | "orders" | "inventory_value" | "supplier_count" | "on_time_delivery" | "stock_turnover";
  period: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  target?: number;
  threshold?: "warning" | "critical";
  compareToLastPeriod?: boolean;
}

interface DashboardKPIsState {
  kpis: CustomKPI[];
}

/**
 * Custom KPI Builder Component
 * Allows users to create and manage custom dashboard KPIs
 */
export function CustomKPIBuilder() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddingKpi, setIsAddingKpi] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CustomKPI>({
    name: "",
    metric: "revenue",
    period: "monthly",
  });

  const { data: kpis = [] } = useQuery({
    queryKey: ["/api/dashboard/custom-kpis"],
    queryFn: () => requestJson<CustomKPI[]>("GET", "/api/dashboard/custom-kpis").catch(() => []),
    staleTime: 30_000,
  });

  const createKpiMutation = useMutation({
    mutationFn: (kpi: CustomKPI) =>
      requestJson("POST", "/api/dashboard/custom-kpis", kpi),
    onSuccess: () => {
      toast({ title: "KPI created", description: "Your custom KPI has been added" });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/custom-kpis"] });
      resetForm();
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create KPI",
        description: err?.message || "Please try again",
      });
    },
  });

  const deleteKpiMutation = useMutation({
    mutationFn: (id: string) =>
      requestJson("DELETE", `/api/dashboard/custom-kpis/${id}`),
    onSuccess: () => {
      toast({ title: "KPI deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/custom-kpis"] });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", metric: "revenue", period: "monthly" });
    setIsAddingKpi(false);
    setEditingId(null);
  };

  const handleAddKpi = () => {
    if (!formData.name.trim()) {
      toast({
        variant: "destructive",
        title: "Validation error",
        description: "KPI name is required",
      });
      return;
    }
    createKpiMutation.mutate(formData);
  };

  const metricLabels: Record<string, string> = {
    revenue: "Revenue",
    orders: "Orders",
    inventory_value: "Inventory Value",
    supplier_count: "Supplier Count",
    on_time_delivery: "On-Time Delivery %",
    stock_turnover: "Stock Turnover",
  };

  const periodLabels: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
  };

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <CardTitle>Custom KPIs</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAddingKpi(true)}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add KPI
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI List */}
        <div className="space-y-2">
          {kpis.length === 0 ? (
            <p className="text-sm text-gray-500">No custom KPIs yet. Create one to get started.</p>
          ) : (
            kpis.map((kpi) => (
              <div
                key={kpi.id}
                className="flex items-center justify-between rounded-lg border bg-white p-3"
              >
                <div className="flex-1">
                  <p className="font-medium text-sm">{kpi.name}</p>
                  <p className="text-xs text-gray-600">
                    {metricLabels[kpi.metric]} • {periodLabels[kpi.period]}
                  </p>
                  {kpi.description && (
                    <p className="text-xs text-gray-500 mt-1">{kpi.description}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteKpiMutation.mutate(kpi.id!)}
                  disabled={deleteKpiMutation.isPending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Add/Edit Dialog */}
        <Dialog open={isAddingKpi} onOpenChange={setIsAddingKpi}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Custom KPI</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="kpi-name">KPI Name</Label>
                <Input
                  id="kpi-name"
                  placeholder="e.g., Monthly Revenue Target"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="kpi-metric">Metric</Label>
                <Select value={formData.metric} onValueChange={(v) =>
                  setFormData({ ...formData, metric: v as CustomKPI["metric"] })
                }>
                  <SelectTrigger id="kpi-metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(metricLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="kpi-period">Period</Label>
                <Select value={formData.period} onValueChange={(v) =>
                  setFormData({ ...formData, period: v as CustomKPI["period"] })
                }>
                  <SelectTrigger id="kpi-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(periodLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="kpi-description">Description (Optional)</Label>
                <Input
                  id="kpi-description"
                  placeholder="Add notes about this KPI"
                  value={formData.description || ""}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="kpi-target">Target Value (Optional)</Label>
                <Input
                  id="kpi-target"
                  type="number"
                  placeholder="Leave blank if no target"
                  value={formData.target || ""}
                  onChange={(e) => setFormData({
                    ...formData,
                    target: e.target.value ? Number(e.target.value) : undefined,
                  })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button onClick={handleAddKpi} disabled={createKpiMutation.isPending}>
                {createKpiMutation.isPending ? "Creating..." : "Create KPI"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
