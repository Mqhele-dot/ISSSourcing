import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,mkdirSync} from "node:fs";
import path from "node:path";
import {sanitizeServerObservation,createServerObservationLog} from "./e2e-server-observations.mjs";

const raw=JSON.stringify({timestamp:"2026-10-27T00:00:00.000Z",level:"error",message:"private-password",
  stack:"private-stack",headers:{cookie:"private-cookie"},meta:{requestId:"request-123",method:"GET",
    route:"/api/mdm/fx/rates?token=private-query",status:400,durationMs:12,errorCode:"FX_INVALID_PAGE",sql:"private-sql"}});
const safe=sanitizeServerObservation(raw);
assert.deepEqual(safe,{level:"error",timestamp:"2026-10-27T00:00:00.000Z",event:"Other structured server event",
  requestId:"request-123",method:"GET",route:"/api/mdm/fx/rates",status:400,durationMs:12,errorCode:"FX_INVALID_PAGE"});
for(const value of ["private-password","private-stack","private-cookie","private-query","private-sql"])
  assert.equal(JSON.stringify(safe).includes(value),false);
assert.equal(sanitizeServerObservation("not JSON"),null);
assert.deepEqual(sanitizeServerObservation(JSON.stringify({level:"info",message:"E2E owned server spawned",meta:{runtimeMode:"built",entryPoint:"dist/index.js",pid:123,commandLine:"private-command",credentials:"private-secret"}})),{level:"info",event:"E2E owned server spawned",runtimeMode:"built",entryPoint:"dist/index.js",pid:123});
assert.deepEqual(sanitizeServerObservation(JSON.stringify({level:"info",message:"E2E owned server spawned",meta:{runtimeMode:"untrusted",entryPoint:"private-path",pid:-1}})),{level:"info",event:"E2E owned server spawned"});
for(const value of ["null","true","42","[]",'"text"'])assert.equal(sanitizeServerObservation(value),null);
const analytics=sanitizeServerObservation(JSON.stringify({level:"info",message:"Analytics observation timing",meta:{requestId:"request-123",route:"/api/analytics/procurement?private-query",durationMs:1200,
  sourceTimings:[{source:"logistics",state:"passed",poolWaitMs:1,executionMs:42,transactionMs:3,totalMs:46,rows:5000,sql:"private-sql",params:["private-parameters"]},
    {source:"private-source",state:"passed"},{source:"finance",state:"failed",executionMs:-1,totalMs:Infinity,rows:-1,secret:"private-secret"}]}}));
assert.deepEqual(analytics,{level:"info",event:"Analytics observation timing",requestId:"request-123",route:"/api/analytics/procurement",durationMs:1200,
  sourceTimings:[{source:"logistics",state:"passed",poolWaitMs:1,executionMs:42,transactionMs:3,totalMs:46,rows:5000},{source:"finance",state:"failed"}]});
assert.ok(!JSON.stringify(analytics).includes("private-"));
assert.equal(sanitizeServerObservation(JSON.stringify({level:"info",message:"Analytics observation timing",meta:{sourceTimings:Array.from({length:100},()=>({source:"inventory",state:"passed"}))}})).sourceTimings.length,16);
assert.throws(()=>createServerObservationLog(path.resolve("unrelated","server-observations.jsonl")));
mkdirSync(path.resolve("artifacts","release-runs"),{recursive:true});
const dir=mkdtempSync(path.resolve("artifacts","release-runs","server-observation-test-"));
const file=path.join(dir,"server-observations.jsonl"),log=createServerObservationLog(file);
log.consume(raw.slice(0,40),"stdout");
log.consume(JSON.stringify({level:"warn",message:"private-stderr"})+"\n","stderr");
log.consume(raw.slice(40)+"\n","stdout");log.finish();
const rows=readFileSync(file,"utf8").trim().split("\n").map(line=>JSON.parse(line));
assert.equal(rows.length,2);assert.deepEqual(rows[1],safe);
console.log("Server observation evidence passed: separate streams, explicit metadata allowlist, query/header/stack redaction and artifact-path containment.");
