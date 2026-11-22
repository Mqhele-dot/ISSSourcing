import assert from 'node:assert/strict';
import {excludeLegacyMixedCurrencyTotals} from '../shared/analytics-financial-safety';
import type {AnalyticsResponse} from '../shared/analytics-types';
const input={generatedAt:'2026-10-25T00:00:00Z',meta:{queryMs:1,filtersApplied:{supplierId:7},dataFreshness:{},partialFailures:[]},filterOptions:{suppliers:[],warehouses:[],categories:[],owners:[],departments:[]},
  kpis:{procurementSpend:{label:'Spend',value:111},apExposure:{label:'AP',value:222,details:{overdueValue:333}},openPurchaseOrders:{label:'POs',value:4,details:{value:444,oldestOpen:'2026-10-01'}}},
  charts:{spendBySupplier:[{label:'Supplier',value:555}],spendByCategory:[{label:'Category',value:666}],apAging:[{label:'Overdue',value:2,amount:777}],supplierRisk:[{label:'Supplier',value:3,amount:888}],stockValueByCategory:[{label:'Estimate',value:999}]},
  tables:{highRiskSuppliers:{columns:[{key:'supplier'},{key:'exposure'}],rows:[{supplier:'Supplier',exposure:111}]},overdueInvoices:{columns:[{key:'invoice'},{key:'amount'}],rows:[{invoice:'INV',amount:222}]}},recommendations:[{id:'overdue-ap',severity:'high',area:'AP',title:'Overdue',reason:'333 mixed currencies',suggestedAction:'Review',href:'/bad'}],dataQualityWarnings:[]} as AnalyticsResponse;
const output=excludeLegacyMixedCurrencyTotals(input);
assert.equal(output.kpis.procurementSpend.value,'Unavailable');
assert.equal(output.kpis.apExposure.value,'Unavailable');
assert.equal(output.kpis.openPurchaseOrders.details?.value,undefined);
assert.deepEqual(output.charts.spendBySupplier,[]);
assert.deepEqual(output.charts.spendByCategory,[]);
assert.equal('amount' in output.charts.apAging[0],false);
assert.equal('amount' in output.charts.supplierRisk[0],false);
assert.equal('exposure' in output.tables.highRiskSuppliers.rows[0],false);
assert.equal('amount' in output.tables.overdueInvoices.rows[0],false);
assert.equal(output.recommendations[0].href,'/finance/accounts-payable/aging?supplierId=7');
assert.equal(input.kpis.procurementSpend.value,111,'Never mutate original business-query evidence');
assert.deepEqual(output.charts.stockValueByCategory,input.charts.stockValueByCategory,'Unrelated valuation estimates are outside this reporting correction');
assert.equal(output.meta.partialFailures.length,0,'Deliberately unavailable metrics are not infrastructure failures');
console.log('Ten legacy financial-output protections passed; original data, operational counts and unrelated estimates preserved.');
