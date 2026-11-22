import {randomUUID} from "node:crypto";
import {drizzle} from "drizzle-orm/node-postgres";
import type {PoolClient} from "pg";
import {eq,and} from "drizzle-orm";
import {apPaymentBatches,payments,type InsertApPaymentBatch} from "@shared/schema";
import {getActiveOrganizationId} from "../../organization-context";
import {authorizeApprovalStep} from "../../services/approval-workflow-service";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
import {GovernanceError,governanceTransaction,governanceRetry,recordGovernanceDenial} from "../rbac/governance-context";
import {analyzeSod} from "../rbac/segregation-analysis";
import {paymentActor,collectPaymentRisk,requireCurrentPaymentRisk,assertPaymentReviewAuthority,paymentPolicyRoleMatches} from "./payment-risk";

export type GovernedPaymentContext={idempotencyKey?:string;riskAssessmentId?:number;comment?:string};
async function batchResult(c:PoolClient,org:number,id:number){
 const batch=(await drizzle(c).select().from(apPaymentBatches).where(and(eq(apPaymentBatches.organizationId,org),eq(apPaymentBatches.id,id))))[0];
 const proof=(await c.query(`SELECT b.currency_code,b.approved_risk_assessment_id,a.version,a.source_fingerprint FROM ap_payment_batches b
  LEFT JOIN payment_risk_assessments a ON a.id=b.approved_risk_assessment_id AND a.organization_id=b.organization_id AND a.batch_id=b.id
  WHERE b.organization_id=$1 AND b.id=$2`,[org,id])).rows[0];
 return {...batch,currencyCode:proof.currency_code,approvedRiskAssessmentId:proof.approved_risk_assessment_id,
  approvedRiskAssessmentVersion:proof.version,approvedRiskSourceFingerprint:proof.source_fingerprint};
}
export async function createGovernedPaymentBatch(input:InsertApPaymentBatch&{invoiceIds?:number[]},user:number,key:string){
  const org=getActiveOrganizationId();
  return governanceTransaction(async c=>{
    await paymentActor(c,org,user,"create");
    await c.query("SELECT pg_advisory_xact_lock(723411,$1)",[org]);
    return governanceRetry(c,org,user,key,"AP_PAYMENT_BATCH_CREATED",input,async()=>{
      const ids=[...new Set(input.invoiceIds??[])].sort((a,b)=>a-b);
      if(!ids.length||ids.length>500||ids.some(id=>!Number.isInteger(id)||id<=0))throw new GovernanceError("PAYMENT_BATCH_INVALID","Select between 1 and 500 eligible invoices.",400);
      const rows=(await c.query(`SELECT id,supplier_id,currency_code,status::text,coalesce(due_amount,total)::numeric::text due
        FROM invoices WHERE organization_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE`,[org,ids])).rows;
      if(rows.length!==ids.length)throw new GovernanceError("PAYMENT_SOURCE_UNAVAILABLE","An invoice is unavailable in this organization.",404);
      if(rows.some(r=>!["APPROVED","PARTIALLY_PAID","OVERDUE"].includes(r.status)||!/^[0-9]+(?:\.[0-9]+)?$/.test(r.due)||Number(r.due)<=0))
        throw new GovernanceError("PAYMENT_INVOICE_NOT_APPROVED","Every selected invoice must have a positive approved unpaid balance.");
      if(new Set(rows.map(r=>r.currency_code)).size!==1)throw new GovernanceError("PAYMENT_MIXED_CURRENCY","Create separate batches for each original currency. No conversion or mixed-currency total is inferred.");
      const duplicate=await c.query(`SELECT bi.invoice_id FROM ap_payment_batch_items bi JOIN ap_payment_batches b ON b.id=bi.batch_id
        WHERE b.organization_id=$1 AND b.status IN ('DRAFT','PENDING_APPROVAL','APPROVED') AND bi.invoice_id=ANY($2::int[]) LIMIT 1`,[org,ids]);
      if(duplicate.rowCount)throw new GovernanceError("PAYMENT_INVOICE_ALREADY_BATCHED","A selected invoice is already in an unreleased batch.");
      const invalidMatch=await c.query(`SELECT i.id FROM invoices i LEFT JOIN LATERAL(SELECT status FROM ap_invoice_match_results
        WHERE organization_id=i.organization_id AND invoice_id=i.id ORDER BY created_at DESC,id DESC LIMIT 1)m ON true
        WHERE i.organization_id=$1 AND i.id=ANY($2::int[]) AND i.purchase_order_id IS NOT NULL AND (m.status IS NULL OR m.status='EXCEPTION') LIMIT 1`,[org,ids]);
      if(invalidMatch.rowCount)throw new GovernanceError("PAYMENT_MATCH_REQUIRED","Resolve PO matching before adding this invoice to a payment batch.");
      const amount=(await c.query("SELECT sum(x.due::numeric)::text amount FROM jsonb_to_recordset($1::jsonb)x(due text)",[JSON.stringify(rows)])).rows[0].amount;
      const metadata=input.exportMetadata??{};
      if(Object.keys(metadata).some(k=>!["reference","urgentReason"].includes(k))||
        Object.values(metadata).some(v=>typeof v!=="string"||v.length>500))throw new GovernanceError("PAYMENT_METADATA_INVALID","Only a bounded reference and explicit urgency reason are supported.",400);
      const batch=(await c.query(`INSERT INTO ap_payment_batches(organization_id,batch_number,status,currency_code,total_amount,payment_method,
        scheduled_date,export_metadata,notes,created_by) VALUES($1,$2,'PENDING_APPROVAL',$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,
        [org,input.batchNumber?.trim()||`APB-${randomUUID()}`,rows[0].currency_code,amount,input.paymentMethod??"BANK_TRANSFER",input.scheduledDate??null,JSON.stringify(metadata),input.notes??null,user])).rows[0];
      await c.query(`INSERT INTO ap_payment_batch_items(batch_id,invoice_id,amount,status) SELECT $1,x.id,x.due::numeric,'PENDING'
        FROM jsonb_to_recordset($2::jsonb)x(id int,due text)`,[batch.id,JSON.stringify(rows)]);
      await c.query(`INSERT INTO approval_history(organization_id,entity_type,entity_id,action,performed_by,new_status,level)
        VALUES($1,'payment_batch',$2,'submitted',$3,'PENDING_APPROVAL',0)`,[org,batch.id,user]);
      await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"AP_PAYMENT_BATCH_CREATED",resourceType:"payment_batch",resourceId:batch.id,
        after:{invoiceIds:ids,currency:rows[0].currency_code,amount,status:"PENDING_APPROVAL"}});
      return batchResult(c,org,batch.id);
    });
  });
}
export async function governedPaymentAction(id:number,user:number,action:"approve"|"release",context:GovernedPaymentContext){
  const org=getActiveOrganizationId();
  return governanceTransaction(async c=>{
    const actor=await paymentActor(c,org,user,action==="approve"?"approve":"execute");
    await c.query("SELECT pg_advisory_xact_lock(723411,$1)",[org]);
    return governanceRetry(c,org,user,context.idempotencyKey??"",`AP_PAYMENT_BATCH_${action.toUpperCase()}`,{id,assessment:context.riskAssessmentId,comment:context.comment},async()=>{
      const source=await collectPaymentRisk(c,org,id),batch=source.batch;
      if(action==="release"&&batch.status==="RELEASED")return batchResult(c,org,id);
      if(batch.created_by===user)throw new GovernanceError("PAYMENT_BATCH_SELF_APPROVAL_BLOCKED","The batch creator cannot approve or release their own batch. Administrator overrides do not bypass independence.",403);
      const risk=await requireCurrentPaymentRisk(c,org,id,context.riskAssessmentId,source);
      const separation=await analyzeSod(c,org,{kind:"user",userId:user});
      if(separation.conflicts.some(r=>r.severity==="CRITICAL"&&r.enforcement_mode!=="WARN"&&!r.exception_id))
        throw new GovernanceError("PAYMENT_SOD_CONFLICT","Your current access contains an unmitigated critical conflict. Ask Security to separate the conflicting duties.",403,separation.conflicts);
      if(action==="approve"){
        if(batch.status!=="PENDING_APPROVAL")throw new GovernanceError("PAYMENT_BATCH_STATE_CHANGED","Only a pending batch can receive a new approval. Reassess stale approvals first.");
        await assertPaymentReviewAuthority(c,org,user,source.amount,source.currency);
        const boundary=Number((await c.query(`SELECT coalesce(max(id),0) boundary FROM approval_history WHERE organization_id=$1 AND entity_type='payment_batch'
          AND entity_id=$2 AND payment_risk_assessment_id IS DISTINCT FROM $3::bigint`,[org,id,risk.id])).rows[0].boundary);
        const step=await authorizeApprovalStep({organizationId:org,entityType:"payment_batch",entityId:id,amount:Number(source.amount),amountCurrency:source.currency,
          actorUserId:user,actorRole:actor.role,actorPreferences:{customRoleId:actor.customRoleId}},drizzle(c),{afterHistoryId:boundary,independent:true});
        if(!paymentPolicyRoleMatches(step.progress.nextPolicy?.approverRole,actor.role,actor.customRoleId))throw new GovernanceError("PAYMENT_APPROVAL_AUTHORITY_REQUIRED","The next approval level does not explicitly authorize your current role.",403);
        await c.query(`INSERT INTO approval_history(organization_id,entity_type,entity_id,action,performed_by,level,previous_status,new_status,comment,payment_risk_assessment_id)
          VALUES($1,'payment_batch',$2,'approved',$3,$4,'PENDING_APPROVAL',$5,$6,$7)`,[org,id,user,step.level,step.isFinal?"APPROVED":"PENDING_APPROVAL",context.comment??null,risk.id]);
        if(step.isFinal)await c.query("UPDATE ap_payment_batches SET status='APPROVED',approved_by=$3,approved_at=clock_timestamp(),approved_risk_assessment_id=$4,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,id,user,risk.id]);
        await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"AP_PAYMENT_BATCH_APPROVED",resourceType:"payment_batch",resourceId:id,
          after:{assessmentId:risk.id,assessmentVersion:risk.version,fingerprint:risk.source_fingerprint,level:step.level,final:step.isFinal}});
      }else{
        if(batch.status!=="APPROVED"||Number(batch.approved_risk_assessment_id)!==Number(risk.id))
          throw new GovernanceError("PAYMENT_RISK_REASSESSMENT_REQUIRED","The batch approval does not authorize this exact current risk assessment.");
        const approvers=(await c.query(`SELECT performed_by FROM approval_history WHERE organization_id=$1 AND entity_type='payment_batch'
          AND entity_id=$2 AND action='approved' AND payment_risk_assessment_id=$3`,[org,id,risk.id])).rows.map(r=>Number(r.performed_by));
        const reviewer=(await c.query("SELECT reviewed_by FROM payment_risk_reviews WHERE organization_id=$1 AND assessment_id=$2",[org,risk.id])).rows[0]?.reviewed_by;
        if(source.policy.independentRelease&&(approvers.includes(user)||reviewer===user))throw new GovernanceError("PAYMENT_RELEASE_INDEPENDENCE_REQUIRED","Release must be performed by someone other than the batch and risk approvers.",403);
        const invoiceApproval=await c.query(`SELECT 1 FROM approval_history WHERE organization_id=$1 AND entity_type='invoice' AND action='approved'
          AND performed_by=$2 AND entity_id=ANY($3::int[]) LIMIT 1`,[org,user,source.items.map(i=>i.invoice_id)]);
        if(invoiceApproval.rowCount)throw new GovernanceError("PAYMENT_RELEASE_INDEPENDENCE_REQUIRED","An invoice approver cannot release this batch.",403);
        await c.query("SELECT set_config('app.ap_reporting_actor',$1,true),set_config('app.payment_risk_assessment',$2,true),set_config('app.payment_risk_releasing_batch',$3,true)",[String(user),String(risk.id),String(id)]);
        const database=drizzle(c);
        // Same canonical payments, invoice balances and batch-item ledger. The
        // reporting triggers capture balance evidence in this transaction.
        const recorded=await database.insert(payments).values(source.items.map(i=>({invoiceId:i.invoice_id,amount:Number(i.amount),method:batch.payment_method,
          receivedBy:user,paymentDate:new Date(),transactionReference:batch.export_metadata?.reference??null,notes:`Recorded via AP batch ${batch.batch_number}; not proof of bank settlement.`}))).returning();
        await c.query(`UPDATE ap_payment_batch_items bi SET payment_id=x.payment_id,status='RELEASED',updated_at=clock_timestamp()
          FROM jsonb_to_recordset($1::jsonb)x(id int,payment_id int) WHERE bi.id=x.id AND bi.batch_id=$2`,
          [JSON.stringify(source.items.map(item=>({id:item.id,payment_id:recorded.find(p=>p.invoiceId===item.invoice_id)!.id}))),id]);
        await c.query(`UPDATE invoices i SET paid_amount=i.paid_amount+x.amount::numeric,due_amount=greatest(i.total-(i.paid_amount+x.amount::numeric),0),
          status=CASE WHEN i.total-(i.paid_amount+x.amount::numeric)<=0 THEN 'PAID'::invoice_status ELSE 'PARTIALLY_PAID'::invoice_status END,
          paid_date=CASE WHEN i.total-(i.paid_amount+x.amount::numeric)<=0 THEN now() ELSE i.paid_date END,updated_at=clock_timestamp()
          FROM (SELECT invoice_id,sum(amount::numeric) amount FROM jsonb_to_recordset($2::jsonb)x(invoice_id int,amount text) GROUP BY invoice_id)x
          WHERE i.organization_id=$1 AND i.id=x.invoice_id`,[org,JSON.stringify(source.items)]);
        await c.query("UPDATE ap_payment_batches SET status='RELEASED',released_by=$3,released_at=clock_timestamp(),updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,id,user]);
        await c.query(`INSERT INTO approval_history(organization_id,entity_type,entity_id,action,performed_by,level,previous_status,new_status,payment_risk_assessment_id)
          VALUES($1,'payment_batch',$2,'released',$3,0,'APPROVED','RELEASED',$4)`,[org,id,user,risk.id]);
        await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"AP_PAYMENT_BATCH_RELEASED",resourceType:"payment_batch",resourceId:id,
          after:{status:"RELEASED",assessmentId:risk.id,assessmentVersion:risk.version,paymentIds:recorded.map(p=>p.id)},details:{recordingOnly:true,bankSettlement:false}});
      }
      return batchResult(c,org,id);
    });
  }).catch(async error=>{await recordGovernanceDenial(org,user,error,"payment_batch",id);throw error;});
}
