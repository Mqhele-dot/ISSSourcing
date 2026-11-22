import {randomUUID,createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {test,expect} from "@playwright/test";
import {pool} from "../server/db";
import {apiJsonRequest,loginForTests,getTestBaseUrl} from "../scripts/test-http";
import {seedProcurementEvidenceFixture,unwrapData,errorCode} from "../scripts/runtime-fixtures/procurement-line-evidence-fixture";
import {requireDisposableE2eDatabase,loginAsSeededUser} from "./wave7-helpers";
import {assertExportActorAccess} from "../server/modules/exports/export-actor-access";
type Run={id:string;amount:string|null;state:string;includedCount:number;excludedCount:number;evidenceHash:string};
type Groups={summary:{amount:string|null;state:string};items:Array<{bucket_key:string;label:string;amount:string|null;count:number;included:number;excluded:number;dimension_state:string}>;total:number;evidenceHash:string};
const root="/v2/analytics/spend-cube",from="2021-02-15";
let fixture:Awaited<ReturnType<typeof seedProcurementEvidenceFixture>>,cookie="",admin=0,foreignSupplier=0,originalCurrency:string|null=null,originalFlag:unknown;
const get=(path:string,actor=cookie)=>apiJsonRequest(path,{cookie:actor});
const post=(path:string,body:unknown,key=randomUUID(),actor=cookie)=>apiJsonRequest(path,{cookie:actor,method:"POST",body,headers:{"Idempotency-Key":key}});
const body=()=>({measure:"ordered",from,to:from,supplierId:fixture.supplierId});
async function capture(input:unknown=body(),key=randomUUID(),actor=cookie){const r=await post(root,input,key,actor);expect(r.status,JSON.stringify(r.json)).toBe(200);return unwrapData<Run>(r.json,"capture");}
async function groups(runId:string,dimension="supplier",actor=cookie){const r=await get(`${root}/${runId}?dimension=${dimension}&pageSize=25`,actor);expect(r.status,JSON.stringify(r.json)).toBe(200);return unwrapData<Groups>(r.json,"groups");}
async function csv(id:string,actor=cookie){const r=await fetch(getTestBaseUrl()+`/api/export/financial_measure/csv?measure=ordered&runId=${id}`,{headers:{Cookie:actor}});expect(r.status).toBe(200);return r.text();}
async function reader(){
 const role=(await pool.query("INSERT INTO custom_roles(organization_id,name,created_by,is_active) VALUES(1,$1,$2,true) RETURNING id",[`Spend reader ${randomUUID()}`,admin])).rows[0].id;
 await pool.query("INSERT INTO custom_role_permissions(role_id,resource,permission_type) SELECT $1,resource::resource,action::permission_type FROM jsonb_to_recordset($2::jsonb)x(resource text,action text)",[role,JSON.stringify(["reports","purchases","suppliers","master_data"].flatMap(resource=>[{resource,action:"read"},...(resource==="reports"?[{resource,action:"export"}]:[])]))]);
 const username=`spend-${randomUUID().slice(0,10)}`;
 const user=(await pool.query("INSERT INTO users(username,email,password,role,active,email_verified,default_organization_id,preferences) SELECT $1,$1||'@example.invalid',password,'custom',true,true,1,jsonb_build_object('customRoleId',$3::int) FROM users WHERE id=$2 RETURNING id",[username,admin,role])).rows[0].id;
 await pool.query("INSERT INTO organization_members(organization_id,user_id,application_role,active,status) VALUES(1,$1,'custom',true,'active')",[user]);
 return {role,user,username,cookie:(await loginForTests(username,"Admin123!"))!};
}
test.beforeAll(async()=>{
 requireDisposableE2eDatabase();expect((await pool.query("SELECT current_database() n")).rows[0].n).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
 cookie=(await loginForTests("admin","Admin123!"))!;expect(cookie).toBeTruthy();admin=(await pool.query("SELECT id FROM users WHERE username='admin'")).rows[0].id;
 originalCurrency=(await pool.query("SELECT currency_code FROM app_settings WHERE organization_id=1")).rows[0].currency_code;
 originalFlag=(await pool.query("SELECT feature_flags->'spend_cube' f FROM organization_settings WHERE organization_id=1")).rows[0].f;
 fixture=await seedProcurementEvidenceFixture();await pool.query("UPDATE app_settings SET currency_code='ZAR' WHERE organization_id=1");
 await pool.query("UPDATE organization_settings SET feature_flags=coalesce(feature_flags,'{}')||'{\"spend_cube\":true}' WHERE organization_id=1");
 await pool.query(`INSERT INTO purchase_orders(organization_id,order_number,supplier_id,department_id,status,approval_status,order_date,currency_code,total_amount,created_by_user_id)
  SELECT 1,$1||n,$2,$3,'APPROVED','APPROVED','2021-02-15','ZAR',0.1,$4 FROM generate_series(1,5005)n`,[`CUBE-${fixture.suffix}-`,fixture.supplierId,fixture.departmentId,admin]);
 await pool.query("INSERT INTO purchase_orders(organization_id,order_number,supplier_id,department_id,status,approval_status,order_date,currency_code,total_amount) VALUES(1,$1,$2,$3,'APPROVED','APPROVED','2021-02-16','USD',2)",[`CUBE-USD-${fixture.suffix}`,fixture.supplierId,fixture.departmentId]);
 const org=(await pool.query("INSERT INTO organizations(id,name,slug) SELECT coalesce(max(id),0)+100,$1,$1 FROM organizations RETURNING id",[`cube-foreign-${fixture.suffix}`])).rows[0].id;
 foreignSupplier=(await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES($1,'Private foreign supplier','active') RETURNING id",[org])).rows[0].id;
 await pool.query("INSERT INTO purchase_orders(organization_id,order_number,supplier_id,status,approval_status,order_date,currency_code,total_amount) VALUES(1,$1,$2,'APPROVED','APPROVED','2021-02-17','ZAR',1)",[`CUBE-GAP-${fixture.suffix}`,foreignSupplier]);
});
test.afterAll(async()=>{
 await pool.query("UPDATE app_settings SET currency_code=$1 WHERE organization_id=1",[originalCurrency]);
 await pool.query("UPDATE organization_settings SET feature_flags=(feature_flags-'spend_cube')||$1::jsonb WHERE organization_id=1",[JSON.stringify(originalFlag==null?{}:{spend_cube:originalFlag})]);
});
test("complete 5,005-source totals, bounded detail and exact canonical parity",async({},info)=>{
 const run=await capture();expect(run.amount).toBe("500.50");expect(run.includedCount).toBe(5005);expect(run.excludedCount).toBe(0);
 const tampered=await post(root,{...body(),amount:"1"});expect(tampered.status).toBe(400); // Financial values are never caller authority.
 const canonical=await get(`/v2/analytics/financial-measures?measure=ordered&from=${from}&to=${from}&supplierId=${fixture.supplierId}`);expect(canonical.status).toBe(200);expect(unwrapData<Run>(canonical.json,"canonical").amount).toBe(run.amount);
 const grouped=await groups(run.id);expect(grouped.items).toHaveLength(1);expect(grouped.items[0]).toMatchObject({count:5005,included:5005,excluded:0,amount:"500.50"});
 for(const size of [25,50,100]){const r=await get(`${root}/${run.id}/evidence?dimension=supplier&bucketKey=supplier:${fixture.supplierId}&pageSize=${size}`);expect(r.status).toBe(200);const d=unwrapData<{items:unknown[];total:number}>(r.json,"detail");expect(d.total).toBe(5005);expect(d.items).toHaveLength(size);}
 const last=await get(`${root}/${run.id}/evidence?dimension=supplier&bucketKey=supplier:${fixture.supplierId}&pageSize=100&page=51`);expect(unwrapData<{items:unknown[]}>(last.json,"last").items).toHaveLength(5);
 expect((await get(`${root}/${run.id}?dimension=item`)).status).toBe(400);
 await info.attach("spend-parity",{body:Buffer.from(JSON.stringify({runId:run.id,count:5005,amount:run.amount,hash:run.evidenceHash})),contentType:"application/json"});
});
test("frozen groups, labels and CSV remain identical after source changes",async()=>{
 const run=await capture(),before=await groups(run.id),file=await csv(run.id);
 await pool.query("UPDATE suppliers SET name=$2,updated_at=clock_timestamp() WHERE organization_id=1 AND id=$1",[fixture.supplierId,`Changed source ${randomUUID()}`]);
 expect(await groups(run.id)).toEqual(before);expect(await csv(run.id)).toBe(file);
 expect(createHash("sha256").update(await csv(run.id)).digest("hex")).toBe(createHash("sha256").update(file).digest("hex"));
 const current=await groups((await capture()).id);expect(current.items[0].label).not.toBe(before.items[0].label);
 expect(file).toContain('"frozenDimensions"');expect(file).toContain("observed source metadata");
});

test("all five canonical adapters preserve their distinct bases and six observed dimensions",async()=>{
 requireDisposableE2eDatabase();const c=await pool.connect(),day="2020-01-01";
 let po=0;
 try{
  await c.query("BEGIN");
  const project=(await c.query("INSERT INTO projects(organization_id,code,name) VALUES(1,$1,'Cube synthetic project') RETURNING id",[randomUUID()])).rows[0].id;
  const contract=(await c.query("INSERT INTO supplier_contracts(organization_id,supplier_id,title,start_date) VALUES(1,$1,'Cube synthetic agreement','2019-01-01') RETURNING id",[fixture.supplierId])).rows[0].id;
  po=(await c.query("INSERT INTO purchase_orders(organization_id,order_number,supplier_id,department_id,contract_id,project_id,status,approval_status,order_date,currency_code,total_amount) VALUES(1,$1,$2,$3,$4,$5,'APPROVED','APPROVED',$6,'ZAR',46) RETURNING id",[randomUUID(),fixture.supplierId,fixture.departmentId,contract,project,day])).rows[0].id;
  const line=(await c.query("INSERT INTO purchase_order_items(order_id,item_id,quantity,received_quantity,unit_price,total_price) VALUES($1,$2,4,1,10,40) RETURNING id",[po,fixture.itemId])).rows[0].id;
  const receipt=(await c.query("INSERT INTO ap_receipts(organization_id,receipt_number,purchase_order_id,supplier_id,received_date) VALUES(1,$1,$2,$3,$4) RETURNING id",[randomUUID(),po,fixture.supplierId,day])).rows[0].id;
  const receiptLine=(await c.query("INSERT INTO ap_receipt_items(receipt_id,purchase_order_item_id,item_id,quantity,accepted_quantity) VALUES($1,$2,$3,1,1) RETURNING id",[receipt,line,fixture.itemId])).rows[0].id;
  await c.query("INSERT INTO receipt_value_evidence(organization_id,receipt_item_id,quantity,unit_price,currency_code,source_price_reference,posted_at,actor_user_id) VALUES(1,$1,1,10,'ZAR',$2,$3,$4)",[receiptLine,`synthetic-line:${line}`,day,admin]);
  const invoice=(await c.query("INSERT INTO invoices(organization_id,invoice_number,supplier_id,purchase_order_id,status,issue_date,due_date,subtotal,tax,total,paid_amount,due_amount,currency_code,created_by) VALUES(1,$1,$2,$3,'APPROVED',$4,$4,40,6,46,5,41,'ZAR',$5) RETURNING id",[randomUUID(),fixture.supplierId,po,day,admin])).rows[0].id;
  await c.query("INSERT INTO payments(invoice_id,amount,payment_date,received_by) VALUES($1,5,$2,$3)",[invoice,day,admin]);
  await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 for(const [measure,amount] of Object.entries({ordered:"46.00",open_commitment:"30.00",received:"10.00",invoiced:"46.00",recorded_payments:"5.00"})){
  const run=await capture({measure,from:day,to:day,supplierId:fixture.supplierId});expect(run.amount,measure).toBe(amount);expect(run.includedCount).toBe(1);
  for(const dimension of ["supplier","department","contract","project","month","currency"]){const g=await groups(run.id,dimension);expect(g.items).toHaveLength(1);expect(g.items[0]).toMatchObject({dimension_state:"observed",amount,count:1});if(dimension==="month")expect(g.items[0].bucket_key).toBe("2020-01");}
  const canonical=await get(`/v2/analytics/financial-measures?measure=${measure}&from=${day}&to=${day}&supplierId=${fixture.supplierId}`);expect(unwrapData<Run>(canonical.json,measure).amount).toBe(run.amount);
 }
 expect(po).toBeGreaterThan(0);
});
test("missing FX and foreign/unassigned dimensions stay explicit without leaking labels",async()=>{
 const partial=await capture({...body(),to:"2021-02-16"});expect(partial.state).toBe("partial");expect(partial.amount).toBe("500.50");expect(partial.excludedCount).toBe(1);
 const currencies=await groups(partial.id,"currency");expect(currencies.items.find(x=>x.bucket_key==="USD")).toMatchObject({amount:null,excluded:1});
 const unavailable=await capture({...body(),from:"2021-02-16",to:"2021-02-16"});expect(unavailable.state).toBe("unavailable");expect(unavailable.amount).toBeNull();
 const gap=await capture({measure:"ordered",from:"2021-02-17",to:"2021-02-17"});const source=await groups(gap.id);expect(source.items[0]).toMatchObject({label:"Unavailable supplier",dimension_state:"unavailable"});expect(JSON.stringify(source)).not.toContain("Private foreign");
 expect((await groups(gap.id,"department")).items[0].dimension_state).toBe("unassigned");
 expect((await post(root,{...body(),supplierId:foreignSupplier})).status).toBe(404);
 expect((await post(root,{...body(),organizationId:999})).status).toBe(400);
 expect((await post(root,{...body(),from:"2021-02-30"})).status).toBe(400);
 expect((await get(`${root}/${randomUUID()}`)).status).toBe(404);
 const own=await capture(),foreignRun=randomUUID();
 await pool.query("INSERT INTO financial_reporting_runs(id,organization_id,actor_user_id,measure,calculation_version,normalized_filters,reporting_currency_code,generated_at,summary,evidence_hash) SELECT $1,s.organization_id,r.actor_user_id,r.measure,r.calculation_version,r.normalized_filters,r.reporting_currency_code,r.generated_at,r.summary,r.evidence_hash FROM financial_reporting_runs r CROSS JOIN suppliers s WHERE r.id=$2 AND r.organization_id=1 AND s.id=$3",[foreignRun,own.id,foreignSupplier]);
 for(const path of [`${root}/${foreignRun}`,`/v2/analytics/financial-measures/ordered/evidence?runId=${foreignRun}`,`/export/financial_measure/csv?measure=ordered&runId=${foreignRun}`])expect((await get(path)).status,path).toBe(404);
});

test("reversal calendar and mismatched supplier links never borrow PO classifications",async()=>{
 const po=(await pool.query("SELECT id FROM purchase_orders WHERE organization_id=1 AND supplier_id=$1 AND order_date='2020-01-01' ORDER BY id LIMIT 1",[fixture.supplierId])).rows[0].id;
 const original=(await pool.query("SELECT e.id,l.receipt_id FROM receipt_value_evidence e JOIN ap_receipt_items l ON l.id=e.receipt_item_id JOIN ap_receipts r ON r.id=l.receipt_id AND r.organization_id=e.organization_id WHERE e.organization_id=1 AND r.purchase_order_id=$1",[po])).rows[0];
 const reversal=(await pool.query("INSERT INTO goods_receipt_reversals(organization_id,receipt_id,reason,reversed_by,idempotency_key,created_at) VALUES(1,$1,'Synthetic reversal fixture',$2,$3,'2020-02-01T12:00:00Z') RETURNING id",[original.receipt_id,admin,randomUUID()])).rows[0].id;
 await pool.query("INSERT INTO receipt_value_reversal_evidence(organization_id,reversal_id,original_evidence_id,quantity,posted_at,actor_user_id) VALUES(1,$1,$2,-1,'2020-02-01T12:00:00Z',$3)",[reversal,original.id,admin]);
 const reversed=await capture({measure:"received",from:"2020-02-01",to:"2020-02-01",supplierId:fixture.supplierId});expect(reversed.amount).toBe("-10.00");expect((await groups(reversed.id,"month")).items[0].bucket_key).toBe("2020-02");
 const other=(await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,'Synthetic mismatched supplier','active') RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO invoices(organization_id,invoice_number,supplier_id,purchase_order_id,status,issue_date,due_date,total,subtotal,paid_amount,due_amount,currency_code,created_by) VALUES(1,$1,$2,$3,'APPROVED','2020-03-01','2020-03-01',10,10,0,10,'ZAR',$4)",[randomUUID(),other,po,admin]);
 const receipt=(await pool.query("INSERT INTO ap_receipts(organization_id,receipt_number,purchase_order_id,supplier_id,received_date) VALUES(1,$1,$2,$3,'2020-03-01') RETURNING id",[randomUUID(),po,other])).rows[0].id;
 const line=(await pool.query("INSERT INTO ap_receipt_items(receipt_id,item_id,quantity,accepted_quantity) VALUES($1,$2,1,1) RETURNING id",[receipt,fixture.itemId])).rows[0].id;
 await pool.query("INSERT INTO receipt_value_evidence(organization_id,receipt_item_id,quantity,unit_price,currency_code,source_price_reference,posted_at,actor_user_id) VALUES(1,$1,1,10,'ZAR','synthetic mismatch','2020-03-01',$2)",[line,admin]);
 for(const measure of ["invoiced","received"]){const run=await capture({measure,from:"2020-03-01",to:"2020-03-01",supplierId:other});expect(run.amount).toBe("10.00");for(const d of ["department","contract","project"])expect((await groups(run.id,d)).items[0].dimension_state).toBe("unavailable");}
});
test("capture retries serialize and audit failure rolls back the observation and retry record",async()=>{
 const key=randomUUID(),results=await Promise.all([capture(body(),key),capture(body(),key)]);expect(results[0].id).toBe(results[1].id);
 expect((await post(root,{...body(),to:"2021-02-16"},key)).status).toBe(409);
 const before=Number((await pool.query("SELECT count(*) n FROM financial_reporting_runs WHERE organization_id=1")).rows[0].n),failKey=randomUUID();
 await pool.query("CREATE FUNCTION b5_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SPEND_CUBE_CAPTURED' THEN RAISE EXCEPTION 'synthetic cube audit failure'; END IF;RETURN NEW;END $$;CREATE TRIGGER b5_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION b5_test_audit_failure()");
 try{const r=await post(root,body(),failKey);expect(r.status).toBe(503);expect(JSON.stringify(r.json)).not.toContain("synthetic cube audit failure");expect(Number((await pool.query("SELECT count(*) n FROM financial_reporting_runs WHERE organization_id=1")).rows[0].n)).toBe(before);expect((await pool.query("SELECT count(*)::int n FROM workflow_idempotency WHERE organization_id=1 AND idempotency_key=$1",[failKey])).rows[0].n).toBe(0);}
 finally{await pool.query("DROP TRIGGER b5_test_audit_failure ON audit_logs;DROP FUNCTION b5_test_audit_failure()");}
 expect((await capture(body(),failKey)).id).toBeTruthy();
});
test("current access is enforced through cube, canonical evidence, CSV, jobs and downloads",async()=>{
 test.setTimeout(70_000);const actor=await reader(),run=await capture(body(),randomUUID(),actor.cookie);
 const job=await post("/v2/analytics/financial-measures/ordered/export",{runId:run.id},randomUUID(),actor.cookie);expect(job.status,JSON.stringify(job.json)).toBe(202);const jobId=unwrapData<{jobId:number}>(job.json,"job").jobId;
 await expect.poll(async()=>{const j=(await pool.query("SELECT status,last_error FROM export_jobs WHERE organization_id=1 AND id=$1",[jobId])).rows[0];if(j.status==="failed")throw Error(j.last_error);return j.status;},{timeout:40000}).toBe("succeeded");
 const token=(await pool.query("SELECT download_token FROM export_jobs WHERE organization_id=1 AND id=$1",[jobId])).rows[0].download_token;
 const path=`/api/export/download/${jobId}?token=${token}`,response=await fetch(getTestBaseUrl()+path,{headers:{Cookie:actor.cookie}});expect(response.status).toBe(200);expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toContain("frozenDimensions");
 await pool.query("DELETE FROM custom_role_permissions WHERE role_id=$1 AND resource='master_data' AND permission_type='read'",[actor.role]);
 for(const url of [`${root}/${run.id}`,`/v2/analytics/financial-measures/ordered/evidence?runId=${run.id}`,`/export/financial_measure/csv?measure=ordered&runId=${run.id}`,path.replace(/^\/api/,"")])expect((await get(url,actor.cookie)).status,url).toBe(403);
 expect((await post("/v2/analytics/financial-measures/ordered/export",{runId:run.id},randomUUID(),actor.cookie)).status).toBe(403);
 await expect(assertExportActorAccess(pool,{organizationId:1,userId:actor.user,dataset:"financial_measure",filters:{measure:"ordered",runId:run.id}})).rejects.toThrow();
 await pool.query("INSERT INTO custom_role_permissions(role_id,resource,permission_type) VALUES($1,'master_data','read')",[actor.role]);
 const warehouse=(await pool.query("SELECT id FROM warehouses WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0].id;
 await pool.query("UPDATE users SET warehouse_id=$2 WHERE id=$1",[actor.user,warehouse]);
 expect((await get(`${root}/${run.id}`,actor.cookie)).status).toBe(403);await expect(assertExportActorAccess(pool,{organizationId:1,userId:actor.user,dataset:"financial_measure",filters:{measure:"ordered",runId:run.id}})).rejects.toThrow();
 await pool.query("UPDATE users SET warehouse_id=NULL WHERE id=$1",[actor.user]);
 await pool.query("UPDATE organization_members SET active=false WHERE organization_id=1 AND user_id=$1",[actor.user]);expect((await get(`${root}/${run.id}`,actor.cookie)).status).toBe(403);
});
test("UI captures, explains and deep-links saved evidence with retry and keyboard access",async({page},info)=>{
 const pageErrors:string[]=[];page.on("pageerror",error=>pageErrors.push(error.message));
 test.setTimeout(60_000);await loginAsSeededUser(page,"admin",admin);page.on("console",message=>{if(message.type()==="error")pageErrors.push(message.text());});await page.goto("/analytics/spend-cube");await expect(page.getByRole("heading",{name:"Spend Cube",exact:true})).toBeVisible();
 await page.getByLabel("From source date",{exact:true}).fill(from);await page.getByLabel("To source date",{exact:true}).fill(from);
 await page.getByLabel("Find supplier",{exact:true}).fill((await pool.query("SELECT name FROM suppliers WHERE organization_id=1 AND id=$1",[fixture.supplierId])).rows[0].name);
 await expect(page.getByLabel("Supplier scope",{exact:true}).locator(`option[value='${fixture.supplierId}']`)).toHaveCount(1);
 await page.getByLabel("Supplier scope",{exact:true}).selectOption(String(fixture.supplierId));expect(await page.getByLabel("Supplier scope",{exact:true}).inputValue()).toBe(String(fixture.supplierId));
 const result=page.waitForResponse(r=>r.url().endsWith("/api/v2/analytics/spend-cube")&&r.request().method()==="POST");await page.getByRole("button",{name:"Capture new observation",exact:true}).click();const response=await result;expect(response.status()).toBe(200);
 await expect(page.getByRole("status").filter({hasText:"500.50 ZAR"})).toBeVisible();
 const inspect=page.getByRole("button",{name:/Why this number:/}).first();await inspect.focus();await page.keyboard.press("Enter");await expect(page.getByRole("region",{name:"Frozen contribution details"})).toContainText("5005 source contributions");
 const saved=page.url();await page.reload();await expect(page.getByRole("region",{name:"Frozen contribution details"})).toContainText("5005 source contributions");expect(page.url()).toBe(saved);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath("spend-cube.png"),fullPage:true});await page.getByRole("region",{name:"Frozen contribution details"}).getByRole("heading",{name:"Why this number?",exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("spend-evidence.png"),fullPage:true});
 expect(pageErrors).toEqual([]);
});
test("empty, disabled, read failure/retry and denied UI states remain explicit",async({page})=>{
 const run=await capture({...body(),from:"2021-02-14",to:"2021-02-14"});expect(run.state).toBe("empty");
 let fail=true;await page.route("**/api/v2/analytics/spend-cube/*?*",async route=>{if(fail){fail=false;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"SYNTHETIC",message:"Retry saved observation"}})});}else await route.continue();});
 await loginAsSeededUser(page,"admin",admin);await page.goto(`/analytics/spend-cube?runId=${run.id}`);await expect(page.getByRole("button",{name:"Retry observation",exact:true})).toBeVisible();await page.getByRole("button",{name:"Retry observation",exact:true}).click();await expect(page.getByText("No source contributions in this observation.",{exact:true})).toBeVisible();
 await pool.query("UPDATE organization_settings SET feature_flags=feature_flags||'{\"spend_cube\":false}' WHERE organization_id=1");try{expect(errorCode((await post(root,body())).json)).toBe("SPEND_DISABLED");await page.reload();await expect(page.getByRole("status").filter({hasText:"New captures are disabled"})).toBeVisible();}finally{await pool.query("UPDATE organization_settings SET feature_flags=feature_flags||'{\"spend_cube\":true}' WHERE organization_id=1");}
 const actor=await reader();await pool.query("DELETE FROM custom_role_permissions WHERE role_id=$1 AND resource='master_data'",[actor.role]);await loginAsSeededUser(page,actor.username,actor.user);await page.goto("/analytics/spend-cube");await expect(page.getByRole("alert").filter({hasText:"Master Data read access is required"})).toBeVisible();
});
