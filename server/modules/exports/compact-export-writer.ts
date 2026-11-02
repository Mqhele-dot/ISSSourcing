import ExcelJS from "exceljs";
import {PassThrough,Readable} from "node:stream";
import {mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import {streamExportFile} from "./stream-export-file";

type Cell=string|number|boolean|null;
type RecordRow=Record<string,Cell>;
type GroupColumn={key:string;label:string};
const summaryLimit=100_000_000;

/** File-generation primitive, not a source query or financial-measure service.
 * A caller must supply one authorized frozen source. Counts describe source
 * rows, never document counts, spend, stock availability or financial totals.
 */
export async function writeCompactExportFiles(input:{
  outputDirectory:string;jobId:number;snapshotReference:string;dataset:string;
  groupColumns:GroupColumn[];rows:AsyncIterable<RecordRow>;signal?:AbortSignal;maxSummaryBytesExclusive?:number;
}){
  if(!Number.isSafeInteger(input.jobId)||input.jobId<1||!input.snapshotReference.trim()||input.snapshotReference.length>200||!input.dataset.trim())throw new Error("A valid job and saved source reference are required.");
  const byteLimit=input.maxSummaryBytesExclusive??summaryLimit;
  if(!Number.isSafeInteger(byteLimit)||byteLimit<1||byteLimit>summaryLimit)throw new Error("The summary size budget must be at most 100 MB.");
  if(input.groupColumns.length>4||new Set(input.groupColumns.map(c=>c.key)).size!==input.groupColumns.length||input.groupColumns.some(c=>!c.key||!c.label||c.key.length>100||c.label.length>200))throw new Error("Choose up to four distinct summary dimensions.");
  const directory=await mkdtemp(path.join(input.outputDirectory,`job-${input.jobId}-`));
  const summaryPath=path.join(directory,`job-${input.jobId}-summary.xlsx`),archivePath=path.join(directory,`job-${input.jobId}-details.jsonl.gz`);
  const groups=new Map<string,{values:Cell[];count:number}>();
  let groupKeyBytes=0;
  let sourceRowCount=0;
  const encoder=new TextEncoder();
  async function* archive(){
    yield encoder.encode(JSON.stringify({type:"metadata",version:1,dataset:input.dataset,snapshotReference:input.snapshotReference,summaryBasis:"source row counts, not financial totals"})+"\n");
    for await(const row of input.rows){
      input.signal?.throwIfAborted();
      if(!row||Array.isArray(row)||typeof row!=="object"||Object.values(row).some(value=>value!==null&&!["string","number","boolean"].includes(typeof value)||typeof value==="number"&&!Number.isFinite(value)))throw new Error("Export rows must contain finite scalar values; exact decimals must remain strings.");
      const values=input.groupColumns.map(column=>Object.hasOwn(row,column.key)?row[column.key]:null);
      if(values.some(value=>typeof value==="string"&&value.length>32767))throw new Error("A summary dimension exceeds Excel's cell limit. Choose a shorter dimension; detail has not been published.");
      const key=JSON.stringify(values),existing=groups.get(key);
      if(existing)existing.count++;else{
        if(groups.size>=10_000)throw new Error("This summary has too many groups. Choose fewer summary dimensions; no partial export was published.");
        groupKeyBytes+=Buffer.byteLength(key,"utf8");
        if(groupKeyBytes>8*1024*1024)throw new Error("The summary dimensions require too much memory. Choose shorter or fewer dimensions; no partial export was published.");
        groups.set(key,{values,count:1});
      }
      if(++sourceRowCount>2147483647)throw new Error("This export exceeds the supported source-row count.");
      yield encoder.encode(JSON.stringify({type:"record",ordinal:sourceRowCount,data:row})+"\n");
    }
    yield encoder.encode(JSON.stringify({type:"completion",snapshotReference:input.snapshotReference,sourceRowCount})+"\n");
  }
  try{
    const archiveSize=await streamExportFile({body:Readable.toWeb(Readable.from(archive())) as ReadableStream<Uint8Array>,destination:archivePath,gzip:true,signal:input.signal});
    input.signal?.throwIfAborted();
    const output=new PassThrough({highWaterMark:64*1024});
    const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({stream:output,useStyles:false,useSharedStrings:false});
    const save=streamExportFile({body:Readable.toWeb(output) as ReadableStream<Uint8Array>,destination:summaryPath,gzip:false,maxBytesExclusive:byteLimit,signal:input.signal});
    // Attach rejection handlers immediately: either producer or destination may
    // fail while the other is waiting for stream backpressure.
    const write=(async()=>{
      try{
        const evidence=workbook.addWorksheet("Export evidence");
        for(const row of [["Dataset",input.dataset],["Snapshot",input.snapshotReference],["Source rows",String(sourceRowCount)],["Summary basis","Source row counts only; not document counts or financial totals"],["Full detail","Separate gzip JSON Lines archive; original decimal strings retained"],["Missing dimension","Blank cells mean no supplied dimension; not a verified business value"]])evidence.addRow(row).commit();
        evidence.commit();
        const summary=workbook.addWorksheet("Summary");
        summary.addRow([...input.groupColumns.map(c=>c.label),"Source rows"]).commit();
        for(const group of groups.values()){
          input.signal?.throwIfAborted();
          summary.addRow([...group.values,String(group.count)]).commit();
        }
        summary.commit();await workbook.commit();
      }catch(error){output.destroy(error instanceof Error?error:new Error("Summary generation failed"));throw error;}
    })();
    const results=await Promise.allSettled([save,write]);
    for(const result of results)if(result.status==="rejected")throw result.reason;
    const summarySize=(results[0] as PromiseFulfilledResult<number>).value;
    return {directory,summaryPath,archivePath,summarySize,archiveSize,sourceRowCount,snapshotReference:input.snapshotReference,groupCount:groups.size};
  }catch(error){
    // This directory was created exclusively by this invocation; never remove
    // an organization directory or a pre-existing file on generation failure.
    await rm(directory,{recursive:true,force:true});throw error;
  }
}
