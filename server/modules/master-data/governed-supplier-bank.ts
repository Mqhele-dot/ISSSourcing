import {z} from "zod";
import {governanceActor,governanceTransaction,GovernanceError,governanceHash} from "../rbac/governance-context";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";

const patchSchema=z.object({supplierId:z.number().int().positive().optional(),supplier_id:z.number().int().positive().optional(),
 bankName:z.string().trim().min(2).max(200).optional(),bank_name:z.string().trim().min(2).max(200).optional(),
 accountNumberMasked:z.string().trim().min(3).max(100).optional(),account_number_masked:z.string().trim().min(3).max(100).optional(),
 swiftCode:z.string().trim().max(20).nullable().optional(),swift_code:z.string().trim().max(20).nullable().optional(),
 currencyCode:z.string().regex(/^[A-Z]{3}$/).optional(),currency_code:z.string().regex(/^[A-Z]{3}$/).optional(),
 paymentMethod:z.string().max(40).optional(),payment_method:z.string().max(40).optional(),
 verificationStatus:z.enum(["unverified","verified","rejected"]).optional(),verification_status:z.enum(["unverified","verified","rejected"]).optional(),
 isDefault:z.boolean().optional(),is_default:z.boolean().optional(),active:z.boolean().optional()}).strict();
const aliases:Record<string,string>={supplierId:"supplier_id",bankName:"bank_name",accountNumberMasked:"account_number_masked",swiftCode:"swift_code",
 currencyCode:"currency_code",paymentMethod:"payment_method",verificationStatus:"verification_status",isDefault:"is_default"};
const frozenPayload=(r:Record<string,unknown>)=>({action:r.action,entityId:r.entity_id,patch:r.proposed_patch});
function normalize(raw:unknown){
 const parsed=patchSchema.parse(raw),out:Record<string,unknown>={};
 for(const[k,v]of Object.entries(parsed)){const key=aliases[k]??k;if(Object.hasOwn(out,key))throw new GovernanceError("BANK_PATCH_AMBIGUOUS","Use one naming form for each bank field.",400);out[key]=v;}
 return out;
}
export async function governSupplierBank(input:{organizationId:number;id:number;actorId:number;reason?:string},action:"approve"|"apply"){
 return governanceTransaction(async c=>{
  const org=input.organizationId,actor=await governanceActor(c,org,input.actorId);
  if(!await actor.can("master_data","read")||!await actor.can("suppliers","update")||
    !(await actor.can("master_data",action==="approve"?"approve":"execute")||await actor.can("settings",action==="approve"?"approve":"execute")))
    throw new GovernanceError("BANK_GOVERNANCE_ACCESS_DENIED","Current supplier maintenance and Master Data approval/application permission is required.",403);
  await c.query("SELECT pg_advisory_xact_lock(723411,$1)",[org]);
  const request=(await c.query("SELECT * FROM mdm_change_requests WHERE organization_id=$1 AND id=$2 AND domain IN ('supplier-bank-accounts','supplier-banks') FOR UPDATE",[org,input.id])).rows[0];
  if(!request)throw new GovernanceError("BANK_REQUEST_NOT_FOUND","Bank change request not found in this organization.",404);
  if(!request.submitted_by||Number(request.submitted_by)===input.actorId)throw new GovernanceError("BANK_INDEPENDENT_APPROVAL_REQUIRED","The maker cannot approve or apply their own supplier banking change. Administrator overrides do not bypass this control.",403);
  const patch=normalize(request.proposed_patch),source=request.entity_id?(await c.query("SELECT to_jsonb(b) snapshot FROM mdm_supplier_bank_accounts b WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,request.entity_id])).rows[0]?.snapshot:null;
  if(request.action!=="create"&&!source)throw new GovernanceError("BANK_SOURCE_UNAVAILABLE","The selected bank reference is unavailable in your organization.",404);
  const supplier=Number(patch.supplier_id??source?.supplier_id);
  if(!Number.isInteger(supplier)||source&&source.supplier_id!==supplier)throw new GovernanceError("BANK_SUPPLIER_CHANGED","A published bank reference cannot be moved to another supplier.");
  if(!(await c.query("SELECT id FROM suppliers WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,supplier])).rowCount)
    throw new GovernanceError("BANK_SOURCE_UNAVAILABLE","The selected supplier is unavailable in your organization.",404);
  const currency=String(patch.currency_code??source?.currency_code??"");
  if(!(await c.query("SELECT id FROM currencies WHERE organization_id=$1 AND code=$2 AND active",[org,currency])).rowCount)throw new GovernanceError("BANK_CURRENCY_REQUIRED","Select an active organization currency before approving this bank reference.");
  const reason=input.reason?.trim();if(!reason||reason.length<5)throw new GovernanceError("BANK_REASON_REQUIRED","Record the verification and supporting review reason.",400);
  if(action==="approve"){
    const prior=(await c.query("SELECT payload,approved_by,approved_at FROM supplier_bank_approvals WHERE organization_id=$1 AND change_request_id=$2",[org,input.id])).rows[0];
    if(prior&&["approved","applied"].includes(request.status)&&governanceHash(prior.payload)===governanceHash(frozenPayload(request)))return {id:input.id,status:request.status,approvedBy:prior.approved_by,approvedAt:prior.approved_at,replayed:true};
    if(!["submitted","validation_passed","pending_approval"].includes(request.status))throw new GovernanceError("BANK_REQUEST_NOT_PENDING","Submit this bank change for a fresh independent review.");
    const material={...source,...patch};
    if(!material.bank_name||!material.account_number_masked)throw new GovernanceError("BANK_REQUIRED_FIELDS","Bank name and masked reference are required. No banking identity will be invented.");
    await c.query("INSERT INTO supplier_bank_approvals(organization_id,change_request_id,payload,source_snapshot,approved_by) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)",
      [org,input.id,JSON.stringify(frozenPayload(request)),source?JSON.stringify(source):null,input.actorId]);
    await c.query("UPDATE mdm_change_requests SET status='approved',approved_by=$3,decided_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,input.id,input.actorId]);
    await c.query("SELECT invalidate_open_payment_risk($1,$2,NULL,'Bank change approved; application pending')",[org,supplier]);
    await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:input.actorId},action:"PAYMENT_RISK_INVALIDATED",resourceType:"supplier",resourceId:supplier,
      details:{changeRequestId:input.id,applicationPending:true,completedPaymentsChanged:false},reason});
  }else{
    const approval=(await c.query("SELECT * FROM supplier_bank_approvals WHERE organization_id=$1 AND change_request_id=$2",[org,input.id])).rows[0];
    const previous=(await c.query("SELECT id,bank_id,applied_at FROM supplier_bank_revisions WHERE organization_id=$1 AND change_request_id=$2",[org,input.id])).rows[0];
    if(!approval||governanceHash(approval.payload)!==governanceHash(frozenPayload(request)))throw new GovernanceError("BANK_APPROVAL_STALE","The approved payload changed. Resubmit it for independent review.");
    if(previous)return {id:input.id,status:"applied",revisionId:previous.id,bankId:previous.bank_id,appliedAt:previous.applied_at,replayed:true};
    if(request.status!=="approved"||approval.approved_by===request.submitted_by||
      governanceHash(approval.source_snapshot)!==governanceHash(source))throw new GovernanceError("BANK_APPROVAL_STALE","The bank source changed after approval. Submit a fresh review.");
    await c.query("SELECT set_config('app.approved_bank_request',$1,true)",[String(input.id)]);
    const columns=Object.keys(patch),values=Object.values(patch);
    let bankId=Number(request.entity_id);
    if(request.action==="create"){
      bankId=(await c.query(`INSERT INTO mdm_supplier_bank_accounts(organization_id,${columns.join(',')}) VALUES($1,${columns.map((_,i)=>`$${i+2}`).join(',')}) RETURNING id`,[org,...values])).rows[0].id;
    }else{
      if(request.action==="deactivate"||request.action==="archive")patch.active=false;
      const fields=Object.keys(patch);
      await c.query(`UPDATE mdm_supplier_bank_accounts SET ${fields.map((k,i)=>`${k}=$${i+3}`).join(',')},updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2`,[org,bankId,...Object.values(patch)]);
    }
    const snapshot=(await c.query("SELECT to_jsonb(b) snapshot FROM mdm_supplier_bank_accounts b WHERE organization_id=$1 AND id=$2",[org,bankId])).rows[0].snapshot;
    const identity=[supplier,snapshot.bank_name,snapshot.account_number_masked,snapshot.swift_code,snapshot.currency_code,snapshot.payment_method];
    const revision=(await c.query(`INSERT INTO supplier_bank_revisions(organization_id,supplier_id,bank_id,change_request_id,beneficiary_fingerprint,source_snapshot,approved_by,applied_by,approved_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id,applied_at`,[org,supplier,bankId,input.id,governanceHash(identity),JSON.stringify(snapshot),approval.approved_by,input.actorId,approval.approved_at])).rows[0];
    await c.query("UPDATE mdm_change_requests SET status='applied' WHERE organization_id=$1 AND id=$2",[org,input.id]);
    await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:input.actorId},action:"PAYMENT_RISK_INVALIDATED",resourceType:"supplier",resourceId:supplier,
      details:{changeRequestId:input.id,bankRevision:revision.id,scope:"Open payment assessments only; completed payments retained."},reason});
    await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:input.actorId},action:"SUPPLIER_BANK_APPLIED",resourceType:"mdm_change_request",resourceId:input.id,
      after:{bankId,revisionId:revision.id},reason});
    await c.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason) VALUES($1,$2,'apply','applied',$3,$4)",[org,input.id,input.actorId,reason]);
    return {id:input.id,status:"applied",bankId,revisionId:revision.id,appliedAt:revision.applied_at};
  }
  await c.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason) VALUES($1,$2,'approval','approved',$3,$4)",[org,input.id,input.actorId,reason]);
  await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:input.actorId},action:"SUPPLIER_BANK_APPROVED",resourceType:"mdm_change_request",resourceId:input.id,after:frozenPayload(request),reason});
  return {id:input.id,status:"approved"};
 });
}
