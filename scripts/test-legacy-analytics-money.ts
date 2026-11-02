import assert from "node:assert/strict";
import {buildAnalyticsSectionCards} from "../client/src/pages/analytics-workspace/build-analytics-section-cards";

for(const amount of [null,undefined,0,100]) {
  const bundle={inventoryStats:undefined,controlTower:undefined,apOverview:{outstandingAmount:amount},spendAnalytics:{spendBySupplier:[{supplierName:"Legacy supplier",totalSpend:999}]}};
  const money=()=>{throw new Error("Unsupported legacy money must never be formatted");};
  const finance=buildAnalyticsSectionCards("finance",bundle,money).find(row=>row.title==="Outstanding AP")!;
  assert.equal(finance.value,"Unavailable");assert.equal(finance.valueState,"unavailable");assert.equal(finance.href,"/finance/accounts-payable/aging");
  const overview=buildAnalyticsSectionCards("overview",bundle,value=>String(value));
  const exposure=overview.find(row=>row.title==="Finance exposure")!;
  assert.equal(exposure.value,"Unavailable");assert.equal(exposure.valueState,"unavailable");
  const procurement=buildAnalyticsSectionCards("procurement",bundle,money).find(row=>row.title==="Top supplier spend")!;
  assert.equal(procurement.value,"Unavailable");assert.equal(procurement.valueState,"unavailable");
}
console.log("Legacy analytics never formats missing or unsupported monetary evidence as zero or verified exposure.");
