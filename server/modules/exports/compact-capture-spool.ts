import {createReadStream} from "node:fs";
import {mkdtemp,writeFile,readFile,rm,stat,rename} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {Readable} from "node:stream";
import {StringDecoder} from "node:string_decoder";
import {isDeepStrictEqual} from 'node:util';
import {streamExportFile,ExportSizeLimitError} from "./stream-export-file";

type Row=Record<string,string|number|boolean|null>;
type Scope={organizationId:number;actorId:number;observationReference:string;dataset:string;schemaVersion:string;columns:string[];normalizedFilters:Record<string,unknown>;sourceInformation?:Record<string,string|null>};
type Manifest=Scope&{version:1;rowCount:number;bytes:number;sha256:string};
const quotaCeiling=2*1024*1024*1024;
export class CompactCaptureQuotaError extends Error {
  readonly code='COMPACT_CAPTURE_QUOTA';
  constructor(readonly quotaBytes:number){super('The private source capture exceeds its temporary-storage quota. Choose fewer columns or a shorter date range; no workbook was published.');}
}
function validScope(scope:Scope){
  if(!Number.isSafeInteger(scope.organizationId)||scope.organizationId<1||!Number.isSafeInteger(scope.actorId)||scope.actorId<1||!scope.observationReference||scope.observationReference.length>200||!scope.dataset||scope.dataset.length>200||!scope.schemaVersion||scope.schemaVersion.length>100||!scope.columns.length||scope.columns.length>16384||new Set(scope.columns).size!==scope.columns.length||scope.columns.some(key=>!key||key.length>100))throw new Error("Invalid capture ownership or column scope.");
  if(scope.sourceInformation&&(Object.keys(scope.sourceInformation).length>100||Object.entries(scope.sourceInformation).some(([key,value])=>!key||key.length>100||value!==null&&typeof value!=="string")))throw new Error("Invalid source-information evidence.");
}

/** Capture only; adapters must hold their consistent read-only observation until
 * this finishes, then release it BEFORE invoking workbook compression. This
 * primitive never queries business data or grants access to a capture.
 */
export async function captureCompactSpool(input:Scope&{root:string;rows:AsyncIterable<Row>;signal?:AbortSignal;quotaBytes?:number}){
  validScope(input);
  const quota=input.quotaBytes??quotaCeiling;
  if(!Number.isSafeInteger(quota)||quota<1||quota>quotaCeiling)throw new Error("Capture quota must not exceed 2 GiB.");
  input.signal?.throwIfAborted();
  const directory=await mkdtemp(path.join(input.root,"compact-capture-"));
  const dataPath=path.join(directory,"rows.jsonl");
  let rowCount=0;const hash=createHash("sha256");
  const scope:Scope={organizationId:input.organizationId,actorId:input.actorId,observationReference:input.observationReference,dataset:input.dataset,schemaVersion:input.schemaVersion,columns:[...input.columns],normalizedFilters:input.normalizedFilters,...(input.sourceInformation?{sourceInformation:{...input.sourceInformation}}:{})};
  async function* lines(){
    for await(const row of input.rows){
      input.signal?.throwIfAborted();
      const selected:Row=Object.create(null);
      for(const key of scope.columns){
        if(!row||!Object.hasOwn(row,key))throw new Error("A selected field is missing from source capture.");
        const value=row[key];
        if(value!==null&&!["string","number","boolean"].includes(typeof value)||typeof value==="number"&&(!Number.isFinite(value)||Object.is(value,-0)))throw new Error("Capture requires losslessly serializable scalar values.");
        selected[key]=value;
      }
      const line=Buffer.from(JSON.stringify(selected)+"\n");
      if(line.length>8*1024*1024)throw new Error("A source record exceeds the safe capture-row budget; choose fewer columns.");
      if(++rowCount>Number.MAX_SAFE_INTEGER)throw new Error("Capture row count exceeds the supported range.");
      hash.update(line);yield line;
    }
  }
  try{
    const bytes=await streamExportFile({body:Readable.toWeb(Readable.from(lines())) as ReadableStream<Uint8Array>,destination:dataPath,gzip:false,maxBytesExclusive:quota+1,signal:input.signal});
    const manifest:Manifest={...scope,version:1,rowCount,bytes,sha256:hash.digest("hex")};
    const serialized=JSON.stringify(manifest);
    if(Buffer.byteLength(serialized)>64*1024)throw new Error('The private capture metadata exceeds its supported size. Choose fewer columns; no workbook was published.');
    if(bytes+Buffer.byteLength(serialized)>quota)throw new CompactCaptureQuotaError(quota);
    await writeFile(path.join(directory,"capture.partial"),serialized,{flag:"wx",mode:0o600});
    input.signal?.throwIfAborted();
    await rename(path.join(directory,"capture.partial"),path.join(directory,"capture.json"));
    return {directory,manifest};
  }catch(error){await rm(directory,{recursive:true,force:true});if(error instanceof ExportSizeLimitError)throw new CompactCaptureQuotaError(quota);throw error;}
}

/** Caller must recheck effective access. Owner IDs here are a fail-closed scope
 * match, not an authorization substitute. No caller-supplied paths are read from
 * the manifest; only fixed filenames inside the attempt directory are used.
 */
export async function readCompactSpool(directory:string,scope:Scope,signal?:AbortSignal){
  validScope(scope);signal?.throwIfAborted();
  const metadataPath=path.join(directory,"capture.json");
  if((await stat(metadataPath)).size>64*1024)throw new Error("Capture metadata is not valid.");
  const manifest=JSON.parse(await readFile(metadataPath,"utf8")) as Manifest;
  for(const key of ["organizationId","actorId","observationReference","dataset","schemaVersion","columns","normalizedFilters","sourceInformation"] as const)
    if(!isDeepStrictEqual(manifest[key],scope[key]))throw new Error("The saved capture does not match the authorized request.");
  if(manifest.version!==1||!Number.isSafeInteger(manifest.rowCount)||manifest.rowCount<0||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<0||manifest.bytes>quotaCeiling||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw new Error("Capture evidence is not valid.");
  const dataPath=path.join(directory,"rows.jsonl"),before=await stat(dataPath);
  const hash=createHash("sha256");for await(const chunk of createReadStream(dataPath)){signal?.throwIfAborted();hash.update(chunk);}
  if(before.size!==manifest.bytes||hash.digest("hex")!==manifest.sha256)throw new Error("Capture integrity verification failed.");
  async function* rows():AsyncGenerator<Row>{
    const source=createReadStream(dataPath,{signal,highWaterMark:64*1024});
    const decoder=new StringDecoder("utf8");let pending="";
    let count=0;const replayHash=createHash("sha256");
    try{
      for await(const chunk of source){
        signal?.throwIfAborted();replayHash.update(chunk);pending+=decoder.write(chunk as Buffer);
        let end:number;
        while((end=pending.indexOf("\n"))!==-1){
          const line=pending.slice(0,end);pending=pending.slice(end+1);
          if(Buffer.byteLength(line)>8*1024*1024||++count>manifest.rowCount)throw new Error("Capture detail exceeds its evidence.");
          yield JSON.parse(line) as Row;
        }
        if(Buffer.byteLength(pending)>8*1024*1024)throw new Error("Capture record exceeds its safe replay budget.");
      }
      pending+=decoder.end();if(pending)throw new Error("Capture has an incomplete final record.");
      const after=await stat(dataPath);
      if(count!==manifest.rowCount||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||replayHash.digest("hex")!==manifest.sha256)throw new Error("Capture changed or is incomplete; retry source capture.");
    }finally{source.destroy();}
  }
  return {manifest,rows:rows()};
}
