import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,rm,readdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {streamExportFile} from '../server/modules/exports/stream-export-file';
import {writeCompactFullDetail} from '../server/modules/exports/compact-full-detail-writer';

// Fault injection is confined to this test process and descriptors opened
// inside its newly owned directory. No actual drive is filled, quota changed,
// application server patched, or production worker injection option introduced.
const root=await mkdtemp(path.join(os.tmpdir(),'iss-enospc-'));
const originals={open:fs.open,close:fs.close,write:fs.write,writev:fs.writev};
const owned=new Set<number>();let threshold=0,written=0,injected=0;
function callback(args:unknown[]){const fn=args[args.length-1];assert.equal(typeof fn,'function');return fn as (...values:unknown[])=>void;}
function fail(args:unknown[]){injected++;queueMicrotask(()=>callback(args)(Object.assign(new Error('Injected test storage exhausted'),{code:'ENOSPC',syscall:'write'})));}
try{
  await writeFile(path.join(root,'unrelated.txt'),'preserve');
  Reflect.set(fs,'open',(...args:unknown[])=>{
    const fn=callback(args),candidate=typeof args[0]==='string'?path.resolve(args[0]):'';
    const relative=path.relative(root,candidate),isOwned=!!relative&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);
    args[args.length-1]=(error:unknown,fd:number)=>{if(!error&&isOwned)owned.add(fd);fn(error,fd);};
    return Reflect.apply(originals.open,fs,args);
  });
  Reflect.set(fs,'close',(...args:unknown[])=>{const fn=callback(args),fd=Number(args[0]);args[args.length-1]=(error:unknown)=>{if(!error)owned.delete(fd);fn(error);};return Reflect.apply(originals.close,fs,args);});
  for(const method of ['write','writev'] as const)Reflect.set(fs,method,(...args:unknown[])=>{
    if(owned.has(Number(args[0]))){
      if(written>=threshold){fail(args);return;}
      const fn=callback(args);args[args.length-1]=(error:unknown,bytes:number,...rest:unknown[])=>{if(!error)written+=bytes;fn(error,bytes,...rest);};
    }
    return Reflect.apply(originals[method],fs,args);
  });
  for(const budget of [0,4096]){
    threshold=budget;written=0;const before=injected;
    const body=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<20;i++)controller.enqueue(new Uint8Array(4096));controller.close();}});
    await assert.rejects(streamExportFile({body,destination:path.join(root,'stream.bin'),gzip:false}),error=>(error as NodeJS.ErrnoException).code==='ENOSPC');
    assert.ok(injected>before);assert.deepEqual(await readdir(root),['unrelated.txt']);
    threshold=budget;written=0;const beforeWorkbook=injected;
    await assert.rejects(writeCompactFullDetail({outputDirectory:root,jobId:91,dataset:'Synthetic disk-failure proof',schemaVersion:'v1',observationReference:'test-only',normalizedFilters:{},columns:[{key:'value',label:'Value',kind:'text'}],expectedRows:5000,rows:(async function*(){for(let i=0;i<5000;i++)yield {value:`Row ${i} unique payload ${String(i*i).padStart(20,'0')}`};})()}));
    assert.ok(injected>beforeWorkbook,'The test must reach the filesystem sink, not only fail source setup');
    assert.deepEqual(await readdir(root),['unrelated.txt'],'No partial/final workbook or attempt directory may survive sink failure');
  }
  assert.equal(await readFile(path.join(root,'unrelated.txt'),'utf8'),'preserve');assert.equal(owned.size,0,'Faulted output descriptors must close');
  console.log(JSON.stringify({status:'passed',mode:'test-process filesystem-sink ENOSPC injection',cases:4,checks:['failure on first disk write','failure after partial disk output','native sink error propagates','stream partial unlinked','workbook attempt removed','no final download candidate','descriptors closed','unrelated file retained'],limits:'Does not fill a real volume or replace native Excel, OS quota, worker-RSS or API-responsiveness benchmarks.'}));
}finally{
  for(const method of ['open','close','write','writev'] as const)Reflect.set(fs,method,originals[method]);
  await rm(root,{recursive:true,force:true});console.log('Removed exact test-owned disk-failure root.');
}
