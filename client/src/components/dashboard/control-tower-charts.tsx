import { useMemo } from "react";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ControlTowerDashboardData } from "@/api/types";
import { DashboardChartCard } from "@/components/dashboard/dashboard-chart-card";
import { DashboardEmptyChart } from "@/components/dashboard/dashboard-empty-chart";

const COLORS = [
  "hsl(var(--chart-1, 221 83% 53%))",
  "hsl(var(--chart-2, 173 80% 40%))",
  "hsl(var(--chart-3, 266 85% 58%))",
  "hsl(var(--chart-4, 31 95% 57%))",
  "hsl(var(--chart-5, 198 93% 60%))",
];

function showArea(area: string, want: string | string[]): boolean {
  if (area === "all") return true;
  if (Array.isArray(want)) return want.includes(area);
  return area === want;
}

type TowerChartsProps = {
  data: ControlTowerDashboardData | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  area: string;
  formatMoney: (n: number) => string;
};

export function ControlTowerChartsSection({
  data,
  loading,
  error,
  onRetry,
  area,
  formatMoney,
}: TowerChartsProps) {
  const pipelineData = useMemo(() => {
    if (!data?.procurementPipeline?.length) return [];
    return data.procurementPipeline.map((row) => ({
      ...row,
      labelShort: row.label.length > 24 ? `${row.label.slice(0, 22)}…` : row.label,
    }));
  }, [data?.procurementPipeline]);

  const pipelineTotal = useMemo(
    () => pipelineData.reduce((s, r) => s + r.count, 0),
    [pipelineData],
  );

  const healthPie = useMemo(() => {
    if (!data?.inventoryHealth) return [];
    return data.inventoryHealth.filter((r) => r.count > 0);
  }, [data?.inventoryHealth]);

  const stockBars = useMemo(() => data?.stockValueByCategory ?? [], [data?.stockValueByCategory]);

  const apBars = useMemo(() => data?.apAging ?? [], [data?.apAging]);

  const logisticsPie = useMemo(() => {
    if (!data?.logisticsRisk) return [];
    return data.logisticsRisk.filter((r) => r.count > 0);
  }, [data?.logisticsRisk]);

  const supplierBars = useMemo(() => data?.supplierPerformance ?? [], [data?.supplierPerformance]);

  const trendLines = useMemo(() => data?.operationsTrend ?? [], [data?.operationsTrend]);

  const err = error ?? undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {showArea(area, "procurement") || showArea(area, "all") ? (
        <DashboardChartCard
          testId="dashboard-procurement-pipeline-chart"
          title="Procurement pipeline"
          helper="Shows where requests and orders are sitting in the buying process."
          loading={loading}
          error={err}
          onRetry={onRetry}
        >
          {pipelineTotal === 0 ? (
            <DashboardEmptyChart
              message="No procurement pipeline data yet."
              detail="Requisitions and purchase orders will appear here once created."
            />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart layout="vertical" data={pipelineData} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="labelShort" width={118} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Count">
                  {pipelineData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-center text-xs text-muted-foreground">
            <Link className="text-primary underline-offset-4 hover:underline" href="/procurement/requisitions">
              Requisitions
            </Link>
            {" · "}
            <Link className="text-primary underline-offset-4 hover:underline" href="/procurement/orders">
              Purchase orders
            </Link>
          </p>
        </DashboardChartCard>
      ) : null}

      {showArea(area, "inventory") || showArea(area, "all") ? (
        <DashboardChartCard
          testId="dashboard-inventory-health-chart"
          title="Inventory health"
          helper="Highlights stock records that may need action (available vs thresholds)."
          loading={loading}
          error={err}
          onRetry={onRetry}
        >
          {healthPie.length === 0 ? (
            <DashboardEmptyChart message="No inventory health breakdown available." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={healthPie}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {healthPie.map((entry, i) => (
                    <Cell key={entry.id} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
          <p className="text-xs text-muted-foreground">
            Segments link to inventory: low stock uses the low-stock hint where supported.
          </p>
        </DashboardChartCard>
      ) : null}

      {showArea(area, "inventory") || showArea(area, "all") ? (
        <DashboardChartCard
          testId="dashboard-stock-value-category-chart"
          title="Stock value by category"
          helper={`Estimated value — ${data?.meta.valueBasisLabel ?? "cost or price × available quantity"}.`}
          loading={loading}
          error={err}
          onRetry={onRetry}
        >
          {stockBars.length === 0 ? (
            <DashboardEmptyChart message="No category value data." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stockBars}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={68} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoney(Number(v))} width={72} />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Bar dataKey="value" fill="hsl(var(--chart-2, 160 60% 45%))" radius={[4, 4, 0, 0]} name="Value" />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-xs text-center">
            <Link className="text-primary underline-offset-4 hover:underline" href="/inventory">
              Open inventory workspace
            </Link>
          </p>
        </DashboardChartCard>
      ) : null}

      {showArea(area, "finance") || showArea(area, "all") ? (
        <DashboardChartCard
          testId="dashboard-ap-aging-chart"
          title="Accounts payable aging"
          helper="Shows supplier invoices by payment urgency (open balances)."
          loading={loading}
          error={err}
          onRetry={onRetry}
        >
          {apBars.every((b) => b.count === 0) ? (
            <DashboardEmptyChart
              message="AP aging will appear once supplier invoices are captured."
              detail="Connect finance intake or record supplier invoices with due dates."
            />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={apBars}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-16} textAnchor="end" height={72} />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(value: number) => [`${value} invoices`, "Count"]} />
                <Bar dataKey="count" fill="hsl(var(--chart-3, 266 85% 58%))" radius={[4, 4, 0, 0]} name="Invoices" />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-xs text-center">
            <Link className="text-primary underline-offset-4 hover:underline" href="/finance/accounts-payable">
              Open accounts payable
            </Link>
          </p>
        </DashboardChartCard>
      ) : null}

      {showArea(area, "logistics") || showArea(area, "all") ? (
        <DashboardChartCard
          testId="dashboard-logistics-risk-chart"
          title="Shipment ETA risk"
          helper="Shows inbound deliveries that may affect availability (org-scoped to PO-linked shipments)."
          loading={loading}
          error={err}
          onRetry={onRetry}
        >
          {logisticsPie.length === 0 ? (
            <DashboardEmptyChart
              message="No active shipments in scope."
              detail="Create shipments from purchase orders to see ETA risk."
            />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={logisticsPie}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={88}
                  paddingAngle={2}
                >
                  {logisticsPie.map((entry, i) => (
                    <Cell key={entry.id} fill={COLORS[(i + 2) % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
          <p className="text-xs text-center">
            <Link className="text-primary underline-offset-4 hover:underline" href="/operations/logistics">
              Open logistics
            </Link>
          </p>
        </DashboardChartCard>
      ) : null}

      {showArea(area, "procurement") || showArea(area, "logistics") || showArea(area, "all") ? (
        <DashboardChartCard
          testId="dashboard-supplier-performance-chart"
          title="Supplier performance snapshot"
          helper="Top suppliers by late inbound shipments (linked PO scope). Full scorecards can evolve later."
          loading={loading}
          error={err}
          onRetry={onRetry}
        >
          {supplierBars.length === 0 ? (
            <DashboardEmptyChart message="No supplier risk signals in this scope." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart layout="vertical" data={supplierBars} margin={{ left: 8, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="riskScore" fill="hsl(var(--chart-4, 31 95% 57%))" radius={[0, 4, 4, 0]} name="Risk count" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </DashboardChartCard>
      ) : null}

      {showArea(area, "all") || showArea(area, "operations") ? (
        <DashboardChartCard
          testId="dashboard-operations-trend-chart"
          title="Operational activity trend"
          helper="Daily event mix from the operations activity feed (approximate categories)."
          loading={loading}
          error={err}
          onRetry={onRetry}
        >
          {trendLines.length === 0 ? (
            <DashboardEmptyChart message="No trend points in the selected window." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendLines}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="requisitions" stroke={COLORS[0]} dot={false} name="Requisitions" />
                <Line type="monotone" dataKey="purchaseOrders" stroke={COLORS[1]} dot={false} name="PO / orders" />
                <Line type="monotone" dataKey="receiving" stroke={COLORS[2]} dot={false} name="Receiving" />
                <Line type="monotone" dataKey="invoices" stroke={COLORS[3]} dot={false} name="Invoices" />
                <Line type="monotone" dataKey="exceptions" stroke={COLORS[4]} dot={false} name="Exceptions" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </DashboardChartCard>
      ) : null}
    </div>
  );
}
