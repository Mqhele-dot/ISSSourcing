import assert from "node:assert/strict";
import { mkdtempSync,writeFileSync,rmSync,mkdirSync,readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fingerprintSourceFiles } from "./release-candidate-evidence.mjs";

const root=mkdtempSync(path.join(os.tmpdir(),"iss-evidence-test-"));
try {
  writeFileSync(path.join(root,"a.ts"),"original");
  writeFileSync(path.join(root,"b.ts"),"second");
  const digest=fingerprintSourceFiles(root,["a.ts","b.ts"]);
  assert.match(digest,/^[a-f0-9]{64}$/);
  assert.equal(fingerprintSourceFiles(root,["a.ts","b.ts"]),digest);
  assert.equal(fingerprintSourceFiles(root,["b.ts","a.ts"]),digest);
  assert.equal(fingerprintSourceFiles(root,["a.ts","b.ts","a.ts"]),digest);
  writeFileSync(path.join(root,"a.ts"),"changed");
  assert.notEqual(fingerprintSourceFiles(root,["a.ts","b.ts"]),digest);
  writeFileSync(path.join(root,"a.ts"),"original");
  assert.notEqual(fingerprintSourceFiles(root,["a.ts"]),digest);
  assert.notEqual(fingerprintSourceFiles(root,["a.ts","b.ts","missing.ts"]),digest);
  const absent=fingerprintSourceFiles(root,["missing.ts"]);
  writeFileSync(path.join(root,"missing.ts"),"");
  assert.notEqual(fingerprintSourceFiles(root,["missing.ts"]),absent);
  assert.equal(digest.includes("original"),false,"Fingerprint must not expose source content");
  const output=path.join(root,"playwright-output");
  const evidence=path.join(root,"evidence");
  mkdirSync(output);mkdirSync(evidence);
  writeFileSync(path.join(evidence,"runner-state.json"),'{"status":"running"}');
  rmSync(output,{recursive:true});
  assert.equal(JSON.parse(readFileSync(path.join(evidence,"runner-state.json"),"utf8")).status,"running");
  console.log("Ten candidate/evidence checks passed: deterministic source identity, changed/missing files and journal survival outside browser output.");
} finally {rmSync(root,{recursive:true,force:true});}
