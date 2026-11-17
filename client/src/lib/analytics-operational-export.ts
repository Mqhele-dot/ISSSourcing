import type { AnalyticsResponse } from "@shared/analytics-types";

/** Legacy analytics downloads must not masquerade as the new frozen financial report. */
export function operationalAnalyticsSnapshot(data: AnalyticsResponse) {
  return {
    ...data,
    financialNotice: "Operational snapshot only. Financial totals and money columns are excluded until frozen-report export integration is complete.",
    kpis:Object.fromEntries(Object.entries(data.kpis).filter(([key])=>!["procurementSpend","apExposure"].includes(key))),
    charts:Object.fromEntries(Object.entries(data.charts).map(([key,rows])=>[key,
      /spend|stockValue/i.test(key)?[]:rows.map(row=>{const {amount:_amount,...rest}=row as unknown as Record<string,unknown>;return rest;})])),
    tables:Object.fromEntries(Object.entries(data.tables).map(([key,table])=>{
      const moneyKeys=new Set(table.columns.filter(column=>column.type==="money").map(column=>column.key));
      return [key,{...table,columns:table.columns.filter(column=>!moneyKeys.has(column.key)),
        rows:table.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([column])=>!moneyKeys.has(column))))}];
    })),
  };
}
