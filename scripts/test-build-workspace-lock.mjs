import assert from "node:assert/strict";
import path from "node:path";
import {statSync,existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {acquireE2eWorkspaceLock} from "./e2e-workspace-lock.mjs";

const ownerEnv={},directory=path.resolve('test-results');
const release=acquireE2eWorkspaceLock(directory,ownerEnv);
try{
  const output=path.resolve('dist/public/index.html');const before=existsSync(output)?statSync(output).mtimeMs:null;
  const env={...process.env};delete env.DISPOSABLE_E2E_LOCK_TOKEN;delete env.DISPOSABLE_E2E_LOCK_PID;
  for(const script of ['build-application.mjs','build-client.mjs','build-server.mjs']){
    const result=spawnSync(process.execPath,[`scripts/${script}`],{env,encoding:'utf8',timeout:30000});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Another application build or disposable browser run/);
    assert.equal(existsSync(output)?statSync(output).mtimeMs:null,before,'Refused builds must not alter packaged assets');
  }
  const inherited=acquireE2eWorkspaceLock(directory,{...ownerEnv});inherited();
  console.log('Build lock passed: wrapper/client/server refuse an unrelated owner before writing; verified parent ownership remains reusable.');
}finally{release();}
