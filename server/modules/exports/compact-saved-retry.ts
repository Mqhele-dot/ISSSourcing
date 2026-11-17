import type {Pool} from 'pg';
import path from 'node:path';
import {lstat,realpath,rm} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {lockCompactDecisions} from './compact-decision-lock';
import {appendAuditEventWithClient} from '../../services/audit-chain-client';
import {assertCompactExportActorWithClient} from './export-actor-access';
import {inspectCompactRetryWorkspace} from './compact-workspaces';
import {captureCompactSpool,readCompactSpool} from './compact-capture-spool';
import type {CompactLeaseIdentity} from './compact-export-leases';
import type {CompactWorkerRequest} from './compact-isolated-worker';

/** Private command: another attempt of an unpublished failed Compact job, not a
 * new live observation. Caller derives actor/tenant from authenticated context.
 * The canonical audit receipt makes network retries idempotent across restarts.
 */
export async function queueCompactSavedRetry(database:Pool,input:{organizationId:number;actorId:number;jobId:number;commandId:string}){
  if(![input.organizationId,input.actorId,input.jobId].every(n=>Number.isSafeInteger(n)&&n>0)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.commandId))throw new Error('Choose a valid export and retry command identity.');
  const commandId=input.commandId.toLowerCase(),client=await database.connect();
  try{
    await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");await lockCompactDecisions(client);
    const found=await client.query(`SELECT * FROM export_jobs WHERE id=$1 AND organization_id=$2 AND created_by=$3 AND profile='compact_excel' AND format='excel' FOR UPDATE`,[input.jobId,input.organizationId,input.actorId]);
    if(found.rowCount!==1)throw new Error('This Compact export is not available to you.');const job=found.rows[0];
    await assertCompactExportActorWithClient(client,{organizationId:input.organizationId,userId:input.actorId,dataset:job.dataset,filters:job.filters},true);
    const receipt=await client.query("SELECT resource_id,user_id,details FROM audit_logs WHERE organization_id=$1 AND request_id=$2 AND action='COMPACT_EXPORT_RETRY_QUEUED'",[input.organizationId,commandId]);
    if(receipt.rowCount){const saved=receipt.rows[0];if(saved.resource_id!==input.jobId||saved.user_id!==input.actorId)throw new Error('This retry command belongs to another request.');await client.query('COMMIT');return {jobId:input.jobId,captureId:String(saved.details.captureId),replayed:true};}
    if(job.status!=='failed'||job.file_path!==null)throw new Error('Only an unpublished failed Compact export can retry its saved capture.');
    const active=await client.query('SELECT 1 FROM compact_export_attempts WHERE job_id=$1 AND organization_id=$2 AND finished_at IS NULL LIMIT 1',[input.jobId,input.organizationId]);
    if(active.rowCount)throw new Error('The earlier export attempt has not stopped. Wait for lease recovery before retrying.');
    // Refuse while filesystem cleanup owns ANY workspace for this job. It may
    // already have removed files before committing its final metadata/audit.
    const cleaning=await client.query("SELECT 1 FROM compact_export_workspaces WHERE job_id=$1 AND organization_id=$2 AND state='cleanup_claimed' LIMIT 1",[input.jobId,input.organizationId]);
    if(cleaning.rowCount)throw new Error('Saved files are being cleaned up. Wait for cleanup to finish; no live source was read.');
    const capture=await client.query(`SELECT c.id FROM compact_export_captures c JOIN compact_export_workspaces w ON w.id=c.workspace_id
      WHERE c.job_id=$1 AND c.organization_id=$2 AND c.actor_id=$3 AND w.state='ready'
        AND c.scope->>'dataset'=$4 AND c.scope->'normalizedFilters'=$5::jsonb ORDER BY c.recorded_at DESC,c.id DESC LIMIT 1`,[input.jobId,input.organizationId,input.actorId,job.dataset,JSON.stringify(job.filters)]);
    if(!capture.rowCount)throw new Error('No retained verified capture matches this export. Create a new confirmed export; this retry will not read live data.');
    await client.query(`UPDATE export_jobs SET status='queued',last_error=NULL,completed_at=NULL,started_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2`,[input.jobId,input.organizationId]);
    await appendAuditEventWithClient(client,{organizationId:input.organizationId,actor:{userId:input.actorId},action:'COMPACT_EXPORT_RETRY_QUEUED',resourceType:'export_job',resourceId:input.jobId,requestId:commandId,details:{captureId:String(capture.rows[0].id),nextAttempt:Number(job.attempts)+1,source:'saved_capture_only'}});
    await client.query('COMMIT');return {jobId:input.jobId,captureId:String(capture.rows[0].id),replayed:false};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

/** Pinning is supplied by the running same-job lease. Copy the completed spool
 * with bounded streaming, never by querying operational source records. The
 * new workspace gets its own quota reservation and capture evidence.
 */
export async function copyCompactSavedCapture(database:Pool,input:{root:string;storageId:string;lease:CompactLeaseIdentity;jobId:number;actorId:number;dataset:string;filters:Record<string,unknown>;columns?:string[];captureRoot:string;quotaBytes:number;signal?:AbortSignal}){
  input.signal?.throwIfAborted();
  const result=await database.query(`SELECT c.* FROM compact_export_captures c JOIN compact_export_workspaces w ON w.id=c.workspace_id
    WHERE c.job_id=$1 AND c.organization_id=$2 AND c.actor_id=$3 AND w.state='ready' AND c.attempt_id<>$4
      AND c.scope->>'dataset'=$5 AND c.scope->'normalizedFilters'=$6::jsonb ORDER BY c.recorded_at DESC,c.id DESC LIMIT 1`,[input.jobId,input.lease.organizationId,input.actorId,input.lease.attemptId,input.dataset,JSON.stringify(input.filters)]);
  if(result.rowCount!==1)throw new Error('The saved capture is unavailable. No live source was read.');const saved=result.rows[0],scope=saved.scope as CompactWorkerRequest['scope'],columns=saved.columns as CompactWorkerRequest['columns'];
  if(scope.organizationId!==input.lease.organizationId||scope.actorId!==input.actorId||scope.dataset!==input.dataset||!isDeepStrictEqual(scope.normalizedFilters,input.filters)||!isDeepStrictEqual(scope.columns,columns.map(c=>c.key))||input.columns&&!isDeepStrictEqual(input.columns,scope.columns))throw new Error('Retry columns and filters must match the saved capture. Create a new confirmed export to change its scope.');
  const workspace=await inspectCompactRetryWorkspace(database,{...input,workspaceId:saved.workspace_id});
  if(typeof saved.capture_directory!=='string'||!/^compact-capture-[A-Za-z0-9]{6,}$/.test(saved.capture_directory))throw new Error('The saved capture identity is invalid.');
  const directory=path.join(workspace.captureRoot,saved.capture_directory);
  if((await lstat(directory)).isSymbolicLink()||await realpath(directory)!==directory)throw new Error('The saved capture path is not an owned directory.');
  for(const name of ['capture.json','rows.jsonl']){const file=await lstat(path.join(directory,name));if(!file.isFile()||file.isSymbolicLink())throw new Error('The saved capture files are not owned regular files.');}
  const original=await readCompactSpool(directory,scope,input.signal);
  if(original.manifest.sha256!==saved.capture_sha256||String(original.manifest.rowCount)!==String(saved.source_rows)||String(original.manifest.bytes)!==String(saved.capture_bytes))throw new Error('The retained capture no longer matches its immutable evidence. No live source was read.');
  const copy=await captureCompactSpool({...scope,root:input.captureRoot,quotaBytes:input.quotaBytes,rows:original.rows,signal:input.signal});
  if(copy.manifest.sha256!==saved.capture_sha256||copy.manifest.rowCount!==original.manifest.rowCount){await rm(copy.directory,{recursive:true,force:true});throw new Error('The saved capture could not be copied without alteration.');}
  return {...copy,scope,columns,sourceCaptureId:String(saved.id)};
}
