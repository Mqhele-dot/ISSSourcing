import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {lstat,realpath,mkdir,writeFile,readFile,opendir,rm} from 'node:fs/promises';
import path from 'node:path';
import type {CompactLeaseIdentity} from './compact-export-leases';
import {lockCompactDecisions} from './compact-decision-lock';
import {checkCompactStorageCapacity} from './compact-storage-capacity';
import {appendAuditEventWithClient} from '../../services/audit-chain-client';

type Workspace={id:string;attempt_id:string;job_id:number;organization_id:number;actor_id:number;storage_id:string;storage_root:string;marker_nonce:string;reserved_bytes:string;state:string};
type Storage={root:string;storageId:string};
const quietPeriodMinutes=35; // Full 30-minute worker deadline plus a five-minute crash/reaping margin.
function validStorage(input:Storage){if(!/^[A-Za-z0-9-]{1,100}$/.test(input.storageId)||!path.isAbsolute(input.root))throw new Error('Choose an absolute private storage root and a stable storage identity.');}
function validId(id:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid workspace identity.');}
function requireValid(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function transaction<T>(database:Pool,run:(client:PoolClient)=>Promise<T>){
  const client=await database.connect();
  try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");await lockCompactDecisions(client);const result=await run(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
async function storageRoot(input:Storage){
  validStorage(input);const stat=await lstat(input.root);
  requireValid(stat.isDirectory()&&!stat.isSymbolicLink(),'Private storage must be a real directory, not a link.');
  return realpath(input.root);
}
function locations(workspace:Workspace){
  validId(workspace.id);requireValid(Number.isSafeInteger(workspace.organization_id)&&workspace.organization_id>0,'Invalid workspace ownership.');
  const organization=path.join(workspace.storage_root,`org-${workspace.organization_id}`),directory=path.join(organization,`workspace-${workspace.id}`);
  return {organization,directory,captureRoot:path.join(directory,'captures'),outputRoot:path.join(directory,'outputs')};
}
function marker(workspace:Workspace){return JSON.stringify({version:1,id:workspace.id,organizationId:workspace.organization_id,jobId:workspace.job_id,attemptId:String(workspace.attempt_id),nonce:workspace.marker_nonce});}
async function realDirectory(directory:string){const stat=await lstat(directory);requireValid(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(directory)===directory,'Workspace directory ownership could not be confirmed.');}
async function ownedMarker(workspace:Workspace){
  const {organization,directory}=locations(workspace);await realDirectory(workspace.storage_root);await realDirectory(organization);await realDirectory(directory);
  const file=path.join(directory,'.compact-workspace.json'),stat=await lstat(file);
  requireValid(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1024,'Workspace ownership marker is not valid.');
  requireValid(await readFile(file,'utf8')===marker(workspace),'Workspace ownership marker does not match its durable record.');
}
function view(workspace:Workspace){return {id:workspace.id,jobId:workspace.job_id,organizationId:workspace.organization_id,reservedBytes:workspace.reserved_bytes,...locations(workspace)};}

/** Private lifecycle primitive. Reserve capacity BEFORE creating files. This
 * does not authorize source reads, claim a job, start a worker or enable a route.
 * A storage identity denotes the same private physical root across restarts.
 */
export async function registerCompactWorkspace(database:Pool,input:Storage&{lease:CompactLeaseIdentity;jobId:number;actorId:number;dataset:string;filters:Record<string,unknown>;reservedBytes:number;organizationQuotaBytes:number;totalQuotaBytes:number}){
  const root=await storageRoot(input);
  requireValid([input.jobId,input.actorId,input.lease.organizationId].every(n=>Number.isSafeInteger(n)&&n>0),'Invalid workspace owner.');
  requireValid([input.reservedBytes,input.organizationQuotaBytes,input.totalQuotaBytes].every(n=>Number.isSafeInteger(n)&&n>0)&&input.reservedBytes<=2*1024**3&&input.reservedBytes<=input.organizationQuotaBytes&&input.organizationQuotaBytes<=input.totalQuotaBytes,'Choose valid private workspace capacity limits.');
  const workspace=await transaction(database,async client=>{
    const job=await client.query(`SELECT a.id FROM compact_export_attempts a JOIN export_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
      WHERE a.id=$1 AND a.organization_id=$2 AND a.lease_token=$3 AND a.finished_at IS NULL AND a.lease_until>clock_timestamp()
        AND j.id=$4 AND j.created_by=$5 AND j.dataset=$6 AND j.filters=$7::jsonb AND j.profile='compact_excel' AND j.format='excel' AND j.status='running' FOR UPDATE OF a,j`,[input.lease.attemptId,input.lease.organizationId,input.lease.leaseToken,input.jobId,input.actorId,input.dataset,JSON.stringify(input.filters)]);
    requireValid(job.rowCount===1,'The workspace does not match an active authorized export lease.');
    const existing=await client.query('SELECT * FROM compact_export_workspaces WHERE attempt_id=$1 FOR UPDATE',[input.lease.attemptId]);
    if(existing.rowCount){const saved=existing.rows[0] as Workspace;requireValid(saved.storage_id===input.storageId&&saved.storage_root===root&&BigInt(saved.reserved_bytes)===BigInt(input.reservedBytes)&&['registered','ready'].includes(saved.state),'An existing workspace cannot be rebound or reused after cleanup.');return saved;}
    const roots=await client.query("SELECT 1 FROM compact_export_workspaces WHERE (storage_id=$1 AND storage_root<>$2 OR storage_root=$2 AND storage_id<>$1) AND state<>'removed' LIMIT 1",[input.storageId,root]);
    requireValid(!roots.rowCount,'This storage identity already belongs to a different private root, or this root belongs to another storage identity.');
    // Quotas belong to this installation/tenant, not a path or storage ID. A
    // second configured root must not reset either budget. The global Compact
    // decision lock also serializes admission across those roots/processes.
    const usage=await client.query(`SELECT coalesce(sum(reserved_bytes) FILTER(WHERE organization_id=$1),0)::text org_bytes,coalesce(sum(reserved_bytes),0)::text total_bytes FROM compact_export_workspaces WHERE state<>'removed'`,[input.lease.organizationId]);
    requireValid(BigInt(usage.rows[0].org_bytes)+BigInt(input.reservedBytes)<=BigInt(input.organizationQuotaBytes)&&BigInt(usage.rows[0].total_bytes)+BigInt(input.reservedBytes)<=BigInt(input.totalQuotaBytes),'Private export storage is full. Wait for governed cleanup or choose a smaller export.');
    // Serialized with quota admission, before durable registration or mkdir.
    // Full outstanding budgets, including other roots/volumes, deliberately
    // over-count disk usage. This can refuse conservatively; it cannot promise
    // an OS reservation or account for unrelated applications/databases.
    await checkCompactStorageCapacity(root,BigInt(usage.rows[0].total_bytes),BigInt(input.reservedBytes));
    return(await client.query(`INSERT INTO compact_export_workspaces(id,attempt_id,job_id,organization_id,actor_id,storage_id,storage_root,marker_nonce,reserved_bytes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[randomUUID(),input.lease.attemptId,input.jobId,input.lease.organizationId,input.actorId,input.storageId,root,randomUUID(),input.reservedBytes])).rows[0] as Workspace;
  });
  // A process crash here leaves a durable reservation, including before mkdir.
  const {organization,directory,captureRoot,outputRoot}=locations(workspace);
  await mkdir(organization,{recursive:true,mode:0o700});await realDirectory(organization);
  await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await realDirectory(directory);
  await writeFile(path.join(directory,'.compact-workspace.json'),marker(workspace),{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await ownedMarker(workspace);
  for(const child of [captureRoot,outputRoot]){await mkdir(child,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await realDirectory(child);}
  const ready=await database.query(`UPDATE compact_export_workspaces w SET state='ready',updated_at=clock_timestamp() FROM compact_export_attempts a JOIN export_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
    WHERE w.id=$1 AND w.attempt_id=a.id AND a.lease_token=$2 AND a.finished_at IS NULL AND a.lease_until>clock_timestamp() AND j.status='running' AND j.profile='compact_excel' AND j.format='excel'
      AND j.created_by=$3 AND j.dataset=$4 AND j.filters=$5::jsonb AND w.state IN ('registered','ready') RETURNING w.id`,[workspace.id,input.lease.leaseToken,input.actorId,input.dataset,JSON.stringify(input.filters)]);
  requireValid(ready.rowCount===1,'The export stopped while its workspace was prepared. Its reservation remains recorded for safe cleanup.');
  return view(workspace);
}

/** Only a current lease may reuse a registered ready workspace. No arbitrary
 * path from a caller or capture manifest is accepted as workspace ownership.
 */
export async function inspectCompactWorkspace(database:Pool,input:Storage&{lease:CompactLeaseIdentity;workspaceId:string}){
  validId(input.workspaceId);const root=await storageRoot(input);
  const result=await database.query(`SELECT w.* FROM compact_export_workspaces w JOIN compact_export_attempts a ON a.id=w.attempt_id AND a.job_id=w.job_id AND a.organization_id=w.organization_id
    JOIN export_jobs j ON j.id=w.job_id AND j.organization_id=w.organization_id
    WHERE w.id=$1 AND w.organization_id=$2 AND w.attempt_id=$3 AND a.lease_token=$4 AND a.finished_at IS NULL AND a.lease_until>clock_timestamp()
      AND w.storage_id=$5 AND w.storage_root=$6 AND w.state='ready' AND j.status='running' AND j.profile='compact_excel' AND j.format='excel' AND j.created_by=w.actor_id`,[input.workspaceId,input.lease.organizationId,input.lease.attemptId,input.lease.leaseToken,input.storageId,root]);
  requireValid(result.rowCount===1,'This workspace is not available to the current export lease.');const workspace=result.rows[0] as Workspace;await ownedMarker(workspace);return view(workspace);
}

/** Source-only workspace access for a new attempt of the SAME job. Current
 * source permissions must be checked by the orchestrator before calling this.
 * Queued/running jobs and all recent attempts pin their older workspaces.
 */
export async function inspectCompactRetryWorkspace(database:Pool,input:Storage&{lease:CompactLeaseIdentity;workspaceId:string;jobId:number;actorId:number}){
  validId(input.workspaceId);const root=await storageRoot(input);
  const result=await database.query(`SELECT w.* FROM compact_export_workspaces w
    JOIN export_jobs j ON j.id=w.job_id AND j.organization_id=w.organization_id
    JOIN compact_export_attempts a ON a.job_id=j.id AND a.organization_id=j.organization_id
    WHERE w.id=$1 AND w.organization_id=$2 AND w.storage_id=$3 AND w.storage_root=$4 AND w.state='ready'
      AND j.id=$5 AND j.created_by=$6 AND w.actor_id=$6 AND j.profile='compact_excel' AND j.format='excel' AND j.status='running'
      AND a.id=$7 AND a.lease_token=$8 AND a.finished_at IS NULL AND a.lease_until>clock_timestamp()`,[input.workspaceId,input.lease.organizationId,input.storageId,root,input.jobId,input.actorId,input.lease.attemptId,input.lease.leaseToken]);
  requireValid(result.rowCount===1,'The saved capture workspace is no longer available to this export attempt. No live source was read.');
  const workspace=result.rows[0] as Workspace;await ownedMarker(workspace);
  for(const child of [locations(workspace).captureRoot,locations(workspace).outputRoot])await realDirectory(child);
  return view(workspace);
}

/** A completed publication has no active generation lease. Its job row is
 * locked by the retention command, which prevents workspace cleanup becoming
 * eligible until expiry commits. Verify the immutable workspace and EVERY
 * parent before unlinking; a changed cwd or linked parent must not be treated
 * as a missing file and falsely release quota. No arbitrary folder scan occurs.
 */
export async function inspectCompactRetainedFile(client:Pick<PoolClient,'query'>,input:{organizationId:number;jobId:number;attemptId:string;filePath:string}){
  const result=await client.query(`SELECT w.* FROM compact_export_workspaces w WHERE w.organization_id=$1 AND w.job_id=$2 AND w.attempt_id=$3 AND w.state='ready'`,[input.organizationId,input.jobId,input.attemptId]);
  requireValid(result.rowCount===1,'Retained workbook ownership could not be confirmed. Review its private workspace; no files were removed.');
  const workspace=result.rows[0] as Workspace,{outputRoot}=locations(workspace),absolute=path.resolve(input.filePath),relative=path.relative(outputRoot,absolute);
  requireValid(relative!==''&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative)&&path.basename(absolute)===`job-${input.jobId}-compact.xlsx`,'The retained file is outside its owned workspace. Review the storage configuration; no files were removed.');
  await ownedMarker(workspace);
  const parents=relative.split(path.sep).slice(0,-1);requireValid(parents.length<=32,'Retained-file nesting requires operator review.');
  let directory=outputRoot;await realDirectory(directory);for(const segment of parents){directory=path.join(directory,segment);await realDirectory(directory);}
}

/** Non-mutating, bounded discovery; never scans folders to infer ownership. */
export async function listCompactCleanupCandidates(database:Pool,input:Storage&{limit?:number}){
  const root=await storageRoot(input),limit=input.limit??25;requireValid([25,50,100].includes(limit),'Choose a cleanup page size of 25, 50 or 100.');
  const result=await database.query(`SELECT w.id,w.organization_id FROM compact_export_workspaces w JOIN compact_export_attempts a ON a.id=w.attempt_id JOIN export_jobs j ON j.id=w.job_id AND j.organization_id=w.organization_id
    WHERE w.storage_id=$1 AND w.storage_root=$2 AND w.state<>'removed' AND a.finished_at<clock_timestamp()-interval '35 minutes' AND j.status NOT IN ('queued','running') AND j.file_path IS NULL
      AND NOT EXISTS(SELECT 1 FROM compact_export_attempts recent WHERE recent.job_id=w.job_id AND recent.organization_id=w.organization_id AND (recent.finished_at IS NULL OR recent.finished_at>=clock_timestamp()-interval '35 minutes'))
      AND (w.state<>'cleanup_claimed' OR w.cleanup_until<=clock_timestamp()) ORDER BY w.updated_at,w.id LIMIT $3`,[input.storageId,root,limit]);
  return result.rows as Array<{id:string;organization_id:number}>;
}

/** Refuse any link/special file before recursive removal. Workspaces are private,
 * service-owned directories, not writable by untrusted local processes. */
async function checkTree(directory:string,budget:{remaining:number},depth=0):Promise<void>{
  requireValid(depth<=32,'Workspace cleanup nesting exceeds the safe bound.');
  const iterator=await opendir(directory);
  for await(const entry of iterator){requireValid(--budget.remaining>=0,'Workspace cleanup requires operator review because it exceeds the safe entry bound.');const file=path.join(directory,entry.name),stat=await lstat(file);requireValid(!stat.isSymbolicLink()&&(stat.isDirectory()||stat.isFile()),'Workspace cleanup refuses linked or special files.');if(stat.isDirectory())await checkTree(file,budget,depth+1);}
}

/** Exact recorded path only; no recursive delete of roots, orgs or unknown dirs.
 * After lease completion wait beyond the complete worker deadline before cleanup.
 * Published workbooks remain protected until normal retention clears file_path.
 */
export async function cleanupCompactWorkspace(database:Pool,input:Storage&{workspaceId:string;organizationId:number}){
  validId(input.workspaceId);const root=await storageRoot(input);requireValid(Number.isSafeInteger(input.organizationId)&&input.organizationId>0,'Invalid cleanup tenant.');
  const token=randomUUID();
  const workspace=await transaction(database,async client=>{
    const result=await client.query(`SELECT w.* FROM compact_export_workspaces w JOIN compact_export_attempts a ON a.id=w.attempt_id JOIN export_jobs j ON j.id=w.job_id AND j.organization_id=w.organization_id
      WHERE w.id=$1 AND w.organization_id=$2 AND w.storage_id=$3 AND w.storage_root=$4 FOR UPDATE OF w,a,j`,[input.workspaceId,input.organizationId,input.storageId,root]);
    if(!result.rowCount)return null;const saved=result.rows[0] as Workspace;if(saved.state==='removed')return saved;
    const eligible=await client.query(`SELECT 1 FROM compact_export_workspaces w JOIN compact_export_attempts a ON a.id=w.attempt_id JOIN export_jobs j ON j.id=w.job_id AND j.organization_id=w.organization_id
      WHERE w.id=$1 AND a.finished_at<clock_timestamp()-$2*interval '1 minute' AND j.status NOT IN ('queued','running') AND j.file_path IS NULL
        AND NOT EXISTS(SELECT 1 FROM compact_export_attempts recent WHERE recent.job_id=w.job_id AND recent.organization_id=w.organization_id AND (recent.finished_at IS NULL OR recent.finished_at>=clock_timestamp()-$2*interval '1 minute'))
        AND (w.state<>'cleanup_claimed' OR w.cleanup_until<=clock_timestamp())`,[saved.id,quietPeriodMinutes]);
    if(!eligible.rowCount)return null;
    return(await client.query(`UPDATE compact_export_workspaces SET state='cleanup_claimed',cleanup_token=$2,cleanup_until=clock_timestamp()+interval '5 minutes',cleanup_attempts=cleanup_attempts+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[saved.id,token])).rows[0] as Workspace;
  });
  if(!workspace)return {status:'not_eligible' as const};if(workspace.state==='removed')return {status:'removed' as const,replayed:true};
  let code:'ownership_mismatch'|'filesystem_failure'='ownership_mismatch';
  try{
    const {organization,directory}=locations(workspace);await realDirectory(root);
    let exists=true;
    try{await lstat(organization);await realDirectory(organization);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')exists=false;else throw error;}
    if(exists)try{await lstat(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')exists=false;else throw error;}
    if(exists){await ownedMarker(workspace);await checkTree(directory,{remaining:10000});await ownedMarker(workspace);
      const owned=await database.query("SELECT 1 FROM compact_export_workspaces WHERE id=$1 AND state='cleanup_claimed' AND cleanup_token=$2 AND cleanup_until>clock_timestamp()",[workspace.id,token]);requireValid(owned.rowCount===1,'Cleanup claim expired before removal.');
      code='filesystem_failure';await rm(directory,{recursive:true,force:false,maxRetries:2,retryDelay:100});
    }
    await transaction(database,async client=>{
      const finished=await client.query(`UPDATE compact_export_workspaces SET state='removed',removed_at=clock_timestamp(),updated_at=clock_timestamp(),cleanup_token=NULL,cleanup_until=NULL,last_cleanup_code=NULL WHERE id=$1 AND state='cleanup_claimed' AND cleanup_token=$2 RETURNING id`,[workspace.id,token]);
      requireValid(finished.rowCount===1,'The cleanup claim changed before completion.');
      await appendAuditEventWithClient(client,{organizationId:workspace.organization_id,actor:{systemActor:'compact-export-maintenance'},action:'COMPACT_WORKSPACE_REMOVED',resourceType:'export_job',resourceId:workspace.job_id,details:{workspaceId:workspace.id,attemptId:String(workspace.attempt_id),releasedReservationBytes:String(workspace.reserved_bytes)}});
    });return {status:'removed' as const,replayed:false};
  }catch{
    await database.query(`UPDATE compact_export_workspaces SET state='cleanup_blocked',last_cleanup_code=$3,cleanup_token=NULL,cleanup_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND state='cleanup_claimed' AND cleanup_token=$2`,[workspace.id,token,code]);
    return {status:'blocked' as const,code};
  }
}
