import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createExportRetentionTask} from '../server/modules/exports/export-retention-task';

const root=await mkdtemp(path.join(os.tmpdir(),'iss-retention-recovery-'));
process.env.TEST_UPLOADS_DIR=root;
const {removeExportFile}=await import('../server/modules/exports/export-file-store');
const nativeUnlink=fs.unlinkSync;
try{
  const first=path.join(root,'first.xlsx'),blocked=path.join(root,'blocked.xlsx'),other=path.join(root,'other.xlsx'),keep=path.join(root,'unrelated.txt');
  for(const file of [first,blocked,other,keep])await writeFile(file,'synthetic only');
  let deny=true,discovery=0,clearFailure=true;
  const cleared:number[]=[],failures:number[]=[];
  fs.unlinkSync=((file:fs.PathLike)=>{
    if(String(file)===blocked&&deny)throw Object.assign(new Error('Synthetic inaccessible file'),{code:'EACCES'});
    return nativeUnlink(file);
  }) as typeof fs.unlinkSync;
  const run=createExportRetentionTask({
    list:async()=>{if(discovery++===0)throw new Error('Synthetic discovery outage');return [{id:1,organizationId:1,primaryFilePath:first,filePaths:[first,blocked]},{id:2,organizationId:2,primaryFilePath:other,filePaths:[other]}].filter(job=>!cleared.includes(job.id));},
    expire:async job=>{for(const file of job.filePaths)removeExportFile(file);if(job.id===2&&clearFailure){clearFailure=false;throw new Error('Synthetic metadata failure');}cleared.push(job.id);},
    onFailure:id=>{failures.push(id);},
  });
  await assert.rejects(run(),/discovery outage/);
  await run();assert.deepEqual(cleared,[]);assert.deepEqual(failures,[1,2]);assert.equal(fs.existsSync(first),false);assert.equal(fs.existsSync(blocked),true);assert.equal(fs.existsSync(other),false);
  // Permission errors cannot be mistaken for absence, including a retry after
  // the preceding file was already removed. A different job still progresses.
  await assert.rejects(async()=>removeExportFile(blocked),/inaccessible/);
  await run();assert.deepEqual(cleared,[2]);deny=false;await run();assert.deepEqual(cleared,[2,1]);
  assert.equal(fs.existsSync(blocked),false);await run();assert.deepEqual(cleared,[2,1]);
  removeExportFile(blocked);removeExportFile(null);removeExportFile(undefined);
  assert.equal(await readFile(keep,'utf8'),'synthetic only');
  let release:()=>void=()=>undefined,listed=0;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const concurrent=createExportRetentionTask({list:async()=>{listed++;await held;return [];},expire:async()=>{},onFailure:()=>{}});
  const active=concurrent();await concurrent();assert.equal(listed,1);release();await active;await concurrent();assert.equal(listed,2);
  console.log(JSON.stringify({status:'passed',checks:['discovery failure releases guard','concurrent cycles do not overlap','later cycles resume','permission failures preserve metadata/quota','partial deletion retries','metadata failure retries after unlink','other jobs continue','missing file idempotency','unrelated file retained'],limitation:'Synthetic adapters and test-owned files only; full database retention/publication/browser integration remains a separate gate.'}));
}finally{fs.unlinkSync=nativeUnlink;await rm(root,{recursive:true,force:true});console.log('Removed exact test-owned retention fixture directory.');}
