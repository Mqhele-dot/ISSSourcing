import type { AnalyticsFilters, AnalyticsResponse } from "@shared/analytics-types";
import { requestJson } from "@/lib/queryClient";

export type AnalyticsArea = "overview" | "procurement" | "inventory" | "logistics" | "suppliers" | "finance" | "exceptions" | "diagnostics" | "reports";

function queryString(filters: AnalyticsFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchAnalytics(area: AnalyticsArea, filters: AnalyticsFilters): Promise<AnalyticsResponse> {
  const response = await requestJson<AnalyticsResponse>("GET", `/api/analytics/${area}${queryString(filters)}`);
  if (
    !response ||
    typeof response.generatedAt !== "string" ||
    !response.meta ||
    typeof response.kpis !== "object" ||
    !response.charts ||
    !response.tables ||
    !Array.isArray(response.recommendations)
  ) {
    throw new Error("The analytics service returned an invalid response. Retry or open System Diagnostics.");
  }
  return response;
}

export const fetchAnalyticsOverview = (filters: AnalyticsFilters) => fetchAnalytics("overview", filters);
export const fetchProcurementAnalytics = (filters: AnalyticsFilters) => fetchAnalytics("procurement", filters);
export const fetchInventoryAnalytics = (filters: AnalyticsFilters) => fetchAnalytics("inventory", filters);
export const fetchLogisticsAnalytics = (filters: AnalyticsFilters) => fetchAnalytics("logistics", filters);
export const fetchSupplierAnalytics = (filters: AnalyticsFilters) => fetchAnalytics("suppliers", filters);
export const fetchFinanceAnalytics = (filters: AnalyticsFilters) => fetchAnalytics("finance", filters);
export const fetchExceptionAnalytics = (filters: AnalyticsFilters) => fetchAnalytics("exceptions", filters);
export const fetchDiagnosticsAnalytics = (filters: AnalyticsFilters) => fetchAnalytics("diagnostics", filters);
