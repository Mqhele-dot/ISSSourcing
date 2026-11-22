import {createReadStream} from "node:fs";
import {realpath,stat,open} from "node:fs/promises";
import path from "node:path";
import {createHash,randomBytes} from "node:crypto";
import type {Pool} from "pg";

const xlsxMime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export type ExportArtifactInput={kind:"summary"|"archive";relativePath:string;fileName:string;mimeType:string};
export type StoredExportArtifact={jobId:number;kind:"summary"|"archive";snapshotReference:string;fileName:string;filePath:string;mimeType:string;fileSize:number;sha256:string;sourceRowCount:string};
type VerifiedArtifact=ExportArtifactInput&{fileSize:number;sha256:string;storedPath:string};
function contained(root:string,file:string){const relative=path.relative(root,file);return relative!==""&&!relative.startsWith(`..${path.sep}`)&&relative!==".."&&!path.isAbsolute(relative);}

export async function readExportArtifacts(database:Pick<Pool,"query">,organizationId:number,jobIds:number[]):Promise<StoredExportArtifact[]>{
  if(!jobIds.length)return [];
  if(jobIds.length>100||jobIds.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error("Choose a bounded export job list.");
  const ready=await database.query("SELECT to_regclass('public.export_artifacts') IS NOT NULL AS ready");
  if(!ready.rows[0]?.ready)return [];
  const result=await database.query(`SELECT job_id,kind,snapshot_reference,file_name,file_path,mime_type,file_size::text,sha256,source_row_count::text
    FROM export_artifacts WHERE organization_id=$1 AND job_id=ANY($2::int[]) ORDER BY job_id,CASE WHEN kind='summary' THEN 0 ELSE 1 END`,[organizationId,jobIds]);
  return result.rows.map(row=>({jobId:Number(row.job_id),kind:row.kind,snapshotReference:row.snapshot_reference,fileName:row.file_name,filePath:row.file_path,
    mimeType:row.mime_type,fileSize:Number(row.file_size),sha256:row.sha256,sourceRowCount:row.source_row_count}));
}

/** Verify and stream the same open file descriptor; never buffer a large archive. */
export async function openVerifiedExportArtifact(root:string,organizationId:number,artifact:Pick<StoredExportArtifact,'jobId'|'filePath'|'fileSize'|'sha256'>){
  const base=await realpath(root),organizationRoot=path.join(base,`org-${organizationId}`);
  const canonical=await realpath(path.resolve(process.cwd(),artifact.filePath));
  if(!contained(organizationRoot,canonical)||!path.basename(canonical).startsWith(`job-${artifact.jobId}-`))throw new Error("Export file ownership could not be verified.");
  const handle=await open(canonical,"r");
  try{
    const before=await handle.stat();
    if(!before.isFile()||before.size!==artifact.fileSize)throw new Error("Export file no longer matches its saved evidence.");
    const hash=createHash("sha256");
    for await(const chunk of handle.createReadStream({start:0,autoClose:false}))hash.update(chunk);
    const after=await handle.stat();
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||hash.digest("hex")!==artifact.sha256)throw new Error("Export file no longer matches its saved evidence.");
    return handle.createReadStream({start:0,autoClose:true});
  }catch(error){await handle.close();throw error;}
}

async function verifyArtifact(root:string,organizationId:number,jobId:number,input:ExportArtifactInput):Promise<VerifiedArtifact>{
  if(!["summary","archive"].includes(input.kind)||/[\u0000-\u001f\u007f/\\"]/.test(input.fileName)||!input.fileName.trim())throw new Error("Invalid export artifact metadata.");
  if(input.kind==="summary"?input.mimeType!==xlsxMime:!["application/zip","application/gzip"].includes(input.mimeType))throw new Error("Invalid export artifact type.");
  const suffix=input.kind==="summary"?".xlsx":input.mimeType==="application/zip"?".zip":".gz";
  if(!input.fileName.toLowerCase().endsWith(suffix))throw new Error("Export artifact filename does not match its type.");
  const base=await realpath(root),organizationRoot=path.join(base,`org-${organizationId}`);
  const resolved=path.resolve(base,input.relativePath);
  if(!contained(organizationRoot,resolved)||!path.basename(resolved).startsWith(`job-${jobId}-`))throw new Error("Export artifact is outside its owned job directory.");
  const canonical=await realpath(resolved);
  if(!contained(organizationRoot,canonical)||!contained(base,canonical))throw new Error("Export artifact resolves outside its organization.");
  const before=await stat(canonical);
  if(!before.isFile()||before.size<1)throw new Error("Export artifact is empty or unavailable.");
  if(input.kind==="summary"&&before.size>=100_000_000)throw new Error("The summary workbook must be smaller than 100 MB.");
  const hash=createHash("sha256");
  for await(const chunk of createReadStream(canonical))hash.update(chunk);
  const after=await stat(canonical);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||before.ino!==after.ino)throw new Error("Export artifact changed during verification.");
  return {...input,fileSize:after.size,sha256:hash.digest("hex"),storedPath:path.relative(process.cwd(),canonical)};
}

/** Both files are generated/validated by the writer before this metadata publication.
 * Uses a dedicated connection/transaction, never a caller's business transaction.
 * No business tables are written.
 */
export async function publishExportPair(database:Pool,input:{root:string;organizationId:number;jobId:number;snapshotReference:string;sourceRowCount:number;tokenTtlMinutes:number;retentionDays:number;artifacts:ExportArtifactInput[]}){
  if(!Number.isSafeInteger(input.organizationId)||input.organizationId<1||!Number.isSafeInteger(input.jobId)||input.jobId<1||!Number.isSafeInteger(input.sourceRowCount)||input.sourceRowCount<0||input.sourceRowCount>2147483647)throw new Error("Invalid export publication scope.");
  if(!input.snapshotReference.trim()||input.snapshotReference.length>200||input.artifacts.length!==2||new Set(input.artifacts.map(file=>file.kind)).size!==2)throw new Error("A summary and full-detail archive from one snapshot are required.");
  if(!Number.isFinite(input.tokenTtlMinutes)||input.tokenTtlMinutes<=0||input.tokenTtlMinutes>55||!Number.isFinite(input.retentionDays)||input.retentionDays<=0)throw new Error("Invalid export retention policy.");
  const artifacts:VerifiedArtifact[]=[];
  for(const file of input.artifacts)artifacts.push(await verifyArtifact(input.root,input.organizationId,input.jobId,file));
  if(artifacts[0].storedPath===artifacts[1].storedPath)throw new Error("The summary and archive must be separate files.");
  const client=await database.connect();
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='10s'");
    const job=await client.query("SELECT status FROM export_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE",[input.organizationId,input.jobId]);
    if(!job.rowCount)throw new Error("Export job is not available in this organization.");
    const existing=await client.query("SELECT kind,sha256,snapshot_reference,source_row_count FROM export_artifacts WHERE organization_id=$1 AND job_id=$2",[input.organizationId,input.jobId]);
    if(job.rows[0].status==="succeeded"){
      if(existing.rowCount!==2||artifacts.some(file=>!existing.rows.some(row=>row.kind===file.kind&&row.sha256===file.sha256&&row.snapshot_reference===input.snapshotReference&&Number(row.source_row_count)===input.sourceRowCount)))throw new Error("The published export cannot be replaced with different evidence.");
      await client.query("COMMIT");return {replayed:true};
    }
    if(job.rows[0].status!=="running"||existing.rowCount)throw new Error("The export job is not ready for paired publication.");
    for(const file of artifacts)await client.query(`INSERT INTO export_artifacts(job_id,organization_id,kind,snapshot_reference,file_name,file_path,mime_type,file_size,sha256,source_row_count)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[input.jobId,input.organizationId,file.kind,input.snapshotReference,file.fileName,file.storedPath,file.mimeType,file.fileSize,file.sha256,input.sourceRowCount]);
    const summary=artifacts.find(file=>file.kind==="summary")!;
    await client.query(`UPDATE export_jobs SET status='succeeded',file_name=$3,file_path=$4,file_size=$5,mime_type=$6,row_count=$7,
      download_token=$8,download_token_expires_at=clock_timestamp()+($9::text||' minutes')::interval,
      retention_expires_at=clock_timestamp()+($10::text||' days')::interval,completed_at=clock_timestamp(),updated_at=clock_timestamp(),last_error=NULL
      WHERE organization_id=$1 AND id=$2`,[input.organizationId,input.jobId,summary.fileName,summary.storedPath,summary.fileSize,summary.mimeType,input.sourceRowCount,randomBytes(24).toString("hex"),input.tokenTtlMinutes,input.retentionDays]);
    await client.query("COMMIT");return {replayed:false};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
