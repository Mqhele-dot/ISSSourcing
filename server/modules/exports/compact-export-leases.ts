import type {Pool,PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import {lockCompactDecisions} from './compact-decision-lock';
import {appendAuditEventWithClient} from '../../services/audit-chain-client';

function scope(organizationId:number,serverId?:string){
  if(!Number.isSafeInteger(organizationId)||organizationId<1||serverId!==undefined&&(!serverId||serverId.length>100))throw new Error("Invalid compact worker scope.");
}
async function transaction<T>(database:Pool,action:(client:PoolClient)=>Promise<T>){
  const client=await database.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'");
    // Serialize only short scheduling decisions, never file generation.
    await lockCompactDecisions(client);
    const result=await action(client);await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function expireCompactLeases(database:Pool){
  return transaction(database,async client=>{
    const expired=await client.query(`UPDATE compact_export_attempts SET stage='interrupted',finished_at=clock_timestamp()
      WHERE id IN(SELECT id FROM compact_export_attempts WHERE finished_at IS NULL AND lease_until<=clock_timestamp() ORDER BY lease_until,id LIMIT 100 FOR UPDATE SKIP LOCKED)
      RETURNING job_id,organization_id`);
    for(const row of expired.rows)await client.query(`UPDATE export_jobs SET status='failed',last_error=$3,completed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=$1 AND organization_id=$2 AND profile='compact_excel' AND status='running'`,[row.job_id,row.organization_id,JSON.stringify({code:"COMPACT_WORKER_INTERRUPTED",message:"Export generation stopped before completion. Retry the saved capture; no file was published."})]);
    return expired.rowCount??0;
  });
}
export async function claimCompactLease(database:Pool,input:{organizationId:number;serverId:string;leaseSeconds?:number}){
  scope(input.organizationId,input.serverId);const seconds=input.leaseSeconds??30;
  if(!Number.isInteger(seconds)||seconds<10||seconds>120)throw new Error("Choose a lease duration between 10 and 120 seconds.");
  return transaction(database,async client=>{
    const busy=await client.query("SELECT 1 FROM compact_export_attempts WHERE finished_at IS NULL AND (organization_id=$1 OR server_id=$2) LIMIT 1",[input.organizationId,input.serverId]);
    if(busy.rowCount)return null;
    const job=await client.query(`SELECT id FROM export_jobs WHERE organization_id=$1 AND profile='compact_excel' AND format='excel' AND status='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[input.organizationId]);
    if(!job.rowCount)return null;
    const token=randomUUID();
    const attempt=await client.query(`INSERT INTO compact_export_attempts(job_id,organization_id,server_id,lease_token,stage,lease_until)
      VALUES($1,$2,$3,$4,'capturing',clock_timestamp()+$5*interval '1 second') RETURNING id::text,job_id,organization_id,lease_token,lease_until`,[job.rows[0].id,input.organizationId,input.serverId,token,seconds]);
    await client.query("UPDATE export_jobs SET status='running',attempts=attempts+1,started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2",[job.rows[0].id,input.organizationId]);
    return attempt.rows[0] as {id:string;job_id:number;organization_id:number;lease_token:string;lease_until:Date};
  });
}
export async function heartbeatCompactLease(database:Pick<Pool,'query'>,input:{organizationId:number;attemptId:string;leaseToken:string;stage:'capturing'|'writing'|'validating';binding?:{jobId:number;actorId:number;dataset:string;filters:Record<string,unknown>}}){
  scope(input.organizationId);
  if(!['capturing','writing','validating'].includes(input.stage))throw new Error("Invalid generation stage.");
  const result=await database.query(`UPDATE compact_export_attempts a SET heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '30 seconds',stage=$4
    FROM export_jobs j WHERE a.id=$1 AND a.organization_id=$2 AND a.lease_token=$3 AND a.finished_at IS NULL AND a.lease_until>clock_timestamp()
      AND j.id=a.job_id AND j.organization_id=a.organization_id AND j.profile='compact_excel' AND j.status='running' AND j.format='excel'
      ${input.binding?'AND j.id=$5 AND j.created_by=$6 AND j.dataset=$7 AND j.filters=$8::jsonb':''}
      AND (a.stage=$4 OR a.stage='capturing' AND $4='writing' OR a.stage='writing' AND $4='validating') RETURNING a.id`,[input.attemptId,input.organizationId,input.leaseToken,input.stage,...(input.binding?[input.binding.jobId,input.binding.actorId,input.binding.dataset,JSON.stringify(input.binding.filters)]:[])]);
  return result.rowCount===1;
}
/** Caller must derive user/organization from the authenticated session. */
export async function cancelCompactJob(database:Pool,input:{organizationId:number;actorId:number;jobId:number}){
  scope(input.organizationId);
  if(!Number.isSafeInteger(input.actorId)||input.actorId<1||!Number.isSafeInteger(input.jobId)||input.jobId<1)throw new Error("Invalid cancellation scope.");
  return transaction(database,async client=>{
    const job=await client.query(`UPDATE export_jobs SET status='failed',last_error=$4,completed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=$1 AND organization_id=$2 AND created_by=$3 AND profile='compact_excel' AND status IN ('queued','running') RETURNING id`,[input.jobId,input.organizationId,input.actorId,JSON.stringify({code:"COMPACT_WORKER_CANCELLED",message:"Export generation was cancelled. No file was published."})]);
    if(!job.rowCount)return false;
    await client.query("UPDATE compact_export_attempts SET stage='cancelled',finished_at=clock_timestamp() WHERE job_id=$1 AND organization_id=$2 AND finished_at IS NULL",[input.jobId,input.organizationId]);
    await appendAuditEventWithClient(client,{organizationId:input.organizationId,actor:{userId:input.actorId},action:'COMPACT_EXPORT_CANCELLED',resourceType:'export_job',resourceId:input.jobId,
      details:{outcome:'cancelled',publication:'none'}});
    return true;
  });
}

export type CompactLeaseIdentity={organizationId:number;attemptId:string;leaseToken:string};
/** Storage fence only, not a workbook validator. The trusted caller must validate
 * and recheck effective access before publication. No hashing, file copying or
 * compression belongs inside this short transaction; final descriptor/path
 * identity checks are permitted alongside transaction-aware access checks.
 */
export async function withCompactPublicationFence<T>(database:Pool,lease:CompactLeaseIdentity,publish:(client:PoolClient,jobId:number)=>Promise<T>){
  scope(lease.organizationId);
  return transaction(database,async client=>{
    const row=await client.query(`SELECT a.job_id FROM compact_export_attempts a JOIN export_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
      WHERE a.id=$1 AND a.organization_id=$2 AND a.lease_token=$3 AND a.stage='validating' AND a.finished_at IS NULL
      AND a.lease_until>clock_timestamp() AND j.profile='compact_excel' AND j.status='running' FOR UPDATE OF a,j`,[lease.attemptId,lease.organizationId,lease.leaseToken]);
    if(!row.rowCount)throw new Error("The export lease is no longer valid. No file was published.");
    const result=await publish(client,Number(row.rows[0].job_id));
    const job=await client.query(`SELECT 1 FROM export_jobs WHERE id=$1 AND organization_id=$2 AND status='succeeded'
      AND file_path IS NOT NULL AND file_size>0 AND file_size<100000000 AND mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`,[row.rows[0].job_id,lease.organizationId]);
    if(!job.rowCount)throw new Error("The complete workbook publication metadata is not valid.");
    // Recheck time after writes too: a slow publication must not outlive its lease.
    const finished=await client.query("UPDATE compact_export_attempts SET stage='complete',finished_at=clock_timestamp() WHERE id=$1 AND lease_until>clock_timestamp() RETURNING id",[lease.attemptId]);
    if(!finished.rowCount)throw new Error("The export lease expired before publication completed.");
    return result;
  });
}

export async function failCompactLease(database:Pool,lease:CompactLeaseIdentity,stage:'refused'|'interrupted'){
  scope(lease.organizationId);
  return transaction(database,async client=>{
    const attempt=await client.query(`UPDATE compact_export_attempts SET stage=$4,finished_at=clock_timestamp()
      WHERE id=$1 AND organization_id=$2 AND lease_token=$3 AND finished_at IS NULL AND lease_until>clock_timestamp() RETURNING job_id`,[lease.attemptId,lease.organizationId,lease.leaseToken,stage]);
    if(!attempt.rowCount)return false;
    const message=stage==='refused'?"The complete export could not be generated safely. Review the selected fields and scope; no file was published.":"Export generation was interrupted. Retry the saved capture; no file was published.";
    await client.query("UPDATE export_jobs SET status='failed',last_error=$3,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND status='running'",[attempt.rows[0].job_id,lease.organizationId,JSON.stringify({code:stage==='refused'?'COMPACT_WORKER_REFUSED':'COMPACT_WORKER_INTERRUPTED',message})]);
    return true;
  });
}
