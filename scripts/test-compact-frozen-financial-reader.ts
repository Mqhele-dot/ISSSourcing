import assert from "node:assert/strict";
import type {PoolClient} from "pg";
import {createFrozenFinancialCompactReader,frozenFinancialCompactColumns} from "../server/modules/exports/compact-frozen-financial-reader";
const runId="00000000-0000-4000-8000-000000000001";
function fixture(total:number,options:{missing?:boolean;wrongCount?:boolean;legacy?:boolean}={}){
  const calls:string[]=[];let authorized=0;
  const authorize=async()=>{authorized++;};
  const query=async(sql:string,args:unknown[])=>{
    calls.push(sql);assert.equal(args[0],17);assert.equal(args[1],runId);
    if(sql.includes('FROM financial_reporting_runs'))return {rowCount:options.missing?0:1,rows:[{summary:{amount:"1.000001",state:"partial",currencyCode:"ZAR",generatedAt:"2026-01-01T00:00:00Z",calculationVersion:"v1",...(options.legacy?{}:{definition:{taxBasis:"net",dateBasis:"posted"}})},normalized_filters:{supplierId:19},evidence_hash:'saved-hash'}]};
    if(sql.includes('count(*)'))return {rows:[{count:String(total+(options.wrongCount?1:0))}]};
    assert.ok(sql.includes('FROM financial_reporting_contributions'));assert.ok(sql.includes('LIMIT 1000'));assert.ok(sql.includes('ORDER BY ordinal'));assert.equal(args.length,3);
    const start=Number(args[2])+1;
    return {rows:Array.from({length:Math.max(0,Math.min(1000,total-start))},(_,i)=>({ordinal:start+i,evidence:{sourceId:String(start+i).padStart(10,"0"),sourceType:"invoice",sourceRevision:"rev-1",amount:options.legacy?1.23:"123456789012345.670000",currencyCode:"USD",exclusion:"=literal source text",reportingAmount:null}}))};
  };
  return {client:{query} as unknown as PoolClient,authorize,calls,get authorized(){return authorized;}};
}
const input={organizationId:17,filters:{runId,measure:"ordered"}};
const all=fixture(5000),reader=await createFrozenFinancialCompactReader(all.client,{...input,authorize:all.authorize});
assert.equal(all.calls.length,2);assert.equal(reader.columns.length,frozenFinancialCompactColumns.length);assert.equal(reader.expectedRows,5000);assert.equal(reader.information.evidenceHash,'saved-hash');
let count=0;for await(const row of reader.rows){assert.equal(row.sourceId,String(count++).padStart(10,"0"));assert.equal(row.originalAmount,"123456789012345.670000");assert.equal(row.reportingAmount,null);assert.equal(row.taxBasis,"net");assert.equal(row.exclusion,"=literal source text");assert.equal(row.precisionEvidence,"stored_text_evidence");}
assert.equal(count,5000);assert.equal(all.calls.length,8);assert.equal(all.authorized,2);
const selected=fixture(2501),choice=await createFrozenFinancialCompactReader(selected.client,{...input,columns:["sourceId","originalAmount"],authorize:selected.authorize});
const first=await choice.rows.next();assert.deepEqual(Object.keys(first.value!),["sourceId","originalAmount"]);assert.equal(selected.calls.length,3);await choice.rows.return();assert.equal(selected.calls.length,3);
for(const columns of [[],["sourceId","sourceId"],["unknown"],["__proto__"]])await assert.rejects(createFrozenFinancialCompactReader(fixture(1).client,{...input,columns,authorize:async()=>{}}),/registered/);
await assert.rejects(createFrozenFinancialCompactReader(fixture(1).client,{...input,filters:{...input.filters,from:"2020-01-01"},authorize:async()=>{}}),/Only saved/);
const denied=fixture(1);await assert.rejects(createFrozenFinancialCompactReader(denied.client,{...input,authorize:async()=>{throw new Error("Access denied");}}),/Access denied/);assert.equal(denied.calls.length,0);
const revoked=fixture(1);let checks=0;const revokedReader=await createFrozenFinancialCompactReader(revoked.client,{...input,authorize:async()=>{if(++checks===2)throw new Error("Access revoked");}});await assert.rejects(async()=>{for await(const row of revokedReader.rows)void row;},/Access revoked/);
const wrong=fixture(1,{wrongCount:true}),incomplete=await createFrozenFinancialCompactReader(wrong.client,{...input,authorize:wrong.authorize});await assert.rejects(async()=>{for await(const row of incomplete.rows)void row;},/incomplete/);
const missing=fixture(0,{missing:true});await assert.rejects(createFrozenFinancialCompactReader(missing.client,{...input,authorize:missing.authorize}),/not available/);
const empty=fixture(0),zero=await createFrozenFinancialCompactReader(empty.client,{...input,authorize:empty.authorize});let emptyRows=0;for await(const row of zero.rows){void row;emptyRows++;}assert.equal(emptyRows,0);assert.equal(JSON.parse(zero.information.summary!).amount,"1.000001");
const legacy=fixture(1,{legacy:true}),old=await createFrozenFinancialCompactReader(legacy.client,{...input,authorize:legacy.authorize});const oldRow=(await old.rows.next()).value!;assert.equal(oldRow.originalAmount,"1.23");assert.equal(oldRow.precisionEvidence,"legacy_numeric_source");assert.equal(oldRow.taxBasis,null);assert.equal(oldRow.definitionProvenance,"legacy_unverified");await old.rows.return();
console.log(JSON.stringify({status:"passed",rowsVerified:count,maximumQueryBatch:1000,checks:["default and selected columns","exact stored strings","immutable-source-only queries","no FX or balance recalculation","lazy keyset reads","early cancellation","access before queries","revocation at completion","unsupported filters rejected","incomplete capture refusal","empty-source metadata","legacy precision warning without invented definitions"],limitations:"Adapter contract only; production authorization wiring, source-information persistence and UI rollout remain gated."}));
