import type {Pool} from "pg";
import type {TenantContext} from "../../organization-context";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
import {documentAccess,DocumentAccessError,ownedDocumentSql} from "./document-access";

/** Explicit existing retention command. Global policy definitions never grant
 * cross-tenant or source access; archives and audit commit together. No files deleted. */
export async function runDocumentRetention(database:Pool,actor:TenantContext,requestId:string){
  const client=await database.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'");
    const access=await documentAccess(client,actor,true,true);
    if(!await access.can("documents","delete"))throw new DocumentAccessError(403,"DOCUMENT_RETENTION_DENIED","Document archive permission is required.");
    await client.query("SELECT pg_advisory_xact_lock($1,$2)",[918204,actor.organizationId]);
    const policies=await client.query("SELECT document_type,retention_years FROM retention_policies WHERE is_active=true ORDER BY id");
    let archivedCount=0;
    for(const policy of policies.rows){
      const years=Number(policy.retention_years);if(!Number.isInteger(years)||years<1||years>100||!access.types.includes(policy.document_type))continue;
      const cutoff=new Date();cutoff.setFullYear(cutoff.getFullYear()-years);
      const result=await client.query(`WITH changed AS(UPDATE documents d SET archived_at=clock_timestamp() WHERE d.organization_id=$1 AND d.entity_type=$2
        AND d.archived_at IS NULL AND d.uploaded_at<=$3 AND ${ownedDocumentSql()} RETURNING d.id) SELECT count(*)::int AS count FROM changed`,[actor.organizationId,policy.document_type,cutoff]);
      archivedCount+=Number(result.rows[0].count);
    }
    if(archivedCount)await appendAuditEventWithClient(client,{organizationId:actor.organizationId,actor:{userId:actor.userId},action:"DOCUMENT_RETENTION_APPLIED",resourceType:"document",requestId,
      details:{archivedCount,authorizedTypes:access.types,filesDeleted:false}});
    await client.query("COMMIT");return {archivedCount,filesDeleted:false};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
