import assert from "node:assert/strict";
import {pool} from "../../server/db";
import {assertMatchedDisposableDatabaseUrls} from "../../server/config/database-safety";
import {governanceHash} from "../../server/modules/rbac/governance-context";
import {defaultRiskPolicy} from "../../shared/procurement-governance";
import {randomUUID} from "node:crypto";

/** Deliberately synthetic standing history, never a migration/backfill or an
 * application command. Only matched disposable targets are accepted. All
 * fixtures commit together and feature flags are restored before visibility. */
export async function seedPaymentRiskHistory(input:{supplierId:number;makerId:number;approverId:number;releaserId:number}){
 assertMatchedDisposableDatabaseUrls(process.env.DATABASE_URL,process.env.TEST_DATABASE_URL);
 const c=await pool.connect(),prefix=`b4-history-${randomUUID().slice(0,8)}`;
 try{
  assert.equal((await c.query("SELECT current_database() name")).rows[0].name,new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
  await c.query("BEGIN");
  assert.notEqual(input.makerId,input.approverId,"Synthetic history still requires distinct makers and approvers.");
  assert.notEqual(input.releaserId,input.approverId,"Synthetic release must be independent.");
  assert.equal((await c.query("SELECT id FROM suppliers WHERE organization_id=1 AND id=$1",[input.supplierId])).rowCount,1,"History fixture supplier must belong to the test organization.");
  const flags=(await c.query("SELECT feature_flags FROM organization_settings WHERE organization_id=1 FOR UPDATE")).rows[0].feature_flags;
  await c.query("UPDATE organization_settings SET feature_flags=feature_flags||'{\"payment_risk\":false}' WHERE organization_id=1");
  const bank=(await c.query(`INSERT INTO mdm_supplier_bank_accounts(organization_id,supplier_id,bank_name,account_number_masked,currency_code,verification_status,is_default,active,created_at,updated_at)
   VALUES(1,$1,'Synthetic historical bank','***0088','ZAR','verified',true,true,now()-interval '40 days',now()-interval '40 days') RETURNING id`,[input.supplierId])).rows[0].id;
  const patch={supplierId:input.supplierId,bankName:"Synthetic historical bank",accountNumberMasked:"***0088",currencyCode:"ZAR",verificationStatus:"verified",isDefault:true,active:true};
  const request=(await c.query(`INSERT INTO mdm_change_requests(organization_id,domain,entity_id,action,proposed_patch,risk_level,status,submitted_by,approved_by,reason,target_version,created_at,decided_at)
   VALUES(1,'supplier-bank-accounts',$1,'create',$2::jsonb,'critical','applied',$3,$4,'Synthetic history fixture, not business approval',1,now()-interval '40 days',now()-interval '40 days') RETURNING id`,
   [bank,JSON.stringify(patch),input.makerId,input.approverId])).rows[0].id;
  const snapshot=(await c.query("SELECT to_jsonb(b) snapshot FROM mdm_supplier_bank_accounts b WHERE organization_id=1 AND id=$1",[bank])).rows[0].snapshot;
  await c.query(`INSERT INTO supplier_bank_approvals(organization_id,change_request_id,payload,source_snapshot,approved_by,approved_at)
   VALUES(1,$1,$2::jsonb,NULL,$3,now()-interval '40 days')`,[request,JSON.stringify({action:"create",entityId:bank,patch}),input.approverId]);
  const fingerprint=governanceHash([input.supplierId,snapshot.bank_name,snapshot.account_number_masked,snapshot.swift_code,snapshot.currency_code,snapshot.payment_method]);
  const bankRevision=(await c.query(`INSERT INTO supplier_bank_revisions(organization_id,supplier_id,bank_id,change_request_id,beneficiary_fingerprint,source_snapshot,approved_by,applied_by,approved_at,applied_at)
   VALUES(1,$1,$2,$3,$4,$5::jsonb,$6,$6,now()-interval '40 days',now()-interval '40 days') RETURNING id`,[input.supplierId,bank,request,fingerprint,JSON.stringify(snapshot),input.approverId])).rows[0].id;
  await c.query(`INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,issue_date,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by,created_at,updated_at)
   SELECT 1,$1||':'||n,$2,'PAID',now()-interval '30 days',now()-interval '10 days',
    CASE WHEN n=5001 THEN 100000 ELSE 100 END,CASE WHEN n=5001 THEN 100000 ELSE 100 END,CASE WHEN n=5001 THEN 100000 ELSE 100 END,0,'ZAR',$3,now()-interval '30 days',now()-interval '20 days'
   FROM generate_series(1,5001)n`,[prefix,input.supplierId,input.makerId]);
  await c.query(`CREATE TEMP TABLE build4_history_rows ON COMMIT DROP AS SELECT id,split_part(invoice_number,':',2)::int n,
   ((split_part(invoice_number,':',2)::int-1)/500+1) cohort,total amount FROM invoices WHERE organization_id=1 AND supplier_id=$1 AND invoice_number LIKE $2||':%'`,[input.supplierId,prefix]);
  await c.query(`INSERT INTO ap_payment_batches(organization_id,batch_number,status,currency_code,total_amount,payment_method,created_by,approved_by,released_by,approved_at,released_at,created_at,updated_at)
   SELECT 1,$1||':history:'||cohort,'RELEASED','ZAR',sum(amount::numeric),'BANK_TRANSFER',$2,$3,$4,now()-interval '21 days',now()-interval '20 days',now()-interval '22 days',now()-interval '20 days'
   FROM build4_history_rows GROUP BY cohort`,[prefix,input.makerId,input.approverId,input.releaserId]);
  await c.query(`CREATE TEMP TABLE build4_history_batches ON COMMIT DROP AS SELECT id,split_part(batch_number,':',3)::int cohort,total_amount FROM ap_payment_batches
   WHERE organization_id=1 AND batch_number LIKE $1||':history:%'`,[prefix]);
  const hashes=Array.from({length:11},(_,i)=>({cohort:i+1,fingerprint:governanceHash(["synthetic-history",prefix,i+1])}));
  const evidence={fixture:"synthetic-standing-history",banks:[{supplier_id:input.supplierId,bank_id:bank,revision_id:bankRevision,beneficiary_fingerprint:fingerprint}]};
  await c.query(`INSERT INTO payment_risk_assessments(organization_id,batch_id,version,assessed_at,assessed_by,source_fingerprint,policy,source_evidence,amount,currency_code,score,risk_level,status)
   SELECT 1,b.id,1,now()-interval '22 days',$1,x.fingerprint,$2::jsonb,
    $3::jsonb||jsonb_build_object('items',(SELECT jsonb_agg(jsonb_build_object('invoice_id',h.id,'amount',h.amount::text) ORDER BY h.id) FROM build4_history_rows h WHERE h.cohort=b.cohort)),
    b.total_amount::numeric,'ZAR',0,'LOW','CURRENT' FROM build4_history_batches b JOIN jsonb_to_recordset($4::jsonb)x(cohort int,fingerprint text) USING(cohort)`,
   [input.makerId,JSON.stringify({...defaultRiskPolicy,reference:"synthetic-standing-history-v1"}),JSON.stringify(evidence),JSON.stringify(hashes)]);
  await c.query(`UPDATE ap_payment_batches b SET approved_risk_assessment_id=a.id FROM payment_risk_assessments a JOIN build4_history_batches t ON t.id=a.batch_id
   WHERE b.organization_id=1 AND a.organization_id=1 AND b.id=a.batch_id`);
  await c.query(`INSERT INTO payments(invoice_id,amount,method,transaction_reference,payment_date,created_at,received_by,risk_assessment_id,bank_evidence_revision)
   SELECT h.id,h.amount,'BANK_TRANSFER',CASE WHEN h.n=5001 THEN $1||':duplicate' ELSE $1||':'||h.n END,now()-interval '20 days',now()-interval '20 days',$2,a.id,$3
   FROM build4_history_rows h JOIN build4_history_batches b USING(cohort) JOIN payment_risk_assessments a ON a.organization_id=1 AND a.batch_id=b.id`,[prefix,input.releaserId,bankRevision]);
  await c.query(`INSERT INTO ap_payment_batch_items(batch_id,invoice_id,amount,payment_id,status)
   SELECT b.id,h.id,h.amount,p.id,'RELEASED' FROM build4_history_rows h JOIN build4_history_batches b USING(cohort) JOIN payments p ON p.invoice_id=h.id`);
  const currentInvoice=(await c.query(`INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by)
   VALUES(1,$1,$2,'APPROVED',now()+interval '30 days',101,101,0,101,'ZAR',$3) RETURNING id`,[`${prefix}:current`,input.supplierId,input.makerId])).rows[0].id;
  await c.query("UPDATE organization_settings SET feature_flags=$1::jsonb WHERE organization_id=1",[JSON.stringify(flags)]);
  await c.query("COMMIT");
  return {supplierId:input.supplierId,bankId:Number(bank),bankRevision:String(bankRevision),currentInvoice:Number(currentInvoice),duplicateReference:`${prefix}:duplicate`,prefix,historyCount:5001};
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
