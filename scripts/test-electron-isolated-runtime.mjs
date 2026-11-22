import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const root=await mkdtemp(path.join(os.tmpdir(),'iss_electron_smoke_'));
assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
assert.ok(path.basename(root).startsWith('iss_electron_smoke_'));
try {
  const env={...process.env,ISSS_ELECTRON_SMOKE_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[fileURLToPath(new URL('./electron-isolated-smoke.cjs',import.meta.url))],{env,windowsHide:true,stdio:'ignore'});
  const code=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Isolated Electron smoke exceeded 35 seconds.'));},35000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});
  });
  assert.equal(code,0,'Isolated Electron runtime did not pass; normal desktop app startup was never attempted.');
  const evidence=JSON.parse(await readFile(path.join(root,'result.json'),'utf8'));
  assert.equal(evidence.electron,require('electron/package.json').version);
  await mkdir('artifacts/release-runs',{recursive:true});
  await writeFile(`artifacts/release-runs/electron-isolated-${randomUUID()}.json`,JSON.stringify(evidence,null,2));
  console.log(`Electron ${evidence.electron} real-preload isolation passed without loading application services or connecting to a database.`);
}finally{
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('iss_electron_smoke_'));
  await rm(root,{recursive:true,force:true});
}
