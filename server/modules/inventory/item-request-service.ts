import { z } from "zod";
import { pool } from "../../db";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";

export const itemRequestSchema=z.object({sku:z.string().trim().min(1).max(100),name:z.string().trim().min(2).max(200),reason:z.string().trim().min(10).max(2000),requestKey:z.string().uuid()}).strict();
export async function requestInventoryItem(org:number,actor:number,input:unknown) {
  const body=itemRequestSchema.parse(input),client=await pool.connect();
  try {
    await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:item-request:${body.requestKey}`]);
    const prior=await client.query("SELECT response FROM workflow_idempotency WHERE organization_id=$1 AND idempotency_key=$2",[org,body.requestKey]);
    const fingerprint=JSON.stringify({actor,body});
    if(prior.rowCount){if(prior.rows[0].response.fingerprint!==fingerprint)throw new Error("ITEM_REQUEST_RETRY_CONFLICT");await client.query("COMMIT");return prior.rows[0].response.result;}
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:item-request-sku:${body.sku}`]);
    if((await client.query("SELECT id FROM inventory_items WHERE organization_id=$1 AND sku=$2",[org,body.sku])).rowCount)throw new Error("ITEM_REQUEST_SKU_EXISTS");
    if((await client.query("SELECT id FROM mdm_change_requests WHERE organization_id=$1 AND domain='items' AND action='create' AND proposed_patch->>'sku'=$2 AND status NOT IN ('rejected','applied')",[org,body.sku])).rowCount)throw new Error("ITEM_REQUEST_ALREADY_PENDING");
    const patch={sku:body.sku,name:body.name};
    const inserted=await client.query(`INSERT INTO mdm_change_requests(organization_id,domain,action,proposed_patch,risk_level,status,submitted_by,reason,target_version) VALUES($1,'items','create',$2::jsonb,'high','pending_approval',$3,$4,1) RETURNING id,status`,[org,JSON.stringify(patch),actor,body.reason]);
    const result=inserted.rows[0];
    await client.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason,after_state) VALUES($1,$2,'submission','pending_approval',$3,$4,$5::jsonb)",[org,result.id,actor,body.reason,JSON.stringify(patch)]);
    await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:actor},action:"INVENTORY_ITEM_REQUESTED",resourceType:"mdm_change_request",resourceId:result.id,after:patch,reason:body.reason});
    await client.query("INSERT INTO workflow_idempotency(organization_id,idempotency_key,action,resource_type,resource_id,response) VALUES($1,$2,'ITEM_REQUEST','mdm_change_request',$3,$4::jsonb)",[org,body.requestKey,result.id,JSON.stringify({fingerprint,result})]);
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

/** Applying a request links the maintained master record; it never creates stock. */
export async function fulfillInventoryItemRequest(org:number,id:number,actor:number) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='5s'");
    const found=await client.query("SELECT * FROM mdm_change_requests WHERE organization_id=$1 AND id=$2 AND domain='items' AND action='create' FOR UPDATE",[org,id]);
    const request=found.rows[0];if(!request)throw new Error("ITEM_REQUEST_NOT_FOUND");
    if(request.status==='applied'){await client.query("COMMIT");return {id,status:'applied',entityId:request.entity_id};}
    if(request.status!=='approved'||!request.approved_by||request.approved_by===request.submitted_by)throw new Error("ITEM_REQUEST_INDEPENDENT_APPROVAL_REQUIRED");
    const item=await client.query("SELECT id,sku,name FROM inventory_items WHERE organization_id=$1 AND sku=$2 FOR SHARE",[org,request.proposed_patch?.sku]);
    if(item.rowCount!==1||item.rows[0].name!==request.proposed_patch?.name)throw new Error("ITEM_REQUEST_MASTER_REQUIRED");
    await client.query("UPDATE mdm_change_requests SET status='applied',entity_id=$3 WHERE organization_id=$1 AND id=$2",[org,id,item.rows[0].id]);
    await client.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason,after_state) VALUES($1,$2,'apply','applied',$3,'Linked maintained item master; no stock created',$4::jsonb)",[org,id,actor,JSON.stringify(item.rows[0])]);
    await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:actor},action:"INVENTORY_ITEM_REQUEST_FULFILLED",resourceType:"mdm_change_request",resourceId:id,after:item.rows[0]});
    await client.query("COMMIT");return {id,status:'applied',entityId:item.rows[0].id};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
