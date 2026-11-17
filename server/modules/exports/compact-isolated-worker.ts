import {fork} from "node:child_process";
import {fileURLToPath} from "node:url";
import {mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import type {CompactDetailColumn,writeCompactFullDetail} from "./compact-full-detail-writer";
import type {validateCompactWorkbook} from "./compact-workbook-validation";

export type CompactWorkerRequest={captureDirectory:string;outputRoot:string;jobId:number;temporaryQuotaBytes?:number;scope:{organizationId:number;actorId:number;observationReference:string;dataset:string;schemaVersion:string;columns:string[];normalizedFilters:Record<string,unknown>;sourceInformation?:Record<string,string|null>};columns:CompactDetailColumn[]};
type Result=Omit<Awaited<ReturnType<typeof writeCompactFullDetail>>,'validationState'>&{captureSha256:string;validationState:'independently_validated';validation:Awaited<ReturnType<typeof validateCompactWorkbook>>;workerProcessId:number;heapLimitBytes:number;credentialEnvironmentPresent:boolean};
export type CompactWorkerResult=Result&{attemptDirectory:string};
const validatedResults=new WeakMap<object,{request:string;result:string}>();
/** Private-process proof is not a caller-supplied boolean or serializable ticket.
 * After a process restart, rerun the captured job under a fresh valid lease.
 */
export function assertValidatedCompactResult(result:CompactWorkerResult,request:CompactWorkerRequest){
  const evidence=validatedResults.get(result);
  if(!evidence||evidence.request!==JSON.stringify(request)||evidence.result!==JSON.stringify(result))throw new Error('A matching unchanged isolated validation result is required before publication.');
}
let active=false;
export class CompactWorkerFailure extends Error{
  constructor(readonly code:string,message:string){super(message);}
}

/** One active process per application instance. Durable claims/leases and
 * cross-instance organization limits must be added before production enablement.
 * No DB, SMTP, SMS or provider credentials are inherited by the child.
 */
export async function runCompactIsolatedWorker(request:CompactWorkerRequest,options:{signal?:AbortSignal;deadlineMs?:number;onStarted?:(processId:number)=>void;onWriting?:()=>void;onStage?:(stage:'validating')=>void}={}){
  request=structuredClone(request);const requestEvidence=JSON.stringify(request);
  const deadline=options.deadlineMs??30*60*1000;
  if(!Number.isSafeInteger(deadline)||deadline<1||deadline>30*60*1000)throw new Error("Invalid compact worker deadline.");
  options.signal?.throwIfAborted();
  if(active)throw new CompactWorkerFailure("COMPACT_WORKER_BUSY","A large export is already running on this server. Retry after it finishes.");
  active=true;
  let attempt:string|undefined;
  try{
    attempt=await mkdtemp(path.join(request.outputRoot,"compact-worker-"));
    const source=import.meta.url.endsWith(".ts");
    const entry=fileURLToPath(new URL(source?"./compact-export-child.ts":"./compact-export-child.js",import.meta.url));
    const env:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV??"production"};
    for(const key of ["PATH","Path","SystemRoot","SYSTEMROOT","WINDIR","TEMP","TMP","TMPDIR"])if(process.env[key])env[key]=process.env[key];
    const result=await new Promise<Result>((resolve,reject)=>{
      // V8's heap includes the young generation. 384 MiB old-space alone
      // yields a 576 MiB total heap on Node 24; bound both generations.
      const child=fork(entry,[],{execArgv:["--max-old-space-size=336","--max-semi-space-size=16",...(source?["--import","tsx"]:[])],env,stdio:["ignore","ignore","ignore","ipc"]});
      let failure:CompactWorkerFailure|undefined,completed:Result|undefined,started=false;
      let lastHeartbeat=Date.now();
      const stop=(code:string,message:string)=>{failure??=new CompactWorkerFailure(code,message);child.kill();};
      const timer=setTimeout(()=>stop("COMPACT_WORKER_TIMEOUT","Export generation exceeded its deadline. Choose a narrower scope or retry."),deadline);
      const heartbeatTimer=setInterval(()=>{if(Date.now()-lastHeartbeat>30_000)stop("COMPACT_WORKER_INTERRUPTED","The export worker stopped responding. No file was published; retry the saved capture.");},5000);
      const abort=()=>stop("COMPACT_WORKER_CANCELLED","Export generation was cancelled. No file was published.");
      options.signal?.addEventListener("abort",abort,{once:true});
      if(options.signal?.aborted)abort();
      child.on("message",(message:unknown)=>{
        if(!message||typeof message!=="object")return;
        const event=message as {type:string;result?:Result;code?:string;message?:string};
        if(event.type==="ready"||event.type==="heartbeat")lastHeartbeat=Date.now();
        if(event.type==="ready"&&!started){started=true;child.send({...request,outputRoot:attempt},error=>{if(error)stop("COMPACT_WORKER_INTERRUPTED","The export worker could not receive its job. Retry the saved capture.");});}
        if(event.type==='writing'){try{options.onWriting?.();}catch{stop('COMPACT_WORKER_INTERRUPTED','Export writing monitoring failed. No file was published.');}}
        if(event.type==='validating'){try{options.onStage?.('validating');}catch{stop('COMPACT_WORKER_INTERRUPTED','Export validation monitoring failed. No file was published.');}}
        if(event.type==="complete")completed=event.result;
        if(event.type==="failed")failure=new CompactWorkerFailure(event.code??"COMPACT_WORKER_FAILED",event.message??"The export worker failed. Retry the saved capture.");
      });
      child.once("error",()=>{failure=new CompactWorkerFailure("COMPACT_WORKER_INTERRUPTED","The export worker could not start. Retry after checking the server configuration.");});
      child.once("close",code=>{
        clearTimeout(timer);clearInterval(heartbeatTimer);options.signal?.removeEventListener("abort",abort);
        if(failure)reject(failure);
        else if(code!==0||!completed||! /^[a-f0-9]{64}$/.test(completed.captureSha256)||completed.validationState!=='independently_validated'||completed.validation?.sha256!==completed.sha256||completed.validation?.verifiedRows!==completed.processedRows)reject(new CompactWorkerFailure("COMPACT_WORKER_INTERRUPTED","Export generation or validation was interrupted. No file was published; retry the saved capture."));
        else resolve(completed);
      });
      if(child.pid&&options.onStarted){try{options.onStarted(child.pid);}catch{stop("COMPACT_WORKER_INTERRUPTED","Worker startup monitoring failed. No export was published.");}}
    });
    const completed={...result,attemptDirectory:attempt};
    validatedResults.set(completed,{request:requestEvidence,result:JSON.stringify(completed)});return completed;
  }catch(error){if(attempt)await rm(attempt,{recursive:true,force:true});throw error;}
  finally{active=false;}
}
