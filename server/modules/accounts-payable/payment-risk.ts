import type {PoolClient} from "pg";
import {riskPolicySchema,defaultRiskPolicy,type PaymentRiskSignal,type PaymentRiskView} from "@shared/procurement-governance";
import {GovernanceError,governanceActor,governanceHash} from "../rbac/governance-context";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
import {roleMatchesPolicy} from "../procurement/service";
import {recordGovernanceNotification} from "../../services/notification-emitter";
import {assertPaymentBatchTransition} from "./ap-state-machine";

export async function paymentActor(c:PoolClient,org:number,user:number,action:"read"|"create"|"approve"|"execute"){
  const actor=await governanceActor(c,org,user);
  if(!await actor.can("payments",action)||!await actor.can("finance",action)||!await actor.can("payments","read")||!await actor.can("finance","read")||
    !await actor.can("invoices","read")||!await actor.can("suppliers","read")||actor.warehouse_id!=null)
    throw new GovernanceError("PAYMENT_ACCESS_DENIED","Current Finance, payment, invoice and supplier read access, the command's payment/Finance authority, and no warehouse restriction are required.",403);
  return actor;
}
export async function assertPaymentReviewAuthority(c:PoolClient,org:number,user:number,amount:string,currency:string){
  const actor=await paymentActor(c,org,user,"approve");
  const policies=(await c.query(`SELECT approver_role,approver_user_id FROM approval_policies WHERE organization_id=$1 AND entity_type='payment_batch'
    AND is_active AND coalesce(amount_min,0)<=$2::numeric AND (amount_max IS NULL OR amount_max>=$2::numeric) FOR SHARE`,[org,amount])).rows;
  if(!policies.some(p=>(p.approver_user_id==null||p.approver_user_id===user)&&paymentPolicyRoleMatches(p.approver_role,actor.role,actor.customRoleId)))
    throw new GovernanceError("PAYMENT_APPROVAL_AUTHORITY_REQUIRED","No current payment approval policy authorizes you for this amount.",403);
  const limit=(await c.query("SELECT amount_limit,currency_code FROM user_approval_limits WHERE organization_id=$1 AND user_id=$2 AND entity_type='payment_batch' FOR SHARE",[org,user])).rows[0];
  if(limit&&(limit.currency_code!==currency||Number(limit.amount_limit)<Number(amount)))throw new GovernanceError("PAYMENT_APPROVAL_LIMIT_EXCEEDED","This amount or currency is outside your configured approval authority.",403);
  return actor;
}
// Canonical policy matching retains legacy admin behavior for unrelated flows.
// Payment governance requires an explicit policy role even for administrators.
export function paymentPolicyRoleMatches(policy:string|null|undefined,role:string,customRoleId:number|null){
 if(!policy)return false;
 if(role.toLowerCase()==="admin"&&!policy.split(/[,\s|/]+/).some(r=>r.toLowerCase()==="admin"))return false;
 return roleMatchesPolicy(policy,role,{customRoleId});
}

type RiskSource=Awaited<ReturnType<typeof collectPaymentRisk>>;
export async function collectPaymentRisk(c:PoolClient,org:number,batchId:number){
  await c.query("SELECT pg_advisory_xact_lock(723411,$1)",[org]);
  const batch=(await c.query("SELECT * FROM ap_payment_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,batchId])).rows[0];
  if(!batch)throw new GovernanceError("PAYMENT_BATCH_NOT_FOUND","Payment batch not found in this organization.",404);
  const policies=(await c.query(`SELECT p.id,p.config,to_jsonb(p) snapshot FROM mdm_procurement_policies p
    WHERE organization_id=$1 AND policy_type='payment_risk' AND active ORDER BY id LIMIT 2 FOR SHARE`,[org])).rows;
  if(policies.length>1)throw new GovernanceError("PAYMENT_RISK_POLICY_COMPETING","Multiple active risk policies need independent Finance review. No arbitrary policy was selected.");
  const configured=policies[0];
  const publication=configured?(await c.query(`SELECT id,applied_at,source_snapshot FROM payment_risk_policy_revisions
    WHERE organization_id=$1 AND policy_id=$2 ORDER BY id DESC LIMIT 1`,[org,configured.id])).rows[0]:null;
  if(configured&&(!publication||governanceHash(publication.source_snapshot)!==governanceHash(configured.snapshot)))
    throw new GovernanceError("PAYMENT_RISK_POLICY_APPROVAL_REQUIRED","Ask Finance to independently approve and apply this risk policy through Master Data before assessing payments.");
  const parsed=riskPolicySchema.safeParse(configured?.config??defaultRiskPolicy);
  if(!parsed.success)throw new GovernanceError("PAYMENT_RISK_POLICY_INVALID","Risk policy thresholds or windows need an administrator's review.");
  const policy={...parsed.data,reference:publication?`mdm:${configured.id}:revision:${publication.id}:${new Date(publication.applied_at).toISOString()}`:"default-v1"};
  const approvalPolicy=(await c.query(`SELECT id,version,approval_level,approver_role,approver_user_id,amount_min::text,amount_max::text
    FROM approval_policies WHERE organization_id=$1 AND entity_type='payment_batch' AND is_active ORDER BY approval_level,id FOR SHARE`,[org])).rows;
  const items=(await c.query(`SELECT bi.id,bi.invoice_id,bi.amount::numeric::text amount,bi.payment_id,
    i.supplier_id,i.currency_code,i.total::numeric::text invoice_total,i.due_amount::numeric::text due_amount,
    i.paid_amount::numeric::text paid_amount,i.status::text invoice_status,i.created_by,i.updated_at invoice_revision,
    i.purchase_order_id,s.name supplier_name,s.status supplier_status,s.onboarding_status,s.risk_rating,s.risk_status,s.compliance_status,
    (SELECT m.status::text FROM ap_invoice_match_results m WHERE m.organization_id=i.organization_id AND m.invoice_id=i.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) match_status
    FROM ap_payment_batch_items bi JOIN invoices i ON i.id=bi.invoice_id AND i.organization_id=$1
    JOIN suppliers s ON s.id=i.supplier_id AND s.organization_id=$1 WHERE bi.batch_id=$2 ORDER BY bi.id LIMIT 501`,[org,batchId])).rows;
  const itemCount=Number((await c.query("SELECT count(*) n FROM ap_payment_batch_items WHERE batch_id=$1",[batchId])).rows[0].n);
  if(!items.length||items.length!==itemCount||items.length>500)throw new GovernanceError("PAYMENT_SOURCE_REVIEW_REQUIRED","This batch has missing, inaccessible or excessive source rows. Use at most 500 verified same-tenant invoices per batch.");
  if(new Set(items.map(i=>i.invoice_id)).size!==items.length)throw new GovernanceError("PAYMENT_DUPLICATE_INVOICE","Each invoice may occur only once in this batch.");
  if(items.some(i=>![i.amount,i.invoice_total,i.due_amount,i.paid_amount].every(v=>typeof v==="string"&&/^\d+(?:\.\d+)?$/.test(v))))throw new GovernanceError("PAYMENT_AMOUNT_UNAVAILABLE","Finite nonnegative invoice balances and positive allocations are required.");
  if(!["RELEASED","CANCELLED"].includes(batch.status)&&items.some(i=>i.payment_id!=null))throw new GovernanceError("PAYMENT_PARTIAL_RELEASE_REVIEW_REQUIRED","This open batch contains recorded payment links and needs Finance reconciliation before further release.");
  await c.query("SELECT id FROM suppliers WHERE organization_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR SHARE",[org,[...new Set(items.map(i=>i.supplier_id))]]);
  await c.query("SELECT id FROM invoices WHERE organization_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE",[org,items.map(i=>i.invoice_id)]);
  await c.query("SELECT id FROM mdm_supplier_bank_accounts WHERE organization_id=$1 AND supplier_id=ANY($2::int[]) ORDER BY id FOR SHARE",[org,[...new Set(items.map(i=>i.supplier_id))]]);
  const count=(await c.query("SELECT count(*)::int count FROM ap_payment_batch_items WHERE batch_id=$1",[batchId])).rows[0].count;
  if(!count||count!==items.length||count>500)throw new GovernanceError("PAYMENT_BATCH_SOURCE_UNAVAILABLE","Every batch line must have an accessible invoice and supplier; batches support at most 500 lines.");
  const currencies=[...new Set(items.map(i=>i.currency_code))];
  if(currencies.length!==1||!currencies[0]||batch.currency_code&&batch.currency_code!==currencies[0])
    throw new GovernanceError("PAYMENT_BATCH_CURRENCY_UNVERIFIED","Use one verified original currency per batch. Mixed currencies are not added together.");
  const currency=String(currencies[0]);
  if(!(await c.query("SELECT id FROM currencies WHERE organization_id=$1 AND code=$2 AND active LIMIT 1",[org,currency])).rowCount)
    throw new GovernanceError("PAYMENT_CURRENCY_UNAVAILABLE","The batch currency needs active Master Data.");
  const amount=(await c.query("SELECT round(sum(amount::numeric),4)::text amount,round(sum(amount::numeric),4)=round($2::numeric,4) matches FROM ap_payment_batch_items WHERE batch_id=$1",[batchId,String(batch.total_amount)])).rows[0];
  if(!amount.matches||!/^\d+(\.\d+)?$/.test(amount.amount)||Number(amount.amount)<=0)throw new GovernanceError("PAYMENT_AMOUNT_UNVERIFIED","Batch total and invoice allocations do not agree. Rebuild this batch from current invoice balances.");
  const suppliers=[...new Set(items.map(i=>Number(i.supplier_id)))];
  const pendingBanks=(await c.query(`SELECT r.id,coalesce(b.supplier_id,
    CASE WHEN coalesce(a.payload->'patch'->>'supplierId',a.payload->'patch'->>'supplier_id') ~ '^[0-9]{1,9}$'
      THEN coalesce(a.payload->'patch'->>'supplierId',a.payload->'patch'->>'supplier_id')::int END) supplier_id,a.approved_at
    FROM supplier_bank_approvals a JOIN mdm_change_requests r ON r.id=a.change_request_id AND r.organization_id=a.organization_id AND r.status='approved'
    LEFT JOIN mdm_supplier_bank_accounts b ON b.id=r.entity_id AND b.organization_id=r.organization_id
    WHERE a.organization_id=$1 AND coalesce(b.supplier_id,
      CASE WHEN coalesce(a.payload->'patch'->>'supplierId',a.payload->'patch'->>'supplier_id') ~ '^[0-9]{1,9}$'
        THEN coalesce(a.payload->'patch'->>'supplierId',a.payload->'patch'->>'supplier_id')::int END)=ANY($2::int[]) ORDER BY supplier_id,r.id`,[org,suppliers])).rows;
  // Bank governance takes these locks in the same order. A release and bank
  // application cannot both authorize incompatible snapshots.
  await c.query("SELECT id FROM suppliers WHERE organization_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR SHARE",[org,suppliers]);
  await c.query("SELECT id FROM mdm_supplier_bank_accounts WHERE organization_id=$1 AND supplier_id=ANY($2::int[]) ORDER BY id FOR SHARE",[org,suppliers]);
  const banks=(await c.query(`WITH latest AS (SELECT DISTINCT ON(bank_id) * FROM supplier_bank_revisions WHERE organization_id=$1 AND supplier_id=ANY($2::int[]) ORDER BY bank_id,id DESC),
    eligible AS(SELECT b.*,r.id revision_id,r.beneficiary_fingerprint,r.applied_at FROM mdm_supplier_bank_accounts b
    JOIN latest r ON r.bank_id=b.id AND r.supplier_id=b.supplier_id AND r.source_snapshot=to_jsonb(b)
    WHERE b.organization_id=$1 AND b.supplier_id=ANY($2::int[]) AND b.active AND b.verification_status='verified' AND b.currency_code=$3),
    choices AS(SELECT supplier_id,CASE WHEN count(*) FILTER(WHERE is_default)=1 THEN min(id) FILTER(WHERE is_default)
      WHEN count(*)=1 THEN min(id) END bank_id FROM eligible GROUP BY supplier_id)
    SELECT e.supplier_id,e.id bank_id,e.revision_id,e.beneficiary_fingerprint,e.applied_at,
      e.applied_at>=transaction_timestamp()-make_interval(days=>$4::int) recent
    FROM choices x JOIN eligible e ON e.id=x.bank_id ORDER BY e.supplier_id`,[org,suppliers,currency,policy.recentBankDays])).rows;
  const bankMap=new Map(banks.map(b=>[Number(b.supplier_id),b]));
  const hist=(await c.query(`WITH target AS(SELECT supplier_id::int,bank_fingerprint,amount::numeric FROM jsonb_to_recordset($4::jsonb)
    AS x(supplier_id int,bank_fingerprint text,amount text)),
    recordings AS MATERIALIZED(SELECT i.supplier_id,p.id,p.invoice_id,p.amount::numeric amount,p.transaction_reference,p.payment_date,p.risk_assessment_id,r.beneficiary_fingerprint
      FROM payments p JOIN invoices i ON i.id=p.invoice_id AND i.organization_id=$1
      LEFT JOIN supplier_bank_revisions r ON r.id=p.bank_evidence_revision AND r.organization_id=i.organization_id AND r.supplier_id=i.supplier_id
      WHERE i.supplier_id=ANY($2::int[]) AND i.currency_code=$3 AND p.payment_date>=transaction_timestamp()-make_interval(days=>$5::int)),
    verified AS MATERIALIZED(SELECT DISTINCT h.id FROM recordings h JOIN ap_payment_batch_items bi ON bi.payment_id=h.id AND bi.invoice_id=h.invoice_id
      JOIN ap_payment_batches b ON b.id=bi.batch_id AND b.organization_id=$1 AND b.status='RELEASED' AND b.approved_risk_assessment_id=h.risk_assessment_id
      JOIN payment_risk_assessments a ON a.id=b.approved_risk_assessment_id AND a.organization_id=b.organization_id AND a.batch_id=b.id),
    history AS(SELECT h.*,v.id IS NOT NULL verified FROM recordings h LEFT JOIN verified v ON v.id=h.id),
    targets AS(SELECT supplier_id,max(bank_fingerprint) bank_fingerprint,array_agg(amount) amounts FROM target GROUP BY supplier_id)
    SELECT t.supplier_id,count(h.amount)::int recorded,count(h.amount) FILTER(WHERE h.verified AND h.beneficiary_fingerprint IS NOT NULL)::int verified,
      count(h.amount) FILTER(WHERE h.verified AND h.beneficiary_fingerprint=t.bank_fingerprint)::int beneficiary_payments,
      percentile_disc(0.5) WITHIN GROUP(ORDER BY h.amount) FILTER(WHERE h.amount>0)::text median,
      count(h.amount) FILTER(WHERE h.amount=ANY(t.amounts))::int duplicate_amounts,
      count(h.amount) FILTER(WHERE h.payment_date>=transaction_timestamp()-make_interval(hours=>$6::int))::int recent_payments,
      count(h.amount) FILTER(WHERE $7<>'' AND lower(btrim(h.transaction_reference))=$7)::int duplicate_references
    FROM targets t LEFT JOIN history h ON h.supplier_id=t.supplier_id GROUP BY t.supplier_id ORDER BY t.supplier_id`,[org,suppliers,currency,
    JSON.stringify(items.map(i=>({supplier_id:i.supplier_id,bank_fingerprint:bankMap.get(Number(i.supplier_id))?.beneficiary_fingerprint??null,amount:i.amount}))),
    policy.historyDays,policy.splitWindowHours,String(batch.export_metadata?.reference??"").trim().toLowerCase()])).rows;
  const related=(await c.query(`SELECT i.supplier_id,count(DISTINCT b.id)::int other_batches,
    count(*) FILTER(WHERE $4<>'' AND lower(btrim(b.export_metadata->>'reference'))=$4)::int duplicate_references
    FROM ap_payment_batch_items bi JOIN ap_payment_batches b ON b.id=bi.batch_id AND b.organization_id=$1
    JOIN invoices i ON i.id=bi.invoice_id AND i.organization_id=$1
    WHERE i.supplier_id=ANY($2::int[]) AND i.currency_code=$3 AND b.id<>$5 AND b.status IN ('DRAFT','PENDING_APPROVAL','APPROVED')
    AND coalesce(b.scheduled_date,b.created_at)>=transaction_timestamp()-make_interval(hours=>$6::int) GROUP BY i.supplier_id ORDER BY i.supplier_id`,
    [org,suppliers,currency,String(batch.export_metadata?.reference??"").trim().toLowerCase(),batchId,policy.splitWindowHours])).rows;
  const mismatches=(await c.query(`SELECT i.supplier_id,count(*)::int count FROM ap_invoice_match_results m
    JOIN invoices i ON i.id=m.invoice_id AND i.organization_id=m.organization_id WHERE m.organization_id=$1 AND i.supplier_id=ANY($2::int[])
    AND m.status='EXCEPTION' AND NOT(m.invoice_id=ANY($4::int[])) AND m.created_at>=transaction_timestamp()-make_interval(days=>$3::int) GROUP BY i.supplier_id ORDER BY i.supplier_id`,[org,suppliers,policy.historyDays,items.map(i=>i.invoice_id)])).rows;
  const signals:PaymentRiskSignal[]=[];
  const add=(code:string,resourceKey:string,points:number,explanation:string,evidence:Record<string,unknown>={})=>signals.push({code,resourceKey,points,explanation,evidence});
  let hold=false;
  for(const supplier of suppliers){
    const cohort=items.filter(i=>Number(i.supplier_id)===supplier),s=cohort[0],bank=bankMap.get(supplier);
    const h=hist.find(r=>Number(r.supplier_id)===supplier)??{},r=related.find(r=>Number(r.supplier_id)===supplier)??{},resource=`supplier:${supplier}`;
    if(pendingBanks.some(r=>Number(r.supplier_id)===supplier)){hold=true;add("BANK_CHANGE_AWAITING_APPLICATION",resource,35,"An independently approved bank change has not been applied. Complete the governed application, then reassess before releasing payments.");}
    if(!bank){hold=true;add("UNKNOWN_BANK_HISTORY",resource,35,"No unique, independently approved current bank reference is available. Obtain governed bank approval before release.");}
    else{
      if(bank.recent)add("RECENT_BANK_CHANGE",resource,25,"The recorded bank reference was applied within the policy's recent-change window.",{bankRevision:String(bank.revision_id),appliedAt:bank.applied_at,windowDays:policy.recentBankDays});
      if(!h.beneficiary_payments){add("FIRST_PAYMENT_TO_BENEFICIARY",resource,10,"No recorded payment to this approved bank reference exists in the inspected history.");add("NEW_BENEFICIARY",resource,10,"This beneficiary reference has not yet been used in recorded payment history.");}
    }
    if(!h.recorded)add("FIRST_PAYMENT_TO_SUPPLIER",resource,10,"First observed payment to this supplier in the inspected history; this is not a claim about unavailable earlier history.");
    if(Number(h.verified??0)<policy.minimumHistory)add("UNKNOWN_PAYMENT_HISTORY",resource,15,"There is insufficient verified recorded-payment history to establish normal behavior.",{verified:h.verified??0,required:policy.minimumHistory,windowDays:policy.historyDays});
    if(h.median&&cohort.some(i=>Number(i.amount)>Number(h.median)*policy.abnormalMultiple))add("PAYMENT_ABOVE_NORMAL_RANGE",resource,20,"An allocation exceeds the configured multiple of the same-currency recorded median.",{median:h.median,multiple:policy.abnormalMultiple,currency,legacyPrecision:true});
    if(Number(h.duplicate_references??0)+Number(r.duplicate_references??0)>0)add("DUPLICATE_PAYMENT_REFERENCE",resource,30,"This payment reference is also present in recorded or open-batch evidence.");
    if(Number(h.duplicate_amounts??0)>0)add("DUPLICATE_PAYMENT_AMOUNT",resource,5,"A matching same-currency recorded payment amount requires review; equal amounts alone are not proof of duplication.");
    if(Number(r.other_batches??0)+Number(h.recent_payments??0)>0)add("POTENTIAL_SPLIT_PAYMENT",resource,10,"Other same-currency payments or open batches exist in the configured window. Review related obligations rather than assuming evasion.",{otherBatches:r.other_batches??0,recentPayments:h.recent_payments??0});
    if([s.risk_rating,s.risk_status,s.compliance_status].some(v=>/high|critical|blocked/i.test(v??"")))add("SUPPLIER_HIGH_RISK",resource,25,"The supplier's recorded risk or compliance state requires Finance review.");
    if(cohort.some(i=>i.match_status==="EXCEPTION")){hold=true;add("OPEN_AP_EXCEPTION",resource,30,"A current invoice matching exception must be resolved through AP before release.");}
    const history=mismatches.find(r=>Number(r.supplier_id)===supplier);
    if(history?.count)add("INVOICE_MISMATCH_HISTORY",resource,10,"The inspected supplier history contains matching exceptions.",{count:history.count});
    if(s.supplier_status!=="active"||String(s.onboarding_status).toLowerCase()!=="approved"){hold=true;add("SUPPLIER_NOT_ELIGIBLE",resource,35,"The supplier is not currently active and independently approved for new transactions.");}
    if(cohort.some(i=>!["APPROVED","PARTIALLY_PAID","OVERDUE"].includes(i.invoice_status)||Number(i.amount)<=0||Number(i.amount)>Number(i.due_amount))){hold=true;add("INVOICE_NOT_PAYABLE",resource,35,"An invoice is not approved/payable for its proposed allocation.");}
    if(cohort.some(i=>i.purchase_order_id&&!i.match_status)){hold=true;add("MATCH_EVIDENCE_MISSING",resource,25,"A PO-linked invoice lacks current matching evidence.");}
  }
  if(batch.export_metadata?.urgentReason)add("URGENT_OVERRIDE",`batch:${batchId}`,10,"Manual urgency was requested; it does not bypass independent review.",{reason:String(batch.export_metadata.urgentReason).slice(0,500)});
  add("BANK_COUNTRY_UNAVAILABLE",`batch:${batchId}`,0,"Reliable bank-country evidence is not stored by this bank-reference model; no country match or clearance is inferred.");
  const score=Math.min(100,signals.reduce((n,s)=>n+s.points,0));
  const unknown=signals.some(s=>s.code.startsWith("UNKNOWN_"));
  const level=hold||score>=policy.critical?"CRITICAL":score>=policy.high?"HIGH":score>=policy.medium||unknown?"MEDIUM":"LOW";
  const evidence={batch:{id:batchId,method:batch.payment_method,scheduledDate:batch.scheduled_date,metadata:batch.export_metadata},items,banks,pendingBanks,hist,related,mismatches,
    policy,approvalPolicy,precisionWarning:"Source amounts retain legacy REAL precision. Recorded payments are not proof of bank settlement.",signals};
  return {batch,items,banks,policy,signals,score,level,hold,amount:String(amount.amount),currency,evidence,fingerprint:governanceHash(evidence)};
}

export async function assessPaymentRisk(c:PoolClient,org:number,user:number,batchId:number){
  await paymentActor(c,org,user,"read");
  const source=await collectPaymentRisk(c,org,batchId);
  if(["RELEASED","CANCELLED"].includes(source.batch.status))throw new GovernanceError("PAYMENT_RISK_TERMINAL","Completed or cancelled batches retain their historical evidence; no new assessment is posted.");
  const current=(await c.query("SELECT * FROM payment_risk_assessments WHERE organization_id=$1 AND batch_id=$2 AND status<>'STALE' FOR UPDATE",[org,batchId])).rows[0];
  if(current?.source_fingerprint===source.fingerprint&&Date.now()-new Date(current.assessed_at).getTime()<source.policy.maxAgeHours*3600000)return current;
  if(current)await c.query("UPDATE payment_risk_assessments SET status='STALE',stale_at=clock_timestamp(),stale_reason='Material source, policy or evidence freshness changed' WHERE id=$1 AND organization_id=$2",[current.id,org]);
  const version=Number((await c.query("SELECT coalesce(max(version),0)+1 version FROM payment_risk_assessments WHERE organization_id=$1 AND batch_id=$2",[org,batchId])).rows[0].version);
  const assessment=(await c.query(`INSERT INTO payment_risk_assessments(organization_id,batch_id,version,assessed_by,source_fingerprint,policy,source_evidence,amount,currency_code,score,risk_level,status)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12) RETURNING *`,[org,batchId,version,user,source.fingerprint,JSON.stringify(source.policy),JSON.stringify(source.evidence),
      source.amount,source.currency,source.score,source.level,source.hold||source.level==="CRITICAL"?"BLOCKED":source.level==="LOW"?"CURRENT":"REVIEW_REQUIRED"])).rows[0];
  if(current)await c.query("UPDATE payment_risk_assessments SET superseded_by=$2 WHERE id=$1 AND organization_id=$3",[current.id,assessment.id,org]);
  if(source.signals.length)await c.query(`INSERT INTO payment_risk_signals(assessment_id,code,resource_key,points,explanation,evidence)
    SELECT $1,x.code,x."resourceKey",x.points,x.explanation,x.evidence FROM jsonb_to_recordset($2::jsonb)
    x(code text,"resourceKey" text,points int,explanation text,evidence jsonb)`,[assessment.id,JSON.stringify(source.signals)]);
  if(source.batch.status==="APPROVED"){
    assertPaymentBatchTransition(source.batch.status,"PENDING_APPROVAL",{riskReassessment:true});
    await c.query("UPDATE ap_payment_batches SET status='PENDING_APPROVAL',approved_risk_assessment_id=NULL,approved_by=NULL,approved_at=NULL,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,batchId]);
    await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"PAYMENT_RISK_INVALIDATED",resourceType:"payment_batch",resourceId:batchId,
      before:{status:"APPROVED",assessmentId:source.batch.approved_risk_assessment_id},after:{status:"PENDING_APPROVAL",assessmentId:assessment.id},reason:"Reassessment requires a fresh approval cycle."});
  }
  await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"PAYMENT_RISK_ASSESSED",resourceType:"payment_batch",resourceId:batchId,
    after:{assessmentId:assessment.id,version,score:source.score,level:source.level,fingerprint:source.fingerprint},details:{signals:source.signals}});
  if(source.level!=="LOW")await recordGovernanceNotification(c,org,{entityType:"payment_risk",entityId:batchId,transitionKey:`payment-risk:${assessment.id}:assessed`,
    title:"Payment batch needs independent Finance review",body:`Batch ${batchId}: ${source.level.toLowerCase()} risk. Review current evidence and required actions; this is not bank settlement.`,targetPath:`/finance/accounts-payable/payments?riskBatch=${batchId}`,priority:source.level==="CRITICAL"?"urgent":"high"});
  return assessment;
}

export async function reviewPaymentRisk(c:PoolClient,org:number,user:number,batchId:number,assessmentId:number,reason:string){
  const source=await collectPaymentRisk(c,org,batchId);
  const row=(await c.query("SELECT * FROM payment_risk_assessments WHERE organization_id=$1 AND batch_id=$2 AND id=$3 FOR UPDATE",[org,batchId,assessmentId])).rows[0];
  await assertPaymentReviewAuthority(c,org,user,source.amount,source.currency);
  if(!row)throw new GovernanceError("PAYMENT_RISK_NOT_FOUND","Risk assessment not found in this batch.",404);
  if(row.assessed_by===user||source.batch.created_by===user)throw new GovernanceError("PAYMENT_RISK_SELF_REVIEW_DENIED","The assessor and batch creator cannot approve their own risk review.",403);
  if(!isRiskCurrent(row,source)||row.status==="BLOCKED")throw new GovernanceError("PAYMENT_RISK_REASSESSMENT_REQUIRED","Resolve holds and reassess current evidence before independent review.");
  const prior=(await c.query("SELECT * FROM payment_risk_reviews WHERE organization_id=$1 AND assessment_id=$2",[org,assessmentId])).rows[0];
  if(prior)return prior;
  const review=(await c.query("INSERT INTO payment_risk_reviews(organization_id,assessment_id,reviewed_by,reason) VALUES($1,$2,$3,$4) RETURNING *",[org,assessmentId,user,reason])).rows[0];
  await c.query("UPDATE payment_risk_assessments SET status='APPROVED_RISK' WHERE organization_id=$1 AND id=$2",[org,assessmentId]);
  await appendAuditEventWithClient(c,{organizationId:org,actor:{userId:user},action:"PAYMENT_RISK_REVIEWED",resourceType:"payment_batch",resourceId:batchId,after:{assessmentId,version:row.version},reason});
  await recordGovernanceNotification(c,org,{entityType:"payment_risk",entityId:batchId,transitionKey:`payment-risk:${assessmentId}:reviewed`,title:"Payment risk review recorded",body:`Batch ${batchId} still requires exact-assessment batch approval and independent release.`,targetPath:`/finance/accounts-payable/payments?riskBatch=${batchId}`});
  return review;
}
export function isRiskCurrent(row:Record<string,any>,source:RiskSource){
  return row.status!=="STALE"&&row.source_fingerprint===source.fingerprint&&Date.now()-new Date(row.assessed_at).getTime()<source.policy.maxAgeHours*3600000;
}
export async function requireCurrentPaymentRisk(c:PoolClient,org:number,batchId:number,id:number|undefined,source:RiskSource){
  const row=id?(await c.query("SELECT * FROM payment_risk_assessments WHERE organization_id=$1 AND batch_id=$2 AND id=$3 FOR UPDATE",[org,batchId,id])).rows[0]:null;
  if(!row||!isRiskCurrent(row,source))throw new GovernanceError("PAYMENT_RISK_REASSESSMENT_REQUIRED","Reassess this batch and obtain approval for the exact current assessment before continuing.");
  if(row.status==="BLOCKED"||row.risk_level==="CRITICAL")throw new GovernanceError("PAYMENT_RISK_HOLD","Critical risk or unavailable required evidence holds this batch. Resolve the cause, then reassess.");
  if(row.risk_level!=="LOW"&&row.status!=="APPROVED_RISK")throw new GovernanceError("PAYMENT_RISK_REVIEW_REQUIRED","An independent, authorized Finance risk review is required before approval or release.");
  return row;
}
export async function paymentRiskView(c:PoolClient,org:number,user:number,batchId:number,page=1,pageSize=25,assessmentId?:number):Promise<PaymentRiskView|null>{
  const actor=await paymentActor(c,org,user,"read");
  const row=(await c.query(`SELECT a.*,(SELECT max(version) FROM payment_risk_assessments n WHERE n.organization_id=a.organization_id AND n.batch_id=a.batch_id) latest_version
    FROM payment_risk_assessments a WHERE organization_id=$1 AND batch_id=$2 AND ($3::bigint IS NULL OR id=$3) ORDER BY version DESC LIMIT 1`,[org,batchId,assessmentId??null])).rows[0];
  if(!row&&assessmentId)throw new GovernanceError("PAYMENT_RISK_NOT_FOUND","This saved assessment is unavailable in the selected batch.",404);
  if(!row){if(!(await c.query("SELECT id FROM ap_payment_batches WHERE organization_id=$1 AND id=$2",[org,batchId])).rowCount)throw new GovernanceError("PAYMENT_BATCH_NOT_FOUND","Payment batch not found.",404);return null;}
  const historical=row.version<row.latest_version;
  const batch=(await c.query("SELECT status,created_by,approved_risk_assessment_id FROM ap_payment_batches WHERE organization_id=$1 AND id=$2",[org,batchId])).rows[0];
  const terminal=["RELEASED","CANCELLED"].includes(batch.status);
  const source=historical||terminal?null:await collectPaymentRisk(c,org,batchId);
  const stale=source!==null&&!isRiskCurrent(row,source);
  const signals=(await c.query(`SELECT code,resource_key AS "resourceKey",points,explanation,evidence FROM payment_risk_signals
    WHERE assessment_id=$1 ORDER BY points DESC,code,resource_key LIMIT $2 OFFSET $3`,[row.id,pageSize,(page-1)*pageSize])).rows;
  const review=(await c.query("SELECT reviewed_by FROM payment_risk_reviews WHERE organization_id=$1 AND assessment_id=$2",[org,row.id])).rows[0];
  return {id:Number(row.id),batchId,version:row.version,assessedAt:new Date(row.assessed_at).toISOString(),assessedBy:row.assessed_by,status:stale?"STALE":row.status,
    riskLevel:row.risk_level,score:row.score,amount:String(row.amount),currency:row.currency_code,sourceFingerprint:row.source_fingerprint,signals,
    nextAction:historical?"Saved historical assessment: this evidence does not authorize the current payment state. Return to the current assessment for required actions.":terminal?"This batch is completed or cancelled. Its saved assessment is retained as evidence, not authorization for another payment.":stale?"Reassess and obtain fresh batch approval.":row.status==="BLOCKED"?"Resolve the listed holds, then reassess.":row.status==="REVIEW_REQUIRED"?"Ask a different authorized Finance reviewer to review this assessment.":"Continue through independent batch approval and release. Recorded payments are not proof of bank settlement.",
    staleReason:stale?row.stale_reason??"Current source, policy or freshness no longer matches the reviewed snapshot.":null,reviewedBy:review?.reviewed_by??null,
    approvalBound:!historical&&Number(batch.approved_risk_assessment_id)===Number(row.id),canAssess:!historical&&!["RELEASED","CANCELLED"].includes(batch.status),
    canReview:!historical&&!["RELEASED","CANCELLED"].includes(batch.status)&&await actor.can("payments","approve")&&await actor.can("finance","approve")&&user!==row.assessed_by&&user!==batch.created_by};
}
