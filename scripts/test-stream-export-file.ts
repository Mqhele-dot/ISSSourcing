import assert from "node:assert/strict";
import {mkdtemp,readFile,readdir,rm,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {gunzipSync} from "node:zlib";
import {randomBytes} from "node:crypto";
import {streamExportFile,ExportSizeLimitError} from "../server/modules/exports/stream-export-file";

const root=await mkdtemp(path.join(os.tmpdir(),"iss-export-stream-"));
try{
  const block=Buffer.from("id,name,amount\r\n001,Example,123456789012345.67\r\n".repeat(1024));
  let produced=0;
  const body=new ReadableStream<Uint8Array>({pull(controller){
    if(produced===512){controller.close();return;}produced++;controller.enqueue(block);
  }});
  const destination=path.join(root,"detail.csv.gz");
  const size=await streamExportFile({body,destination,gzip:true});
  const compressed=await readFile(destination),expanded=gunzipSync(compressed);
  assert.equal(size,compressed.length);assert.equal(produced,512);
  assert.equal(expanded.length,block.length*512);
  for(let n=0;n<512;n++)assert.deepEqual(expanded.subarray(n*block.length,(n+1)*block.length),block);
  const native=randomBytes(256*1024),nativePath=path.join(root,"native.xlsx");
  await streamExportFile({body:new ReadableStream({start(c){c.enqueue(native);c.close();}}),destination:nativePath,gzip:false});
  assert.deepEqual(await readFile(nativePath),native);
  let pulls=0;
  const failedPath=path.join(root,"failed.csv.gz");
  await assert.rejects(streamExportFile({body:new ReadableStream({pull(c){if(pulls++===0)c.enqueue(block);else c.error(new Error("Injected source interruption"));}}),destination:failedPath,gzip:true}),/Injected source interruption/);
  const sibling=path.join(root,"unrelated.partial");await writeFile(sibling,"preserve");
  await assert.rejects(streamExportFile({body:new ReadableStream({start(c){c.close();}}),destination:path.join(root,"missing","file"),gzip:false}));
  assert.deepEqual((await readdir(root)).sort(),["detail.csv.gz","native.xlsx","unrelated.partial"]);
  assert.equal(await readFile(sibling,"utf8"),"preserve");
  const small=Buffer.from("complete exact bytes"),sizedPath=path.join(root,"bounded.bin");
  const source=()=>new ReadableStream<Uint8Array>({start(c){c.enqueue(small);c.close();}});
  assert.equal(await streamExportFile({body:source(),destination:sizedPath,gzip:false,maxBytesExclusive:small.length+1}),small.length);
  const gzipSize=await streamExportFile({body:source(),destination:path.join(root,"bounded.gz"),gzip:true});
  const before=(await readdir(root)).sort();
  await assert.rejects(streamExportFile({body:source(),destination:path.join(root,"refused.bin"),gzip:false,maxBytesExclusive:small.length}),ExportSizeLimitError);
  await assert.rejects(streamExportFile({body:source(),destination:path.join(root,"refused.gz"),gzip:true,maxBytesExclusive:1}),ExportSizeLimitError);
  await assert.rejects(streamExportFile({body:source(),destination:path.join(root,"trailer-refused.gz"),gzip:true,maxBytesExclusive:gzipSize}),ExportSizeLimitError);
  for(const invalid of [0,-1,NaN,Infinity,1.5])await assert.rejects(streamExportFile({body:source(),destination:path.join(root,"invalid.bin"),gzip:false,maxBytesExclusive:invalid}),/positive whole/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(streamExportFile({body:source(),destination:path.join(root,"cancelled.bin"),gzip:false,signal:controller.signal}),/abort/i);
  let cancelled=false;
  const during=new AbortController();let read=0;
  await assert.rejects(streamExportFile({body:new ReadableStream<Uint8Array>({pull(c){c.enqueue(block);if(++read===2)during.abort();},cancel(){cancelled=true;}}),destination:path.join(root,"interrupted.bin"),gzip:false,signal:during.signal}),/abort/i);
  assert.equal(cancelled,true,"Cancellation releases the underlying source");
  assert.deepEqual((await readdir(root)).sort(),before,"Oversize, invalid and cancelled attempts cannot publish files or leave partials");
  console.log("Exact byte limits passed: below-limit publication, at-limit refusal, compressed-output enforcement, invalid policy rejection and cancellation cleanup.");
  console.log(`Streaming export passed: ${expanded.length} exact source bytes, gzip parity, native-file preservation, interrupted-source cleanup, write failure and unrelated-file preservation.`);
}finally{
  assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith("iss-export-stream-"));
  await rm(root,{recursive:true,force:true});
}
