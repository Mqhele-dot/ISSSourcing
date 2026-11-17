import {randomUUID} from "node:crypto";
import {expect,test,type Page} from "@playwright/test";
import {pool} from "../server/db";
import {apiJsonRequest,loginForTests} from "../scripts/test-http";
import {seedProcurementEvidenceFixture,unwrapData,errorCode} from "../scripts/runtime-fixtures/procurement-line-evidence-fixture";
import {loginAsSeededUser,requireDisposableE2eDatabase} from "./wave7-helpers";
import type {IntakeNeed,IntakeEvaluation,IntakeRoute} from "../shared/procurement-intake";

// Cases have independent commands; Playwright recreates their guarded fixture
// after a failed worker instead of skipping unrelated acceptance coverage.
test.describe.configure({mode:"default"});
const root="/v2/procurement/intake";
let f:Awaited<ReturnType<typeof seedProcurementEvidenceFixture>>,cookie="",agreement=0,policy=0,requester=0;
let initialSourcing:unknown[]=[];
const need=(patch:Partial<IntakeNeed>={}):IntakeNeed=>({description:`Intake equipment ${f.suffix}`,kind:"goods",quantity:2,
  estimatedValue:"250",currency:"ZAR",requiredDate:new Date(Date.now()+7*86400000).toISOString().slice(0,10),
  justification:`Controlled intake test ${f.suffix}`,departmentId:f.departmentId,costCentreId:f.costCentreId,
  supplierId:f.supplierId,unitId:f.unitOfMeasureId,taxId:f.taxCodeId,...patch});
const post=(path:string,body:unknown,key?:string,actor=cookie)=>apiJsonRequest(root+path,{method:"POST",cookie:actor,body,
  headers:key?{"Idempotency-Key":key}:undefined});
async function evaluate(n=need()){
  const res=await post("/evaluate",n);expect(res.status,JSON.stringify(res.json)).toBe(200);
  return unwrapData<IntakeEvaluation>(res.json,"evaluation");
}
const convert=(e:IntakeEvaluation,key=randomUUID(),route:IntakeRoute=e.recommendation)=>post("/convert",{need:e.normalized,revision:e.revision,route},key);
const count=async()=>(await pool.query("SELECT count(*)::int n FROM purchase_requisitions WHERE organization_id=1")).rows[0].n;

test.beforeAll(async()=>{
  requireDisposableE2eDatabase();
  expect((await pool.query("SELECT current_database() name")).rows[0].name).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
  f=await seedProcurementEvidenceFixture();
  cookie=(await loginForTests("admin","Admin123!"))!;expect(cookie).toBeTruthy();
  requester=(await pool.query("SELECT id FROM users WHERE username='admin'")).rows[0].id;
  initialSourcing=(await pool.query("SELECT id FROM mdm_procurement_policies WHERE organization_id=1 AND policy_type='sourcing' AND active")).rows.map(r=>r.id);
  await pool.query("UPDATE mdm_procurement_policies SET active=false WHERE organization_id=1 AND policy_type='sourcing'");
  policy=(await pool.query(`INSERT INTO mdm_procurement_policies(organization_id,code,name,policy_type,config,active)
    VALUES(1,$1,'Intake competition','sourcing','{"competitionRequired":true,"competitionThreshold":1000}',true) RETURNING id`,[`INTAKE-${f.suffix}`])).rows[0].id;
  agreement=(await pool.query(`INSERT INTO supplier_contracts(organization_id,supplier_id,title,contract_type,contract_number,start_date,
    status,approval_status,currency,owner_user_id,version,maximum_value) VALUES(1,$1,$2,'blanket',$2,now()-interval '1 day',
    'active','APPROVED','ZAR',$3,1,5000) RETURNING id`,[f.supplierId,`INTAKE-${f.suffix}`,requester])).rows[0].id;
  await pool.query(`INSERT INTO supplier_contract_lines(organization_id,contract_id,line_number,item_id,description,currency_code,unit_price,
    minimum_quantity,maximum_quantity,valid_from) VALUES(1,$1,1,$2,'Intake catalogue','ZAR',100,1,100,now()-interval '1 day')`,[agreement,f.itemId]);
  await pool.query(`INSERT INTO procurement_feature_settings(organization_id,phase2_enabled) VALUES(1,true)
    ON CONFLICT(organization_id) DO UPDATE SET phase2_enabled=true`);
  await pool.query(`INSERT INTO approval_policies(organization_id,name,entity_type,approval_level,approver_role)
    VALUES(1,'Intake release','contract_release',1,'admin')`);
});
test.afterAll(async()=>{
  if(policy){await pool.query("UPDATE mdm_procurement_policies SET active=false WHERE id=$1 AND organization_id=1",[policy]);
    if(initialSourcing.length)await pool.query("UPDATE mdm_procurement_policies SET active=true WHERE id=ANY($1::int[]) AND organization_id=1",[initialSourcing]);}
});

test("standard, services, uncertainty, catalogue, agreement and competition use current canonical rules",async()=>{
  const standard=await evaluate();expect(standard.recommendation).toBe("STANDARD_REQUISITION");expect(standard.canCreateDraft).toBe(true);
  const service=await evaluate(need({kind:"service"}));expect(service.recommendation).toBe("SERVICE_REQUISITION");
  const serviceDraft=await convert(service);expect(serviceDraft.status,JSON.stringify(serviceDraft.json)).toBe(201);
  const serviceId=unwrapData<{id:number}>(serviceDraft.json,"service draft").id;
  expect((await pool.query("SELECT line_type,fulfilment_type FROM purchase_requisition_items WHERE requisition_id=$1",[serviceId])).rows)
    .toEqual([{line_type:"SERVICE",fulfilment_type:"SERVICE_CONFIRMATION"}]);
  const unsure=await evaluate(need({kind:"unsure"}));expect(unsure.recommendation).toBe("MANUAL_PROCUREMENT_REVIEW");expect(unsure.canCreateDraft).toBe(false);
  const contract=await evaluate(need({itemId:f.itemId}));expect(contract.recommendation).toBe("CONTRACT_RELEASE");
  expect(contract.agreement?.id).toBe(agreement);expect(contract.alternatives).toContain("CATALOG_REQUISITION");
  expect(contract.reasons.join(" ")).toContain("approved");
  await pool.query("UPDATE supplier_contracts SET status='draft' WHERE id=$1 AND organization_id=1",[agreement]);
  const catalog=await evaluate(need({itemId:f.itemId,supplierId:undefined}));expect(catalog.recommendation).toBe("CATALOG_REQUISITION");
  expect(catalog.supplier?.id).toBe(f.supplierId);expect(catalog.reasons.join(" ")).toContain("preferred");
  await pool.query("UPDATE supplier_contracts SET status='active' WHERE id=$1 AND organization_id=1",[agreement]);
  const competition=await evaluate(need({estimatedValue:"2000"}));expect(competition.recommendation).toBe("RFQ_OR_SOURCING");
  expect(competition.sourcing.required).toBe(true);expect(competition.sourcing.threshold).toBe(1000);
  expect((await convert(competition)).status).toBe(201);
  const conservative=await evaluate(need({itemId:f.itemId,quantity:20,estimatedValue:"1"}));
  expect(conservative.recommendation).toBe("RFQ_OR_SOURCING");
  const conservativeDraft=await convert(conservative);expect(conservativeDraft.status).toBe(201);
  expect((await pool.query("SELECT total_amount FROM purchase_requisitions WHERE organization_id=1 AND id=$1",
    [unwrapData<{id:number}>(conservativeDraft.json,"conservative sourcing draft").id])).rows[0].total_amount).toBe(2000);
});

test("approval applicability follows the priced route and unavailable alternatives are not offered",async()=>{
  const previous=(await pool.query("SELECT id FROM approval_policies WHERE organization_id=1 AND entity_type='requisition' AND is_active")).rows.map(r=>r.id);
  await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND entity_type='requisition'");
  const approval=(await pool.query(`INSERT INTO approval_policies(organization_id,name,entity_type,amount_min,amount_max,approval_level,approver_role)
    VALUES(1,'Intake priced route','requisition',0,150,1,'planner') RETURNING id`)).rows[0].id;
  try{
    const e=await evaluate(need({itemId:f.itemId,contractId:agreement,quantity:1,estimatedValue:"250"}));
    expect(e.recommendation).toBe("CONTRACT_RELEASE");expect(e.canCreateDraft).toBe(true);expect(e.alternatives).toEqual([]);
    expect((await convert(e)).status).toBe(201);
  }finally{
    await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND id=$1",[approval]);
    await pool.query("UPDATE approval_policies SET is_active=true WHERE organization_id=1 AND id=ANY($1::int[])",[previous]);
  }
});

test("expired/blocked agreements, suppliers, onboarding and missing Master Data cannot convert",async()=>{
  const n=need({itemId:f.itemId,contractId:agreement});
  await pool.query("UPDATE supplier_contracts SET end_date=now()-interval '1 hour' WHERE id=$1 AND organization_id=1",[agreement]);
  expect((await evaluate(n)).blockers.map(b=>b.code)).toContain("INTAKE_CONTRACT_UNAVAILABLE");
  await pool.query("UPDATE supplier_contracts SET end_date=null,status='draft' WHERE id=$1 AND organization_id=1",[agreement]);
  expect((await evaluate(n)).canCreateDraft).toBe(false);
  await pool.query("UPDATE supplier_contracts SET status='active' WHERE id=$1 AND organization_id=1",[agreement]);
  await pool.query("UPDATE suppliers SET status='blocked' WHERE id=$1 AND organization_id=1",[f.supplierId]);
  const blocked=await evaluate();expect(blocked.canCreateDraft).toBe(false);expect((await convert(blocked)).status).toBe(409);
  await pool.query("UPDATE suppliers SET status='active',onboarding_status='prospective' WHERE id=$1 AND organization_id=1",[f.supplierId]);
  expect((await evaluate()).recommendation).toBe("SUPPLIER_ONBOARDING_REQUIRED");
  await pool.query("UPDATE suppliers SET onboarding_status='APPROVED' WHERE id=$1 AND organization_id=1",[f.supplierId]);
  const missing=await evaluate(need({departmentId:undefined,unitId:undefined}));expect(missing.canCreateDraft).toBe(false);
  expect(missing.blockers.some(b=>b.state==="setup_required")).toBe(true);
  expect((await evaluate(need({currency:"XXX"}))).canCreateDraft).toBe(false);
});

test("tenant and ownership substitutions, strict inputs, no permission and revoked membership are denied",async()=>{
  const org=(await pool.query(`INSERT INTO organizations(id,name,slug) SELECT coalesce(max(id),0)+100,$1,$1 FROM organizations RETURNING id`,[`intake-${f.suffix}`])).rows[0].id;
  const foreignSupplier=(await pool.query("INSERT INTO suppliers(organization_id,name) VALUES($1,'Foreign') RETURNING id",[org])).rows[0].id;
  const foreignDept=(await pool.query("INSERT INTO departments(organization_id,code,name) VALUES($1,'FOREIGN','Foreign') RETURNING id",[org])).rows[0].id;
  const foreignCentre=(await pool.query("INSERT INTO mdm_cost_centres(organization_id,code,name) VALUES($1,'FOREIGN','Foreign') RETURNING id",[org])).rows[0].id;
  const foreignSite=(await pool.query("INSERT INTO mdm_sites(organization_id,code,name) VALUES($1,'FOREIGN','Foreign') RETURNING id",[org])).rows[0].id;
  const foreignItem=(await pool.query("INSERT INTO inventory_items(organization_id,name,sku,quantity,price) VALUES($1,'Foreign','FOREIGN',0,10) RETURNING id",[org])).rows[0].id;
  const foreignContract=(await pool.query("INSERT INTO supplier_contracts(organization_id,supplier_id,title,start_date) VALUES($1,$2,'Foreign',now()) RETURNING id",[org,foreignSupplier])).rows[0].id;
  const foreignReq=(await pool.query("INSERT INTO purchase_requisitions(organization_id,requisition_number,requestor_id) VALUES($1,'FOREIGN',$2) RETURNING id",[org,requester])).rows[0].id;
  const foreignOrder=(await pool.query("INSERT INTO purchase_orders(organization_id,order_number,created_by_user_id,supplier_id,approval_status) VALUES($1,'FOREIGN',$2,$3,'APPROVED') RETURNING id",[org,requester,foreignSupplier])).rows[0].id;
  const before=await count();
  for(const patch of [{supplierId:foreignSupplier},{departmentId:foreignDept},{costCentreId:foreignCentre},{siteId:foreignSite},
    {itemId:foreignItem},{contractId:foreignContract},{source:{kind:"requisition" as const,id:foreignReq}},{source:{kind:"order" as const,id:foreignOrder}}]){
    const denied=await post("/evaluate",need(patch));expect(denied.status,JSON.stringify(patch)).toBe(404);
    expect(JSON.stringify(denied.json)).not.toContain('"Foreign"');
  }
  expect(await count()).toBe(before);
  expect((await post("/evaluate",{...need(),organizationId:org,approverId:requester,status:"APPROVED"})).status).toBe(400);
  expect((await post("/evaluate",need({quantity:1.5}))).status).toBe(400);
  const viewer=(await loginForTests("viewer","Admin123!"))!;
  const e=await evaluate();expect([403,401]).toContain((await post("/convert",{need:e.normalized,revision:e.revision,route:e.recommendation},randomUUID(),viewer)).status);
  await pool.query("UPDATE organization_members SET active=false WHERE organization_id=1 AND user_id=$1",[requester]);
  try{expect([401,403]).toContain((await post("/evaluate",need())).status);}finally{
    await pool.query("UPDATE organization_members SET active=true WHERE organization_id=1 AND user_id=$1",[requester]);
  }
});

test("source and policy drift, changed payload and route tampering reject without creating drafts",async()=>{
  const n=need({itemId:f.itemId,contractId:agreement}),e=await evaluate(n),before=await count();
  await pool.query("UPDATE supplier_contracts SET status='draft' WHERE id=$1 AND organization_id=1",[agreement]);
  let changed=await convert(e);expect(changed.status).toBe(409);expect(errorCode(changed.json)).toBe("INTAKE_RECOMMENDATION_CHANGED");
  await pool.query("UPDATE supplier_contracts SET status='active' WHERE id=$1 AND organization_id=1",[agreement]);
  const p=await evaluate();
  await pool.query("UPDATE mdm_procurement_policies SET config=$2::jsonb,updated_at=now() WHERE id=$1",[policy,JSON.stringify({competitionRequired:true,competitionThreshold:100})]);
  changed=await convert(p);expect(errorCode(changed.json)).toBe("INTAKE_RECOMMENDATION_CHANGED");
  await pool.query("UPDATE mdm_procurement_policies SET config=$2::jsonb,updated_at=now() WHERE id=$1",[policy,JSON.stringify({competitionRequired:true,competitionThreshold:1000})]);
  const fresh=await evaluate();expect((await convert(fresh,randomUUID(),"CONTRACT_RELEASE")).status).toBe(409);
  expect(await count()).toBe(before);
});

test("concurrent retries create one unauthorised draft with atomic audit and no copied history",async()=>{
  const e=await evaluate(),key=randomUUID(),before=await count();
  const results=await Promise.all([convert(e,key),convert(e,key),convert(e,key)]);
  for(const r of results)expect([200,201],JSON.stringify(r.json)).toContain(r.status);
  const ids=results.map(r=>unwrapData<{id:number}>(r.json,"conversion").id);expect(new Set(ids).size).toBe(1);expect(await count()).toBe(before+1);
  const row=(await pool.query("SELECT * FROM purchase_requisitions WHERE organization_id=1 AND id=$1",[ids[0]])).rows[0];
  expect(row.status).toBe("DRAFT");expect(row.approver_id).toBeNull();expect(row.approval_date).toBeNull();expect(row.requestor_id).toBe(requester);
  expect((await pool.query("SELECT count(*)::int n FROM approval_history WHERE organization_id=1 AND entity_type='requisition' AND entity_id=$1",[ids[0]])).rows[0].n).toBe(0);
  const audit=(await pool.query("SELECT details FROM audit_logs WHERE organization_id=1 AND resource_id=$1 AND action='INTAKE_CONVERTED'",[String(ids[0])])).rows;
  expect(audit).toHaveLength(1);expect(audit[0].details.revision).toBe(e.revision);expect(audit[0].details.decision.policy.id).toBe(policy);
  expect((await post("/convert",{need:{...e.normalized,quantity:3},revision:e.revision,route:e.recommendation},key)).status).toBe(409);
  const source=await apiJsonRequest(`${root}/recent/requisition/${ids[0]}`,{cookie});
  expect(source.status).toBe(200);const seed=unwrapData<{need:Partial<IntakeNeed>}>(source.json,"recent");
  expect(seed.need).not.toHaveProperty("approverId");expect(seed.need).not.toHaveProperty("estimatedValue");
  const repeated=await evaluate(need({...seed.need,requiredDate:e.normalized.requiredDate,justification:"Fresh review required"}));
  const second=await convert(repeated);expect(second.status).toBe(201);expect(unwrapData<{id:number}>(second.json,"repeat").id).not.toBe(ids[0]);
  const po=(await pool.query(`INSERT INTO purchase_orders(organization_id,order_number,created_by_user_id,supplier_id,department_id,
    currency_code,approval_status,status) VALUES(1,$1,$2,$3,$4,'ZAR','APPROVED','APPROVED') RETURNING id`,[`INTAKE-PO-${f.suffix}`,requester,f.supplierId,f.departmentId])).rows[0].id;
  await pool.query(`INSERT INTO purchase_order_items(order_id,item_id,line_number,line_type,quantity,unit_price,total_price,
    unit_of_measure_id,tax_code_id,cost_centre_id,gl_account_code)
    VALUES($1,$2,1,'CATALOG',2,125,250,$3,$4,$5,$6)`,[po,f.itemId,f.unitOfMeasureId,f.taxCodeId,f.costCentreId,f.glAccountCode]);
  const poSeed=unwrapData<{need:Partial<IntakeNeed>}>((await apiJsonRequest(`${root}/recent/order/${po}`,{cookie})).json,"repeat PO");
  expect(poSeed.need.source).toEqual({kind:"order",id:po});
  const orderRepeat=await convert(await evaluate(need({...poSeed.need,requiredDate:e.normalized.requiredDate,justification:"Repeat only as fresh draft"})));
  expect(orderRepeat.status).toBe(201);
});

test("audit failure rolls back header, lines and retry; safe retry succeeds",async()=>{
  const e=await evaluate(),key=randomUUID(),before=await count();
  const lineCount=async()=>(await pool.query("SELECT count(*)::int n FROM purchase_requisition_items")).rows[0].n;
  const linesBefore=await lineCount();
  await pool.query(`CREATE FUNCTION intake_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='INTAKE_CONVERTED' THEN RAISE EXCEPTION 'Synthetic intake audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER intake_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION intake_fail_audit()`);
  try{expect((await convert(e,key)).status).toBe(503);expect(await count()).toBe(before);expect(await lineCount()).toBe(linesBefore);
    expect((await pool.query("SELECT count(*)::int n FROM workflow_idempotency WHERE organization_id=1 AND idempotency_key=$1",[key])).rows[0].n).toBe(0);
  }finally{await pool.query("DROP TRIGGER intake_fail_audit ON audit_logs; DROP FUNCTION intake_fail_audit()");}
  expect((await convert(e,key)).status).toBe(201);
});

async function pick(page:Page,label:string,search:string){
  await page.getByRole("button",{name:label,exact:true}).click();
  await page.getByLabel(`Search ${label.toLowerCase()}`,{exact:true}).fill(search);
  const choice=page.locator("ul button").filter({hasText:new RegExp(`Wave 7 .+ ${f.suffix}`)});
  await expect(choice).toHaveCount(1);await choice.focus();await page.keyboard.press("Enter");
  await expect(page.getByRole("button",{name:label,exact:true})).toContainText(f.suffix);
}
async function fill(page:Page){
  await page.getByLabel("Description of need",{exact:true}).fill(`Browser intake ${f.suffix}`);
  await page.getByLabel("Goods or service",{exact:true}).selectOption("goods");
  await page.getByLabel("Estimated total value",{exact:true}).fill("250");
  await page.getByLabel("Required date",{exact:true}).fill(need().requiredDate);
  await page.getByLabel("Business justification",{exact:true}).fill("Verified browser purchasing need");
  await pick(page,"Department",f.suffix);await pick(page,"Cost centre",f.suffix);await pick(page,"Known supplier",f.suffix);
  await page.getByText("More details (agreement, currency, unit and tax)",{exact:true}).click();
  await pick(page,"Unit of measure",f.suffix);
}
test("connected browser need, alternative, new draft and expert workflow remain usable",async({page},info)=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await loginAsSeededUser(page,"admin",requester);await page.goto("/procurement/intake");
  await expect(page.getByText("What do you need?",{exact:true})).toBeVisible();
  await fill(page);await pick(page,"Known catalogue item",f.suffix);
  await page.getByRole("button",{name:"Save as favorite",exact:true}).click();
  await page.getByRole("button",{name:"Evaluate request",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Recommended: Agreement-backed requisition"})).toBeFocused();
  await page.getByRole("radio",{name:"Catalogue requisition",exact:true}).check();
  await page.screenshot({path:info.outputPath("intake-recommendation.png"),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("button",{name:"Create controlled draft",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Draft created",exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Open requisition draft",exact:true}).click();
  await expect(page.getByTestId("requisition-form-page")).toBeVisible();
  await expect(page.getByTestId("requisition-save-button")).toBeVisible();
  const draftId=Number(new URL(page.url()).pathname.split("/").pop());expect(draftId).toBeGreaterThan(0);
  const draft=(await pool.query("SELECT status,approver_id FROM purchase_requisitions WHERE organization_id=1 AND id=$1",[draftId])).rows[0];
  expect(draft).toEqual({status:"DRAFT",approver_id:null});
  const submit=await apiJsonRequest(`/v2/procurement/requisitions/${draftId}/submit`,{method:"POST",cookie,body:{}});
  expect(submit.status,JSON.stringify(submit.json)).toBe(200);
  const independent=(await loginForTests("planner","Admin123!"))!;
  const approved=await apiJsonRequest(`/v2/procurement/requisitions/${draftId}/approve`,{method:"POST",cookie:independent,body:{comment:"Independent intake browser verification"}});
  expect(approved.status,JSON.stringify(approved.json)).toBe(200);
  const order=await apiJsonRequest(`/purchase-requisitions/${draftId}/convert`,{method:"POST",cookie,body:{}});
  expect(order.status,JSON.stringify(order.json)).toBe(201);
  const orderId=unwrapData<{id:number}>(order.json,"intake to order").id;
  const parity=(await pool.query(`SELECT p.requisition_id,i.item_id,i.quantity,i.unit_price,i.unit_of_measure_id,i.cost_centre_id,
    i.gl_account_code FROM purchase_orders p JOIN purchase_order_items i ON i.order_id=p.id WHERE p.organization_id=1 AND p.id=$1`,[orderId])).rows[0];
  expect(parity).toMatchObject({requisition_id:draftId,item_id:f.itemId,quantity:1,unit_price:250,unit_of_measure_id:f.unitOfMeasureId,cost_centre_id:f.costCentreId,gl_account_code:f.glAccountCode});
  expect(errors).toEqual([]);
});

test("browser loading, setup, stale recommendation, failed/retry and denied states",async({page},info)=>{
  test.setTimeout(90000);
  await loginAsSeededUser(page,"admin",requester);await page.goto("/procurement/intake");await fill(page);
  await page.getByRole("button",{name:"Department",exact:true}).click();await page.getByRole("button",{name:"Clear selection",exact:true}).click();
  await page.getByRole("button",{name:"Evaluate request",exact:true}).click();
  await expect(page.getByText("Choose an active department.",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"Create controlled draft",exact:true})).toHaveCount(0);
  await pick(page,"Department",f.suffix);await pick(page,"Cost centre",f.suffix);
  let release:(()=>void)|undefined;const delayed=new Promise<void>(r=>{release=r;});
  let completed:(()=>void)|undefined;const continued=new Promise<void>(r=>{completed=r;});
  await page.route("**/api/v2/procurement/intake/evaluate",async route=>{await delayed;await route.continue();completed!();});
  await page.getByRole("button",{name:"Evaluate request",exact:true}).click();await expect(page.getByRole("button",{name:"Evaluating…",exact:true})).toBeDisabled();
  release!();await continued;await page.unroute("**/api/v2/procurement/intake/evaluate");
  await expect(page.getByRole("button",{name:"Create controlled draft",exact:true})).toBeVisible();
  await pool.query("UPDATE suppliers SET status='blocked' WHERE organization_id=1 AND id=$1",[f.supplierId]);
  await page.getByRole("button",{name:"Create controlled draft",exact:true}).click();
  await expect(page.getByText("The sources or policy changed.",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"Create controlled draft",exact:true})).toHaveCount(0);
  await pool.query("UPDATE suppliers SET status='active' WHERE organization_id=1 AND id=$1",[f.supplierId]);
  await page.route("**/api/v2/procurement/intake/evaluate",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"INTAKE_UNAVAILABLE",message:"Intake is temporarily unavailable. Retry."}})}));
  await page.getByRole("button",{name:"Evaluate request",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"The service could not complete this request"})).toBeVisible();
  await page.unroute("**/api/v2/procurement/intake/evaluate");await page.getByRole("button",{name:"Evaluate request",exact:true}).click();
  await expect(page.getByRole("button",{name:"Create controlled draft",exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath("intake-retry.png"),fullPage:true});
  await page.route("**/api/v2/procurement/intake/context",route=>route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"INTAKE_PERMISSION_DENIED",message:"You need purchase read access to use Smart Intake."}})}));
  await page.reload();await expect(page.getByRole("alert").filter({hasText:"You do not have access to this action"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Retry Intake",exact:true})).toBeVisible();
});
