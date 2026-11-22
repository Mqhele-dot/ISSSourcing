import type {Pool} from "pg";
import {heartbeatCompactLease,failCompactLease,type CompactLeaseIdentity} from "./compact-export-leases";
import {runCompactIsolatedWorker,type CompactWorkerRequest} from "./compact-isolated-worker";
import {rm} from "node:fs/promises";

/** Runs an already captured job under its durable lease. Returns unpublished
 * independently validated output in validating stage: current access checks and
 * the separate publication fence are still required. Never marks output ready.
 */
export async function runLeasedCompactWorker(database:Pool,lease:CompactLeaseIdentity,request:CompactWorkerRequest,options:{signal?:AbortSignal;onStarted?:(pid:number)=>void}={}){
  request=structuredClone(request);
  if(request.scope.organizationId!==lease.organizationId)throw new Error("Worker lease scope does not match its capture.");
  const owned=await database.query(`SELECT a.job_id FROM compact_export_attempts a JOIN export_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
    WHERE a.id=$1 AND a.organization_id=$2 AND a.lease_token=$3 AND a.finished_at IS NULL AND a.lease_until>clock_timestamp()
    AND j.created_by=$4 AND j.status='running' AND j.profile='compact_excel' AND j.format='excel' AND j.dataset=$5 AND j.filters=$6::jsonb`,[lease.attemptId,lease.organizationId,lease.leaseToken,request.scope.actorId,request.scope.dataset,JSON.stringify(request.scope.normalizedFilters)]);
  if(!owned.rowCount||Number(owned.rows[0].job_id)!==request.jobId)throw new Error("Worker lease does not match the requested export job.");
  const binding={jobId:request.jobId,actorId:request.scope.actorId,dataset:request.scope.dataset,filters:request.scope.normalizedFilters};
  if(!await heartbeatCompactLease(database,{...lease,stage:"writing",binding}))throw new Error("The export lease is no longer valid.");
  const controller=new AbortController();
  const abort=()=>controller.abort();options.signal?.addEventListener("abort",abort,{once:true});if(options.signal?.aborted)abort();
  let checking=false,checkingWork:Promise<void>|undefined,stage:'writing'|'validating'='writing';
  const renew=()=>{
    if(checking)return;
    checking=true;checkingWork=(async()=>{
      try{if(!await heartbeatCompactLease(database,{...lease,stage,binding}))controller.abort();}
      catch{controller.abort();}finally{checking=false;}
    })();
  };
  const timer=setInterval(renew,1000);
  let output:Awaited<ReturnType<typeof runCompactIsolatedWorker>>|undefined;
  try{
    output=await runCompactIsolatedWorker(request,{signal:controller.signal,onStarted:options.onStarted,onStage:()=>{stage='validating';}});
    clearInterval(timer);await checkingWork;
    if(controller.signal.aborted||!await heartbeatCompactLease(database,{...lease,stage:"validating",binding}))throw new Error("The export lease was cancelled or lost before validation. No file was published.");
    return output;
  }catch(error){
    if(output)await rm(output.attemptDirectory,{recursive:true,force:true});
    const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';
    await failCompactLease(database,lease,code.startsWith('EXCEL_')||code==='COMPACT_EXCEL_TOO_LARGE'?'refused':'interrupted').catch(()=>undefined);
    throw error;
  }finally{clearInterval(timer);await checkingWork;options.signal?.removeEventListener("abort",abort);}
}
