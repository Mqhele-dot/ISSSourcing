import type {Pool,PoolClient} from 'pg';
import {realpath,open,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {assertValidatedCompactResult,type CompactWorkerRequest,type CompactWorkerResult} from './compact-isolated-worker';
import {readCompactSpool} from './compact-capture-spool';
import {withCompactPublicationFence,type CompactLeaseIdentity} from './compact-export-leases';
import {assertCompactExportActorWithClient} from './export-actor-access';
import {appendAuditEventWithClient} from '../../services/audit-chain-client';

const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function requireValid(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message);}
function within(root:string,file:string){const relative=path.relative(root,file);return !!relative&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);}
type Policy={organizationRetainedBytes:number;totalRetainedBytes:number;retentionDays:number;tokenTtlMinutes:number};

/** Internal single-workbook publication, not an enabled route/feature. The
 * caller MUST supply current effective source/warehouse authorization using the
 * provided transaction client. This callback is not a replacement permission
 * service. File verification is outside the short DB transaction.
 * Quotas cover registered retained Compact workbooks, NOT unrelated files or
 * orphaned/private captures. Those retain their separate 2 GiB attempt budget.
 */
export async function publishCompactWorkbook(database:Pool,input:{root:string;lease:CompactLeaseIdentity;request:CompactWorkerRequest;result:CompactWorkerResult;policy:Policy;authorize:(client:PoolClient)=>Promise<void>;signal?:AbortSignal}){
  const {request,result,lease,policy}=input;
  requireValid(typeof input.authorize==='function','Current source access must be rechecked before publication.');
  requireValid(lease.organizationId===request.scope.organizationId&&Number.isSafeInteger(request.scope.actorId)&&request.scope.actorId>0,'Export ownership does not match its capture.');
  requireValid([policy.organizationRetainedBytes,policy.totalRetainedBytes].every(value=>Number.isSafeInteger(value)&&value>0)&&policy.organizationRetainedBytes<=policy.totalRetainedBytes&&Number.isInteger(policy.retentionDays)&&policy.retentionDays>=1&&policy.retentionDays<=365&&Number.isInteger(policy.tokenTtlMinutes)&&policy.tokenTtlMinutes>=1&&policy.tokenTtlMinutes<=55,'Choose a valid retained-workbook quota and retention policy.');
  assertValidatedCompactResult(result,request);input.signal?.throwIfAborted();
  requireValid(result.processedRows<=2147483647,'This workbook exceeds the supported job row count.');
  const capture=await readCompactSpool(request.captureDirectory,request.scope,input.signal);
  requireValid(capture.manifest.rowCount===result.processedRows&&capture.manifest.sha256===result.captureSha256,'The saved source no longer matches the validated workbook.');
  const base=await realpath(input.root),org=path.join(base,`org-${lease.organizationId}`),attempt=await realpath(result.attemptDirectory),directory=await realpath(result.directory),file=await realpath(result.filePath);
  requireValid(within(org,attempt)&&within(attempt,directory)&&within(directory,file)&&path.basename(file)===`job-${request.jobId}-compact.xlsx`,'The validated workbook is outside its owned organization attempt.');
  requireValid(!(await lstat(result.filePath)).isSymbolicLink(),'A retained workbook cannot be a symbolic link.');
  const handle=await open(file,'r');
  try{
    const before=await handle.stat();requireValid(before.isFile()&&before.size>0&&before.size===result.actualBytes&&before.size<100_000_000,'The complete workbook must remain unchanged and below 100 MB.');
    const hash=createHash('sha256');for await(const chunk of handle.createReadStream({start:0,autoClose:false})){input.signal?.throwIfAborted();hash.update(chunk);}
    requireValid(hash.digest('hex')===result.sha256,'The workbook changed after validation; no file was published.');
    const storedPath=path.relative(process.cwd(),file),fileName=`job-${request.jobId}-compact.xlsx`;
    const verifyFile=async()=>{input.signal?.throwIfAborted();const after=await handle.stat(),current=await lstat(file);requireValid(!current.isSymbolicLink()&&current.ino===before.ino&&after.size===before.size&&current.size===before.size&&after.mtimeMs===before.mtimeMs&&current.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&current.ctimeMs===before.ctimeMs,'The workbook changed before publication; retry its saved capture.');};
    const verifyJob=async(client:PoolClient)=>{
      const job=await client.query(`SELECT 1 FROM export_jobs WHERE id=$1 AND organization_id=$2 AND created_by=$3 AND profile='compact_excel' AND format='excel' AND dataset=$4 AND filters=$5::jsonb FOR UPDATE`,[request.jobId,lease.organizationId,request.scope.actorId,request.scope.dataset,JSON.stringify(request.scope.normalizedFilters)]);
      requireValid(job.rowCount===1,'The export job no longer matches its authorized capture.');
      await input.authorize(client);await verifyFile();
    };
    const replay=async()=>{
      const client=await database.connect();
      try{
        await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");
        const existing=await client.query(`SELECT p.* FROM compact_export_publications p JOIN export_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id JOIN compact_export_attempts a ON a.id=p.attempt_id AND a.organization_id=p.organization_id AND a.job_id=p.job_id WHERE p.job_id=$1 AND p.organization_id=$2 AND j.status='succeeded' AND a.lease_token=$3 AND a.stage='complete'`,[request.jobId,lease.organizationId,lease.leaseToken]);
        if(!existing.rowCount){await client.query('ROLLBACK');return null;}
        await verifyJob(client);const saved=existing.rows[0];
        requireValid(String(saved.attempt_id)===lease.attemptId&&saved.actor_id===request.scope.actorId&&saved.sha256===result.sha256&&saved.capture_sha256===capture.manifest.sha256&&saved.observation_reference===request.scope.observationReference&&saved.file_path===storedPath,'A published workbook cannot be replaced with different evidence.');
        await client.query('COMMIT');return {replayed:true};
      }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
    };
    const existing=await replay();if(existing)return existing;
    try{
      return await withCompactPublicationFence(database,lease,async(client,jobId)=>{
        requireValid(jobId===request.jobId,'The publication lease belongs to another job.');await verifyJob(client);
        // The publication fence serializes competing Compact writers. Expired
        // files still consume quota until the retention worker removes/clears
        // their job path; immutable publication evidence itself is retained.
        const usage=await client.query(`SELECT coalesce(sum(p.file_size) FILTER(WHERE p.organization_id=$1),0)::text org_bytes,coalesce(sum(p.file_size),0)::text total_bytes FROM compact_export_publications p JOIN export_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id WHERE j.file_path IS NOT NULL`,[lease.organizationId]);
        requireValid(BigInt(usage.rows[0].org_bytes)+BigInt(before.size)<=BigInt(policy.organizationRetainedBytes)&&BigInt(usage.rows[0].total_bytes)+BigInt(before.size)<=BigInt(policy.totalRetainedBytes),'Retained Compact workbooks exceed the storage quota. Remove expired files through governed retention or choose a smaller export.');
        await client.query(`INSERT INTO compact_export_publications(job_id,organization_id,actor_id,attempt_id,observation_reference,dataset,schema_version,normalized_filters,selected_columns,source_information,capture_sha256,writer_version,validator_version,file_name,file_path,file_size,sha256,source_row_count,data_sheet_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,[request.jobId,lease.organizationId,request.scope.actorId,lease.attemptId,request.scope.observationReference,request.scope.dataset,request.scope.schemaVersion,JSON.stringify(request.scope.normalizedFilters),JSON.stringify(request.columns),JSON.stringify(capture.manifest.sourceInformation??{}),capture.manifest.sha256,result.writerVersion,result.validation.validatorVersion,fileName,storedPath,before.size,result.sha256,result.processedRows,result.sheetCount]);
        await client.query(`UPDATE export_jobs SET status='succeeded',file_name=$3,file_path=$4,file_size=$5,mime_type=$6,row_count=$7,download_token=$8,download_token_expires_at=clock_timestamp()+$9*interval '1 minute',retention_expires_at=clock_timestamp()+$10*interval '1 day',completed_at=clock_timestamp(),updated_at=clock_timestamp(),last_error=NULL WHERE id=$1 AND organization_id=$2`,[request.jobId,lease.organizationId,fileName,storedPath,before.size,mime,result.processedRows,randomBytes(24).toString('hex'),policy.tokenTtlMinutes,policy.retentionDays]);
        await appendAuditEventWithClient(client,{organizationId:lease.organizationId,actor:{userId:request.scope.actorId},action:'COMPACT_WORKBOOK_PUBLISHED',resourceType:'export_job',resourceId:request.jobId,
          details:{attemptId:lease.attemptId,observationReference:request.scope.observationReference,sourceRows:result.processedRows,captureSha256:capture.manifest.sha256,sha256:result.sha256,bytes:before.size,writerVersion:result.writerVersion,validatorVersion:result.validation.validatorVersion}});
        await verifyFile();return {replayed:false};
      });
    }catch(error){const replayed=await replay();if(replayed)return replayed;throw error;}
  }finally{await handle.close();}
}

/** Production-facing private publication entry. Callers cannot supply/bypass
 * authorization. Public Compact routes stay disabled until the whole pipeline,
 * lifecycle, UI and benchmarks pass their separate release gates.
 */
export async function publishAuthorizedCompactWorkbook(database:Pool,input:Omit<Parameters<typeof publishCompactWorkbook>[1],'authorize'>){
  return publishCompactWorkbook(database,{...input,authorize:async client=>{
    await assertCompactExportActorWithClient(client,{organizationId:input.request.scope.organizationId,userId:input.request.scope.actorId,dataset:input.request.scope.dataset,filters:input.request.scope.normalizedFilters},true);
  }});
}
