import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile,readFile,lstat,readdir,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import "dotenv/config";

if(!process.argv.includes("--local-disposable"))throw new Error("Use --local-disposable; no database or process was started.");
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD
  ?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);
assert.ok(configured);const ownerUrl=new URL(configured);assert.ok(["localhost","127.0.0.1","[::1]"].includes(ownerUrl.hostname));ownerUrl.pathname="/postgres";
const temporaryParent=path.resolve(os.tmpdir());
const artifactRoot=await mkdtemp(path.resolve("artifacts/release-runs/document-runtime-failures-"));
const sentinel=path.join(artifactRoot,"unrelated-file.txt");await writeFile(sentinel,"Unrelated evidence must survive.",{flag:"wx"});
const owner=new pg.Client({connectionString:ownerUrl.toString(),connectionTimeoutMillis:5000});await owner.connect();
const cases=[];
function validateIdentity(identity){
  assert.equal(identity.version,1);assert.match(identity.runId,/^[a-f0-9-]{36}$/);assert.match(identity.database,/^iss_document_test_[a-f0-9]{32}$/);
  assert.equal(typeof identity.uploadRoot,"string");const root=path.resolve(identity.uploadRoot);
  assert.equal(root,identity.uploadRoot);assert.equal(path.dirname(root),temporaryParent);assert.match(path.basename(root),/^iss-document-source-[a-zA-Z0-9_-]+$/);
  return root;
}
async function absent(database){return (await owner.query("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[database])).rows[0].n===0;}
async function rescueExact(identity){
  const root=validateIdentity(identity);assert.equal((await lstat(root)).isSymbolicLink(),false);
  const marker=JSON.parse(await readFile(path.join(root,".runtime-owner.json"),"utf8"));assert.deepEqual(marker,{version:1,runId:identity.runId,database:identity.database,uploadRoot:root});
  const target=new URL(ownerUrl);target.pathname=`/${identity.database}`;
  const proof=new pg.Client({connectionString:target.toString(),connectionTimeoutMillis:5000});await proof.connect();
  try{assert.equal((await proof.query("SELECT current_database() AS name")).rows[0].name,identity.database);assert.deepEqual((await proof.query("SELECT run_id FROM _document_runtime_owner")).rows,[{run_id:identity.runId}]);}finally{await proof.end();}
  const walk=async(dir)=>{assert.equal((await lstat(dir)).isSymbolicLink(),false);for(const entry of await readdir(dir,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())await walk(path.join(dir,entry.name));}};
  await walk(root);
  await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",[identity.database]);
  await owner.query(`DROP DATABASE "${identity.database}"`);
  await rm(root,{recursive:true,force:false});
}
async function run(mode){
  const child=spawn(process.execPath,["--import","tsx","scripts/test-document-source-runtime.ts","--local-disposable",`--inject-failure=${mode}`],{cwd:process.cwd(),shell:false,windowsHide:true,env:{...process.env,DISABLE_NOTIFICATION_EMAIL:"true",DISABLE_NOTIFICATION_SMS:"true"},stdio:["ignore","pipe","pipe"]});
  const lines=[];let stdout="",stderr="",spawnError,outputExceeded=false;
  child.stdout.on("data",chunk=>{if(outputExceeded)return;stdout+=chunk.toString();if(stdout.length>8*1024*1024){outputExceeded=true;child.kill("SIGKILL");}});
  child.stderr.on("data",chunk=>{if(outputExceeded)return;stderr+=chunk.toString();if(stderr.length>8*1024*1024){outputExceeded=true;child.kill("SIGKILL");}});
  child.on("error",error=>{spawnError=error;});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL");},180000);
  const result=await new Promise(resolve=>child.once("close",(code,signal)=>resolve({code,signal})));clearTimeout(timer);
  for(const line of (stdout+"\n"+stderr).split(/\r?\n/)){try{const value=JSON.parse(line);if(value?.kind?.startsWith("document-runtime-"))lines.push(value);}catch{}}
  await writeFile(path.join(artifactRoot,`${mode}.log`),stdout+"\n"+stderr,{flag:"wx"});
  const identities=lines.filter(line=>line.kind==="document-runtime-identity");assert.equal(identities.length,1,"A failed child must publish exactly one early identity.");
  const identity=identities[0];validateIdentity(identity);
  let rescued=false;
  try{
    assert.equal(spawnError,undefined);assert.equal(outputExceeded,false,"Output overflow is a failed run, not the intended injected fault.");assert.equal(timedOut,false,"A deadline is failure evidence, not a successful injected case.");assert.notEqual(result.code,0,"Injected failure must not report a green child command.");
    const first=lines.find(line=>line.kind==="document-runtime-first-response");assert.ok(first);assert.match(first.requestId,/^[a-f0-9-]{36}$/);
    if(mode==="hard-stop"){
      assert.equal(first.status,200);assert.equal(lines.some(line=>line.kind==="document-runtime-cleanup"),false,"A hard stop must not claim child cleanup ran.");
      const markerPath=path.join(identity.uploadRoot,".runtime-owner.json"),original=await readFile(markerPath);
      await writeFile(markerPath,JSON.stringify({version:1,runId:"wrong-proof",database:identity.database,uploadRoot:identity.uploadRoot}));
      try{await assert.rejects(()=>rescueExact(identity));assert.equal(await absent(identity.database),false,"Mismatched proof cannot authorize deletion.");}finally{await writeFile(markerPath,original);}
      await rescueExact(identity);rescued=true;
    }else{
      const cleanup=lines.find(line=>line.kind==="document-runtime-cleanup");assert.ok(cleanup);assert.equal(cleanup.runId,identity.runId);
      assert.equal(cleanup.serverClosed,true);assert.equal(cleanup.poolClosed,true);assert.equal(cleanup.databaseRemoved,true);assert.equal(cleanup.uploadsRemoved,true);
      if(mode==="cleanup-pool"){assert.equal(first.status,200);assert.equal(cleanup.suitePassed,true);assert.equal(cleanup.status,"failed");assert.ok(lines.some(line=>line.kind==="document-runtime-cleanup-stage-failed"&&line.stage==="pool"));}
      else{assert.equal(first.status,503);assert.equal(cleanup.suitePassed,false);assert.equal(cleanup.boundaryFailures,1);const boundary=lines.find(line=>line.kind==="document-runtime-boundary");assert.equal(boundary?.requestId,first.requestId);assert.equal(cleanup.status,"passed");}
    }
    assert.equal(await absent(identity.database),true);await assert.rejects(()=>lstat(identity.uploadRoot),{code:"ENOENT"});
    assert.equal(await readFile(sentinel,"utf8"),"Unrelated evidence must survive.");
    cases.push({mode,childExit:result.code,signal:result.signal,identity:{runId:identity.runId,database:identity.database,uploadRoot:identity.uploadRoot},parentRescue:rescued,status:"passed"});
    await writeFile(path.join(artifactRoot,"progress.json"),JSON.stringify({status:"running",cases},null,2));
    console.log(JSON.stringify({kind:"document-runtime-case-completed",mode,database:identity.database,parentRescue:rescued}));
  }finally{
    // A timeout/unexpected failure is never a pass. Rescue only the exact child
    // with BOTH filesystem and database ownership proof; otherwise leave its
    // identity in retained evidence for review instead of guessing targets.
    if(!await absent(identity.database))await rescueExact(identity);
  }
}
try{
  for(const mode of ["membership-connect","membership-query","permission-query","cleanup-pool","hard-stop"])await run(mode);
  await writeFile(path.join(artifactRoot,"result.json"),JSON.stringify({status:"passed",cases,limits:"Controlled dependency/query/cleanup faults and one test-owned hard stop; not a PostgreSQL outage or guarantee against machine/process loss.",sentinelPreserved:true},null,2),{flag:"wx"});
  console.log(JSON.stringify({status:"passed",cases,artifacts:artifactRoot,sentinelPreserved:true}));
}catch(error){
  await writeFile(path.join(artifactRoot,"result.json"),JSON.stringify({status:"failed",cases,error:{name:error.name,code:error.code??null},note:"Inspect retained case logs. Missing cases are not passed."},null,2),{flag:"wx"});
  throw error;
}finally{await owner.end();}
