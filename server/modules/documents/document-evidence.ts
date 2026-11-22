import {open,realpath,stat} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {documentsDir} from "../../http/upload-config";
import {ownedDocumentSql} from "./document-access";

export const DOCUMENT_UPLOAD_ACTION="DOCUMENT_FILE_STORED_V1";
export function documentStoredPath(fileUrl:string){
  const prefix="/uploads/documents/";if(!fileUrl.startsWith(prefix))return null;
  const name=fileUrl.slice(prefix.length);if(!name||/[\\/:\u0000-\u001f]/.test(name)||name==="."||name==="..")return null;
  return path.join(documentsDir,name);
}
export const documentProofsSql=`WITH proofs AS MATERIALIZED (SELECT DISTINCT ON(resource_id) resource_id,details
  FROM audit_logs WHERE organization_id=$1 AND resource_type='document' AND action='${DOCUMENT_UPLOAD_ACTION}' ORDER BY resource_id,id)`;
export const documentColumnsSql=`d.id,d.entity_type AS "entityType",d.entity_id AS "entityId",d.file_name AS "fileName",d.file_url AS "storedUrl",
  d.mime_type AS "mimeType",d.file_size AS "fileSize",d.version,d.uploaded_at AS "uploadedAt",d.archived_at AS "archivedAt",d.last_verified_at AS "lastVerifiedAt",
  CASE WHEN p.details->>'fileUrl'=d.file_url AND p.details->>'fileSize'=d.file_size::text AND p.details->>'entityType'=d.entity_type
    AND p.details->>'entityId'=d.entity_id::text AND p.details->>'sha256'=d.checksum AND p.details->>'fileName'=d.file_name
    AND p.details->>'mimeType'=d.mime_type THEN p.details->>'sha256' ELSE NULL END AS "proofHash"`;
export type EvidenceRow={id:number;entityType:string;entityId:number;fileName:string;storedUrl:string;mimeType:string|null;fileSize:number|null;version:number;uploadedAt:Date;archivedAt:Date|null;lastVerifiedAt:Date|null;proofHash:string|null};
export async function fileState(row:EvidenceRow){
  const stored=documentStoredPath(row.storedUrl);
  if(!stored||!row.proofHash||!/^[a-f0-9]{64}$/.test(row.proofHash))return "unverified" as const;
  try{const base=await realpath(documentsDir),canonical=await realpath(stored);if(path.dirname(canonical)!==base)return "unverified" as const;
    const info=await stat(canonical);return info.isFile()&&info.size===row.fileSize?"available" as const:"unverified" as const;
  }catch(error){if(["ENOENT","ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code)))return "missing" as const;return "unverified" as const;}
}
export async function publicDocument(row:EvidenceRow){
  const fileStatus=await fileState(row);const {storedUrl:_url,proofHash:_hash,...safe}=row;
  return {...safe,fileUrl:`/api/documents/${row.id}/download`,fileStatus,fileAvailable:fileStatus==="available",lifecycleStatus:row.archivedAt?"archived":"active",
    evidenceGuidance:fileStatus==="unverified"?"File ownership or upload evidence is unverified. Reattach an original through the authorized upload workflow; history is unchanged.":null};
}
/** Bounded cursor batches, including physical-file filters. Never load every row
 * or issue one database query per file; counts and page share one DB observation. */
export async function documentPage(client:PoolClient,org:number,types:string[],query:{entityType?:string;entityId?:number;documentId?:number;q?:string;archived:string;sort:string;fileStatus:string},offset:number,limit:number){
  const values:unknown[]=[org,types];const filters=["d.organization_id=$1","d.entity_type=ANY($2::text[])",ownedDocumentSql()];
  if(query.entityType){values.push(query.entityType);filters.push(`d.entity_type=$${values.length}`);}
  if(query.entityId){values.push(query.entityId);filters.push(`d.entity_id=$${values.length}`);}
  if(query.documentId){values.push(query.documentId);filters.push(`d.id=$${values.length}`);}
  if(query.archived!=="include")filters.push(query.archived==="only"?"d.archived_at IS NOT NULL":"d.archived_at IS NULL");
  if(query.q){values.push(`%${query.q}%`);filters.push(`(d.file_name ILIKE $${values.length} OR d.entity_type ILIKE $${values.length})`);}
  const order={newest:"d.uploaded_at DESC,d.id DESC",oldest:"d.uploaded_at,d.id",name_asc:"d.file_name,d.id",name_desc:"d.file_name DESC,d.id DESC"}[query.sort]??"d.uploaded_at DESC,d.id DESC";
  await client.query(`DECLARE document_page_cursor NO SCROLL CURSOR FOR ${documentProofsSql} SELECT ${documentColumnsSql} FROM documents d LEFT JOIN proofs p ON p.resource_id=d.id WHERE ${filters.join(" AND ")} ORDER BY ${order}`,values);
  let total=0,active=0,archived=0,missing=0,unverified=0;const items:Awaited<ReturnType<typeof publicDocument>>[]=[];const started=Date.now();
  for(;;){
    if(Date.now()-started>10000)throw new Error("Document observation timed out");
    const batch=await client.query<EvidenceRow>("FETCH FORWARD 500 FROM document_page_cursor");
    for(const row of batch.rows){const view=await publicDocument(row);if(query.fileStatus!=="all"&&view.fileStatus!==query.fileStatus)continue;
      if(total>=offset&&items.length<limit)items.push(view);total++;if(row.archivedAt)archived++;else active++;if(view.fileStatus==="missing")missing++;if(view.fileStatus==="unverified")unverified++;}
    if((batch.rowCount??0)<500)break;
  }
  await client.query("CLOSE document_page_cursor");
  return {items,total,summary:{active,archived,missing,unverified},hasNext:offset+limit<total,observationAt:new Date().toISOString(),availabilityBasis:"authorized metadata and current file checks; download revalidates hash"};
}
export async function openDocument(row:EvidenceRow){
  const stored=documentStoredPath(row.storedUrl);if(!stored||!row.proofHash)throw new Error("DOCUMENT_UNVERIFIED");
  const base=await realpath(documentsDir),canonical=await realpath(stored);if(path.dirname(canonical)!==base)throw new Error("DOCUMENT_UNVERIFIED");
  const handle=await open(canonical,"r");
  try{const before=await handle.stat();if(!before.isFile()||before.size!==row.fileSize)throw new Error("DOCUMENT_UNVERIFIED");
    const hash=createHash("sha256");for await(const chunk of handle.createReadStream({start:0,autoClose:false}))hash.update(chunk);
    const after=await handle.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||hash.digest("hex")!==row.proofHash)throw new Error("DOCUMENT_UNVERIFIED");
    return handle.createReadStream({start:0,autoClose:true});
  }catch(error){await handle.close();throw error;}
}
