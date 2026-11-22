import {z} from "zod";
import {pool} from "../../db";
import {riskPolicySchema} from "@shared/procurement-governance";
import {governanceActor,governanceTransaction,GovernanceError,governanceHash} from "../rbac/governance-context";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
const patchSchema=z.object({code:z.string().trim().min(2).max(100).optional(),name:z.string().trim().min(2).max(200).optional(),
 policyType:z.literal("payment_risk").optional(),policy_type:z.literal("payment_risk").optional(),config:z.unknown().optional(),active:z.boolean().optional()}).strict();
const payload=(r:Record<string,unknown>)=>({action:r.action,entityId:r.entity_id,patch:r.proposed_patch});
export async function isPaymentRiskPolicyRequest(org:number,row:Record<string,unknown>){
 if(row.domain!=="procurement-policies")return false;
 const patch=row.proposed_patch as Record<string,unknown>|null;
 if(patch?.policyType==="payment_risk"||patch?.policy_type==="payment_risk")return true;
 return !!row.entity_id&&(await pool.query("SELECT id FROM mdm_procurement_policies WHERE organization_id=$1 AND id=$2 AND policy_type='payment_risk'",[org,row.entity_id])).rowCount===1;
}
export async function governPaymentRiskPolicy(input:{organizationId:number;id:number;actorId:number;reason?:string},action:"approve"|"apply"){
 return governanceTransaction(async c=>{
  const org=input.organizationId,actor=await governanceActor(c,org,input.actorId);
  if(!await actor.can("master_data","read")||!await actor.can("finance","configure")||
    !(await actor.can("master_data",action==="approve"?"approve":"execute")||await actor.can("settings",action==="approve"?"approve":"execute")))
   throw new GovernanceError("PAYMENT_RISK_POLICY_ACCESS_DENIED","Current Finance configuration and independent Master Data approval/application permission is required.",403);
  await c.query("SELECT pg_advisory_xact_lock(723411,$1)",[org]);
  const r=(await c.query("SELECT * FROM mdm_change_requests WHERE organization_id=$1 AND id=$2 AND domain='procurement-policies' FOR UPDATE",[org,input.id])).rows[0];
  if(!r)throw new GovernanceError("PAYMENT_RISK_POLICY_REQUEST_UNAVAILABLE","This policy request is unavailable in the current organization.",404);
  if(!["create","update","deactivate","archive"].includes(r.action))throw new GovernanceError("PAYMENT_RISK_POLICY_INVALID","Use a supported policy creation, amendment or withdrawal request.",400);
  if(!r.submitted_by||r.submitted_by===input.actorId)throw new GovernanceError("PAYMENT_RISK_POLICY_INDEPENDENCE_REQUIRED","The maker cannot approve or apply their own payment-risk policy, including through an administrator override.",403);
  const parsed=patchSchema.safeParse(r.proposed_patch);
  if(!parsed.success)throw new GovernanceError("PAYMENT_RISK_POLICY_INVALID","Use only policy code, name, payment_risk type, active state and supported risk settings.",400);
  const raw=parsed.data;if(raw.policyType&&raw.policy_type)throw new GovernanceError("PAYMENT_RISK_POLICY_INVALID","Use one naming form for the policy type.",400);
  const patch:Record<string,unknown>={...raw};delete patch.policyType;if(raw.policyType)patch.policy_type=raw.policyType;
  const source=r.entity_id?(await c.query("SELECT to_jsonb(p) snapshot FROM mdm_procurement_policies p WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,r.entity_id])).rows[0]?.snapshot:null;
  if(r.action!=="create"&&!source)throw new GovernanceError("PAYMENT_RISK_POLICY_UNAVAILABLE","The policy source is unavailable in this organization.",404);
  if(r.action==="create"&&r.entity_id)throw new GovernanceError("PAYMENT_RISK_POLICY_INVALID","A new policy request must not borrow an existing target.",400);
  if(source&&source.policy_type!=="payment_risk"||!source&&patch.policy_type!=="payment_risk")throw new GovernanceError("PAYMENT_RISK_POLICY_IDENTITY_IMMUTABLE","A published policy cannot change its policy type. Submit a new policy instead.");
  const config=riskPolicySchema.safeParse(patch.config??source?.config??{});
  if(!config.success)throw new GovernanceError("PAYMENT_RISK_POLICY_INVALID","Use increasing thresholds, bounded history windows and mandatory independent release. No setting was applied.",400);
  const next={...source,...patch,config:config.data,active:patch.active??source?.active??true};
  if(r.action==="archive"||r.action==="deactivate")next.active=false;
  if(!next.code||!next.name)throw new GovernanceError("PAYMENT_RISK_POLICY_INVALID","A policy code and name are required.",400);
  const reason=input.reason?.trim()||String(r.reason??"").trim();if(reason.length<5||reason.length>2000)throw new GovernanceError("PAYMENT_RISK_POLICY_REASON_REQUIRED","Record a review reason between 5 and 2,000 characters.",400);
  const approval=(await c.query("SELECT * FROM payment_risk_policy_approvals WHERE organization_id=$1 AND change_request_id=$2",[org,input.id])).rows[0];
  if(action==="approve"){
   if(approval&&["approved","applied"].includes(r.status)&&governanceHash(approval.payload)===governanceHash(payload(r)))return {id:input.id,status:r.status,replayed:true};
   if(!["submitted","validation_passed","pending_approval"].includes(r.status))throw new GovernanceError("PAYMENT_RISK_POLICY_NOT_PENDING","Submit this policy for a fresh independent review.");
   await c.query("INSERT INTO payment_risk_policy_approvals(organization_id,change_request_id,payload,source_snapshot,approved_by) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)",[org,input.id,JSON.stringify(payload(r)),source?JSON.stringify(source):null,input.actorId]);
   await c.query("UPDATE mdm_change_requests SET status='approved',approved_by=$3,decided_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,input.id,input.actorId]);
  }else{
   if(!approval||governanceHash(approval.payload)!==governanceHash(payload(r)))throw new GovernanceError("PAYMENT_RISK_POLICY_APPROVAL_STALE","The approved payload changed. Submit it for a fresh independent review.");
   const prior=(await c.query("SELECT id,policy_id,applied_at FROM payment_risk_policy_revisions WHERE organization_id=$1 AND change_request_id=$2",[org,input.id])).rows[0];
   if(prior)return {id:input.id,status:"applied",revisionId:prior.id,policyId:prior.policy_id,appliedAt:prior.applied_at,replayed:true};
   if(r.status!=="approved"||approval.approved_by===r.submitted_by||governanceHash(approval.source_snapshot)!==governanceHash(source))throw new GovernanceError("PAYMENT_RISK_POLICY_APPROVAL_STALE","The policy source changed after review. Resubmit before application.");
   if(next.active&&(await c.query("SELECT id FROM mdm_procurement_policies WHERE organization_id=$1 AND policy_type='payment_risk' AND active AND id IS DISTINCT FROM $2::int LIMIT 1",[org,r.entity_id??null])).rowCount)
    throw new GovernanceError("PAYMENT_RISK_POLICY_COMPETING","There is already an active risk policy. Independently withdraw it or amend that policy; no arbitrary winner is selected.");
   await c.query("SELECT set_config('app.approved_risk_policy_request',$1,true)",[String(input.id)]);
   let policyId=Number(r.entity_id);
   if(r.action==="create")policyId=(await c.query(`INSERT INTO mdm_procurement_policies(organization_id,code,name,policy_type,config,active) VALUES($1,$2,$3,'payment_risk',$4::jsonb,$5) RETURNING id`,[org,next.code,next.name,JSON.stringify(config.data),next.active??true])).rows[0].id;
   else await c.query("UPDATE mdm_procurement_policies SET code=$3,name=$4,config=$5::jsonb,active=$6,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,policyId,next.code,next.name,JSON.stringify(config.data),next.active]);
   const snapshot=(await c.query("SELECT to_jsonb(p) snapshot FROM mdm_procurement_policies p WHERE organization_id=$1 AND id=$2",[org,policyId])).rows[0].snapshot;
   const revision=(await c.query(`INSERT INTO payment_risk_policy_revisions(organization_id,policy_id,change_request_id,source_snapshot,approved_by,applied_by,approved_at)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING id,applied_at`,[org,policyId,input.id,JSON.stringify(snapshot),approval.approved_by,input.actorId,approval.approved_at])).rows[0];
   await c.query("UPDATE mdm_change_requests SET status='applied' WHERE organization_id=$1 AND id=$2",[org,input.id]);
   await c.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason,after_state) VALUES($1,$2,'apply','applied',$3,$4,$5::jsonb)",[org,input.id,input.actorId,reason,JSON.stringify(snapshot)]);
   await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:input.actorId},action:"PAYMENT_RISK_POLICY_APPLIED",resourceType:"mdm_change_request",resourceId:input.id,after:{policyId,revisionId:revision.id},reason});
   return {id:input.id,status:"applied",policyId,revisionId:revision.id,appliedAt:revision.applied_at};
  }
  await c.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason) VALUES($1,$2,'approval','approved',$3,$4)",[org,input.id,input.actorId,reason]);
  await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:input.actorId},action:"PAYMENT_RISK_POLICY_APPROVED",resourceType:"mdm_change_request",resourceId:input.id,after:payload(r),reason});
  return {id:input.id,status:"approved"};
 });
}
