import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {pool} from "../../db";
import {getTenantContext} from "../../organization-context";
import {queryRolePermission,queryCustomRolePermission,queryUserCustomRoleId} from "../../services/permission-query-service";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";

export class GovernanceError extends Error {
  constructor(readonly code:string,message:string,readonly status=409,readonly details?:unknown){super(message);}
}
// JSONB normalizes key order. Fingerprints must survive a database round trip,
// without changing array order or treating an omitted value as a supplied null.
function canonical(value:unknown):unknown {
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined)
    .sort(([a],[b])=>a.localeCompare(b,"en")).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export const governanceHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export async function governanceEnabled(org:number,feature:"sod"|"payment_risk"|"spend_cube",database:Pick<PoolClient,"query">=pool){
  const r=await database.query("SELECT coalesce(feature_flags->>$2='true',false) enabled FROM organization_settings WHERE organization_id=$1",[org,feature]);
  return r.rows[0]?.enabled===true;
}
export async function governanceActor(client:PoolClient,organizationId:number,userId:number){
  const {rows:[actor]}=await client.query(`SELECT m.application_role AS role,u.preferences,u.warehouse_id
    FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active JOIN organizations o ON o.id=m.organization_id AND o.active
    WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND m.status='active' FOR SHARE OF m,u,o`,[organizationId,userId]);
  if(!actor)throw new GovernanceError("GOVERNANCE_ACCESS_DENIED","An active organization membership is required.",403);
  const custom=actor.role==="custom"?await queryUserCustomRoleId(client,organizationId,userId,true):null;
  const can=async(resource:string,action:string)=>await queryRolePermission(client,actor.role,resource,action,true)||
    Boolean(custom&&await queryCustomRolePermission(client,organizationId,custom,resource,action,true));
  return {...actor,userId,organizationId,customRoleId:custom,can};
}
export async function requireGovernanceAdmin(client:PoolClient){
  const t=getTenantContext(),actor=await governanceActor(client,t.organizationId,t.userId);
  if(!await actor.can("custom_roles","manage")&&!await actor.can("custom_roles","admin"))throw new GovernanceError("GOVERNANCE_ACCESS_DENIED","Role administration permission is required.",403);
  return actor;
}
export async function governanceTransaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  for(let attempt=0;;attempt++){
    const c=await pool.connect();
    try{await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");await c.query("SET LOCAL statement_timeout='8s'");
      const value=await work(c);await c.query("COMMIT");return value;
    }catch(error){await c.query("ROLLBACK").catch(()=>undefined);
      if(attempt<2&&(["40001","40P01"].includes((error as {code?:string}).code??"")||
        (error as {code?:string;constraint?:string}).code==="23505"&&(error as {constraint?:string}).constraint==="workflow_idempotency_org_key_uidx"))continue;
      if((error as Error).message==="SOD_ASSIGNMENT_CONFLICT"){
        let details:unknown;try{details=JSON.parse((error as {detail?:string}).detail??"[]");}catch{details=[];}
        throw new GovernanceError("SOD_ASSIGNMENT_CONFLICT","This change introduces an unmitigated separation-of-duties conflict. Review the permissions and required controls.",409,details);
      }throw error;
    }finally{c.release();}
  }
}
export async function governanceRetry<T>(c:PoolClient,org:number,actor:number,key:string,action:string,payload:unknown,work:()=>Promise<T>):Promise<T>{
  if(!key||key.length>128)throw new GovernanceError("IDEMPOTENCY_KEY_REQUIRED","Supply a retry key of at most 128 characters.",400);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`governance:${org}:${key}`]);
  const hash=governanceHash([actor,action,payload]);
  const prior=(await c.query("SELECT action,response FROM workflow_idempotency WHERE organization_id=$1 AND idempotency_key=$2",[org,key])).rows[0];
  if(prior){if(prior.action!==action||prior.response?.hash!==hash)throw new GovernanceError("IDEMPOTENCY_CONFLICT","This retry key belongs to a different command.");return prior.response.result as T;}
  const result=await work();
  await c.query(`INSERT INTO workflow_idempotency(organization_id,idempotency_key,action,resource_type,response)
    VALUES($1,$2,$3,'governance',$4::jsonb)`,[org,key,action,JSON.stringify({hash,result})]);
  return result;
}

/** A rejected business transaction rolls back first. Record the attempt in its
 * own audit transaction; never retain caller banking/form payloads or SQL. */
export async function recordGovernanceDenial(org:number,user:number,error:unknown,resourceType:string,resourceId?:number){
 if(!(error instanceof GovernanceError)||![403,409].includes(error.status))return;
 const action=error.code.startsWith("SOD_")?"SOD_ASSIGNMENT_BLOCKED":"PAYMENT_RELEASE_BLOCKED_RISK";
 try{await governanceTransaction(async c=>{
  await governanceActor(c,org,user);
  await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action,resourceType,resourceId,
   details:{code:error.code,changesApplied:false},requestId:getTenantContext().correlationId});
 });}catch{console.error(JSON.stringify({event:"governance_denial_audit_unavailable",organizationId:org,actorId:user,code:error.code}));}
}
