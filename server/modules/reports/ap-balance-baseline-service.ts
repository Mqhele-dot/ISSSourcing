import type { Pool,PoolClient } from "pg";
import { pool } from "../../db";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";
import { authorizeApprovalStep } from "../../services/approval-workflow-service";
import { parseReportingDecimal,addReportingDecimals } from "../../lib/exact-reporting-decimal";

type Actor={organizationId:number;actorUserId:number;actorRole:string};
type BaselineLine={invoiceId:number;sourceRevision:string;snapshot:Record<string,string|null>};
const failure=(code:string,message:string,status=409)=>Object.assign(new Error(message),{code,status});

async function transaction<T>(database:Pick<Pool,"connect">,work:(c:PoolClient)=>Promise<T>):Promise<T> {
  const c=await database.connect();
  try {await c.query("BEGIN");const result=await work(c);await c.query("COMMIT");return result;}
  catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}

export async function prepareApCorrection(input:Actor&{invoiceId:number;targetEventId:string;patch:Record<string,string|null>;documentIds:number[];reason:string},database:Pick<Pool,"connect">=pool) {
  const allowed=new Set(["currencyCode","total","paidAmount","remainingBalance","status","issueDate","dueDate"]);
  if(!input.reason.trim()||!input.documentIds.length||input.documentIds.length>20||new Set(input.documentIds).size!==input.documentIds.length||!Object.keys(input.patch).length||Object.keys(input.patch).some(k=>!allowed.has(k))) throw failure("AP_BASELINE_INVALID_CORRECTION","Provide a reason, verified invoice documents and supported correction fields.",400);
  return transaction(database,async c=>{
    const source=(await c.query(`SELECT id,md5(to_jsonb(i)::text) revision FROM invoices i WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[input.organizationId,input.invoiceId])).rows[0];
    const target=(await c.query("SELECT * FROM ap_balance_events WHERE organization_id=$1 AND invoice_id=$2 AND id=$3",[input.organizationId,input.invoiceId,input.targetEventId])).rows[0];
    if(!source||!target||target.event_kind==='DELETED') throw failure("AP_BASELINE_CORRECTION_TARGET","Select an available invoice balance event in your organization.",404);
    const coverage=await c.query(`SELECT 1 FROM ap_balance_events WHERE organization_id=$1 AND invoice_id=$2 AND effective_at<=$3 AND actor_user_id IS NOT NULL AND event_kind IN ('CREATED','OPENING_BASELINE') LIMIT 1`,[input.organizationId,input.invoiceId,target.effective_at]);
    if(!coverage.rowCount) throw failure("AP_BASELINE_CORRECTION_COVERAGE","A correction cannot create history before verified opening coverage. Review an opening baseline first.");
    const docs=await c.query(`SELECT to_jsonb(d) evidence FROM documents d WHERE organization_id=$1 AND id=ANY($2::int[]) AND entity_id=$3 AND entity_type IN ('invoice','supplier_invoice','ap_invoice') AND archived_at IS NULL AND checksum IS NOT NULL AND trim(checksum)<>'' ORDER BY id FOR SHARE`,[input.organizationId,input.documentIds,input.invoiceId]);
    if(docs.rowCount!==input.documentIds.length) throw failure("AP_BASELINE_CORRECTION_DOCUMENTS","Use current, integrity-verified documents linked to this invoice in your organization.");
    const line:BaselineLine={invoiceId:input.invoiceId,sourceRevision:source.revision,snapshot:{...target.snapshot,...input.patch}};
    delete line.snapshot.deleted;
    validateLine(line);
    if(!["DRAFT","PENDING_APPROVAL","APPROVED","SENT","DISPUTED","PARTIALLY_PAID","PAID","OVERDUE","CANCELLED","VOID"].includes(String(line.snapshot.status))) throw failure("AP_BASELINE_CORRECTION_STATUS","Choose a supported invoice status backed by the attached evidence.",400);
    if(!(await c.query("SELECT 1 FROM currencies WHERE organization_id=$1 AND code=$2",[input.organizationId,line.snapshot.currencyCode])).rowCount) throw failure("AP_BASELINE_CORRECTION_CURRENCY","Choose a currency from your organization's Master Data.");
    const result=await c.query(`INSERT INTO ap_balance_baselines(organization_id,created_by,status,reason,proposal,request_kind,target_event_id,requested_effective_at,document_evidence)
      VALUES($1,$2,'DRAFT',$3,$4::jsonb,'CORRECTION',$5,$6,$7::jsonb) RETURNING id,status,proposal,request_kind AS "requestKind",requested_effective_at AS "effectiveAt"`,[input.organizationId,input.actorUserId,input.reason.trim(),JSON.stringify([line]),input.targetEventId,target.effective_at,JSON.stringify(docs.rows.map(r=>r.evidence))]);
    await appendAuditEventWithClient(c,{organizationId:input.organizationId,actor:{userId:input.actorUserId},action:"AP_CORRECTION_PREPARED",resourceType:"ap_balance_correction",resourceId:Number(result.rows[0].id),reason:input.reason,after:{targetEventId:input.targetEventId,documentIds:input.documentIds}});
    return result.rows[0];
  });
}

function validateLine(line:BaselineLine) {
  const s=line.snapshot;
  if(!s.supplierId||!s.currencyCode||!/^[A-Z]{3}$/.test(s.currencyCode)||!s.issueDate||!Number.isFinite(Date.parse(s.issueDate)))
    throw failure("AP_BASELINE_MISSING_EVIDENCE","An invoice is missing supplier, currency or issue-date evidence. Correct the source and prepare a new preview.");
  for(const key of ["total","paidAmount","remainingBalance"]) {
    try {if(s[key]===null||s[key]===undefined||parseReportingDecimal(s[key]!).coefficient<0n) throw new Error();}
    catch {throw failure("AP_BASELINE_INVALID_BALANCE","An invoice has missing, invalid or negative balance evidence. Review it before submitting.");}
  }
  const total=parseReportingDecimal(s.total!);
  const parts=addReportingDecimals(parseReportingDecimal(s.paidAmount!),parseReportingDecimal(s.remainingBalance!));
  if(total.coefficient*10n**BigInt(parts.scale)!==parts.coefficient*10n**BigInt(total.scale))
    throw failure("AP_BASELINE_UNRECONCILED","An invoice total does not match recorded payments plus its remaining balance. Reconcile the source before approving an opening baseline.");
}

export async function prepareApBaseline(input:Actor&{invoiceIds:number[];reason:string},database:Pick<Pool,"connect">=pool) {
  if(!input.invoiceIds.length||input.invoiceIds.length>100||new Set(input.invoiceIds).size!==input.invoiceIds.length||input.invoiceIds.some(id=>!Number.isSafeInteger(id)||id<1)||!input.reason.trim())
    throw failure("AP_BASELINE_INVALID_SELECTION","Select 1–100 distinct invoices and provide a review reason.",400);
  return transaction(database,async c=>{
    const rows=await c.query(`SELECT i.id AS "invoiceId",md5(to_jsonb(i)::text) AS "sourceRevision",ap_reporting_invoice_snapshot(to_jsonb(i)) AS snapshot
      FROM invoices i JOIN suppliers s ON s.id=i.supplier_id AND s.organization_id=i.organization_id
      WHERE i.organization_id=$1 AND i.id=ANY($2::int[]) ORDER BY i.id`,[input.organizationId,input.invoiceIds]);
    if(rows.rowCount!==input.invoiceIds.length) throw failure("AP_BASELINE_INVOICE_UNAVAILABLE","One or more selected invoices are not available in your organization.",404);
    const result=await c.query(`INSERT INTO ap_balance_baselines(organization_id,created_by,status,reason,proposal)
      VALUES($1,$2,'DRAFT',$3,$4::jsonb) RETURNING id,status,proposal,created_at AS "createdAt"`,[input.organizationId,input.actorUserId,input.reason.trim(),JSON.stringify(rows.rows)]);
    await appendAuditEventWithClient(c,{organizationId:input.organizationId,actor:{userId:input.actorUserId},action:"AP_BASELINE_PREPARED",resourceType:"ap_balance_baseline",resourceId:result.rows[0].id,after:{invoiceIds:input.invoiceIds}});
    return result.rows[0];
  });
}

export async function transitionApBaseline(input:Actor&{id:number;action:"submit"|"approve"},database:Pick<Pool,"connect">=pool,
  authorize:typeof authorizeApprovalStep=authorizeApprovalStep) {
  return transaction(database,async c=>{
    const row=(await c.query("SELECT * FROM ap_balance_baselines WHERE organization_id=$1 AND id=$2 FOR UPDATE",[input.organizationId,input.id])).rows[0];
    if(!row) throw failure("AP_BASELINE_NOT_FOUND","This opening baseline is not available in your organization.",404);
    const correction=row.request_kind==='CORRECTION',entityType=correction?'ap_balance_correction':'ap_balance_baseline';
    if(input.action==="approve"&&row.status==="APPLIED") return {id:row.id,status:row.status,appliedAt:row.applied_at};
    const proposal=row.proposal as BaselineLine[];
    if(input.action==="submit") {
      if(Number(row.created_by)!==input.actorUserId) throw failure("AP_BASELINE_CREATOR_REQUIRED","The person who prepared this preview must submit it.",403);
      if(row.status==="SUBMITTED") return {id:row.id,status:row.status};
      if(row.status!=="DRAFT") throw failure("AP_BASELINE_INVALID_STATE","Prepare a new opening baseline for review.");
      proposal.forEach(validateLine);
      await c.query("UPDATE ap_balance_baselines SET status='SUBMITTED',submitted_by=$3,submitted_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[input.organizationId,input.id,input.actorUserId]);
    } else {
      if([Number(row.created_by),Number(row.submitted_by)].includes(input.actorUserId)) throw failure("AP_BASELINE_INDEPENDENT_APPROVAL","A different authorized person must approve this opening baseline. Administrator status does not bypass this rule.",403);
      if(row.status!=="SUBMITTED") throw failure("AP_BASELINE_SUBMIT_REQUIRED","Submit this baseline for review before approval.");
      proposal.forEach(validateLine);
      const current=await c.query(`SELECT id,md5(to_jsonb(i)::text) revision FROM invoices i WHERE organization_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE`,[input.organizationId,proposal.map(l=>l.invoiceId)]);
      if(current.rowCount!==proposal.length||proposal.some(line=>current.rows.find(r=>Number(r.id)===line.invoiceId)?.revision!==line.sourceRevision))
        throw failure("AP_BASELINE_STALE","Selected invoices changed after this preview. Prepare and review a fresh baseline; no balances were applied.");
      if(correction) {
        const latest=(await c.query("SELECT id::text FROM ap_balance_events WHERE organization_id=$1 AND invoice_id=$2 AND effective_at=$3 ORDER BY id DESC LIMIT 1",[input.organizationId,proposal[0].invoiceId,row.requested_effective_at])).rows[0];
        if(latest?.id!==String(row.target_event_id)) throw failure("AP_BASELINE_CORRECTION_STALE","The selected historical event has already been corrected. Review the latest evidence before submitting a new correction.");
        const evidence=row.document_evidence as Array<{id:number}>;
        const docs=await c.query("SELECT to_jsonb(d) evidence FROM documents d WHERE organization_id=$1 AND id=ANY($2::int[]) AND archived_at IS NULL ORDER BY id FOR SHARE",[input.organizationId,evidence.map(d=>d.id)]);
        if(JSON.stringify(docs.rows.map(r=>r.evidence))!==JSON.stringify(evidence)) throw failure("AP_BASELINE_CORRECTION_DOCUMENTS_CHANGED","Supporting documents changed after review. Prepare a new correction preview.");
      } else {
        const covered=await c.query(`SELECT 1 FROM ap_balance_events WHERE organization_id=$1 AND invoice_id=ANY($2::int[]) AND (event_kind='OPENING_BASELINE' OR (event_kind='CREATED' AND actor_user_id IS NOT NULL)) LIMIT 1`,[input.organizationId,proposal.map(l=>l.invoiceId)]);
        if(covered.rowCount) throw failure("AP_BASELINE_ALREADY_COVERED","An invoice already has opening history. Do not create a second opening balance.");
      }
      const approval=await authorize({organizationId:input.organizationId,entityType,entityId:input.id,amount:0,actorUserId:input.actorUserId,actorRole:input.actorRole});
      if(approval.progress.completedApproverIds.includes(input.actorUserId)) throw failure("AP_BASELINE_INDEPENDENT_LEVEL","A different authorized person must complete the next approval level.",403);
      await c.query(`INSERT INTO approval_history(organization_id,entity_type,entity_id,level,action,performed_by,comment,previous_status,new_status)
        VALUES($1,$7,$2,$3,'approved',$4,$5,'SUBMITTED',$6)`,[input.organizationId,input.id,approval.level,input.actorUserId,row.reason,approval.isFinal?"APPLIED":"SUBMITTED",entityType]);
      if(!approval.isFinal) {
        await appendAuditEventWithClient(c,{organizationId:input.organizationId,actor:{userId:input.actorUserId},action:"AP_BASELINE_APPROVAL_LEVEL",resourceType:entityType,resourceId:input.id,after:{level:approval.level,policy:approval.progress.nextPolicy}});
        return {id:input.id,status:"SUBMITTED",pendingApproval:true};
      }
      const applicationTime=(await c.query("SELECT clock_timestamp() AS at")).rows[0].at;
      if(correction) {
        await c.query(`INSERT INTO ap_balance_events(organization_id,invoice_id,event_kind,source_revision,source_command_ref,previous_event_id,correction_request_id,target_event_id,actor_user_id,actor_provenance,snapshot,effective_at)
          SELECT $1,(line->>'invoiceId')::int,'CORRECTION',line->>'sourceRevision','correction:'||($2::bigint)::text||':invoice:'||(line->>'invoiceId'),
          (SELECT id FROM ap_balance_events WHERE organization_id=$1 AND invoice_id=(line->>'invoiceId')::int ORDER BY id DESC LIMIT 1),$2::bigint,$3,$4,'independently_approved_correction',line->'snapshot',$5
          FROM jsonb_array_elements($6::jsonb) line`,[input.organizationId,input.id,row.target_event_id,input.actorUserId,row.requested_effective_at,JSON.stringify(proposal)]);
      } else await c.query(`INSERT INTO ap_balance_events(organization_id,invoice_id,event_kind,source_revision,source_command_ref,previous_event_id,baseline_id,actor_user_id,actor_provenance,snapshot,effective_at)
        SELECT $1,(line->>'invoiceId')::int,'OPENING_BASELINE',line->>'sourceRevision','baseline:'||($2::bigint)::text||':invoice:'||(line->>'invoiceId'),
        (SELECT id FROM ap_balance_events e WHERE e.organization_id=$1 AND e.invoice_id=(line->>'invoiceId')::int ORDER BY id DESC LIMIT 1),$2::bigint,$3,'independently_approved_baseline',line->'snapshot',$5
        FROM jsonb_array_elements($4::jsonb) line`,[input.organizationId,input.id,input.actorUserId,JSON.stringify(proposal),applicationTime]);
      await c.query("UPDATE ap_balance_baselines SET status='APPLIED',approved_by=$3,applied_at=$4 WHERE organization_id=$1 AND id=$2",[input.organizationId,input.id,input.actorUserId,applicationTime]);
    }
    await appendAuditEventWithClient(c,{organizationId:input.organizationId,actor:{userId:input.actorUserId},action:input.action==="submit"?"AP_BASELINE_SUBMITTED":correction?"AP_CORRECTION_APPLIED":"AP_BASELINE_APPLIED",resourceType:entityType,resourceId:input.id,after:{invoiceIds:proposal.map(l=>l.invoiceId),targetEventId:row.target_event_id??null}});
    return {id:input.id,status:input.action==="submit"?"SUBMITTED":"APPLIED"};
  });
}
