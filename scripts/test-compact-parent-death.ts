import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {captureCompactSpool} from '../server/modules/exports/compact-capture-spool';

const root=await mkdtemp(path.join(os.tmpdir(),'iss-worker-parent-death-'));
const scope={organizationId:7,actorId:9,dataset:'synthetic-parent-crash',schemaVersion:'v1',observationReference:'parent-crash-observation',columns:['id','note'],normalizedFilters:{}};
const children:number[]=[];let safeToClean=false;
async function alive(pid:number){
  try{
    process.kill(pid,0);
    if(process.platform!=='win32')try{if(/\) Z /.test(await readFile(`/proc/${pid}/stat`,'utf8')))return false;}catch{/* no procfs: process probe remains authoritative */}
    return true;
  }catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ESRCH')return false;throw error;}
}
async function files(directory:string):Promise<string[]>{const entries=await readdir(directory,{withFileTypes:true});return(await Promise.all(entries.map(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):Promise.resolve([path.join(directory,entry.name)])))).flat();}
try{
  const capture=await captureCompactSpool({...scope,root,rows:(async function*(){for(let i=0;i<25000;i++)yield {id:String(i).padStart(10,'0'),note:`${i}:`+'safe synthetic text '.repeat(100)};})()});
  const results:Array<{stage:string;stoppedMs:number}>=[];
  for(const stage of ['started','writing','validating']){
    const outputRoot=path.join(root,stage);await mkdir(outputRoot);
    const request={captureDirectory:capture.directory,outputRoot,jobId:61,scope,columns:[{key:'id',label:'ID',kind:'identifier' as const},{key:'note',label:'Note',kind:'text' as const}]};
    const env:NodeJS.ProcessEnv={NODE_ENV:'test'};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR'])if(process.env[key])env[key]=process.env[key];
    const parent=fork(fileURLToPath(new URL('./compact-parent-crash-harness.ts',import.meta.url)),[],{execArgv:['--import','tsx'],env,stdio:['ignore','ignore','ignore','ipc']});
    let workerPid:number|undefined,completed=false;
    const close=new Promise<void>(resolve=>parent.once('close',()=>resolve()));
    try{
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error(`Test parent never reached ${stage}`)),30000);
        parent.on('message',(event:unknown)=>{
          if(!event||typeof event!=='object')return;const message=event as {type:string;pid?:number;stage?:string};
          if(message.type==='worker'){
            workerPid=message.pid;
            if(workerPid===undefined||!Number.isSafeInteger(workerPid)||workerPid<1){clearTimeout(timer);reject(new Error('Test parent did not identify its actual child process'));return;}
            children.push(workerPid);if(stage==='started'){clearTimeout(timer);resolve();}
          }
          if(message.type==='phase'&&message.stage===stage){clearTimeout(timer);resolve();}
          if(message.type==='completed'){completed=true;clearTimeout(timer);reject(new Error('Worker completed before the parent-death test could interrupt it'));}
          if(message.type==='failed'){clearTimeout(timer);reject(new Error('Test parent failed before interruption'));}
        });
        parent.once('error',error=>{clearTimeout(timer);reject(error);});
        parent.send({request,modulePath:process.env.COMPACT_BUILT_MODULE});
      });
      assert.ok(workerPid);assert.equal(completed,false);const started=Date.now();
      parent.kill();await close;
      while(await alive(workerPid)&&Date.now()-started<5000)await pause(50);
      assert.equal(await alive(workerPid),false,`A ${stage} worker must stop when its owning parent dies`);
      if(stage==='writing')assert.equal((await files(outputRoot)).some(file=>file.endsWith('.xlsx')),false,'Parent death during writing must not leave a finalized workbook');
      results.push({stage,stoppedMs:Date.now()-started});
    }finally{if(parent.exitCode===null&&parent.signalCode===null){parent.kill();await close;}}
  }
  safeToClean=true;
  console.log(JSON.stringify({status:'passed',mode:process.env.COMPACT_BUILT_MODULE?'built-runtime':'source',sourceRows:25000,results,checks:['real hard parent termination','startup IPC loss','writing IPC loss','validation IPC loss','no finalized writing artifact','no live orphan child'],limitations:'Only test-owned attempt files are cleaned here. Durable production workspace/capture metadata and restart cleanup remain a separate controller prerequisite.'}));
}finally{
  if(!safeToClean)safeToClean=(await Promise.all(children.map(alive))).every(live=>!live);
  if(safeToClean){await rm(root,{recursive:true,force:true});console.log('Removed exact test-owned parent-death directory.');}
  else console.log(JSON.stringify({retainedTestRoot:root,reason:'A test child may still be alive; cleanup refused rather than racing an unknown live writer.'}));
}
