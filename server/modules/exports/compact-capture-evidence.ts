import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import type {CompactLeaseIdentity} from './compact-export-leases';
import type {CompactWorkerRequest} from './compact-isolated-worker';
import {inspectCompactWorkspace} from './compact-workspaces';
import {readCompactSpool} from './compact-capture-spool';
import {lockCompactDecisions} from './compact-decision-lock';
import {assertCompactExportActorWithClient} from './export-actor-access';
import {appendAuditEventWithClient} from '../../services/audit-chain-client';

/** Immutable capture registration after the read-only source transaction has
 * closed. Paths come from the durable workspace; no arbitrary path is retained.
 * A completed record is evidence, not permission to reuse/download its contents.
 */
export async function recordCompactCapture(database:Pool,input:{root:string;storageId:string;workspaceId:string;lease:CompactLeaseIdentity;request:CompactWorkerRequest;signal?:AbortSignal}){
  const request=structuredClone(input.request);input.signal?.throwIfAborted();
  if(JSON.stringify(request.scope.columns)!==JSON.stringify(request.columns.map(column=>column.key))||Buffer.byteLength(JSON.stringify({scope:request.scope,columns:request.columns}))>256*1024)throw new Error('The captured column evidence is not valid or exceeds its metadata budget.');
  const workspace=await inspectCompactWorkspace(database,input);
  const captureDirectory=await realpath(request.captureDirectory),captureName=path.basename(captureDirectory);
  if((await lstat(request.captureDirectory)).isSymbolicLink()||path.dirname(captureDirectory)!==workspace.captureRoot||!/^[A-Za-z0-9-]+$/.test(captureName)||!/^compact-capture-[A-Za-z0-9]{6,}$/.test(captureName)||await realpath(request.outputRoot)!==workspace.outputRoot)throw new Error('The source capture is outside its recorded workspace.');
  const capture=await readCompactSpool(captureDirectory,request.scope,input.signal);
  if(capture.manifest.rowCount>2147483647)throw new Error('This capture exceeds the supported job row count.');
  const client=await database.connect();
  try{
    await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");await lockCompactDecisions(client);
    const active=await client.query(`SELECT w.id FROM compact_export_workspaces w JOIN compact_export_attempts a ON a.id=w.attempt_id AND a.job_id=w.job_id AND a.organization_id=w.organization_id
      JOIN export_jobs j ON j.id=w.job_id AND j.organization_id=w.organization_id
      WHERE w.id=$1 AND w.state='ready' AND w.attempt_id=$2 AND w.organization_id=$3 AND a.lease_token=$4 AND a.finished_at IS NULL AND a.lease_until>clock_timestamp()
        AND j.id=$5 AND j.created_by=$6 AND w.actor_id=$6 AND j.dataset=$7 AND j.filters=$8::jsonb AND j.profile='compact_excel' AND j.format='excel' AND j.status='running' FOR UPDATE OF w,a,j`,[workspace.id,input.lease.attemptId,input.lease.organizationId,input.lease.leaseToken,request.jobId,request.scope.actorId,request.scope.dataset,JSON.stringify(request.scope.normalizedFilters)]);
    if(!active.rowCount)throw new Error('The captured source no longer matches the running export. Review its filters and create a new confirmed request; no values were replaced.');
    await assertCompactExportActorWithClient(client,{organizationId:request.scope.organizationId,userId:request.scope.actorId,dataset:request.scope.dataset,filters:request.scope.normalizedFilters},true);
    const existing=await client.query('SELECT id,capture_directory,capture_sha256,scope=$2::jsonb AND columns=$3::jsonb AS same FROM compact_export_captures WHERE workspace_id=$1',[workspace.id,JSON.stringify(request.scope),JSON.stringify(request.columns)]);
    if(existing.rowCount){const saved=existing.rows[0];if(!saved.same||saved.capture_directory!==captureName||saved.capture_sha256!==capture.manifest.sha256)throw new Error('Recorded capture evidence cannot be replaced.');await client.query('COMMIT');return {id:String(saved.id),sha256:capture.manifest.sha256,rows:capture.manifest.rowCount,replayed:true};}
    input.signal?.throwIfAborted();const id=randomUUID();
    await client.query(`INSERT INTO compact_export_captures(id,workspace_id,attempt_id,job_id,organization_id,actor_id,capture_directory,capture_sha256,source_rows,capture_bytes,scope,columns)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,[id,workspace.id,input.lease.attemptId,request.jobId,request.scope.organizationId,request.scope.actorId,captureName,capture.manifest.sha256,capture.manifest.rowCount,capture.manifest.bytes,JSON.stringify(request.scope),JSON.stringify(request.columns)]);
    await appendAuditEventWithClient(client,{organizationId:request.scope.organizationId,actor:{userId:request.scope.actorId},action:'COMPACT_CAPTURE_RECORDED',resourceType:'export_job',resourceId:request.jobId,
      details:{captureId:id,workspaceId:workspace.id,attemptId:input.lease.attemptId,observationReference:request.scope.observationReference,sourceRows:capture.manifest.rowCount,captureSha256:capture.manifest.sha256,schemaVersion:request.scope.schemaVersion}});
    input.signal?.throwIfAborted();await client.query('COMMIT');return {id,sha256:capture.manifest.sha256,rows:capture.manifest.rowCount,replayed:false};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
