import assert from "node:assert/strict";
import {publicStartupStatus} from "../server/diagnostics/public-startup-status";

const internal={dbReady:false,schemaReady:false,sessionStoreReady:true,websocketReady:false,
  stack:"private-stack",sql:"private-query",credentials:"private-password",build:{internalPath:"private-path"}};
const failed=publicStartupStatus("2026-10-27T00:00:00Z",internal,"safe-request-reference");
assert.equal(failed.ok,false);
assert.match(failed.startupFailure!.message,/administrator.*Diagnostics/);
assert.equal(failed.requestId,"safe-request-reference");
for(const secret of ["private-stack","private-query","private-password","private-path"])
  assert.equal(JSON.stringify(failed).includes(secret),false);
assert.deepEqual(Object.keys(failed.readiness).sort(),["dbReady","schemaReady","sessionStoreReady","websocketReady"]);
assert.equal("events" in failed,false);
assert.equal("stack" in failed.startupFailure!,false);
assert.equal(publicStartupStatus(null,internal,null).startupFailure,null);
console.log("Public startup status passed: safe failure guidance, request reference and explicit readiness allowlist; no events, stacks, SQL or credentials.");
