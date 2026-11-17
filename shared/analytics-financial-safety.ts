import type {AnalyticsResponse,ChartDatum} from './analytics-types';

/** Transitional operational analytics must not export unconverted financial totals. */
export function excludeLegacyMixedCurrencyTotals(input:AnalyticsResponse):AnalyticsResponse {
  const result:AnalyticsResponse=JSON.parse(JSON.stringify(input));
  const notice='Financial totals are available only through shared reporting-currency measures and their saved evidence. Operational counts are not approved financial obligations.';
  result.meta.financialMeasureNotice=notice;
  for(const key of ['procurementSpend','apExposure'])if(result.kpis[key]){
    result.kpis[key].value='Unavailable';result.kpis[key].helperText=notice;result.kpis[key].details={basis:'Deprecated: use shared financial measures'};
  }
  if(result.kpis.openPurchaseOrders?.details)delete result.kpis.openPurchaseOrders.details.value;
  result.charts.spendBySupplier=[];result.charts.spendByCategory=[];
  for(const key of ['apAging','supplierRisk'])for(const row of (result.charts[key]??[]) as ChartDatum[])delete row.amount;
  for(const [table,key]of [['highRiskSuppliers','exposure'],['overdueInvoices','amount']])if(result.tables[table]){
    result.tables[table].columns=result.tables[table].columns.filter(column=>column.key!==key);
    for(const row of result.tables[table].rows)delete row[key];
  }
  for(const recommendation of result.recommendations)if(recommendation.id==='overdue-ap'){
    recommendation.reason='This is an operational overdue-invoice count, not an approved financial balance. Review shared AP reporting for currency-safe obligations and evidence.';
    const supplier=result.meta.filtersApplied.supplierId;
    recommendation.href='/finance/accounts-payable/aging'+(Number.isSafeInteger(supplier)&&Number(supplier)>0?`?supplierId=${supplier}`:'');
  }
  return result;
}
