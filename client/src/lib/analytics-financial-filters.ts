import type { AnalyticsFilters } from "@shared/analytics-types";

/** Never silently drop a filter the financial service cannot apply. */
export function financialFiltersForAnalytics(filters: AnalyticsFilters) {
  const unsupported = Object.entries(filters).filter(([key,value]) =>
    !["dateFrom","dateTo","supplierId"].includes(key) && value !== undefined && value !== "" && value !== "all").map(([key])=>key);
  return {unsupported,filters:{from:filters.dateFrom,to:filters.dateTo,supplierId:filters.supplierId}};
}
