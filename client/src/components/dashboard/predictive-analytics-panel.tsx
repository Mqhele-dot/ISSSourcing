import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, AlertTriangle, Eye, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requestJson } from "@/lib/queryClient";

interface DemandForecast {
  date: string;
  actual: number;
  forecast: number;
  confidence: number;
  trend: "up" | "down" | "stable";
}

interface StockAlert {
  itemId: number;
  itemName: string;
  currentStock: number;
  forecastedDemand: number;
  daysUntilStockout: number;
  recommendedOrderQty: number;
  riskLevel: "critical" | "high" | "medium" | "low";
}

/**
 * Predictive Analytics Component
 * Provides demand forecasting and stock optimization recommendations
 */
export function PredictiveAnalyticsPanel() {
  const [selectedItem, setSelectedItem] = useState<string>("all");
  const [forecastDays, setForecastDays] = useState<7 | 14 | 30>(14);

  // Fetch demand forecast data
  const { data: forecastData = [] } = useQuery({
    queryKey: ["/api/analytics/demand-forecast", selectedItem, forecastDays],
    queryFn: () =>
      requestJson<DemandForecast[]>(
        "GET",
        `/api/analytics/demand-forecast?item=${selectedItem}&days=${forecastDays}`
      ).catch(() => []),
    staleTime: 60_000,
  });

  // Fetch stock alerts
  const { data: stockAlerts = [] } = useQuery({
    queryKey: ["/api/analytics/stock-alerts"],
    queryFn: () =>
      requestJson<StockAlert[]>("GET", "/api/analytics/stock-alerts").catch(
        () => []
      ),
    staleTime: 60_000,
  });

  const criticalAlerts = useMemo(
    () => stockAlerts.filter((a) => a.riskLevel === "critical"),
    [stockAlerts]
  );

  const highRiskAlerts = useMemo(
    () => stockAlerts.filter((a) => a.riskLevel === "high"),
    [stockAlerts]
  );

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "critical":
        return "bg-red-100 text-red-800 border-red-300";
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-300";
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "low":
        return "bg-green-100 text-green-800 border-green-300";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "up":
        return <TrendingUp className="h-4 w-4 text-red-600" />;
      case "down":
        return <TrendingDown className="h-4 w-4 text-green-600" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Critical Alerts Banner */}
      {criticalAlerts.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex gap-3 items-start">
              <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-900">
                  {criticalAlerts.length} Critical Stock Alert
                  {criticalAlerts.length !== 1 ? "s" : ""}
                </h4>
                <p className="text-sm text-red-700 mt-1">
                  The following items are at risk of stockout within the next week:
                </p>
                <div className="mt-3 space-y-1">
                  {criticalAlerts.map((alert) => (
                    <p key={alert.itemId} className="text-sm text-red-700">
                      • <strong>{alert.itemName}</strong> — {alert.daysUntilStockout} days
                      until stockout (current: {alert.currentStock})
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Demand Forecast Chart */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  <CardTitle>Demand Forecast</CardTitle>
                </div>
                <Select value={String(forecastDays)} onValueChange={(v) =>
                  setForecastDays(Number(v) as any)
                }>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 Days</SelectItem>
                    <SelectItem value="14">14 Days</SelectItem>
                    <SelectItem value="30">30 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {forecastData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={forecastData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(255, 255, 255, 0.95)",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                      }}
                      formatter={(value: any) => [value, null]}
                      labelFormatter={(label) => `Date: ${label}`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      stroke="#3b82f6"
                      name="Actual Demand"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast"
                      stroke="#10b981"
                      name="Forecast"
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-gray-500 py-8">
                  No forecast data available
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Key Metrics */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Forecast Accuracy</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-600">MAPE (Mean Absolute Percentage Error)</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {forecastData.length > 0
                      ? (
                          forecastData.reduce((sum, d) => sum + (100 - d.confidence), 0) /
                          forecastData.length
                        ).toFixed(1)
                      : "—"}
                    %
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Average Confidence</p>
                  <p className="text-2xl font-bold text-green-600">
                    {forecastData.length > 0
                      ? (
                          forecastData.reduce((sum, d) => sum + d.confidence, 0) /
                          forecastData.length
                        ).toFixed(0)
                      : "—"}
                    %
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stock Health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Critical</span>
                  <span className="text-lg font-bold text-red-600">
                    {criticalAlerts.length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">High Risk</span>
                  <span className="text-lg font-bold text-orange-600">
                    {highRiskAlerts.length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Total Items</span>
                  <span className="text-lg font-bold">
                    {stockAlerts.length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Stock Alerts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Stock Optimization Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {stockAlerts.length === 0 ? (
              <p className="text-center text-gray-500 py-8">
                No stock alerts at this time
              </p>
            ) : (
              stockAlerts.map((alert) => (
                <div
                  key={alert.itemId}
                  className={`p-3 rounded-lg border ${getRiskColor(alert.riskLevel)} space-y-2`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm">{alert.itemName}</h4>
                      <p className="text-xs opacity-75 mt-0.5">Item ID: {alert.itemId}</p>
                    </div>
                    <span className="text-xs font-bold px-2 py-1 bg-white bg-opacity-50 rounded">
                      {alert.riskLevel.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="opacity-75">Current Stock</p>
                      <p className="font-semibold">{alert.currentStock} units</p>
                    </div>
                    <div>
                      <p className="opacity-75">Forecasted Demand</p>
                      <p className="font-semibold">{alert.forecastedDemand} units</p>
                    </div>
                    <div>
                      <p className="opacity-75">Days Until Stockout</p>
                      <p className="font-semibold">{alert.daysUntilStockout} days</p>
                    </div>
                    <div>
                      <p className="opacity-75">Recommended Order</p>
                      <p className="font-semibold">{alert.recommendedOrderQty} units</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
