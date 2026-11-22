import ExcelJS from "exceljs";
import {PassThrough,Readable} from "node:stream";
import {createReadStream} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {setImmediate as yieldTurn} from "node:timers/promises";
import {streamExportFile,ExportSizeLimitError} from "./stream-export-file";
import {compactLiteralText} from "./compact-literal-text";

export type CompactDetailColumn={key:string;label:string;kind:"text"|"identifier"|"decimal"|"timestamp"|"scalar"};
type Value=string|number|boolean|null;
const writerVersion="compact-full-detail-v2-rich-text";

export class CompactDetailRefusal extends Error{
  constructor(readonly code:string,message:string,readonly sourceOrdinal?:number,readonly field?:string){super(message);}
}
function text(value:string,ordinal?:number,field?:string){
  if(value.length>32767||value.split("\n").length>254||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/.test(value)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
    throw new CompactDetailRefusal("EXCEL_VALUE_UNREPRESENTABLE","A selected value cannot be preserved in Excel. Review the identified field or choose different columns.",ordinal,field);
  if(/\r/.test(value))throw new CompactDetailRefusal("WRITER_TEXT_PRESERVATION_UNVERIFIED","The current writer cannot verify lossless preservation of carriage returns. Choose different columns or wait for a supported writer; no partial file was produced.",ordinal,field);
  return value;
}

/** Internal generation primitive only. The caller must provide a completed,
 * authorized capture (or frozen financial run), not a live full-array exporter.
 * Publication, child-process isolation and leases belong to the job orchestrator.
 */
export async function writeCompactFullDetail(input:{outputDirectory:string;jobId:number;dataset:string;observationReference:string;
  schemaVersion:string;normalizedFilters:Record<string,unknown>;columns:CompactDetailColumn[];
  sourceInformation?:Record<string,string|null>;
  expectedRows:number;rows:AsyncIterable<Record<string,Value>>;signal?:AbortSignal;
  maxBytesExclusive?:number;maxRowsPerWorksheet?:number;
}){
  const byteLimit=input.maxBytesExclusive??100_000_000,rowsPerSheet=input.maxRowsPerWorksheet??1_048_576;
  if(!Number.isSafeInteger(byteLimit)||byteLimit<1||byteLimit>100_000_000||!Number.isSafeInteger(rowsPerSheet)||rowsPerSheet<2||rowsPerSheet>1_048_576)throw new Error("Invalid compact workbook limits.");
  if(!Number.isSafeInteger(input.jobId)||input.jobId<1||!Number.isSafeInteger(input.expectedRows)||input.expectedRows<0||!input.observationReference||input.observationReference.length>200||!input.schemaVersion||input.schemaVersion.length>100||!input.dataset||input.dataset.length>200)throw new Error("A valid captured source and exact source count are required.");
  if(!input.columns.length||input.columns.length>16384||new Set(input.columns.map(c=>c.key)).size!==input.columns.length||input.columns.some(c=>!c.key||c.key.length>100||!c.label||c.label.length>200||!["text","identifier","decimal","timestamp","scalar"].includes(c.kind)))throw new Error("Choose valid distinct registered columns.");
  const metadata:Array<Array<string|null>>=[
    ["Profile","Compact Excel — complete selected detail"],["Dataset",input.dataset],["Observation",input.observationReference],
    ["Source rows",String(input.expectedRows)],["Schema version",input.schemaVersion],["Writer version",writerVersion],
    ["Filters",JSON.stringify(input.normalizedFilters)],["Selected columns",JSON.stringify(input.columns.map(c=>c.key))],
    ["Precision","Values are literal text. Decimal, identifier and timestamp columns must arrive as exact strings; no formulas, macros or external links are generated."],
    ["Scope","Every captured record and selected column is included. No summaries, separate archives or automatic format changes."],
  ];
  if(input.sourceInformation){
    const entries=Object.entries(input.sourceInformation);
    if(entries.length>100||entries.some(([key,value])=>!key||key.length>100||value!==null&&typeof value!=="string"))throw new Error("Invalid source-information evidence.");
    for(const [key,value]of entries)metadata.push([`Source information: ${key}`,value]);
  }
  for(const row of metadata)for(const value of row)if(value!==null)text(value);
  for(const column of input.columns)text(column.label);
  input.signal?.throwIfAborted();
  const directory=await mkdtemp(path.join(input.outputDirectory,`job-${input.jobId}-full-`));
  const filePath=path.join(directory,`job-${input.jobId}-compact.xlsx`);
  let processedRows=0,sheetCount=0;
  try{
    const output=new PassThrough({highWaterMark:64*1024});
    const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({stream:output,useStyles:false,useSharedStrings:false,zip:{zlib:{level:6}}});
    let streamFailure:unknown;
    const save=streamExportFile({body:Readable.toWeb(output) as ReadableStream<Uint8Array>,destination:filePath,gzip:false,maxBytesExclusive:byteLimit,signal:input.signal})
      .catch(error=>{streamFailure=error;output.destroy();throw error;});
    const write=(async()=>{
      try{
        const information=workbook.addWorksheet("Export information");for(const row of metadata)information.addRow(row.map(value=>value===null?null:compactLiteralText(value))).commit();information.commit();
        let sheet:ExcelJS.Worksheet,rowsOnSheet=0;
        const nextSheet=()=>{
          if(sheetCount)sheet.commit();
          sheet=workbook.addWorksheet(`Data ${++sheetCount}`,{views:[{state:"frozen",ySplit:1}]});
          sheet.addRow(input.columns.map(c=>compactLiteralText(c.label))).commit();rowsOnSheet=1;
          sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:input.columns.length}};
        };
        nextSheet();
        for await(const row of input.rows){
          if(streamFailure)throw streamFailure;
          input.signal?.throwIfAborted();
          if(++processedRows>input.expectedRows)throw new CompactDetailRefusal("CAPTURE_COUNT_MISMATCH","The saved source count does not match its detail. Retry source capture.");
          const cells=input.columns.map(column=>{
            if(!row||!Object.hasOwn(row,column.key))throw new CompactDetailRefusal("CAPTURE_COLUMN_MISSING","A selected field is missing from the saved source. Refresh the capture.",processedRows,column.key);
            const value=row[column.key];
            if(value===null)return null;
            if(["decimal","identifier","timestamp"].includes(column.kind)&&typeof value!=="string")throw new CompactDetailRefusal("EXACT_VALUE_REQUIRED","An exact source string is required for this field. Review its source adapter.",processedRows,column.key);
            if(!["string","number","boolean"].includes(typeof value)||typeof value==="number"&&!Number.isFinite(value))throw new CompactDetailRefusal("EXCEL_VALUE_UNREPRESENTABLE","A selected value cannot be preserved in Excel.",processedRows,column.key);
            const literal=text(Object.is(value,-0)?"-0":String(value),processedRows,column.key);
            // Unformatted inline strings preserve empty text versus null and
            // avoid double entity decoding in some string-cell readers.
            return compactLiteralText(literal);
          });
          if(rowsOnSheet===rowsPerSheet)nextSheet();
          const excelRow=sheet!.addRow(cells);
          // ExcelJS drops wholly empty rows unless they have a height. A normal
          // default-height row preserves its source ordinal without inventing
          // an identifier or replacing null values with empty strings.
          if(cells.every(value=>value===null))excelRow.height=15;
          excelRow.commit();rowsOnSheet++;
          if(processedRows%1000===0)await yieldTurn();
        }
        if(processedRows!==input.expectedRows)throw new CompactDetailRefusal("CAPTURE_COUNT_MISMATCH","The saved source is incomplete. Retry source capture.");
        sheet!.commit();await workbook.commit();
      }catch(error){output.destroy(error instanceof Error?error:new Error("Workbook generation failed"));throw error;}
    })();
    // A rejected destination can leave ExcelJS commit pending; never wait for
    // both settlements after failure. The producer observes streamFailure on
    // its next row and the destroyed output cannot create another artifact.
    let actualBytes:number;
    try{[actualBytes]=await Promise.all([save,write]);}
    catch(error){
      // Stream cancellation may reach ExcelJS before the destination reports
      // its primary size error. Wait only for destination cleanup, never for a
      // potentially pending commit, and retain the actionable size refusal.
      const destinationFailure=await save.then(()=>undefined,reason=>reason);
      if(destinationFailure instanceof ExportSizeLimitError)throw destinationFailure;
      throw error;
    }
    input.signal?.throwIfAborted();
    // Never publish directly from this primitive. A separately isolated validator
    // must verify finalized ZIP/XML and detail parity without spilling outside
    // the attempt directory. ExcelJS's reader uses global temporary files, so it
    // is deliberately not used as the production publication gate here.
    const hash=createHash("sha256");for await(const chunk of createReadStream(filePath))hash.update(chunk);
    return {directory,filePath,actualBytes,processedRows,sheetCount,sha256:hash.digest("hex"),observationReference:input.observationReference,writerVersion,validationState:"pending_independent_validation" as const};
  }catch(error){
    await rm(directory,{recursive:true,force:true});
    if(error instanceof ExportSizeLimitError)throw new CompactDetailRefusal("COMPACT_EXCEL_TOO_LARGE","The complete export cannot fit below 100 MB. Choose fewer columns or a shorter date range.");
    throw error;
  }
}
