import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {test,expect} from "@playwright/test";
import {pool} from "../server/db";
import {apiJsonRequest,loginForTests} from "../scripts/test-http";
import {requireDisposableE2eDatabase,loginAsSeededUser} from "./wave7-helpers";
import {seedProcurementEvidenceFixture,unwrapData,errorCode} from "../scripts/runtime-fixtures/procurement-line-evidence-fixture";
import type {SodAnalysis,PaymentRiskView} from "../shared/procurement-governance";
import {governanceHash} from "../server/modules/rbac/governance-context";
import {sodProjection,sodUserWorklist} from "../server/modules/rbac/segregation-analysis";
import {seedPaymentRiskHistory} from "../scripts/runtime-fixtures/payment-risk-history-fixture";
import {defaultRiskPolicy} from "../shared/procurement-governance";
test.describe.configure({mode:"default"});
let cookie="",checkerCookie="",admin=0,checker=0,role=0,foreignRole=0,invoice=0,batch=0;
let fixture:Awaited<ReturnType<typeof seedProcurementEvidenceFixture>>;
let originalPaymentPolicies:Array<{id:number;is_active:boolean}>=[];
const root="/v2/admin/sod";
const post=(url:string,body:unknown={},key=randomUUID(),actor=cookie)=>apiJsonRequest(url,{method:"POST",cookie:actor,body,headers:{"Idempotency-Key":key}});
const get=(url:string,actor=cookie)=>apiJsonRequest(url,{cookie:actor});
async function analysis(id=role){const r=await post(root+"/analyze",{kind:"role",role:"custom",customRoleId:id});expect(r.status,JSON.stringify(r.json)).toBe(200);return unwrapData<SodAnalysis>(r.json,"analysis");}
async function command(body:unknown,key=randomUUID()){return post(root+"/commands",body,key);}
async function newRole(grants:string[]=[]){const r=(await pool.query("INSERT INTO custom_roles(organization_id,name,created_by,is_active) VALUES(1,$1,$2,true) RETURNING id",[`B4-${randomUUID()}`,admin])).rows[0].id;
 for(const key of grants){const [resource,permission]=key.split(":");await pool.query("INSERT INTO custom_role_permissions(role_id,resource,permission_type) VALUES($1,$2,$3)",[r,resource,permission]);}return r;}
async function financeActor(roleId:number){const username=`fin-${randomUUID().slice(0,8)}`;
 const id=(await pool.query(`INSERT INTO users(username,email,password,role,active,email_verified,default_organization_id,preferences)
  SELECT $1,$1||'@example.invalid',password,'custom',true,true,1,jsonb_build_object('customRoleId',$3::int) FROM users WHERE id=$2 RETURNING id`,[username,admin,roleId])).rows[0].id;
 await pool.query("INSERT INTO organization_members(organization_id,user_id,application_role,active,status) VALUES(1,$1,'custom',true,'active')",[id]);
 const session=(await loginForTests(username,"Admin123!"))!;expect(session).toBeTruthy();return {id,session};
}
test.beforeAll(async()=>{
 requireDisposableE2eDatabase();expect((await pool.query("SELECT current_database() name")).rows[0].name).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
 // Authentication helper independently proves server/database identity before mutation.
 cookie=(await loginForTests("admin","Admin123!"))!;expect(cookie).toBeTruthy();
 await pool.query("UPDATE organization_settings SET feature_flags=coalesce(feature_flags,'{}'::jsonb)||'{\"sod\":false,\"payment_risk\":false}' WHERE organization_id=1");
 fixture=await seedProcurementEvidenceFixture();admin=(await pool.query("SELECT id FROM users WHERE username='admin'")).rows[0].id;
 originalPaymentPolicies=(await pool.query("SELECT id,is_active FROM approval_policies WHERE organization_id=1 AND entity_type='payment_batch'")).rows;
 const username=`checker-${fixture.suffix}`;
 checker=(await pool.query(`INSERT INTO users(username,email,password,role,active,email_verified,default_organization_id)
   SELECT $1,$1||'@example.invalid',password,'admin',true,true,1 FROM users WHERE id=$2 RETURNING id`,[username,admin])).rows[0].id;
 await pool.query("INSERT INTO organization_members(organization_id,user_id,application_role,active,status) VALUES(1,$1,'admin',true,'active')",[checker]);
 checkerCookie=(await loginForTests(username,"Admin123!"))!;expect(checkerCookie).toBeTruthy();
 const csrf=await Promise.all([get("/csrf-token",checkerCookie),get("/csrf-token",checkerCookie)]);
 const tokens=csrf.map(r=>(r.json as {csrfToken?:string}).csrfToken);expect(tokens[0]).toBeTruthy();expect(tokens[1]).toBe(tokens[0]);
 role=await newRole(["payments:create"]);
 const org=(await pool.query("INSERT INTO organizations(id,name,slug) SELECT coalesce(max(id),0)+100,$1,$1 FROM organizations RETURNING id",[`b4-${fixture.suffix}`])).rows[0].id;
 foreignRole=(await pool.query("INSERT INTO custom_roles(organization_id,name,created_by) VALUES($1,$2,$3) RETURNING id",[org,`foreign-${fixture.suffix}`,admin])).rows[0].id;
 await pool.query("INSERT INTO approval_policies(organization_id,name,entity_type,approval_level,approver_role,approver_user_id) VALUES(1,$1,'payment_batch',1,'admin',$2)",[`B4 risk review ${fixture.suffix}`,checker]);
 invoice=(await pool.query(`INSERT INTO invoices(organization_id,invoice_number,supplier_id,customer_id,status,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by)
  VALUES(1,$1,$2,NULL,'APPROVED',now()+interval '30 days',100,100,0,100,'ZAR',$3) RETURNING id`,[`B4-${fixture.suffix}`,fixture.supplierId,admin])).rows[0].id;
 await pool.query("UPDATE organization_settings SET feature_flags=coalesce(feature_flags,'{}'::jsonb)||'{\"sod\":true,\"payment_risk\":true}' WHERE organization_id=1");
});
test.afterAll(async()=>{await pool.query("UPDATE organization_settings SET feature_flags=feature_flags||'{\"sod\":false,\"payment_risk\":false}' WHERE organization_id=1");
 await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND entity_type='payment_batch'");
 await pool.query(`UPDATE approval_policies p SET is_active=x.is_active FROM jsonb_to_recordset($1::jsonb)x(id int,is_active boolean)
  WHERE p.organization_id=1 AND p.entity_type='payment_batch' AND p.id=x.id`,[JSON.stringify(originalPaymentPolicies)]);
});

test("risk settings require independent frozen approval, atomic publication and retry-safe withdrawal",async()=>{
 const createRequest=async(patch:unknown,entityId?:number)=>{
  const r=await post("/mdm/change-requests",{domain:"procurement-policies",action:entityId?"update":"create",entityId,proposedPatch:patch,reason:"Synthetic Finance risk policy review"});
  expect(r.status,JSON.stringify(r.json)).toBe(201);return unwrapData<{id:number}>(r.json,"policy request").id;
 };
 const approve=(id:number,actor=checkerCookie)=>post(`/mdm/change-requests/${id}/approve`,{reason:"Independently reviewed synthetic risk controls",allowAdminOverride:true},randomUUID(),actor);
 const apply=(id:number)=>post(`/mdm/change-requests/${id}/apply`,{reason:"Publish only the independently approved settings"},randomUUID(),checkerCookie);
 const id=await createRequest({code:`B4-POLICY-${fixture.suffix}`,name:"Synthetic governed risk settings",policyType:"payment_risk",config:defaultRiskPolicy});
 expect((await approve(id,cookie)).status).toBe(403);
 expect((await approve(id)).status).toBe(200);
 expect((await pool.query("SELECT count(*)::int n FROM payment_risk_policy_revisions WHERE organization_id=1 AND change_request_id=$1",[id])).rows[0].n).toBe(0);
 await pool.query(`CREATE FUNCTION build4_policy_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.action='PAYMENT_RISK_POLICY_APPLIED' THEN RAISE EXCEPTION 'synthetic policy audit failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER build4_policy_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build4_policy_audit_failure()`);
 try{
  const failed=await apply(id);expect(failed.status).toBe(500);expect(JSON.stringify(failed.json)).not.toContain("synthetic policy audit failure");
  expect((await pool.query("SELECT status FROM mdm_change_requests WHERE organization_id=1 AND id=$1",[id])).rows[0].status).toBe("approved");
  expect((await pool.query("SELECT count(*)::int n FROM mdm_procurement_policies WHERE organization_id=1 AND code=$1",[`B4-POLICY-${fixture.suffix}`])).rows[0].n).toBe(0);
 }finally{await pool.query("DROP TRIGGER build4_policy_audit_failure ON audit_logs; DROP FUNCTION build4_policy_audit_failure()");}
 const results=await Promise.all([apply(id),apply(id)]);for(const r of results)expect(r.status,JSON.stringify(r.json)).toBe(200);
 const publication=unwrapData<{revisionId:string;policyId:number}>(results[0].json,"policy publication");
 expect(unwrapData<{revisionId:string}>(results[1].json,"policy replay").revisionId).toBe(publication.revisionId);
 const riskInvoice=(await pool.query(`INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by)
  VALUES(1,$1,$2,'APPROVED',now()+interval '30 days',9,9,0,9,'ZAR',$3) RETURNING id`,[`POLICY-${fixture.suffix}`,fixture.supplierId,admin])).rows[0].id;
 const made=await post("/ap/payment-batches",{invoiceIds:[riskInvoice],paymentMethod:"BANK_TRANSFER"});expect(made.status,JSON.stringify(made.json)).toBe(201);
 const batchId=unwrapData<{id:number}>(made.json,"policy test batch").id;
 const assessed=await post(`/v2/ap/payment-batches/${batchId}/risk/assess`);expect(assessed.status,JSON.stringify(assessed.json)).toBe(200);
 const assessment=unwrapData<{id:string;policy:{reference:string}}>(assessed.json,"published assessment");
 expect(assessment.policy.reference).toContain(`revision:${publication.revisionId}:`);
 await expect(pool.query("UPDATE mdm_procurement_policies SET config='{}'::jsonb WHERE organization_id=1 AND id=$1",[publication.policyId])).rejects.toThrow("PAYMENT_RISK_POLICY_GOVERNANCE_REQUIRED");
 await expect(pool.query("UPDATE payment_risk_policy_revisions SET source_snapshot='{}' WHERE organization_id=1 AND id=$1",[publication.revisionId])).rejects.toThrow();
 const unsafe=await createRequest({config:{...defaultRiskPolicy,independentRelease:false}},publication.policyId);expect((await approve(unsafe)).status).toBe(400);
 const changed=await createRequest({config:{...defaultRiskPolicy,recentBankDays:8}},publication.policyId);expect((await approve(changed)).status).toBe(200);
 await pool.query("UPDATE mdm_change_requests SET proposed_patch=proposed_patch||'{\"name\":\"Changed after approval\"}' WHERE organization_id=1 AND id=$1",[changed]);
 expect(errorCode((await apply(changed)).json)).toBe("PAYMENT_RISK_POLICY_APPROVAL_STALE");
 const withdrawal=await createRequest({active:false},publication.policyId);expect((await approve(withdrawal)).status).toBe(200);expect((await apply(withdrawal)).status).toBe(200);
 expect((await pool.query("SELECT status FROM payment_risk_assessments WHERE organization_id=1 AND id=$1",[assessment.id])).rows[0].status).toBe("STALE");
 expect((await pool.query("SELECT count(*)::int n FROM payment_risk_policy_revisions WHERE organization_id=1 AND policy_id=$1",[publication.policyId])).rows[0].n).toBe(2);
});

test("canonical hashes survive JSONB key order without altering arrays",()=>{
 expect(governanceHash({z:{b:2,a:1},a:[1,2]})).toBe(governanceHash({a:[1,2],z:{a:1,b:2}}));
 expect(governanceHash([1,2])).not.toBe(governanceHash([2,1]));expect(governanceHash({a:null})).not.toBe(governanceHash({}));
});

test("invoice forms cannot forge approval, payment balances or posted financial evidence",async()=>{
 const body={supplierId:fixture.supplierId,invoiceNumber:`BOUNDARY-${randomUUID()}`,issueDate:new Date().toISOString(),dueDate:new Date(Date.now()+86400000).toISOString(),currencyCode:"ZAR",subtotal:11,total:11,tax:0,dueAmount:11,paidAmount:0,status:"DRAFT",items:[]};
 for(const path of ["/invoices","/ap/invoices"]){
  const forged=await post(path,{...body,status:"APPROVED"});expect(forged.status,JSON.stringify(forged.json)).toBe(409);expect(errorCode(forged.json)).toBe("INVOICE_GOVERNED_TRANSITION_REQUIRED");
  expect((await post(path,{...body,createdBy:checker})).status).toBe(400);
  expect((await post(path,{...body,paidAmount:11,dueAmount:0})).status).toBe(409);
 }
 expect((await pool.query("SELECT count(*)::int n FROM invoices WHERE organization_id=1 AND invoice_number=$1",[body.invoiceNumber])).rows[0].n).toBe(0);
 const created=await post("/ap/invoices",body);expect(created.status,JSON.stringify(created.json)).toBe(201);const id=unwrapData<{id:number}>(created.json,"draft").id;
 const update=(data:unknown)=>apiJsonRequest(`/invoices/${id}`,{method:"PATCH",cookie,body:data});
 expect((await update({status:"APPROVED"})).status).toBe(409);expect((await update({paidAmount:11,dueAmount:0})).status).toBe(409);
 expect((await update({total:12,subtotal:12,dueAmount:12})).status).toBe(200);
 expect((await pool.query("SELECT status::text,paid_amount,due_amount,created_by FROM invoices WHERE organization_id=1 AND id=$1",[id])).rows[0]).toEqual({status:"DRAFT",paid_amount:0,due_amount:12,created_by:admin});
 const line=await post(`/invoices/${id}/items`,{itemId:fixture.itemId,description:"Synthetic draft line",quantity:1,unitPrice:12,taxRate:0,taxAmount:0,totalPrice:12});expect(line.status,JSON.stringify(line.json)).toBe(201);const lineId=unwrapData<{id:number}>(line.json,"draft line").id;
 // Synthetic staging represents a legacy posted source, never a client approval.
 await pool.query("UPDATE invoices SET status='APPROVED' WHERE organization_id=1 AND id=$1",[id]);
 expect((await update({total:13})).status).toBe(409);
 expect((await apiJsonRequest(`/invoices/${id}/items/${lineId}`,{method:"PATCH",cookie,body:{unitPrice:13}})).status).toBe(409);
 expect((await apiJsonRequest(`/invoices/${id}/items/${lineId}`,{method:"DELETE",cookie})).status).toBe(409);
 await expect(pool.query("UPDATE invoice_items SET quantity=2 WHERE id=$1 AND invoice_id=$2",[lineId,id])).rejects.toThrow("INVOICE_GOVERNED_CORRECTION_REQUIRED");
 expect((await apiJsonRequest(`/ap/invoices/${id}`,{method:"DELETE",cookie})).status).toBe(409);
 const policies=(await pool.query("SELECT id,is_active FROM approval_policies WHERE organization_id=1 AND entity_type='invoice'")).rows;
 try{
  await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND entity_type='invoice'");
  await pool.query("INSERT INTO approval_policies(organization_id,name,entity_type,approval_level,approver_role,approver_user_id) VALUES(1,$1,'invoice',1,'admin',$2)",[`Invoice boundary ${randomUUID()}`,admin]);
  await pool.query("UPDATE invoices SET status='PENDING_APPROVAL' WHERE organization_id=1 AND id=$1",[id]);
  const denied=await post(`/ap/invoices/${id}/approve`,{adminOverride:true,overrideReason:"Cannot borrow an explicitly assigned approval"},randomUUID(),checkerCookie);
  expect(denied.status,JSON.stringify(denied.json)).toBe(403);expect(errorCode(denied.json)).toBe("APPROVER_USER_REQUIRED");
  expect((await pool.query("SELECT status::text FROM invoices WHERE organization_id=1 AND id=$1",[id])).rows[0].status).toBe("PENDING_APPROVAL");
 }finally{
  await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND entity_type='invoice'");
  await pool.query("UPDATE approval_policies p SET is_active=x.is_active FROM jsonb_to_recordset($1::jsonb)x(id int,is_active boolean) WHERE p.organization_id=1 AND p.id=x.id",[JSON.stringify(policies)]);
 }
});

test("assignment previews block escalation, retain warnings and guard activation",async()=>{
 const safe=await newRole(["reports:read"]),person=await financeActor(safe);
 const response=await post(root+"/analyze",{kind:"user",userId:person.id});expect(response.status).toBe(200);const before=unwrapData<SodAnalysis>(response.json,"before assignment");
 const preview=await post(root+"/analyze",{kind:"user",userId:person.id,proposedRole:"admin"});expect(preview.status).toBe(200);expect(unwrapData<SodAnalysis>(preview.json,"proposed assignment").blocked).toBe(true);
 expect(errorCode((await command({kind:"assign",userId:person.id,role:"admin",revision:before.revision,reason:"Escalation must be blocked before saving"})).json)).toBe("SOD_ASSIGNMENT_CONFLICT");
 expect((await pool.query("SELECT application_role FROM organization_members WHERE organization_id=1 AND user_id=$1",[person.id])).rows[0].application_role).toBe("custom");
 const warning=await newRole(["purchases:create"]),w=await analysis(warning);
 const saved=await command({kind:"grant",roleId:warning,revision:w.revision,reason:"Warning-only delegated purchase authority",grant:{resource:"purchases",permissionType:"approve"},enabled:true});
 expect(saved.status,JSON.stringify(saved.json)).toBe(200);const warned=unwrapData<SodAnalysis>(saved.json,"warning");expect(warned.blocked).toBe(false);expect(warned.conflicts.some(c=>c.code==="PO_CREATE_APPROVE"&&c.enforcement_mode==="WARN")).toBe(true);
 // Test-owned legacy dormant grants; the flag change is invisible outside this transaction.
 const c=await pool.connect();let dormant=0;try{await c.query("BEGIN");await c.query("UPDATE organization_settings SET feature_flags=feature_flags||'{\"sod\":false}' WHERE organization_id=1");
  dormant=(await c.query("INSERT INTO custom_roles(organization_id,name,is_active,created_by) VALUES(1,$1,false,$2) RETURNING id",[`Dormant-${randomUUID()}`,admin])).rows[0].id;
  await c.query("INSERT INTO custom_role_permissions(role_id,resource,permission_type) VALUES($1,'payments','create'),($1,'payments','execute')",[dormant]);
  await c.query("UPDATE organization_settings SET feature_flags=feature_flags||'{\"sod\":true}' WHERE organization_id=1");await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 const inactive=await analysis(dormant);expect(inactive.permissions).toEqual([]);
 expect(errorCode((await command({kind:"role",roleId:dormant,isActive:true,revision:inactive.revision,reason:"Activation must inspect all dormant grants"})).json)).toBe("SOD_ASSIGNMENT_CONFLICT");
 expect((await pool.query("SELECT is_active FROM custom_roles WHERE organization_id=1 AND id=$1",[dormant])).rows[0].is_active).toBe(false);
});

test("all foreign governance references are denied without changing foreign evidence",async()=>{
 const org=(await pool.query("SELECT organization_id FROM custom_roles WHERE id=$1",[foreignRole])).rows[0].organization_id;
 const user=(await pool.query(`INSERT INTO users(username,email,password,role,active,email_verified,default_organization_id)
  SELECT $1,$1||'@example.invalid',password,'viewer',true,true,$3 FROM users WHERE id=$2 RETURNING id`,[`foreign-${randomUUID()}`,admin,org])).rows[0].id;
 await pool.query("INSERT INTO organization_members(organization_id,user_id,application_role,active,status) VALUES($1,$2,'viewer',true,'active')",[org,user]);
 const supplier=(await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES($1,$2,'active') RETURNING id",[org,`Foreign private ${randomUUID()}`])).rows[0].id;
 const bank=(await pool.query("INSERT INTO mdm_supplier_bank_accounts(organization_id,supplier_id,bank_name,account_number_masked,currency_code) VALUES($1,$2,'Private bank','***7777','ZAR') RETURNING id",[org,supplier])).rows[0].id;
 const inv=(await pool.query("INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by) VALUES($1,$2,$3,'APPROVED',now(),9,9,0,9,'ZAR',$4) RETURNING id",[org,`Foreign-${randomUUID()}`,supplier,user])).rows[0].id;
 const payment=(await pool.query("INSERT INTO payments(invoice_id,amount,received_by) VALUES($1,1,$2) RETURNING id",[inv,user])).rows[0].id;
 const foreignBatch=(await pool.query("INSERT INTO ap_payment_batches(organization_id,batch_number,total_amount,created_by,currency_code) VALUES($1,$2,9,$3,'ZAR') RETURNING id",[org,`Foreign-${randomUUID()}`,user])).rows[0].id;
 const risk=(await pool.query(`INSERT INTO payment_risk_assessments(organization_id,batch_id,version,assessed_by,source_fingerprint,policy,source_evidence,amount,currency_code,score,risk_level,status)
  VALUES($1,$2,1,$3,'foreign-private','{}','{}',9,'ZAR',0,'LOW','CURRENT') RETURNING id`,[org,foreignBatch,user])).rows[0].id;
 const rule=(await pool.query("SELECT id FROM sod_conflict_rules WHERE code='INVOICE_CREATE_APPROVE' AND organization_id IS NULL")).rows[0].id;
 const exception=(await pool.query(`INSERT INTO sod_conflict_exceptions(organization_id,rule_id,subject_key,permission_fingerprint,source_evidence,reason,compensating_control,requested_by,starts_at,expires_at)
  VALUES($1,$2,$3,'private','{}','Private reason','Private control',$4,now(),now()+interval '1 day') RETURNING id`,[org,rule,`user:${user}`,user])).rows[0].id;
 const snapshot=async()=> (await pool.query(`SELECT jsonb_build_array(
  (SELECT to_jsonb(u) FROM users u WHERE id=$1),(SELECT to_jsonb(s) FROM suppliers s WHERE id=$2),
  (SELECT to_jsonb(b) FROM mdm_supplier_bank_accounts b WHERE id=$3),(SELECT to_jsonb(i) FROM invoices i WHERE id=$4),
  (SELECT to_jsonb(p) FROM payments p WHERE id=$5),(SELECT to_jsonb(b) FROM ap_payment_batches b WHERE id=$6),
  (SELECT to_jsonb(a) FROM payment_risk_assessments a WHERE id=$7),(SELECT to_jsonb(e) FROM sod_conflict_exceptions e WHERE id=$8)) evidence`,[user,supplier,bank,inv,payment,foreignBatch,risk,exception])).rows[0].evidence;
 const before=await snapshot();
 expect((await post(root+"/analyze",{kind:"user",userId:user})).status).toBe(404);
 expect((await command({kind:"assign",userId:user,role:"viewer",revision:"unavailable",reason:"Foreign assignment must remain unavailable"})).status).toBe(404);
 expect((await post(root+"/analyze",{kind:"role",role:"custom",customRoleId:foreignRole})).status).toBe(404);
 expect((await post(root+`/exceptions/${exception}/approve`,{reason:"Foreign exception must remain unavailable"},randomUUID(),checkerCookie)).status).toBe(404);
 expect((await post("/ap/payment-batches",{invoiceIds:[inv],paymentMethod:"BANK_TRANSFER"})).status).toBe(404);
 for(const path of [`/v2/ap/payment-batches/${foreignBatch}/risk`,`/v2/ap/payment-batches/${foreignBatch}/risk/history`])expect((await get(path)).status).toBe(404);
 const ownInvoice=(await pool.query("INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by) VALUES(1,$1,$2,'APPROVED',now(),3,3,0,3,'ZAR',$3) RETURNING id",[`OwnScope-${randomUUID()}`,fixture.supplierId,admin])).rows[0].id;
 const ownCreated=await post("/ap/payment-batches",{invoiceIds:[ownInvoice],paymentMethod:"BANK_TRANSFER"});expect(ownCreated.status).toBe(201);const ownBatch=unwrapData<{id:number}>(ownCreated.json,"own batch").id;
 expect((await get(`/v2/ap/payment-batches/${ownBatch}/risk?assessmentId=${risk}`)).status).toBe(404);
 expect((await post(`/v2/ap/payment-batches/${ownBatch}/risk/review`,{assessmentId:Number(risk),reason:"Foreign assessment must not authorize this batch"},randomUUID(),checkerCookie)).status).toBe(404);
 expect((await post(`/ap/payment-batches/${foreignBatch}/release`,{riskAssessmentId:Number(risk)})).status).toBe(404);
 const patch=await apiJsonRequest(`/payments/${payment}`,{method:"PATCH",cookie,body:{amount:999}});expect(patch.status).toBe(409);
 for(const data of [{action:"create",proposedPatch:{supplierId:supplier,bankName:"Synthetic",accountNumberMasked:"***1111",currencyCode:"ZAR"}},{action:"update",entityId:bank,proposedPatch:{accountNumberMasked:"***2222"}}]){
  const req=await post("/mdm/change-requests",{domain:"supplier-bank-accounts",...data,reason:"Foreign reference must not be borrowed"});expect(req.status).toBe(201);const rid=unwrapData<{id:number}>(req.json,"foreign bank request").id;
  const denied=await post(`/mdm/change-requests/${rid}/approve`,{reason:"Independent review cannot grant foreign access"},randomUUID(),checkerCookie);expect(denied.status,JSON.stringify(denied.json)).toBe(404);expect(JSON.stringify(denied.json)).not.toContain("Private");
 }
 expect(await snapshot()).toEqual(before);
});

test("governance migration can be reapplied and rolled back without rewriting evidence",async()=>{
 const c=await pool.connect();try{await c.query("BEGIN");
  const before=(await c.query("SELECT count(*)::int n FROM sod_conflict_rules")).rows[0].n;
  const sql=readFileSync("migrations/20261117140000_procurement_sod_payment_risk.sql","utf8");await c.query(sql);await c.query(sql);
  expect((await c.query("SELECT count(*)::int n FROM sod_conflict_rules")).rows[0].n).toBe(before);
  expect((await c.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='governed_risk_policy_write_guard' AND NOT tgisinternal")).rows[0].n).toBe(1);
 }finally{await c.query("ROLLBACK");c.release();}
});
test("role, user, system and proposed analysis preserve legacy conflicts and deny foreign scope",async()=>{
 expect((await analysis()).conflicts).toEqual([]);
 const proposed=await post(root+"/analyze",{kind:"role",role:"custom",customRoleId:role,proposedGrants:[{resource:"payments",permissionType:"create"},{resource:"payments",permissionType:"execute"}]});
 expect(unwrapData<SodAnalysis>(proposed.json,"proposal").conflicts.map(c=>c.code)).toContain("PAYMENT_CREATE_RELEASE");
 const before=(await pool.query("SELECT application_role FROM organization_members WHERE organization_id=1 AND user_id=$1",[admin])).rows[0];
 for(const input of [{kind:"user",userId:admin},{kind:"role",role:"admin"}]){
  const r=await post(root+"/analyze",input);expect(r.status).toBe(200);expect(unwrapData<SodAnalysis>(r.json,"legacy").conflicts.length).toBeGreaterThan(2);
 }
 expect((await pool.query("SELECT application_role FROM organization_members WHERE organization_id=1 AND user_id=$1",[admin])).rows[0]).toEqual(before);
 expect((await post(root+"/analyze",{kind:"role",role:"custom",customRoleId:foreignRole})).status).toBe(404);
 expect((await post(root+"/analyze",{kind:"role",role:"custom",customRoleId:role,organizationId:999})).status).toBe(400);
 const summary=await get(root+"/summary");expect(summary.status,JSON.stringify(summary.json)).toBe(200);
 for(const tab of ["users","roles","conflicts","rules","exceptions"]){const r=await get(`${root}/${tab}?pageSize=25`);expect(r.status,JSON.stringify(r.json)).toBe(200);expect(unwrapData<{items:unknown[]}>(r.json,tab).items.length).toBeLessThanOrEqual(25);}
 expect((await get(root+"/rules?pageSize=26")).status).toBe(400);
});
test("new critical grants are blocked in commands, compatibility APIs and storage",async()=>{
 const before=await analysis(),body={kind:"grant",roleId:role,revision:before.revision,reason:"Separate payment preparation from release",grant:{resource:"payments",permissionType:"execute"},enabled:true};
 const denied=await command(body);expect(denied.status).toBe(409);expect(errorCode(denied.json)).toBe("SOD_ASSIGNMENT_CONFLICT");
 expect((await post(`/custom-roles/${role}/permissions`,{resource:"payments",permissionType:"execute"})).status).toBe(409);
 await expect(pool.query("INSERT INTO custom_role_permissions(role_id,resource,permission_type) VALUES($1,'payments','execute')",[role])).rejects.toThrow("SOD_ASSIGNMENT_CONFLICT");
 expect((await analysis()).permissions).toEqual(before.permissions);
});
test("governed grants are idempotent, reject stale revisions and serialize concurrent edits",async()=>{
 const id=await newRole(),before=await analysis(id),body={kind:"grant",roleId:id,revision:before.revision,reason:"Grant bounded read access",grant:{resource:"reports",permissionType:"read"},enabled:true},key=randomUUID();
 const a=await command(body,key),replay=await command(body,key);expect(a.status,JSON.stringify(a.json)).toBe(200);expect(replay.json&&unwrapData<SodAnalysis>(replay.json,"replay")).toEqual(unwrapData(a.json,"first"));
 expect((await command({...body,reason:"Changed command payload"},key)).status).toBe(409);
 expect(errorCode((await command({...body,grant:{resource:"analytics",permissionType:"read"}})).json)).toBe("SOD_REVISION_CHANGED");
 const next=await analysis(id),parallel=await Promise.all(["analytics","inventory"].map(resource=>command({...body,revision:next.revision,grant:{resource,permissionType:"read"}})));
 expect(parallel.map(r=>r.status).sort()).toEqual([200,409]);
 const audit=await pool.query("SELECT id FROM audit_logs WHERE organization_id=1 AND resource_id=$1 AND action='SOD_ROLE_CHANGED'",[id]);expect(audit.rowCount).toBe(2);
});
test("mitigation requires an independent approver and exact proposed access",async()=>{
 const id=await newRole(["invoices:create"]),proposal={kind:"role",role:"custom",customRoleId:id,proposedGrants:[{resource:"invoices",permissionType:"create"},{resource:"invoices",permissionType:"approve"}]};
 const a=unwrapData<SodAnalysis>((await post(root+"/analyze",proposal)).json,"proposal"),conflict=a.conflicts.find(c=>c.code==="INVOICE_CREATE_APPROVE")!;
 const request=await post(root+"/exceptions",{analysis:proposal,revision:a.revision,ruleId:conflict.rule_id,reason:"Independent invoice and payment review",control:"Release performed by a different authorized Finance user",startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()});
 expect(request.status,JSON.stringify(request.json)).toBe(200);const exception=unwrapData<{id:number}>(request.json,"exception");
 expect((await post(`${root}/exceptions/${exception.id}/approve`,{reason:"Attempt self approval denied"})).status).toBe(403);
 const approvalKey=randomUUID(),approvals=await Promise.all([1,2].map(()=>post(`${root}/exceptions/${exception.id}/approve`,{reason:"Independent control verified for one day"},approvalKey,checkerCookie)));
 for(const approved of approvals)expect(approved.status,JSON.stringify(approved.json)).toBe(200);
 expect((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE organization_id=1 AND resource_type='sod_exception' AND resource_id=$1 AND action='SOD_EXCEPTION_APPROVED'",[exception.id])).rows[0].n).toBe(1);
 const current=await analysis(id),granted=await command({kind:"grant",roleId:id,revision:current.revision,reason:"Apply independently mitigated role grant",grant:{resource:"invoices",permissionType:"approve"},enabled:true});expect(granted.status,JSON.stringify(granted.json)).toBe(200);
 expect((await analysis(id)).conflicts.find(c=>c.code===conflict.code)?.exception_id).toBeTruthy();
 expect((await post(`${root}/exceptions/${exception.id}/revoke`,{reason:"End temporary mitigation after review"})).status).toBe(200);
 expect((await analysis(id)).conflicts.find(c=>c.code===conflict.code)?.exception_id).toBeNull();
});
test("shared profiles cannot silently change another organization's custom access",async()=>{
 const ownRole=await newRole(["reports:read"]),person=await financeActor(ownRole),org=(await pool.query("SELECT organization_id FROM custom_roles WHERE id=$1",[foreignRole])).rows[0].organization_id;
 await pool.query("UPDATE organization_members SET application_role='viewer' WHERE organization_id=1 AND user_id=$1",[person.id]);
 await pool.query("INSERT INTO custom_role_permissions(role_id,resource,permission_type) VALUES($1,'reports','read')",[foreignRole]);
 await pool.query("INSERT INTO organization_members(organization_id,user_id,application_role,active,status) VALUES($1,$2,'custom',true,'active')",[org,person.id]);
 await pool.query("UPDATE users SET preferences=jsonb_build_object('customRoleId',$2::int) WHERE id=$1",[person.id,foreignRole]);
 const current=await post(root+"/analyze",{kind:"user",userId:person.id});expect(current.status).toBe(200);const a=unwrapData<SodAnalysis>(current.json,"viewer membership");
 const result=await command({kind:"assign",userId:person.id,role:"custom",customRoleId:ownRole,revision:a.revision,reason:"Must not modify the other tenant's role"});
 expect(errorCode(result.json)).toBe("SOD_MEMBERSHIP_SCOPE_REVIEW_REQUIRED");
 expect((await pool.query("SELECT preferences->>'customRoleId' role FROM users WHERE id=$1",[person.id])).rows[0].role).toBe(String(foreignRole));
 expect((await pool.query("SELECT application_role FROM organization_members WHERE organization_id=1 AND user_id=$1",[person.id])).rows[0].application_role).toBe("viewer");
});
test("expiry reactivates conflicts and approved mitigation evidence cannot be rewritten",async()=>{
 const id=await newRole(["invoices:create"]),a=await analysis(id);
 const rule=(await pool.query("SELECT id FROM sod_conflict_rules WHERE organization_id IS NULL AND code='INVOICE_CREATE_APPROVE' ORDER BY revision DESC LIMIT 1")).rows[0].id;
 // Explicitly synthetic expired evidence proves observation semantics without
 // changing an approved production record or waiting for wall-clock expiry.
 const proposed=unwrapData<SodAnalysis>((await post(root+"/analyze",{kind:"role",role:"custom",customRoleId:id,proposedGrants:[{resource:"invoices",permissionType:"create"},{resource:"invoices",permissionType:"approve"}]})).json,"proposal");
 const expired=(await pool.query(`INSERT INTO sod_conflict_exceptions(organization_id,rule_id,subject_key,permission_fingerprint,source_evidence,reason,compensating_control,
  requested_by,approved_by,starts_at,expires_at,approved_at,status) VALUES(1,$1,$2,$3,'{}','Synthetic expired review','Synthetic independent release',$4,$5,now()-interval '2 days',now()-interval '1 day',now()-interval '2 days','APPROVED') RETURNING id`,[rule,a.subjectKey,proposed.fingerprint,admin,checker])).rows[0].id;
 const blocked=await command({kind:"grant",roleId:id,revision:a.revision,reason:"An expired mitigation must not authorize access",grant:{resource:"invoices",permissionType:"approve"},enabled:true});expect(errorCode(blocked.json)).toBe("SOD_ASSIGNMENT_CONFLICT");
 await expect(pool.query("UPDATE sod_conflict_exceptions SET expires_at=now()+interval '1 day' WHERE organization_id=1 AND id=$1",[expired])).rejects.toThrow("IMMUTABLE");
 const invalid=await post(root+"/exceptions",{analysis:{kind:"role",role:"custom",customRoleId:id},revision:a.revision,ruleId:rule,reason:"Invalid date interval must fail safely",control:"Independent recorded review control",startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+91*86400000).toISOString()});expect(invalid.status).toBe(400);
});
test("AP uses canonical supplier identity, holds missing evidence and deduplicates concurrent assessment",async()=>{
 const created=await post("/ap/payment-batches",{invoiceIds:[invoice],paymentMethod:"BANK_TRANSFER"});expect(created.status,JSON.stringify(created.json)).toBe(201);batch=unwrapData<{id:number}>(created.json,"batch").id;
 const path=`/v2/ap/payment-batches/${batch}/risk`,key=randomUUID(),results=await Promise.all([post(path+"/assess",{},key),post(path+"/assess",{},key)]);
 for(const r of results)expect(r.status,JSON.stringify(r.json)).toBe(200);
 expect(unwrapData<{id:string}>(results[0].json,"assessment").id).toBe(unwrapData<{id:string}>(results[1].json,"retry").id);
 const view=await get(path);expect(view.status,JSON.stringify(view.json)).toBe(200);const risk=unwrapData<PaymentRiskView>(view.json,"risk");
 expect(risk.riskLevel).toBe("CRITICAL");expect(risk.status).toBe("BLOCKED");expect(risk.signals.map(s=>s.code)).toEqual(expect.arrayContaining(["UNKNOWN_BANK_HISTORY","UNKNOWN_PAYMENT_HISTORY","FIRST_PAYMENT_TO_SUPPLIER"]));
 expect(risk.signals.find(s=>s.code==="UNKNOWN_BANK_HISTORY")?.resourceKey).toBe(`supplier:${fixture.supplierId}`);
 expect((await post(`/ap/payment-batches/${batch}/release`,{riskAssessmentId:risk.id})).status).toBe(403);
 const other=await post(path+"/review",{assessmentId:risk.id,reason:"Independent reviewer cannot bypass critical hold"},randomUUID(),checkerCookie);expect(errorCode(other.json)).toBe("PAYMENT_RISK_REASSESSMENT_REQUIRED");
 await pool.query("UPDATE invoices SET due_date=due_date+interval '1 day',updated_at=clock_timestamp() WHERE organization_id=1 AND id=$1",[invoice]);
 expect((await pool.query("SELECT status FROM payment_risk_assessments WHERE organization_id=1 AND id=$1",[risk.id])).rows[0].status).toBe("STALE");
 const reassess=await post(path+"/assess");expect(reassess.status).toBe(200);expect(unwrapData<{version:number}>(reassess.json,"version").version).toBe(2);
 await expect(pool.query("UPDATE payment_risk_assessments SET score=0 WHERE organization_id=1 AND id=$1",[risk.id])).rejects.toThrow("immutable");
 const compatibility=await post(`/invoices/${invoice}/payments`,{amount:1,method:"CASH"});expect(compatibility.status).toBe(409);expect(errorCode(compatibility.json)).toBe("PAYMENT_GOVERNED_BATCH_REQUIRED");
 expect((await pool.query("SELECT count(*)::int n FROM payments WHERE invoice_id=$1",[invoice])).rows[0].n).toBe(0);
 expect((await get("/v2/ap/payment-batches/2147483000/risk")).status).toBe(404);
});
test("SoD six-view browser review is responsive and records persistent findings",async({page},info)=>{
 let failSummary=true;
 await page.route("**/api/v2/admin/sod/summary?*",async route=>{
  if(failSummary){failSummary=false;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"SYNTHETIC_RETRY",message:"Access evidence temporarily unavailable. Retry."}})});}
  else await route.continue();
 });
 await loginAsSeededUser(page,"admin",admin);await page.goto("/admin/segregation-of-duties");
 await expect(page.getByRole("heading",{name:"Segregation of duties",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Retry evidence",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Retry evidence",exact:true}).click();
 await expect(page.getByText("Critical conflicts",{exact:true})).toBeVisible();
 for(const tab of ["Users","Roles","Conflicts","Exceptions","Rules","Summary"]){await page.getByRole("tab",{name:tab,exact:true}).click();await expect(page.getByRole("button",{name:"Refresh",exact:true})).toBeVisible();}
 await page.getByRole("combobox",{name:"Application role",exact:true}).selectOption("admin");await page.getByRole("button",{name:"Analyze",exact:true}).click();
 await expect(page.getByRole("region",{name:"Access analysis"})).toContainText("CRITICAL");
 await page.getByRole("button",{name:"Record access review"}).click();await expect(page.getByRole("status").filter({hasText:"Review command saved"})).toBeVisible();
 expect((await pool.query("SELECT count(*)::int n FROM sod_conflict_findings WHERE organization_id=1")).rows[0].n).toBeGreaterThan(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath("sod-review.png"),fullPage:true});
});

test("ordinary users receive guidance without access to governance evidence",async({page},info)=>{
 const id=await newRole(["reports:read"]),person=await financeActor(id),username=(await pool.query("SELECT username FROM users WHERE id=$1",[person.id])).rows[0].username;
 expect((await get(root+"/summary",person.session)).status).toBe(403);expect((await get("/v2/ap/payment-risk/context",person.session)).status).toBe(403);
 const unexpected:string[]=[];page.on("pageerror",e=>unexpected.push(e.message));
 await loginAsSeededUser(page,username,person.id);await page.goto("/admin/segregation-of-duties");
 await expect(page.getByRole("alert").filter({hasText:"Role administration access is required"})).toBeVisible();
 await expect(page.getByRole("button",{name:"Record access review"})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(unexpected).toEqual([]);
 await page.screenshot({path:info.outputPath("sod-denied.png"),fullPage:true});
});
test("approved bank evidence, independent risk review and bound payment release remain atomic and retry safe",async()=>{
 const paymentFixture=await seedProcurementEvidenceFixture();
 const reviewRole=await newRole(["payments:read","payments:approve","finance:read","finance:approve","invoices:read","suppliers:read"]),releaseRole=await newRole(["payments:read","payments:execute","finance:read","finance:execute","invoices:read","suppliers:read"]);
 const reviewer=await financeActor(reviewRole),approver=await financeActor(reviewRole),releaser=await financeActor(releaseRole);
 await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND entity_type='payment_batch'");
 await pool.query("INSERT INTO approval_policies(organization_id,name,entity_type,approval_level,approver_role) VALUES(1,$1,'payment_batch',1,$2)",[`Bound policy ${fixture.suffix}`,`custom:${reviewRole}`]);
 const bankRequest=await post("/mdm/change-requests",{domain:"supplier-bank-accounts",action:"create",proposedPatch:{supplierId:paymentFixture.supplierId,bankName:"Synthetic bank",accountNumberMasked:"***0019",currencyCode:"ZAR",verificationStatus:"verified",isDefault:true},reason:"Synthetic independent bank verification"});
 expect(bankRequest.status,JSON.stringify(bankRequest.json)).toBe(201);const requestId=unwrapData<{id:number}>(bankRequest.json,"bank request").id;
 expect((await post(`/mdm/change-requests/${requestId}/approve`,{reason:"Maker override must be denied",allowAdminOverride:true})).status).toBe(403);
 const approved=await post(`/mdm/change-requests/${requestId}/approve`,{reason:"Independent synthetic bank reference verification"},randomUUID(),checkerCookie);expect(approved.status,JSON.stringify(approved.json)).toBe(200);
 const applied=await post(`/mdm/change-requests/${requestId}/apply`,{reason:"Apply the independently approved synthetic reference"},randomUUID(),checkerCookie);expect(applied.status,JSON.stringify(applied.json)).toBe(200);
 const publication=unwrapData<{bankId:number;revisionId:string}>(applied.json,"bank publication");
 const inv=(await pool.query(`INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by)
  VALUES(1,$1,$2,'APPROVED',now()+interval '30 days',125,125,0,125,'ZAR',$3) RETURNING id`,[`RELEASE-${randomUUID()}`,paymentFixture.supplierId,admin])).rows[0].id;
 const created=await post("/ap/payment-batches",{invoiceIds:[inv],paymentMethod:"BANK_TRANSFER"});expect(created.status,JSON.stringify(created.json)).toBe(201);
 const id=unwrapData<{id:number}>(created.json,"batch").id,path=`/v2/ap/payment-batches/${id}/risk`;
 const assessed=await post(path+"/assess");expect(assessed.status,JSON.stringify(assessed.json)).toBe(200);const risk=unwrapData<{id:string;risk_level:string}>(assessed.json,"risk");
 expect(["HIGH","MEDIUM"]).toContain(risk.risk_level);
 const view=unwrapData<PaymentRiskView>((await get(path)).json,"risk view");
 expect(view.signals.map(s=>s.code)).toEqual(expect.arrayContaining(["RECENT_BANK_CHANGE","FIRST_PAYMENT_TO_BENEFICIARY","NEW_BENEFICIARY","UNKNOWN_PAYMENT_HISTORY"]));
 expect((await post(path+"/review",{assessmentId:Number(risk.id),reason:"Creator cannot approve their risk assessment"})).status).toBe(403);
 const reviewed=await post(path+"/review",{assessmentId:Number(risk.id),reason:"Independently verified synthetic beneficiary and approved invoice"},randomUUID(),reviewer.session);expect(reviewed.status,JSON.stringify(reviewed.json)).toBe(200);
 const approvedBatch=await post(`/ap/payment-batches/${id}/approve`,{riskAssessmentId:Number(risk.id)},randomUUID(),approver.session);expect(approvedBatch.status,JSON.stringify(approvedBatch.json)).toBe(200);
 expect((await pool.query("SELECT approved_risk_assessment_id FROM ap_payment_batches WHERE organization_id=1 AND id=$1",[id])).rows[0].approved_risk_assessment_id).toBe(String(risk.id));
 // A material source change invalidates old approval, not the invoice itself.
 await pool.query("UPDATE suppliers SET risk_rating='medium',updated_at=clock_timestamp() WHERE organization_id=1 AND id=$1",[paymentFixture.supplierId]);
 const stale=await post(`/ap/payment-batches/${id}/release`,{riskAssessmentId:Number(risk.id)},randomUUID(),releaser.session);expect(errorCode(stale.json)).toBe("PAYMENT_RISK_REASSESSMENT_REQUIRED");
 expect((await pool.query("SELECT count(*)::int n FROM payments WHERE invoice_id=$1",[inv])).rows[0].n).toBe(0);
 const reassessed=await post(path+"/assess"),next=unwrapData<{id:string;version:number}>(reassessed.json,"new risk");expect(reassessed.status).toBe(200);expect(next.version).toBe(2);
 expect((await post(path+"/review",{assessmentId:Number(next.id),reason:"Review changed supplier evidence independently"},randomUUID(),reviewer.session)).status).toBe(200);
 expect((await post(`/ap/payment-batches/${id}/approve`,{riskAssessmentId:Number(next.id)},randomUUID(),approver.session)).status).toBe(200);
 const beforeEvents=Number((await pool.query("SELECT count(*) n FROM ap_balance_events WHERE organization_id=1 AND invoice_id=$1",[inv])).rows[0].n);
 await pool.query(`CREATE OR REPLACE FUNCTION build4_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.action='AP_PAYMENT_BATCH_RELEASED' AND NEW.resource_id=${Number(id)} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER build4_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build4_test_audit_failure()`);
 try{
  const failed=await post(`/ap/payment-batches/${id}/release`,{riskAssessmentId:Number(next.id)},randomUUID(),releaser.session);
  expect(failed.status,JSON.stringify(failed.json)).toBe(503);expect(JSON.stringify(failed.json)).not.toContain("synthetic audit failure");
  expect((await pool.query("SELECT count(*)::int n FROM payments WHERE invoice_id=$1",[inv])).rows[0].n).toBe(0);
  expect((await pool.query("SELECT status::text FROM ap_payment_batches WHERE organization_id=1 AND id=$1",[id])).rows[0].status).toBe("APPROVED");
  expect(Number((await pool.query("SELECT count(*) n FROM ap_balance_events WHERE organization_id=1 AND invoice_id=$1",[inv])).rows[0].n)).toBe(beforeEvents);
 }finally{await pool.query("DROP TRIGGER build4_test_audit_failure ON audit_logs; DROP FUNCTION build4_test_audit_failure()");}
 const releaseKey=randomUUID(),releases=await Promise.all([1,2].map(()=>post(`/ap/payment-batches/${id}/release`,{riskAssessmentId:Number(next.id)},releaseKey,releaser.session)));
 for(const r of releases)expect(r.status,JSON.stringify(r.json)).toBe(200);
 const paid=(await pool.query("SELECT amount,risk_assessment_id,bank_evidence_revision FROM payments WHERE invoice_id=$1",[inv])).rows;
 expect(paid).toEqual([{amount:125,risk_assessment_id:String(next.id),bank_evidence_revision:String(publication.revisionId)}]);
 expect((await pool.query("SELECT paid_amount,due_amount,status::text FROM invoices WHERE organization_id=1 AND id=$1",[inv])).rows[0]).toEqual({paid_amount:125,due_amount:0,status:"PAID"});
 const inbox=await get("/v2/action-inbox?state=all",releaser.session);expect(inbox.status,JSON.stringify(inbox.json)).toBe(200);
 expect(unwrapData<{items:Array<{id:string}>}>(inbox.json,"inbox").items.some(r=>r.id===`payment-risk:${id}`)).toBe(true);
 await pool.query("UPDATE organization_members SET active=false WHERE organization_id=1 AND user_id=$1",[releaser.id]);
 expect((await get(path,releaser.session)).status).toBe(403);
});
test("5,005 additional users keep complete totals, bounded pages and deduplicated review work",async({},info)=>{
 requireDisposableE2eDatabase();
 const c=await pool.connect(),prefix=`bulk-${randomUUID().slice(0,8)}`;
 try{await c.query("BEGIN");const flags=(await c.query("SELECT feature_flags FROM organization_settings WHERE organization_id=1 FOR UPDATE")).rows[0].feature_flags;
  await c.query("UPDATE organization_settings SET feature_flags=feature_flags||'{\"sod\":false}' WHERE organization_id=1");
  // Synthetic principal fixtures only. Feature state is restored before commit;
  // other sessions never observe an ungoverned organization.
  await c.query(`WITH made AS(INSERT INTO users(username,email,password,role,active,email_verified,default_organization_id)
   SELECT $1||'-'||n,$1||'-'||n||'@example.invalid',u.password,'viewer',true,true,1 FROM generate_series(1,5005)n CROSS JOIN users u WHERE u.id=$2 RETURNING id)
   INSERT INTO organization_members(organization_id,user_id,application_role,active,status) SELECT 1,id,'viewer',true,'active' FROM made`,[prefix,admin]);
  await c.query("UPDATE organization_settings SET feature_flags=$1::jsonb WHERE organization_id=1",[JSON.stringify(flags)]);await c.query("COMMIT");
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
 const plan=await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sodProjection} SELECT * FROM (${sodUserWorklist})p ORDER BY subject_key LIMIT 25`,[1,""]);
 await info.attach("sod-user-worklist-5005-plan",{body:Buffer.from(JSON.stringify(plan.rows[0]["QUERY PLAN"],null,2)),contentType:"application/json"});
 const oldPlan=await pool.query(`EXPLAIN (FORMAT JSON) ${sodProjection} SELECT * FROM (${sodUserWorklist.replace("u.id=s.user_id","s.subject_key='user:'||u.id")})p ORDER BY subject_key LIMIT 25`,[1,""]);
 await info.attach("sod-user-worklist-legacy-expression-plan",{body:Buffer.from(JSON.stringify(oldPlan.rows[0]["QUERY PLAN"],null,2)),contentType:"application/json"});
 const list=await get(root+"/users?pageSize=25");expect(list.status,JSON.stringify(list.json)).toBe(200);
 const first=unwrapData<{items:unknown[];total:number}>(list.json,"large user list");expect(first.items).toHaveLength(25);expect(first.total).toBeGreaterThanOrEqual(5005);
 const actual=Number((await pool.query("SELECT count(*) n FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active WHERE m.organization_id=1 AND m.active AND m.status='active'")).rows[0].n);expect(first.total).toBe(actual);
 const last=await get(`${root}/users?pageSize=100&page=${Math.ceil(actual/100)}`);expect(last.status).toBe(200);expect(unwrapData<{items:unknown[]}>(last.json,"last page").items.length).toBe(actual%100||100);
 expect((await get(root+"/summary")).status).toBe(200);
 expect((await post(root+"/scan")).status).toBe(200);
 const before=Number((await pool.query("SELECT count(*) n FROM notifications WHERE organization_id=1 AND type='governance_review'")).rows[0].n);
 expect((await post(root+"/scan")).status).toBe(200);
 expect(Number((await pool.query("SELECT count(*) n FROM notifications WHERE organization_id=1 AND type='governance_review'")).rows[0].n)).toBe(before);
});
test("role editor previews critical conflicts and commits only an explicit safe confirmation",async({page},info)=>{
 const id=await newRole(["payments:create"]),name=(await pool.query("SELECT name FROM custom_roles WHERE organization_id=1 AND id=$1",[id])).rows[0].name;
 await loginAsSeededUser(page,"admin",admin);await page.goto("/admin/user-roles");
 await page.getByRole("combobox",{name:"Select custom role",exact:true}).selectOption(String(id));
 await expect(page.getByRole("combobox",{name:"Select custom role",exact:true})).toHaveValue(String(id));
 await expect(page.getByRole("combobox",{name:"Select custom role",exact:true}).locator('option:checked')).toHaveText(name);
 await page.getByLabel("Filter resources",{exact:true}).fill("payments");await page.getByRole("button",{name:/Finance data/}).click();
 await page.getByRole("button",{name:/^Grant Execute permission for payments;/}).click();
 const dialog=page.getByRole("dialog",{name:"Review proposed access"});await expect(dialog).toContainText("CRITICAL");await expect(dialog.getByRole("button",{name:"Confirm access change"})).toBeDisabled();
 await dialog.getByRole("button",{name:"Cancel access change"}).focus();await page.keyboard.press("Enter");await expect(dialog).not.toBeVisible();
 expect((await analysis(id)).permissions).toEqual(["payments:create"]);
 await page.getByRole("button",{name:/^Grant Read permission for payments;/}).click();
 await expect(dialog).toContainText("No configured conflict found");await dialog.getByRole("textbox",{name:"Access change reason"}).fill("Read only payment visibility for preparation");
 await dialog.getByRole("button",{name:"Confirm access change"}).focus();await page.keyboard.press("Enter");
 await expect(page.getByRole("button",{name:/^Remove Read permission for payments;/})).toBeVisible();expect((await analysis(id)).permissions).toEqual(["payments:create","payments:read"]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath("role-access-preview.png"),fullPage:true});
});
test("AP risk deep link explains holds, retries a failed read and opens saved assessment evidence",async({page},info)=>{
 const inv=(await pool.query(`INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by)
  VALUES(1,$1,$2,'APPROVED',now()+interval '30 days',95,95,0,95,'ZAR',$3) RETURNING id`,[`BROWSER-${randomUUID()}`,fixture.supplierId,admin])).rows[0].id;
 const created=await post("/ap/payment-batches",{invoiceIds:[inv],paymentMethod:"BANK_TRANSFER"});expect(created.status).toBe(201);const id=unwrapData<{id:number}>(created.json,"UI batch").id;
 await loginAsSeededUser(page,"admin",admin);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));let injected=false;
 await page.route(`**/api/v2/ap/payment-batches/${id}/risk?**`,async route=>{
  if(!injected){injected=true;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"GOVERNANCE_UNAVAILABLE",message:"Synthetic unavailable probe",requestId:randomUUID()}})});}else await route.continue();
 });
 await page.goto(`/finance/accounts-payable/payments?riskBatch=${id}`);
 const panel=page.getByTestId("payment-risk-panel");await expect(panel.getByRole("button",{name:"Retry risk"})).toBeVisible();await panel.getByRole("button",{name:"Retry risk"}).click();
 await expect(panel).toContainText("No assessment yet");await panel.getByRole("button",{name:"Assess current evidence"}).click();
 await expect(panel).toContainText("CRITICAL");await expect(panel).toContainText("No unique, independently approved current bank reference");
 await expect(panel.getByRole("button",{name:"Record approved batch payments"})).toBeDisabled();
 await panel.getByText("Assessment history",{exact:true}).click();await panel.getByRole("button",{name:"View assessment version 1",exact:true}).click();await expect(panel).toContainText("Version 1");
 expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath("ap-risk-hold.png"),fullPage:true});
});
test("risk signals use complete 5,001-invoice history, exact source changes and immutable saved assessments",async({},info)=>{
 test.setTimeout(90_000); // Includes synthetic 5,001-row history and the full command matrix; SQL budgets are unchanged.
 const supplier=await seedProcurementEvidenceFixture(),releaseRole=await newRole(["payments:read","payments:execute","finance:read","finance:execute","invoices:read","suppliers:read"]),releaser=await financeActor(releaseRole);
 const approveRole=await newRole(["payments:read","payments:approve","finance:read","finance:approve","invoices:read","suppliers:read"]),approver=await financeActor(approveRole);
 await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND entity_type='payment_batch'");
 await pool.query("INSERT INTO approval_policies(organization_id,name,entity_type,approval_level,approver_role) VALUES(1,$1,'payment_batch',1,$2)",[`Matrix policy ${randomUUID()}`,`custom:${approveRole}`]);
 const h=await seedPaymentRiskHistory({supplierId:supplier.supplierId,makerId:admin,approverId:checker,releaserId:releaser.id});
 const created=await post("/ap/payment-batches",{invoiceIds:[h.currentInvoice],paymentMethod:"BANK_TRANSFER"});expect(created.status,JSON.stringify(created.json)).toBe(201);
 const id=unwrapData<{id:number}>(created.json,"history batch").id,path=`/v2/ap/payment-batches/${id}/risk`;
 type Assessment={id:string;version:number;score:number;risk_level:string;status:string;source_evidence:{hist:Array<{recorded:number;verified:number;median:string}>;signals:Array<{code:string;points:number}>}};
 const assess=async(actor=cookie)=>{const r=await post(path+"/assess",{},randomUUID(),actor);expect(r.status,JSON.stringify(r.json)).toBe(200);return unwrapData<Assessment>(r.json,"matrix assessment");};
 const codes=(a:Assessment)=>a.source_evidence.signals.map(s=>s.code);
 const amount=async(value:number)=>{
  const c=await pool.connect();try{await c.query("BEGIN");await c.query("UPDATE invoices SET total=$2,subtotal=$2,due_amount=$2,updated_at=clock_timestamp() WHERE organization_id=1 AND id=$1",[h.currentInvoice,value]);
   await c.query("UPDATE ap_payment_batch_items SET amount=$2 WHERE batch_id=$1",[id,value]);await c.query("UPDATE ap_payment_batches SET total_amount=$2 WHERE organization_id=1 AND id=$1",[id,value]);await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 };
 const normal=await assess();expect(normal.risk_level).toBe("LOW");expect(normal.score).toBe(0);expect(normal.source_evidence.hist[0]).toMatchObject({recorded:5001,verified:5001,median:"100"});
 expect(codes(normal)).not.toEqual(expect.arrayContaining(["FIRST_PAYMENT_TO_SUPPLIER","UNKNOWN_PAYMENT_HISTORY"]));
 await amount(100);expect((await pool.query("SELECT status FROM payment_risk_assessments WHERE organization_id=1 AND id=$1",[normal.id])).rows[0].status).toBe("STALE");
 expect(codes(await assess())).toContain("DUPLICATE_PAYMENT_AMOUNT");
 await amount(1000);await pool.query("UPDATE ap_payment_batches SET export_metadata=$2::jsonb WHERE organization_id=1 AND id=$1",[id,JSON.stringify({reference:h.duplicateReference})]);
 const high=await assess();expect(high.risk_level).toBe("HIGH");expect(high.score).toBe(50);expect(codes(high)).toEqual(expect.arrayContaining(["PAYMENT_ABOVE_NORMAL_RANGE","DUPLICATE_PAYMENT_REFERENCE"]));
 await pool.query("UPDATE ap_payment_batches SET export_metadata=export_metadata||'{\"urgentReason\":\"Synthetic urgency review\"}' WHERE organization_id=1 AND id=$1",[id]);
 const urgent=await assess(approver.session);expect(codes(urgent)).toContain("URGENT_OVERRIDE");
 expect(errorCode((await post(path+"/review",{assessmentId:Number(urgent.id),reason:"Authorized assessor still cannot review their own assessment"},randomUUID(),approver.session)).json)).toBe("PAYMENT_RISK_SELF_REVIEW_DENIED");
 await pool.query("UPDATE suppliers SET risk_rating='high' WHERE organization_id=1 AND id=$1",[h.supplierId]);const critical=await assess();expect(critical.risk_level).toBe("CRITICAL");expect(critical.score).toBe(85);expect(critical.status).toBe("BLOCKED");
 const oldInvoice=(await pool.query("SELECT id FROM invoices WHERE organization_id=1 AND supplier_id=$1 AND invoice_number=$2",[h.supplierId,`${h.prefix}:1`])).rows[0].id;
 await pool.query("INSERT INTO ap_invoice_match_results(organization_id,invoice_id,status,mismatch_count,created_at) VALUES(1,$1,'EXCEPTION',1,now()-interval '19 days'),(1,$2,'EXCEPTION',1,now())",[oldInvoice,h.currentInvoice]);
 const exception=await assess();expect(exception.status).toBe("BLOCKED");expect(codes(exception)).toEqual(expect.arrayContaining(["OPEN_AP_EXCEPTION","INVOICE_MISMATCH_HISTORY"]));
 await pool.query("INSERT INTO ap_invoice_match_results(organization_id,invoice_id,status) VALUES(1,$1,'MATCHED')",[h.currentInvoice]);
 await pool.query("UPDATE ap_payment_batches SET export_metadata='{}'::jsonb WHERE organization_id=1 AND id=$1",[id]);await amount(101);
 const medium=await assess();expect(medium.risk_level).toBe("MEDIUM");expect(medium.score).toBe(35);
 await pool.query("UPDATE suppliers SET risk_rating='low' WHERE organization_id=1 AND id=$1",[h.supplierId]);const restored=await assess();expect(restored.risk_level).toBe("LOW");expect(restored.score).toBe(10);
 await pool.query("UPDATE invoices SET currency_code='USD' WHERE organization_id=1 AND id=$1",[h.currentInvoice]);await pool.query("UPDATE ap_payment_batches SET currency_code='USD' WHERE organization_id=1 AND id=$1",[id]);
 expect((await pool.query("SELECT status FROM payment_risk_assessments WHERE organization_id=1 AND id=$1",[restored.id])).rows[0].status).toBe("STALE");
 await pool.query("UPDATE invoices SET currency_code='ZAR' WHERE organization_id=1 AND id=$1",[h.currentInvoice]);await pool.query("UPDATE ap_payment_batches SET currency_code='ZAR' WHERE organization_id=1 AND id=$1",[id]);
 const addedInvoice=(await pool.query(`INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by)
  VALUES(1,$1,$2,'APPROVED',now()+interval '30 days',7,7,0,7,'ZAR',$3) RETURNING id`,[`SPLIT-${randomUUID()}`,h.supplierId,admin])).rows[0].id;
 const beforeMembership=await assess();const line=(await pool.query("INSERT INTO ap_payment_batch_items(batch_id,invoice_id,amount,status) VALUES($1,$2,7,'PENDING') RETURNING id",[id,addedInvoice])).rows[0].id;
 expect((await pool.query("SELECT status FROM payment_risk_assessments WHERE organization_id=1 AND id=$1",[beforeMembership.id])).rows[0].status).toBe("STALE");
 await pool.query("DELETE FROM ap_payment_batch_items WHERE batch_id=$1 AND id=$2",[id,line]);
 const splitCreated=await post("/ap/payment-batches",{invoiceIds:[addedInvoice],paymentMethod:"BANK_TRANSFER"});expect(splitCreated.status).toBe(201);const splitId=unwrapData<{id:number}>(splitCreated.json,"split batch").id;
 expect(codes(await assess())).toContain("POTENTIAL_SPLIT_PAYMENT");await pool.query("UPDATE ap_payment_batches SET status='CANCELLED' WHERE organization_id=1 AND id=$1",[splitId]);
 const current=await assess(),saved=unwrapData<PaymentRiskView>((await get(path+`?assessmentId=${normal.id}`)).json,"saved assessment");expect(saved.score).toBe(0);expect(saved.riskLevel).toBe("LOW");expect(saved.canAssess).toBe(false);expect(saved.nextAction).toContain("Saved historical assessment");
 expect((await post(`/ap/payment-batches/${id}/approve`,{riskAssessmentId:Number(current.id)},randomUUID(),approver.session)).status).toBe(200);
 const change=await post("/mdm/change-requests",{domain:"supplier-bank-accounts",entityId:h.bankId,action:"update",proposedPatch:{accountNumberMasked:"***0099"},reason:"Synthetic bank change while payment approval is pending"});expect(change.status,JSON.stringify(change.json)).toBe(201);const requestId=unwrapData<{id:number}>(change.json,"bank change").id;
 expect((await post(`/mdm/change-requests/${requestId}/approve`,{reason:"Independent verification of the changed synthetic reference"},randomUUID(),checkerCookie)).status).toBe(200);
 expect((await pool.query("SELECT status FROM payment_risk_assessments WHERE organization_id=1 AND id=$1",[current.id])).rows[0].status).toBe("STALE");
 const awaiting=await assess();expect(awaiting.status).toBe("BLOCKED");expect(codes(awaiting)).toContain("BANK_CHANGE_AWAITING_APPLICATION");
 const [apply,release]=await Promise.all([post(`/mdm/change-requests/${requestId}/apply`,{reason:"Apply only the independently approved reference"},randomUUID(),checkerCookie),post(`/ap/payment-batches/${id}/release`,{riskAssessmentId:Number(current.id)},randomUUID(),releaser.session)]);
 expect(apply.status,JSON.stringify(apply.json)).toBe(200);expect(errorCode(release.json)).toBe("PAYMENT_RISK_REASSESSMENT_REQUIRED");
 expect((await pool.query("SELECT count(*)::int n FROM payments WHERE invoice_id=$1",[h.currentInvoice])).rows[0].n).toBe(0);
 const changed=await assess();expect(codes(changed)).toEqual(expect.arrayContaining(["RECENT_BANK_CHANGE","FIRST_PAYMENT_TO_BENEFICIARY","NEW_BENEFICIARY"]));
 expect((await pool.query("SELECT source_evidence,score FROM payment_risk_assessments WHERE organization_id=1 AND id=$1",[normal.id])).rows[0]).toEqual({source_evidence:normal.source_evidence,score:0});
 await info.attach("payment-risk-history-matrix",{body:Buffer.from(JSON.stringify({fixture:"synthetic-only",historyInvoices:h.historyCount,recorded:normal.source_evidence.hist[0].recorded,verified:normal.source_evidence.hist[0].verified,median:normal.source_evidence.hist[0].median,levels:[normal.risk_level,medium.risk_level,high.risk_level,critical.risk_level],bankRace:{apply:apply.status,release:release.status},unchangedSavedAssessment:true},null,2)),contentType:"application/json"});
});
