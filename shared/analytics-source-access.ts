import type {AnalyticsResponse} from "./analytics-types";
import type {AnalyticsFilters} from "./analytics-types";

export const analyticsResources=["purchases","inventory","suppliers","warehouses","finance","users"] as const;
export type AnalyticsReadAccess=Partial<Record<typeof analyticsResources[number],boolean>> & { companySupplierScope?: boolean };
export const analyticsSourceRequirements:Record<string,readonly (typeof analyticsResources[number])[]>={
  filter_suppliers:["suppliers"],filter_warehouses:["warehouses"],filter_categories:["inventory"],filter_departments:["purchases"],filter_owners:["users"],
  procurement:["purchases"],procurement_pipeline:["purchases"],requisition_pipeline:["purchases"],supplier_spend:["purchases","suppliers"],category_spend:["purchases","inventory"],
  inventory:["inventory","warehouses","suppliers"],logistics:["inventory","purchases","suppliers"],finance:["finance","suppliers"],exceptions:["inventory"],supplier_risk:["suppliers","purchases","inventory"],operations_trend:["purchases","inventory","finance"],
};
export function canReadAnalyticsSource(source:string,access:AnalyticsReadAccess):boolean {
  if(source==="supplier_risk"&&access.companySupplierScope===false)return false;
  const required=analyticsSourceRequirements[source];
  return Boolean(required)&&required.every(resource=>access[resource]===true);
}
const sourceFilters:Record<string,readonly string[]>={
  procurement:["dateFrom","dateTo","supplierId","ownerId","departmentId","status"],procurement_pipeline:["dateFrom","dateTo","supplierId","ownerId","departmentId"],requisition_pipeline:["dateFrom","dateTo","supplierId","ownerId","departmentId"],
  supplier_spend:["dateFrom","dateTo","supplierId","departmentId"],category_spend:["dateFrom","dateTo","supplierId","categoryId","departmentId"],
  inventory:["supplierId","warehouseId","categoryId"],logistics:["dateFrom","dateTo","supplierId","status"],finance:["dateFrom","dateTo","supplierId","ownerId","status"],exceptions:["dateFrom","dateTo","risk","status"],supplier_risk:["supplierId"],operations_trend:["dateFrom","dateTo"],
};
export function unsupportedAnalyticsSourceFilters(source:string,filters:AnalyticsFilters):string[] {
  if(source.startsWith("filter_"))return []; // Choices are tenant Master Data, not filtered transactions.
  return Object.entries(filters).filter(([key,value])=>key!=="businessArea"&&!( ["inventory","supplier_risk"].includes(source)&&["dateFrom","dateTo"].includes(key))&&value!==undefined&&value!==null&&value!==""&&!sourceFilters[source]?.includes(key)).map(([key])=>key);
}

const kpis:Record<string,string>={procurementSpend:"procurement",openPurchaseOrders:"procurement",inventoryHealth:"inventory",lateShipments:"logistics",openExceptions:"exceptions",apExposure:"finance",supplierRisk:"supplier_risk"};
const charts:Record<string,string>={procurementPipeline:"procurement",inventoryHealth:"inventory",logisticsRisk:"logistics",apAging:"finance",exceptionsBySeverity:"exceptions",operationsTrend:"operations_trend",spendBySupplier:"supplier_spend",spendByCategory:"category_spend",supplierRisk:"supplier_risk",invoiceStatus:"finance",stockValueByCategory:"inventory",exceptionAging:"exceptions"};
const tables:Record<string,string>={highRiskSuppliers:"supplier_risk",delayedShipments:"logistics",oldestOpenExceptions:"exceptions",lowStockItems:"inventory",overdueInvoices:"finance"};
const recommendations:Record<string,string>={"negative-stock":"inventory","low-stock":"inventory","late-shipments":"logistics","missing-eta":"logistics","overdue-ap":"finance","open-exceptions":"exceptions"};
export function restrictAnalyticsOutputs(response:AnalyticsResponse,denied:ReadonlySet<string>):AnalyticsResponse {
  const message="Unavailable: your current role does not have read access to all sources required for this view.";
  response.meta.restrictedSources=[...denied].sort();
  response.meta.restrictedCharts=[];
  if(denied.size&&response.kpis.systemHealth?.value==="Ready")response.kpis.systemHealth={...response.kpis.systemHealth,value:"Limited access",status:"neutral",helperText:"Only sources permitted by your current role were checked. Restricted sources are not verified by this observation."};
  return markUnavailableAnalyticsSources(response,denied,message);
}
export function markUnavailableAnalyticsSources(response:AnalyticsResponse,denied:ReadonlySet<string>,message:string):AnalyticsResponse {
  response.meta.unavailableCharts??={};
  for(const [key,source] of Object.entries(kpis))if(denied.has(source)&&response.kpis[key]) {
    response.kpis[key]={label:response.kpis[key].label,value:"Unavailable",status:"neutral",helperText:message};
  }
  for(const [key,source] of Object.entries(charts))if(denied.has(source)) {
    response.charts[key]=[];response.meta.unavailableCharts[key]=message;
    if(response.meta.restrictedSources?.includes(source))response.meta.restrictedCharts?.push(key);
  }
  for(const [key,source] of Object.entries(tables))if(denied.has(source)&&response.tables[key]) {
    response.tables[key]={...response.tables[key],rows:[],emptyTitle:"Unavailable",emptyDescription:message};
  }
  response.recommendations=response.recommendations.filter(row=>!denied.has(recommendations[row.id]??"unknown"));
  response.dataQualityWarnings=response.dataQualityWarnings.filter(row=>!denied.has(row.code.startsWith("PO_")?"procurement":row.code.startsWith("SHIPMENT_")?"logistics":"inventory"));
  return response;
}
