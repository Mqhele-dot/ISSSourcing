import type {Express,Request,Response} from "express";
import {createReadStream} from "node:fs";
import {unlink} from "node:fs/promises";
import {createHash} from "node:crypto";
import {pipeline} from "node:stream/promises";
import {z} from "zod";
import {pool} from "../../db";
import {getTenantContext} from "../../organization-context";
import {documentUpload} from "../../http/upload-config";
import type {AuthBundle} from "../procurement/types";
import {sendError,sendOk,resolveRequestId} from "../../api-response";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
import {recordServerDiagnosticEvent} from "../../diagnostics/server-diagnostics-store";
import {documentAccess,documentSources,DocumentAccessError,ownedDocumentSql,type DocumentEntity} from "./document-access";
import {documentPage,documentColumnsSql,documentProofsSql,openDocument,DOCUMENT_UPLOAD_ACTION,type EvidenceRow} from "./document-evidence";
import {documentEntity as entity,documentPageQuery as pageQuery,documentLegacyQuery as legacyQuery} from "../../../shared/document-query";

const uploadBody=z.object({entityType:entity,entityId:z.coerce.number().int().positive().max(2147483647)}).strict();
const validId=(value:unknown)=>z.coerce.number().int().positive().max(2147483647).parse(value);

function failure(res:Response,error:unknown){
  if(error instanceof DocumentAccessError)return sendError(res,error.status,error.code,error.message);
  if(error instanceof z.ZodError)return sendError(res,400,"DOCUMENT_INPUT_INVALID","Choose a valid record, supported filters and page size. Unsupported inputs cannot be ignored.");
  const requestId=resolveRequestId(res);
  recordServerDiagnosticEvent({source:"request",severity:"error",title:"Document evidence unavailable",message:"Document evidence could not be observed. Retry or review storage and permissions.",status:503,details:{requestId}});
  return sendError(res,503,"DOCUMENT_EVIDENCE_UNAVAILABLE","Document evidence could not be loaded. Retry; give your administrator the request ID if it continues.");
}
export function registerDocumentRoutes(app:Express,auth:AuthBundle){
  const read=[auth.ensureAuthenticated,auth.ensurePermission("documents","read")];
  const write=[auth.ensureAuthenticated,auth.ensureRole(["manager","admin"]),auth.ensurePermission("documents","read")];
  const list=(legacy:boolean)=>async(req:Request,res:Response)=>{
    let client;
    try{
      const query=legacy?legacyQuery.parse(req.query):pageQuery.parse(req.query),actor=getTenantContext();
      client=await pool.connect();await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");await client.query("SET LOCAL statement_timeout='5s'");
      const access=await documentAccess(client,actor);
      if(query.entityType&&!access.types.includes(query.entityType))throw new DocumentAccessError(403,"DOCUMENT_SOURCE_DENIED","You do not have access to this document's source records.");
      const offset="offset" in query?query.offset:(query.page-1)*query.pageSize,limit="limit" in query?query.limit:query.pageSize;
      const result=await documentPage(client,actor.organizationId,access.types,query,offset,limit);
      await client.query("COMMIT");res.setHeader("Cache-Control","private, no-store");
      if(legacy){res.setHeader("X-Total-Count",String(result.total));res.setHeader("Deprecation","true");return res.json(result.items);}
      return sendOk(res,{...result,page:"page" in query?query.page:1,pageSize:limit});
    }catch(error){await client?.query("ROLLBACK").catch(()=>undefined);return failure(res,error);}finally{client?.release();}
  };
  app.get("/api/v2/documents",...read,list(false));app.get("/api/documents",...read,list(true));
  app.post("/api/documents/reconcile",...write,auth.ensurePermission("documents","verify"),async(_req,res)=>{
    let client;
    try{client=await pool.connect();await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");await client.query("SET LOCAL statement_timeout='5s'");
      const actor=getTenantContext(),access=await documentAccess(client,actor);
      const result=await documentPage(client,actor.organizationId,access.types,{archived:"include",sort:"newest",fileStatus:"all"},0,0);
      await client.query("COMMIT");return sendOk(res,{checked:result.total,available:result.total-result.summary.missing-result.summary.unverified,missing:result.summary.missing,
        unverified:result.summary.unverified,verifiedAt:result.observationAt,changesApplied:false});
    }catch(error){await client?.query("ROLLBACK").catch(()=>undefined);return failure(res,error);}finally{client?.release();}
  });
  // Caller-supplied paths cannot establish file ownership, even for a manager.
  app.post("/api/documents",...write,auth.ensurePermission("documents","create"),(_req,res)=>sendError(res,409,"DOCUMENT_REGISTRATION_UNVERIFIED","No changes were applied. Upload an original through Documents to establish an authorized file binding; arbitrary stored paths cannot be registered."));
  app.post("/api/documents/upload",...write,auth.ensurePermission("documents","create"),documentUpload.single("file"),async(req,res)=>{
    let client,committed=false;
    try{
      if(!req.file)return sendError(res,400,"DOCUMENT_FILE_REQUIRED","Choose an original file to upload.");
      if(req.file.originalname.length>255||/[\u0000-\u001f\u007f]/.test(req.file.originalname))throw new DocumentAccessError(400,"DOCUMENT_NAME_INVALID","Use a filename of at most 255 characters without control characters.");
      const input=uploadBody.parse(req.body),actor=getTenantContext(),source=documentSources[input.entityType];
      const hash=createHash("sha256");for await(const chunk of createReadStream(req.file.path))hash.update(chunk);
      const sha256=hash.digest("hex");client=await pool.connect();await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'");
      const access=await documentAccess(client,actor,true,true);
      if(!access.types.includes(input.entityType)||!await access.can("documents","create"))throw new DocumentAccessError(403,"DOCUMENT_SOURCE_DENIED","You do not have permission to attach evidence to this source record.");
      const owned=await client.query(`SELECT id FROM ${source.table} WHERE organization_id=$1 AND id=$2 FOR SHARE`,[actor.organizationId,input.entityId]);
      if(!owned.rowCount)throw new DocumentAccessError(404,"DOCUMENT_SOURCE_NOT_FOUND","This source record is unavailable in your organization.");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`document-version:${actor.organizationId}:${input.entityType}:${input.entityId}`]);
      const version=await client.query("SELECT COALESCE(MAX(version),0)+1 AS next FROM documents WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3",[actor.organizationId,input.entityType,input.entityId]);
      const fileUrl=`/uploads/documents/${req.file.filename}`;
      const created=await client.query(`INSERT INTO documents(organization_id,entity_type,entity_id,file_url,file_name,mime_type,file_size,checksum,version,uploaded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[actor.organizationId,input.entityType,input.entityId,fileUrl,req.file.originalname,req.file.mimetype,req.file.size,sha256,version.rows[0].next,actor.userId]);
      const id=created.rows[0].id;
      await appendAuditEventWithClient(client,{organizationId:actor.organizationId,actor:{userId:actor.userId},action:DOCUMENT_UPLOAD_ACTION,resourceType:"document",resourceId:id,
        details:{fileUrl,fileSize:req.file.size,sha256,entityType:input.entityType,entityId:input.entityId,fileName:req.file.originalname,mimeType:req.file.mimetype},requestId:resolveRequestId(res)});
      await client.query("COMMIT");committed=true;return res.status(201).json({id,entityType:input.entityType,entityId:input.entityId,fileName:req.file.originalname,version:version.rows[0].next,fileUrl:`/api/documents/${id}/download`});
    }catch(error){await client?.query("ROLLBACK").catch(()=>undefined);return failure(res,error);}finally{
      client?.release();if(req.file&&!committed)await unlink(req.file.path).catch(()=>recordServerDiagnosticEvent({source:"request",severity:"warning",title:"Private upload cleanup needs review",message:"A rejected upload could not be removed. Ask an administrator to review its private cleanup evidence; no document record was published.",details:{requestId:resolveRequestId(res),uploadId:req.file!.filename.slice(0,36),errorCode:"DOCUMENT_UPLOAD_CLEANUP_FAILED"}}));
    }
  });
  app.get("/api/documents/:id/download",...read,async(req,res)=>{
    let client,stream:Awaited<ReturnType<typeof openDocument>>|undefined;
    try{const id=validId(req.params.id),actor=getTenantContext();client=await pool.connect();await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");await client.query("SET LOCAL statement_timeout='5s'");
      const access=await documentAccess(client,actor);
      const result=await client.query<EvidenceRow>(`${documentProofsSql} SELECT ${documentColumnsSql} FROM documents d LEFT JOIN proofs p ON p.resource_id=d.id
        WHERE d.organization_id=$1 AND d.id=$2 AND d.entity_type=ANY($3::text[]) AND ${ownedDocumentSql()}`,[actor.organizationId,id,access.types]);
      if(!result.rowCount)throw new DocumentAccessError(404,"DOCUMENT_NOT_FOUND","Document not available in your authorized scope.");
      const row=result.rows[0];await client.query("COMMIT");client.release();client=undefined;
      try{stream=await openDocument(row);}catch(error){
        if(["ENOENT","ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code)))return sendError(res,410,"DOCUMENT_FILE_MISSING","The original file is unavailable. Metadata and history have been preserved.");
        return sendError(res,409,"DOCUMENT_FILE_UNVERIFIED","File ownership or bytes could not be verified. Reattach an original through the authorized Documents workflow; no replacement was generated.");
      }
      res.attachment(row.fileName);res.setHeader("Content-Type",row.mimeType??"application/octet-stream");res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");
      await pipeline(stream,res);
    }catch(error){stream?.destroy();await client?.query("ROLLBACK").catch(()=>undefined);if(res.headersSent){res.destroy();return;}return failure(res,error);}finally{client?.release();}
  });
  app.delete("/api/documents/:id",...write,auth.ensurePermission("documents","delete"),async(req,res)=>{
    let client;
    try{const id=validId(req.params.id),actor=getTenantContext();client=await pool.connect();await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'");
      const access=await documentAccess(client,actor,true,true);
      if(!await access.can("documents","delete"))throw new DocumentAccessError(403,"DOCUMENT_ARCHIVE_DENIED","You need document archive permission.");
      const rows=await client.query("SELECT * FROM documents WHERE organization_id=$1 AND id=$2 FOR UPDATE",[actor.organizationId,id]);const row=rows.rows[0];
      if(!row||!access.types.includes(row.entity_type as DocumentEntity))throw new DocumentAccessError(404,"DOCUMENT_NOT_FOUND","Document not available in your authorized scope.");
      const source=documentSources[row.entity_type as DocumentEntity];const owned=await client.query(`SELECT id FROM ${source.table} WHERE organization_id=$1 AND id=$2 FOR SHARE`,[actor.organizationId,row.entity_id]);
      if(!owned.rowCount)throw new DocumentAccessError(404,"DOCUMENT_SOURCE_NOT_FOUND","Source record unavailable in your organization.");
      if(!row.archived_at){await client.query("UPDATE documents SET archived_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[actor.organizationId,id]);
        await appendAuditEventWithClient(client,{organizationId:actor.organizationId,actor:{userId:actor.userId},action:"DOCUMENT_ARCHIVED",resourceType:"document",resourceId:id,requestId:resolveRequestId(res)});}
      await client.query("COMMIT");return res.json({id,archived:true,historyPreserved:true});
    }catch(error){await client?.query("ROLLBACK").catch(()=>undefined);return failure(res,error);}finally{client?.release();}
  });
}
