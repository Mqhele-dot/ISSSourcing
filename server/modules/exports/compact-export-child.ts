import {readCompactSpool} from "./compact-capture-spool";
import {writeCompactFullDetail,CompactDetailRefusal} from "./compact-full-detail-writer";
import type {CompactWorkerRequest} from "./compact-isolated-worker";
import {getHeapStatistics} from "node:v8";
import {stat} from "node:fs/promises";
import path from "node:path";
import {validateCompactWorkbook} from "./compact-workbook-validation";

// Deliberately no application bootstrap, database module or provider clients.
let completedDelivery=false;
// An application crash must not leave credential-free but CPU/disk-active
// orphan workers. Only a successfully delivered terminal result may disconnect
// normally. Unpublished attempt files remain for the owning cleanup lifecycle.
process.once('disconnect',()=>{if(!completedDelivery)process.exit(1);});
if(!process.connected)process.exit(1);
process.once("message",async(message:CompactWorkerRequest)=>{
  const heartbeat=setInterval(()=>{if(process.connected)process.send?.({type:"heartbeat"},()=>{});},5000);
  let response:Record<string,unknown>;
  try{
    if(JSON.stringify(message.columns.map(column=>column.key))!==JSON.stringify(message.scope.columns))throw new Error("Capture column scope mismatch");
    const capture=await readCompactSpool(message.captureDirectory,message.scope);
    const quota=message.temporaryQuotaBytes??2*1024*1024*1024;
    if(!Number.isSafeInteger(quota)||quota<1||quota>2*1024*1024*1024)throw new CompactDetailRefusal("COMPACT_TEMP_QUOTA","The temporary-storage budget is not valid.");
    const captureBytes=capture.manifest.bytes+(await stat(path.join(message.captureDirectory,"capture.json"))).size;
    const available=quota-captureBytes;
    if(available<1)throw new CompactDetailRefusal("COMPACT_TEMP_QUOTA","The saved capture leaves no temporary-storage budget for a workbook. Choose a shorter date range or fewer columns.");
    let result:Awaited<ReturnType<typeof writeCompactFullDetail>>;
    try{
      process.send?.({type:'writing'},()=>{});
      result=await writeCompactFullDetail({outputDirectory:message.outputRoot,jobId:message.jobId,dataset:message.scope.dataset,observationReference:message.scope.observationReference,schemaVersion:message.scope.schemaVersion,normalizedFilters:message.scope.normalizedFilters,columns:message.columns,sourceInformation:capture.manifest.sourceInformation,expectedRows:capture.manifest.rowCount,rows:capture.rows,maxBytesExclusive:Math.min(100_000_000,available+1)});
    }catch(error){
      if(available+1<100_000_000&&error instanceof CompactDetailRefusal&&error.code==='COMPACT_EXCEL_TOO_LARGE')throw new CompactDetailRefusal("COMPACT_TEMP_QUOTA","The capture and workbook exceed the temporary-storage budget. Choose a shorter date range or fewer columns; no file was published.");
      throw error;
    }
    process.send?.({type:'validating'},()=>{});
    const validationCapture=await readCompactSpool(message.captureDirectory,message.scope);
    if(validationCapture.manifest.sha256!==capture.manifest.sha256||validationCapture.manifest.rowCount!==capture.manifest.rowCount)throw new Error('Capture changed before validation');
    const validation=await validateCompactWorkbook({filePath:result.filePath,expectedSha256:result.sha256,dataset:message.scope.dataset,observationReference:message.scope.observationReference,schemaVersion:message.scope.schemaVersion,normalizedFilters:message.scope.normalizedFilters,sourceInformation:capture.manifest.sourceInformation,columns:message.columns,expectedRows:capture.manifest.rowCount,sheetCount:result.sheetCount,rows:validationCapture.rows});
    response={type:"complete",result:{...result,captureSha256:capture.manifest.sha256,validationState:'independently_validated',validation,workerProcessId:process.pid,heapLimitBytes:getHeapStatistics().heap_size_limit,credentialEnvironmentPresent:Boolean(process.env.DATABASE_URL||process.env.TEST_DATABASE_URL||process.env.EMAIL_PASS||process.env.OPENAI_API_KEY)}};
  }catch(error){
    response=error instanceof CompactDetailRefusal?{type:"failed",code:error.code,message:error.message}:{type:"failed",code:"COMPACT_WORKER_FAILED",message:"The saved capture could not be converted safely. Review its evidence and retry; no file was published."};
  }
  clearInterval(heartbeat);process.send?.(response,(error:Error|null)=>{
    completedDelivery=!error;if(error)process.exitCode=1;
    if(process.connected)process.disconnect();
  });
});
process.send?.({type:"ready"});
