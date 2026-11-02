import assert from "node:assert/strict";
import {buildGenericSummaryMetrics} from "../server/services/operational-report-summary";

const rows=[{documentTotal:1000,unitPrice:100,lineTotal:500,currencyCode:"USD"},{documentTotal:1000,unitPrice:100,lineTotal:500,currencyCode:"ZAR"}];
const columns=["documentTotal","unitPrice","lineTotal"].map(key=>({key,header:key,width:20}));
const original=JSON.stringify(rows);
for(const source of [rows,[],[{documentTotal:null,unitPrice:NaN,lineTotal:Infinity}]]){
  const result=buildGenericSummaryMetrics(source,columns);
  assert.deepEqual(result.map(row=>row.label),["Records","Columns","Updated"]);
  assert.equal(result[0].value,String(source.length));assert.equal(result[1].value,"3");
  assert.ok(!JSON.stringify(result).match(/Monetary|Sum|ZAR|USD|NaN|Infinity/));
}
assert.equal(JSON.stringify(rows),original,"Removing unsupported summaries must not rewrite detailed source values");
console.log("Operational report summary passed: no mixed-currency/lifecycle-field sum, no fabricated monetary zero, unchanged source details and accurate operational counts.");
