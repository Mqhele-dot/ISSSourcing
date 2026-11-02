import assert from "node:assert/strict";
import type {PoolClient} from "pg";
import {streamFrozenFinancialCsv,buildFrozenFinancialCsv} from "../server/modules/reports/frozen-financial-export";

function evidenceClient(total:number,options:{missing?:boolean;wrongCount?:boolean}={}){
  const calls:{after:unknown}[]=[];
  const saved={summary:{definition:{taxBasis:"net",dateBasis:"posted"},amount:"1.00",currencyCode:"ZAR",state:"partial"},normalized_filters:{},evidence_hash:"test"};
  const query=async(sql:string,args:unknown[])=>{
    assert.equal(args[0],17,"Every query is tenant scoped");assert.equal(args[1],"saved-run");
    if(sql.includes("FROM financial_reporting_runs"))return {rowCount:options.missing?0:1,rows:[saved]};
    if(sql.includes("count(*)"))return {rows:[{count:String(total+(options.wrongCount?1:0))}]};
    assert.ok(sql.includes("LIMIT 1000"));calls.push({after:args[2]});
    const start=Number(args[2])+1;
    return {rows:Array.from({length:Math.max(0,Math.min(1000,total-start))},(_,n)=>({ordinal:start+n,evidence:{sourceId:`00${start+n}`,amount:"123456789012345.67",currencyCode:"USD",exclusion:'=UNTRUSTED,"note"\ntext'}}))};
  };
  return {client:{query} as unknown as PoolClient,calls};
}
const early=evidenceClient(5000),stream=await streamFrozenFinancialCsv(early.client,17,"saved-run","ordered");
assert.equal(early.calls.length,0,"Creating a stream must not read every page");
await stream!.chunks.next();assert.equal(early.calls.length,0,"Header does not load detail");
const row=await stream!.chunks.next();assert.equal(early.calls.length,1);
assert.ok(row.value!.includes('"123456789012345.67"'));assert.ok(row.value!.includes("'=UNTRUSTED"));
await stream!.chunks.return();assert.equal(early.calls.length,1,"Cancellation stops further page queries");
const complete=evidenceClient(2501),result=await streamFrozenFinancialCsv(complete.client,17,"saved-run","ordered");
const parts:string[]=[];for await(const part of result!.chunks)parts.push(part);
assert.equal(parts.length,2502);assert.equal(complete.calls.length,3);
const compatibility=evidenceClient(2501),buffered=await buildFrozenFinancialCsv(compatibility.client,17,"saved-run","ordered");
assert.equal(buffered!.buffer.toString(),parts.join(""));
const empty=evidenceClient(0),zero=await streamFrozenFinancialCsv(empty.client,17,"saved-run","ordered");
let count=0;for await(const _chunk of zero!.chunks)count++;assert.equal(count,2);assert.equal(zero!.rowCount,0);
const missing=evidenceClient(0,{missing:true});assert.equal(await streamFrozenFinancialCsv(missing.client,17,"saved-run","ordered"),null);
const mismatch=evidenceClient(1,{wrongCount:true}),bad=await streamFrozenFinancialCsv(mismatch.client,17,"saved-run","ordered");
await assert.rejects(async()=>{for await(const _chunk of bad!.chunks){/* consume */}},/changed/);
console.log("Frozen export stream passed: lazy bounded reads, early cancellation, exact decimals, formula-safe text, parity, empty/missing evidence and incomplete-source refusal.");
