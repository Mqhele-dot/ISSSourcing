import {createHash} from "node:crypto";
import {open,realpath} from "node:fs/promises";
import path from "node:path";
import type {Pool} from "pg";
import {SUPPLIER_DISCLOSURE_POLICY} from "../../../shared/supplier-public-profile";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
import {assertExportActorAccess} from "./export-actor-access";

export const SUPPLIER_EXPORT_REVIEW_GUIDANCE = "This retained supplier file has no verified banking-disclosure evidence. No file was delivered or changed. Generate a new supplier export; ask an administrator if publication storage needs updating.";
export type SupplierPublication = {jobId:number;filePath:string;fileName:string;mimeType:string;fileSize:number;sha256:string;policyVersion:string};
type JobFile = {id:number;dataset:string;filePath:string|null;fileName:string|null;mimeType:string|null;fileSize:number|null};
export function matchesSupplierPublication(job:JobFile,proof:SupplierPublication|undefined){
  return !!proof&&job.dataset==="suppliers"&&proof.jobId===job.id&&proof.policyVersion===SUPPLIER_DISCLOSURE_POLICY&&
    proof.filePath===job.filePath&&proof.fileName===job.fileName&&proof.mimeType===job.mimeType&&proof.fileSize===job.fileSize;
}
export async function readSupplierPublications(database:Pick<Pool,"query">,organizationId:number,ids:number[]){
  const result=new Map<number,SupplierPublication>();
  if(!ids.length)return result;
  if(ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error("Choose a bounded supplier export list.");
  const ready=await database.query("SELECT to_regclass('public.supplier_export_publications') IS NOT NULL AS ready");
  if(!ready.rows[0]?.ready)return result;
  const rows=await database.query(`SELECT job_id,file_path,file_name,mime_type,file_size::text,sha256,policy_version
    FROM supplier_export_publications WHERE organization_id=$1 AND job_id=ANY($2::int[])`,[organizationId,ids]);
  for(const row of rows.rows)result.set(Number(row.job_id),{jobId:Number(row.job_id),filePath:row.file_path,fileName:row.file_name,
    mimeType:row.mime_type,fileSize:Number(row.file_size),sha256:row.sha256,policyVersion:row.policy_version});
  return result;
}
type PublicationInput={root:string;organizationId:number;id:number;filePath:string;fileName:string;mimeType:string;fileSize:number;rowCount:number;
  policyVersion:string|null;downloadToken:string;tokenExpiry:Date;retentionExpiry:Date};

/** Server publication only. Hash the packaged bytes, then atomically publish proof,
 * success and canonical audit evidence. No legacy proof is inferred/backfilled. */
export async function publishSupplierExport(database:Pool,input:PublicationInput){
  if(input.policyVersion!==SUPPLIER_DISCLOSURE_POLICY)throw new Error("Supplier export generation did not confirm the required disclosure policy. Generate a new export after updating the application.");
  if(!Number.isSafeInteger(input.id)||input.id<1||!Number.isSafeInteger(input.organizationId)||input.organizationId<1||/[\u0000-\u001f\u007f"/\\]/.test(input.fileName))throw new Error("Invalid supplier export publication scope.");
  const base=await realpath(input.root),orgRoot=path.join(base,`org-${input.organizationId}`);
  const canonical=await realpath(path.resolve(input.filePath));
  const relative=path.relative(orgRoot,canonical);
  if(!relative||relative.startsWith(`..${path.sep}`)||relative===".."||path.isAbsolute(relative)||!path.basename(canonical).startsWith(`job-${input.id}-`))throw new Error("Supplier export file ownership could not be verified.");
  const handle=await open(canonical,"r");let sha256:string;
  try{
    const before=await handle.stat();if(!before.isFile()||before.size!==input.fileSize||before.size<1)throw new Error("Supplier export size could not be verified.");
    const hash=createHash("sha256");for await(const chunk of handle.createReadStream({start:0,autoClose:false}))hash.update(chunk);
    const after=await handle.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error("Supplier export changed during publication.");
    sha256=hash.digest("hex");
  }finally{await handle.close();}
  const client=await database.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='10s'");
    const job=await client.query("SELECT * FROM export_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE",[input.organizationId,input.id]);
    const row=job.rows[0];
    if(!row||row.dataset!=="suppliers"||!["running","succeeded"].includes(row.status)||row.profile==="compact_excel")throw new Error("This supplier export is not ready for publication.");
    await assertExportActorAccess(client,{organizationId:input.organizationId,userId:Number(row.created_by),dataset:"suppliers",filters:row.filters??{}},true);
    const ready=await client.query("SELECT to_regclass('public.supplier_export_publications') IS NOT NULL AS ready");
    if(!ready.rows[0]?.ready)throw new Error("Supplier export publication storage is unavailable. Ask an administrator to review the separately approved supplier-export migration; no legacy file was certified.");
    if(row.status==="succeeded"){
      const proof=(await readSupplierPublications(client,input.organizationId,[input.id])).get(input.id);
      if(!matchesSupplierPublication({id:input.id,dataset:"suppliers",filePath:input.filePath,fileName:input.fileName,mimeType:input.mimeType,fileSize:input.fileSize},proof)||proof?.sha256!==sha256||
        row.file_path!==proof.filePath||row.file_name!==proof.fileName||row.mime_type!==proof.mimeType||Number(row.file_size)!==proof.fileSize)throw new Error("Published supplier export evidence cannot be replaced.");
      await client.query("COMMIT");return;
    }
    await client.query(`INSERT INTO supplier_export_publications(job_id,organization_id,policy_version,file_path,file_name,mime_type,file_size,sha256,actor_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[input.id,input.organizationId,SUPPLIER_DISCLOSURE_POLICY,input.filePath,input.fileName,input.mimeType,input.fileSize,sha256,row.created_by]);
    await client.query(`UPDATE export_jobs SET status='succeeded',file_name=$3,file_path=$4,file_size=$5,mime_type=$6,row_count=$7,
      download_token=$8,download_token_expires_at=$9,retention_expires_at=$10,completed_at=clock_timestamp(),updated_at=clock_timestamp(),last_error=NULL
      WHERE organization_id=$1 AND id=$2`,[input.organizationId,input.id,input.fileName,input.filePath,input.fileSize,input.mimeType,input.rowCount,input.downloadToken,input.tokenExpiry,input.retentionExpiry]);
    await appendAuditEventWithClient(client,{organizationId:input.organizationId,actor:{userId:Number(row.created_by)},action:"SUPPLIER_EXPORT_PUBLISHED",resourceType:"export_job",resourceId:input.id,
      requestId:`export-job-${input.id}`,details:{policyVersion:SUPPLIER_DISCLOSURE_POLICY,sha256,fileSize:input.fileSize}});
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
