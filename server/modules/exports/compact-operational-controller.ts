import type {Pool,PoolClient} from 'pg';
import {claimCompactLease,heartbeatCompactLease,failCompactLease,type CompactLeaseIdentity} from './compact-export-leases';
import {registerCompactWorkspace} from './compact-workspaces';
import {captureOperationalCompact} from './capture-operational-compact';
import {recordCompactCapture} from './compact-capture-evidence';
import {assertCompactExportActorWithClient} from './export-actor-access';
import {runCompactIsolatedWorker} from './compact-isolated-worker';
import {publishAuthorizedCompactWorkbook} from './compact-publication';
import {copyCompactSavedCapture} from './compact-saved-retry';
export {expireObservedExportFile} from './expire-export-file';
export {readExpiredExportFiles} from './expired-export-files';

type Policy={temporaryBytes:number;organizationTemporaryBytes:number;totalTemporaryBytes:number;organizationRetainedBytes:number;totalRetainedBytes:number;retentionDays:number;tokenTtlMinutes:number};
type Progress={stage:'claimed'|'captured'|'validated';jobId:number;workspaceId?:string;captureId?:string};
export class CompactPipelineFailure extends Error{
  readonly code='COMPACT_PIPELINE_STOPPED';
  constructor(cause?:unknown){super('This export stopped before it could be published safely. Review its access, filters and recorded attempt before retrying. No partial download was made available.',{cause});}
}

/** Private operational pipeline, deliberately not registered with the automatic
 * worker or any public route. No fallback, hidden filter rewrite or live retry.
 * Failed same-job attempts reuse saved captures only after a governed retry
 * command. Providers and frozen-financial capture remain separate gates.
 */
export async function executeCompactOperationalJob(database:Pool,input:{root:string;storageId:string;organizationId:number;serverId:string;policy:Policy;columns?:string[];utcTimestampEvidence?:string},options:{signal?:AbortSignal;deadlineMs?:number;onProgress?:(event:Progress)=>Promise<void>|void}={}){
  input=structuredClone(input);const policy=input.policy,deadlineMs=options.deadlineMs??30*60*1000;
  if(!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>30*60*1000)throw new Error('Choose a worker deadline no longer than 30 minutes.');
  const poolOptions=Reflect.get(database,'options') as {max?:number;connectionTimeoutMillis?:number}|undefined;
  if(!poolOptions||!Number.isInteger(poolOptions.max)||(poolOptions.max??0)<2||!Number.isInteger(poolOptions.connectionTimeoutMillis)||(poolOptions.connectionTimeoutMillis??0)<1||(poolOptions.connectionTimeoutMillis??0)>10000)throw new Error('Compact requires at least two pool connections and a positive acquisition timeout no longer than ten seconds.');
  if(![policy.temporaryBytes,policy.organizationTemporaryBytes,policy.totalTemporaryBytes,policy.organizationRetainedBytes,policy.totalRetainedBytes].every(value=>Number.isSafeInteger(value)&&value>0)||policy.temporaryBytes<8192||policy.temporaryBytes>2*1024**3||policy.organizationTemporaryBytes<policy.temporaryBytes||policy.totalTemporaryBytes<policy.organizationTemporaryBytes||policy.organizationRetainedBytes>policy.totalRetainedBytes||!Number.isInteger(policy.retentionDays)||policy.retentionDays<1||policy.retentionDays>365||!Number.isInteger(policy.tokenTtlMinutes)||policy.tokenTtlMinutes<1||policy.tokenTtlMinutes>55)throw new Error('Choose valid private and retained export limits before claiming work.');
  options.signal?.throwIfAborted();
  const claim=await claimCompactLease(database,{organizationId:input.organizationId,serverId:input.serverId});if(!claim)return {status:'idle' as const};
  const lease:CompactLeaseIdentity={organizationId:input.organizationId,attemptId:claim.id,leaseToken:claim.lease_token},controller=new AbortController();
  const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
  const started=Date.now(),deadline=setTimeout(abort,deadlineMs);let renewal:ReturnType<typeof setInterval>|undefined,leaseClient:PoolClient|undefined,inFlight:Promise<void>|undefined,checking=false;
  let stage:'capturing'|'writing'|'validating'='capturing';
  const notify=async(event:Progress)=>{
    controller.signal.throwIfAborted();if(!options.onProgress)return;
    let rejectAbort:()=>void=()=>undefined;
    const interrupted=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(new CompactPipelineFailure());controller.signal.addEventListener('abort',rejectAbort,{once:true});if(controller.signal.aborted)rejectAbort();});
    try{await Promise.race([Promise.resolve().then(()=>options.onProgress!(event)),interrupted]);}finally{controller.signal.removeEventListener('abort',rejectAbort);}
    controller.signal.throwIfAborted();
  };
  try{
    leaseClient=await database.connect();await leaseClient.query("SET statement_timeout='5s'");
    const job=(await leaseClient.query('SELECT created_by,dataset,filters,retry_of_job_id,attempts FROM export_jobs WHERE id=$1 AND organization_id=$2',[claim.job_id,input.organizationId])).rows[0];
    if(!job||!Number.isSafeInteger(job.created_by)||job.created_by<1||!job.filters||Array.isArray(job.filters)||typeof job.filters!=='object'||job.retry_of_job_id!==null)throw new CompactPipelineFailure();
    const binding={jobId:claim.job_id,actorId:Number(job.created_by),dataset:String(job.dataset),filters:structuredClone(job.filters) as Record<string,unknown>};
    if(job.attempts>1){
      const retry=await leaseClient.query(`SELECT 1 FROM audit_logs WHERE organization_id=$1 AND user_id=$2 AND resource_type='export_job' AND resource_id=$3
        AND action='COMPACT_EXPORT_RETRY_QUEUED' AND details->>'nextAttempt'=$4 LIMIT 1`,[input.organizationId,binding.actorId,claim.job_id,String(job.attempts)]);
      if(!retry.rowCount)throw new CompactPipelineFailure();
    }
    const checkLease=async()=>{if(!await heartbeatCompactLease(leaseClient!,{...lease,stage,binding}))throw new CompactPipelineFailure();controller.signal.throwIfAborted();};
    await checkLease();
    const renew=()=>{if(checking)return;checking=true;inFlight=(async()=>{try{await checkLease();}catch{abort();}finally{checking=false;}})();};
    renewal=setInterval(renew,1000);
    const authorize=async(client?:PoolClient)=>{controller.signal.throwIfAborted();const owned=!client,connection=client??await database.connect();try{await assertCompactExportActorWithClient(connection,{organizationId:input.organizationId,userId:binding.actorId,dataset:binding.dataset,filters:binding.filters});}finally{if(owned)connection.release();}controller.signal.throwIfAborted();};
    await authorize();await notify({stage:'claimed',jobId:claim.job_id});
    const workspace=await registerCompactWorkspace(database,{root:input.root,storageId:input.storageId,lease,...binding,reservedBytes:policy.temporaryBytes,organizationQuotaBytes:policy.organizationTemporaryBytes,totalQuotaBytes:policy.totalTemporaryBytes});
    // Reserve marker/housekeeping bytes as well as capture+workbook payload.
    const payloadBudget=policy.temporaryBytes-4096;
    const capture=job.attempts>1
      ?await copyCompactSavedCapture(database,{...binding,root:input.root,storageId:input.storageId,lease,columns:input.columns,captureRoot:workspace.captureRoot,quotaBytes:payloadBudget,signal:controller.signal})
      :await captureOperationalCompact(database,{dataset:binding.dataset,organizationId:input.organizationId,actorId:binding.actorId,root:workspace.captureRoot,filters:binding.filters,columns:input.columns,utcTimestampEvidence:input.utcTimestampEvidence,quotaBytes:payloadBudget,signal:controller.signal,authorize});
    const request={captureDirectory:capture.directory,outputRoot:workspace.outputRoot,jobId:claim.job_id,temporaryQuotaBytes:payloadBudget,scope:capture.scope,columns:capture.columns};
    const evidence=await recordCompactCapture(database,{root:input.root,storageId:input.storageId,workspaceId:workspace.id,lease,request,signal:controller.signal});
    await notify({stage:'captured',jobId:claim.job_id,workspaceId:workspace.id,captureId:evidence.id});await authorize();
    stage='writing';await inFlight;await checkLease();
    const remaining=deadlineMs-(Date.now()-started);if(remaining<1)throw new CompactPipelineFailure();
    const result=await runCompactIsolatedWorker(request,{signal:controller.signal,deadlineMs:remaining,onStage:()=>{stage='validating';}});
    stage='validating';await inFlight;await checkLease();
    await notify({stage:'validated',jobId:claim.job_id,workspaceId:workspace.id,captureId:evidence.id});
    if(result.captureSha256!==evidence.sha256)throw new CompactPipelineFailure();
    await publishAuthorizedCompactWorkbook(database,{root:input.root,lease,request,result,policy,signal:controller.signal});
    // Publication is the terminal business outcome. A later observer failure
    // must never relabel an already committed workbook as an unpublished failure.
    return {status:'succeeded' as const,jobId:claim.job_id,workspaceId:workspace.id,captureId:evidence.id,rows:result.processedRows,bytes:result.actualBytes};
  }catch(error){
    abort();if(renewal)clearInterval(renewal);await inFlight;
    await failCompactLease(database,lease,'interrupted').catch(()=>undefined);throw new CompactPipelineFailure(error);
  }finally{
    if(renewal)clearInterval(renewal);clearTimeout(deadline);options.signal?.removeEventListener('abort',abort);await inFlight;
    if(leaseClient){try{await leaseClient.query('RESET statement_timeout');leaseClient.release();}catch{leaseClient.release(true);}}
  }
}
