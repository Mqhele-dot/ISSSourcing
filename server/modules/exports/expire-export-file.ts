import type {Pool} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import type {ExpiredExportFile} from './expired-export-files';
import {removeExportFile} from './export-file-store';
import {appendAuditEventWithClient} from '../../services/audit-chain-client';
import {inspectCompactRetainedFile} from './compact-workspaces';

/** One system retention command, not a repair API. Pin the CURRENT expired
 * generation before touching any file: retries may reuse a standard job ID.
 * Filesystem deletion cannot roll back. On any DB/audit failure metadata and
 * quota remain retained, and a later command retries already-absent files.
 */
export async function expireObservedExportFile(database:Pool,observed:ExpiredExportFile,remove:(filePath:string)=>void|Promise<void>=removeExportFile){
  if(![observed.id,observed.organizationId].every(n=>Number.isSafeInteger(n)&&n>0)||!observed.primaryFilePath||!Array.isArray(observed.filePaths)||observed.filePaths.length<1||observed.filePaths.length>10||observed.filePaths[0]!==observed.primaryFilePath||observed.filePaths.some(p=>typeof p!=='string'||!p||p.length>32768||p.includes('\0')))throw new Error('Retained export identity could not be verified. No files were removed.');
  const client=await database.connect();
  try{
    await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    const found=await client.query(`SELECT * FROM export_jobs WHERE id=$1 AND organization_id=$2 AND file_path=$3 AND retention_expires_at<clock_timestamp() FOR UPDATE SKIP LOCKED`,[observed.id,observed.organizationId,observed.primaryFilePath]);
    if(found.rowCount!==1){await client.query('COMMIT');return {status:'skipped' as const};}
    const job=found.rows[0];
    const schema=await client.query("SELECT to_regclass('public.export_artifacts') IS NOT NULL AS ready");
    const artifacts=schema.rows[0]?.ready?await client.query('SELECT file_path FROM export_artifacts WHERE job_id=$1 AND organization_id=$2 LIMIT 11',[observed.id,observed.organizationId]):{rows:[]};
    const current=[...new Set<string>([String(job.file_path),...artifacts.rows.map(row=>row.file_path)].filter((p):p is string=>typeof p==='string'&&p.length>0))];
    if(current.length>10||!isDeepStrictEqual([...current].sort(),[...new Set(observed.filePaths)].sort()))throw new Error('Retained export files changed. Retry discovery; no files were removed.');
    if(job.profile==='compact_excel'){
      const proof=await client.query('SELECT file_path,file_size,attempt_id FROM compact_export_publications WHERE job_id=$1 AND organization_id=$2',[observed.id,observed.organizationId]);
      if(proof.rowCount!==1||proof.rows[0].file_path!==job.file_path||String(proof.rows[0].file_size)!==String(job.file_size)||current.length!==1)throw new Error('Compact publication evidence is unavailable or inconsistent. Review its retained proof; no files were removed.');
      await inspectCompactRetainedFile(client,{organizationId:observed.organizationId,jobId:observed.id,attemptId:String(proof.rows[0].attempt_id),filePath:String(job.file_path)});
    }
    for(const filePath of current)await remove(filePath);
    const cleared=await client.query(`UPDATE export_jobs SET file_path=NULL,download_token=NULL,download_token_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND file_path=$3 RETURNING id`,[observed.id,observed.organizationId,observed.primaryFilePath]);
    if(cleared.rowCount!==1)throw new Error('Retained export changed before completion. Retry its recorded command.');
    if(job.profile==='compact_excel')await appendAuditEventWithClient(client,{organizationId:observed.organizationId,actor:{systemActor:'export-retention'},action:'COMPACT_EXPORT_FILE_EXPIRED',resourceType:'export_job',resourceId:observed.id,details:{reason:'retention_expired',recordedFileBytes:job.file_size===null?'unknown':String(job.file_size),fileCount:current.length}});
    await client.query('COMMIT');return {status:'expired' as const};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
