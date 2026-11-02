import assert from "node:assert/strict";
import {analyticsResources,canReadAnalyticsSource,restrictAnalyticsOutputs,markUnavailableAnalyticsSources,unsupportedAnalyticsSourceFilters} from "../shared/analytics-source-access";
import type {AnalyticsResponse} from "../shared/analytics-types";

assert.equal(canReadAnalyticsSource("finance",{}),false);
assert.equal(canReadAnalyticsSource("unknown",Object.fromEntries(analyticsResources.map(key=>[key,true]))),false);
assert.equal(canReadAnalyticsSource("finance",{finance:true}),false,"Joined supplier evidence also requires permission");
assert.equal(canReadAnalyticsSource("finance",{finance:true,suppliers:true}),true);
assert.equal(canReadAnalyticsSource("inventory",{inventory:true,warehouses:true,suppliers:true}),true);
assert.deepEqual(unsupportedAnalyticsSourceFilters("finance",{warehouseId:1}),["warehouseId"]);
assert.deepEqual(unsupportedAnalyticsSourceFilters("inventory",{dateFrom:"2026-01-01"}),[],"Inventory is explicitly labelled as a current snapshot");
assert.deepEqual(unsupportedAnalyticsSourceFilters("inventory",{supplierId:1,warehouseId:2,categoryId:3}),[]);
assert.deepEqual(unsupportedAnalyticsSourceFilters("logistics",{risk:"high"}),["risk"],"Risk severity is not an ETA classifier");
const fixture=():AnalyticsResponse=>({generatedAt:"2026-10-26T00:00:00Z",meta:{queryMs:1,filtersApplied:{},dataFreshness:{},partialFailures:[]},filterOptions:{suppliers:[],warehouses:[],categories:[],owners:[],departments:[]},
  kpis:{apExposure:{label:"AP",value:999,details:{secret:77}},openExceptions:{label:"Exceptions",value:4}},
  charts:{apAging:[{label:"secret invoice",value:8}],invoiceStatus:[{label:"secret status",value:1}]},
  tables:{overdueInvoices:{columns:[{key:"invoice",label:"Invoice"}],rows:[{invoice:"secret invoice"}]},oldestOpenExceptions:{columns:[],rows:[{title:"secret exception"}]}},
  recommendations:[{id:"overdue-ap",severity:"high",area:"AP",title:"secret recommendation",reason:"secret",suggestedAction:"Review",href:"/finance"}],dataQualityWarnings:[]});
const denied=restrictAnalyticsOutputs(fixture(),new Set(["finance","exceptions"]));
assert.equal(denied.kpis.apExposure.value,"Unavailable");assert.equal(denied.kpis.apExposure.details,undefined);
assert.equal(denied.kpis.openExceptions.value,"Unavailable");
assert.deepEqual(denied.charts.apAging,[]);assert.deepEqual(denied.tables.overdueInvoices.rows,[]);
assert.deepEqual(denied.tables.oldestOpenExceptions.rows,[]);assert.deepEqual(denied.recommendations,[]);
assert.equal(JSON.stringify(denied).includes("secret"),false);
assert.match(denied.meta.unavailableCharts!.apAging,/read access/);
const failed=markUnavailableAnalyticsSources(fixture(),new Set(["finance"]),"Retry this source.");
assert.equal(failed.kpis.apExposure.value,"Unavailable");assert.equal(failed.meta.unavailableCharts!.invoiceStatus,"Retry this source.");
assert.equal(failed.meta.restrictedSources,undefined,"Service failure is not an access denial");
console.log("Analytics source access checks passed: deny by default, joined-source requirements, no hidden totals/records, explicit unavailable states.");
