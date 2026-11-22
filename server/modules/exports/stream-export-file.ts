import {createWriteStream} from "node:fs";
import {rename,unlink,stat} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {Readable,Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {createGzip} from "node:zlib";

/** Backpressure-aware packaging; never accumulates the complete download in memory. */
export class ExportSizeLimitError extends Error {
  readonly code="EXPORT_SIZE_LIMIT_EXCEEDED";
  constructor(readonly maxBytesExclusive:number){super("The generated file exceeds the selected download size limit. Choose a smaller summary or narrower scope.");}
}

export async function streamExportFile(input:{body:ReadableStream<Uint8Array>;destination:string;gzip:boolean;maxBytesExclusive?:number;signal?:AbortSignal}) {
  if(input.maxBytesExclusive!==undefined&&(!Number.isSafeInteger(input.maxBytesExclusive)||input.maxBytesExclusive<1))
    throw new Error("The export size limit must be a positive whole number of bytes.");
  const temporary=`${input.destination}.${randomUUID()}.partial`;
  let created=false;
  let sizeFailure:ExportSizeLimitError|undefined;
  const output=createWriteStream(temporary,{flags:"wx"});
  output.once("open",()=>{created=true;});
  async function* chunks(){
    const reader=input.body.getReader();
    try{for(;;){const part=await reader.read();if(part.done)break;yield part.value;}}
    finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  }
  try{
    const source=Readable.from(chunks());
    let bytes=0;
    // Placed after compression: ZIP/gzip trailers and final output bytes count,
    // not an estimate based on the uncompressed source.
    const limit=new Transform({transform(chunk:Buffer,_encoding,callback){
      bytes+=chunk.length;
      if(input.maxBytesExclusive!==undefined&&bytes>=input.maxBytesExclusive){sizeFailure=new ExportSizeLimitError(input.maxBytesExclusive);callback(sizeFailure);}
      else callback(null,chunk);
    }});
    if(input.gzip)await pipeline(source,createGzip({level:9}),limit,output,{signal:input.signal});
    else await pipeline(source,limit,output,{signal:input.signal});
    const size=(await stat(temporary)).size;
    await rename(temporary,input.destination);
    return size;
  }catch(error){
    await input.body.cancel().catch(()=>undefined);
    if(created)await unlink(temporary).catch(()=>undefined);
    throw sizeFailure??error;
  }
}
