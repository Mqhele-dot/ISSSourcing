import assert from "node:assert/strict";
import { financialFiltersForAnalytics } from "../client/src/lib/analytics-financial-filters";
import { operationalAnalyticsSnapshot } from "../client/src/lib/analytics-operational-export";
import type { AnalyticsResponse } from "../shared/analytics-types";

assert.deepEqual(financialFiltersForAnalytics({businessArea:"all",dateFrom:"2026-10-01",supplierId:4}),{
  unsupported:[],filters:{from:"2026-10-01",to:undefined,supplierId:4}});
assert.deepEqual(financialFiltersForAnalytics({warehouseId:2,categoryId:3,status:"approved",businessArea:"procurement"}).unsupported,
  ["warehouseId","categoryId","status","businessArea"]);
const source:AnalyticsResponse={generatedAt:"2026-10-16T00:00:00Z",meta:{queryMs:1,filtersApplied:{},dataFreshness:{},partialFailures:[]},
  filterOptions:{suppliers:[],warehouses:[],categories:[],owners:[],departments:[]},
  kpis:{procurementSpend:{label:"Spend",value:123},apExposure:{label:"Exposure",value:123},openPurchaseOrders:{label:"Open POs",value:2}},
  charts:{spendBySupplier:[{label:"Mixed currencies",value:123,amount:123}],invoiceStatus:[{label:"Approved",value:2,amount:123}]},
  tables:{invoices:{columns:[{key:"id",label:"ID"},{key:"amount",label:"Amount",type:"money"}],rows:[{id:1,amount:123}]}},
  recommendations:[],dataQualityWarnings:[]};
const before=JSON.stringify(source);
const output=operationalAnalyticsSnapshot(source);
assert.equal(output.kpis.procurementSpend,undefined);
assert.equal(output.kpis.apExposure,undefined);
assert.equal(output.kpis.openPurchaseOrders.value,2);
assert.deepEqual(output.charts.spendBySupplier,[]);
assert.deepEqual(output.charts.invoiceStatus,[{label:"Approved",value:2}]);
assert.deepEqual(output.tables.invoices.rows,[{id:1}]);
assert.equal(output.tables.invoices.columns.length,1);
assert.equal(JSON.stringify(source),before,"Export must not mutate the rendered source data");
console.log("Analytics financial integration passed: supported filters, unsupported-filter blocking, monetary export exclusions and source preservation.");
