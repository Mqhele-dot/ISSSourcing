import assert from "node:assert/strict";
import {mkdtemp,readdir,rm,writeFile,readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {captureCompactSpool} from "../server/modules/exports/compact-capture-spool";
import {runCompactIsolatedWorker} from "../server/modules/exports/compact-isolated-worker";
const run=process.env.COMPACT_BUILT_MODULE? (await import(pathToFileURL(process.env.COMPACT_BUILT_MODULE).href)).runCompactIsolatedWorker as typeof runCompactIsolatedWorker:runCompactIsolatedWorker;
const root=await mkdtemp(path.join(os.tmpdir(),"iss-isolated-export-test-"));
const scope={organizationId:7,actorId:9,observationReference:"isolated-test-observation",dataset:"synthetic",schemaVersion:"v1",columns:["id","amount"],normalizedFilters:{}};
try{
  await writeFile(path.join(root,"unrelated.txt"),"preserve");
  const capture=await captureCompactSpool({...scope,root,rows:(async function*(){for(let i=0;i<5000;i++)yield {id:String(i).padStart(10,"0"),amount:"123456789012345.000001"};})()});
  const request={captureDirectory:capture.directory,outputRoot:root,jobId:61,scope,columns:[{key:"id",label:"ID",kind:"identifier" as const},{key:"amount",label:"Amount",kind:"decimal" as const}]};
  process.env.EMAIL_PASS="synthetic-do-not-inherit";process.env.OPENAI_API_KEY="synthetic-do-not-inherit";
  let validatedStage=false;const active=run(request,{onStage:()=>{validatedStage=true;}});
  await assert.rejects(run(request),/already running/);
  const result=await active;
  assert.notEqual(result.workerProcessId,process.pid);assert.equal(result.credentialEnvironmentPresent,false);assert.ok(result.heapLimitBytes<=384*1024*1024);assert.equal(result.processedRows,5000);
  assert.equal(result.validationState,"independently_validated");assert.equal(validatedStage,true);assert.equal(result.validation.verifiedRows,5000);assert.equal(result.validation.sha256,result.sha256);
  const baseline=(await readdir(root)).sort();
  await assert.rejects(run({...request,temporaryQuotaBytes:1024},{deadlineMs:20000}),/temporary-storage budget/);
  await assert.rejects(run({...request,temporaryQuotaBytes:capture.manifest.bytes+1500},{deadlineMs:20000}),/temporary-storage budget/);
  await assert.rejects(run(request,{deadlineMs:1}),/deadline/);
  const controller=new AbortController();const cancelled=run(request,{signal:controller.signal});controller.abort();await assert.rejects(cancelled,/cancelled/);
  await assert.rejects(run(request,{onStarted:pid=>process.kill(pid)}),/interrupted/);
  const validationAbort=new AbortController();await assert.rejects(run(request,{signal:validationAbort.signal,onStage:()=>validationAbort.abort()}),/cancelled/);
  await assert.rejects(run({...request,scope:{...scope,actorId:99}}),/could not be converted safely/);
  assert.deepEqual((await readdir(root)).sort(),baseline);
  // Crash/cancellation must release the in-process slot and retain the capture.
  const retry=await run(request);assert.equal(retry.processedRows,5000);assert.equal(await readFile(path.join(root,"unrelated.txt"),"utf8"),"preserve");
  console.log(JSON.stringify({status:"passed",mode:process.env.COMPACT_BUILT_MODULE?"built-runtime":"source",sourceRows:result.processedRows,heapLimitBytes:result.heapLimitBytes,workerProcessId:result.workerProcessId,checks:["separate process","credential environment isolation","one active worker","deadline","cancellation during writing and validation","independent ZIP/XML capture parity","termination","scope mismatch","cleanup","capture reuse after failure"],limitations:"Public orchestration, validated publication, UI and native Excel benchmarks remain pending."}));
}finally{await rm(root,{recursive:true,force:true});console.log("Removed exact test-owned isolated-worker directory.");}
