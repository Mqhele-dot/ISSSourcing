import { expect, test, type Page } from "@playwright/test";
import { pool } from "../server/db";
import { gotoAuthed, readBrowserApi } from "./test-helpers";
import { requireDisposableE2eDatabase } from "./wave7-helpers";
import { appendAuditEventWithClient } from "../server/services/audit-chain-client";
import { bindPurchaseOrderBudgetProvenance } from "../server/modules/procurement/purchase-order-budget-provenance";
import { apiJsonRequest, loginForTests } from "../scripts/test-http";

async function guarded() {
  requireDisposableE2eDatabase();
  expect((await pool.query("SELECT current_database() name")).rows[0].name).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
}
async function csrf(page: Page) {
  const response = await readBrowserApi(page, "/api/csrf-token");
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { "X-CSRF-Token": body.data?.csrfToken ?? body.csrfToken };
}

test("linked RFQ creation serializes both entry points and cannot race into a second purchasing path", async ({ page }, info) => {
  test.setTimeout(120000);
  await guarded();
  const label=`RFQ-${crypto.randomUUID()}`;
  const supplier=(await pool.query(`INSERT INTO suppliers(organization_id,name,status,onboarding_status)
    VALUES(1,$1,'active','approved') RETURNING id`,[label])).rows[0].id;
  const item=(await pool.query("SELECT id FROM inventory_items WHERE organization_id=1 AND status='active' ORDER BY id LIMIT 1")).rows[0].id;
  const foreignOrg=(await pool.query(`INSERT INTO organizations(id,name,slug)
    SELECT coalesce(max(id),0)+100,$1,$1 FROM organizations RETURNING id`,[`${label}-foreign`])).rows[0].id;
  const makeReq=async(suffix:string,org=1)=>{
    const id=(await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,supplier_id,status,currency_code,total_amount,exchange_rate_to_zar)
      VALUES($1,$2,$3,'APPROVED','ZAR',100,1) RETURNING id`,[org,`${label}-${suffix}`,supplier])).rows[0].id;
    await pool.query(`INSERT INTO purchase_requisition_items(requisition_id,item_id,line_number,quantity,unit_price,total_price,description)
      VALUES($1,$2,1,2,50,100,'Locked requisition line')`,[id,item]);
    return id;
  };
  const req=await makeReq("atomic"), other=await makeReq("cross-route"), racing=await makeReq("race"), foreign=await makeReq("foreign",foreignOrg);
  await gotoAuthed(page,"/procurement/overview");
  const headers=await csrf(page);
  const body={title:`${label} ${info.project.name}`,deadline:new Date(Date.now()+86400000).toISOString(),supplierIds:[supplier],minimumResponses:1};
  const direct={...body,reportingCurrencyCode:"ZAR",criteria:[{name:"Landed cost",criterionType:"commercial",weight:100}],
    lines:[{itemId:item,quantity:2,description:"Locked requisition line",targetUnitPrice:50,targetCurrencyCode:"ZAR"}]};
  const v2=(id:number,key:string=crypto.randomUUID(),data=body)=>page.request.post(`/api/v2/procurement/requisitions/${id}/convert-to-rfq`,{headers:{...headers,"Idempotency-Key":key},data});
  const create=(id:number|null,key:string=crypto.randomUUID())=>page.request.post("/api/sourcing/events",{headers:{...headers,"Idempotency-Key":key},data:{...direct,requisitionId:id}});
  const snapshot=async(id:number)=>(await pool.query(`SELECT r.status,
    (SELECT count(*)::int FROM sourcing_events WHERE organization_id=1 AND requisition_id=r.id) AS rfqs,
    (SELECT count(*)::int FROM purchase_orders WHERE organization_id=1 AND requisition_id=r.id) AS orders
    FROM purchase_requisitions r WHERE r.organization_id=1 AND r.id=$1`,[id])).rows[0];
  expect((await v2(foreign)).status()).toBe(404);
  expect((await create(foreign)).status()).toBe(404);
  expect((await v2(req,crypto.randomUUID(),{...body,deadline:"invalid"})).status()).toBe(400);
  const key=crypto.randomUUID();
  await pool.query(`CREATE FUNCTION build2_reject_rfq_creation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='RFQ_CREATED' THEN RAISE EXCEPTION 'Synthetic RFQ creation audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER build2_reject_rfq_creation BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build2_reject_rfq_creation()`);
  try {
    expect((await v2(req,key)).status()).toBe(500);
    expect(await snapshot(req)).toEqual({status:"APPROVED",rfqs:0,orders:0});
    expect((await pool.query("SELECT id FROM workflow_idempotency WHERE organization_id=1 AND idempotency_key=$1",[key])).rowCount).toBe(0);
  } finally {await pool.query("DROP TRIGGER build2_reject_rfq_creation ON audit_logs; DROP FUNCTION build2_reject_rfq_creation()");}
  const replies=await Promise.all([v2(req,key),v2(req,key)]);
  expect(replies.map(r=>r.status())).toEqual([201,201]);
  const results=await Promise.all(replies.map(async r=>(await r.json()).data));
  const eventId=results[0].event.id;
  expect(results[1].event.id).toBe(eventId);
  expect(results[0]).toMatchObject({event:{status:"DRAFT",requisitionId:req},
    lines:[{itemId:item,quantity:2,targetUnitPrice:50,targetCurrencyCode:"ZAR"}],
    invitations:[{invitation:{supplierId:supplier}}]});
  expect((await v2(req,key,{...body,title:"Changed retry request"})).status()).toBe(409);
  expect((await v2(other,key)).status()).toBe(409);
  expect(await snapshot(req)).toEqual({status:"CONVERTED_TO_RFQ",rfqs:1,orders:0});
  const audit=(await pool.query(`SELECT event_hash,details FROM audit_logs WHERE organization_id=1 AND action='RFQ_CREATED' AND resource_type='sourcing_event' AND resource_id=$1`,[eventId])).rows;
  expect(audit).toEqual([expect.objectContaining({event_hash:expect.any(String),details:expect.objectContaining({
    before:{requisitionId:req,requisitionStatus:"APPROVED"},after:expect.objectContaining({requisitionId:req,requisitionStatus:"CONVERTED_TO_RFQ"}),
  })})]);
  const competing=await Promise.all([create(other),v2(other)]);
  expect(competing.map(r=>r.status()).sort()).toEqual([201,409]);
  expect(await snapshot(other)).toEqual({status:"CONVERTED_TO_RFQ",rfqs:1,orders:0});
  const race=await Promise.all([v2(racing),page.request.post(`/api/purchase-requisitions/${racing}/convert`,{
    headers:{...headers,"Idempotency-Key":crypto.randomUUID()},data:{},
  })]);
  expect(race.map(r=>r.status()).sort()).toEqual([201,409]);
  expect(await snapshot(racing)).toEqual(race[0].status()===201
    ?{status:"CONVERTED_TO_RFQ",rfqs:1,orders:0}:{status:"CONVERTED_TO_PO",rfqs:0,orders:1});
  const standalone=await create(null);
  expect(standalone.status()).toBe(201);
  expect((await standalone.json()).data.event).toMatchObject({status:"DRAFT",requisitionId:null});
  await page.goto(`/procurement/sourcing/${eventId}`);
  await expect(page.getByTestId("sourcing-event-detail")).toContainText(body.title);
});

test("linked RFQ withdrawal preserves independent approval and serializes against competing actions", async ({ page, browser }) => {
  test.setTimeout(180000);
  await guarded();
  const label = `Withdraw-${crypto.randomUUID()}`;
  const {rows: [{admin,maker}]} = await pool.query(`SELECT
    (SELECT id FROM users WHERE username='admin') AS admin,(SELECT id FROM users WHERE username='planner') AS maker`);
  const supplier = (await pool.query(`INSERT INTO suppliers(organization_id,name,status,onboarding_status) VALUES(1,$1,'active','approved') RETURNING id`,[label])).rows[0].id;
  const item = (await pool.query("SELECT id FROM inventory_items WHERE organization_id=1 AND status='active' ORDER BY id LIMIT 1")).rows[0].id;
  const budget = (await pool.query(`INSERT INTO finance_budgets(organization_id,fiscal_year,currency_code,approved_amount)
    VALUES(1,2099,'ZAR',1000) RETURNING id`)).rows[0].id;
  await gotoAuthed(page, "/procurement/overview");
  const headers = await csrf(page);
  const post = (url:string,data:object,key = crypto.randomUUID()) => page.request.post(url,{headers:{...headers,"Idempotency-Key":key},data});
  const fixture = async (suffix:string,proof:"history"|"policy"|"none" = "history") => {
    const req = (await pool.query(`INSERT INTO purchase_requisitions
      (organization_id,requisition_number,requestor_id,approver_id,approval_date,supplier_id,status,currency_code,total_amount,exchange_rate_to_zar)
      VALUES(1,$1,$2,$3,now(),$4,'APPROVED','ZAR',100,1) RETURNING id`,[`${label}-${suffix}`,maker,admin,supplier])).rows[0].id;
    await pool.query(`INSERT INTO purchase_requisition_items(requisition_id,item_id,line_number,quantity,unit_price,total_price,description)
      VALUES($1,$2,1,2,50,100,'Synthetic withdrawal line')`,[req,item]);
    await pool.query(`INSERT INTO budget_commitments(organization_id,budget_id,source_type,source_id,amount,currency_code,status)
      VALUES(1,$1,'REQUISITION',$2,100,'ZAR','ACTIVE')`,[budget,req]);
    if(proof==="history") await pool.query(`INSERT INTO approval_history(organization_id,entity_type,entity_id,action,performed_by,previous_status,new_status,performed_at)
      SELECT organization_id,'requisition',id,'approved',approver_id,'SUBMITTED','APPROVED',approval_date FROM purchase_requisitions WHERE organization_id=1 AND id=$1`,[req]);
    if(proof==="policy") await pool.query(`INSERT INTO purchase_budget_policy_evidence
      (organization_id,requisition_id,approved_at,approver_user_id,policy_revision,policy_mode,outcome,budget_id)
      SELECT organization_id,id,approval_date,approver_id,'synthetic-1','HARD_BLOCK','within_budget',$2
      FROM purchase_requisitions WHERE organization_id=1 AND id=$1`,[req,budget]);
    const result = await post(`/api/v2/procurement/requisitions/${req}/convert-to-rfq`, {
      title:`${label}-${suffix}`, supplierIds:[supplier], minimumResponses:1, deadline:new Date(Date.now()+86400000).toISOString(),
    });
    expect(result.status(),await result.text()).toBe(201);
    return {req,event:(await result.json()).data.event.id as number};
  };
  const reason = "Buyer withdrew the unused synthetic draft.";
  const endpoint = (event:number) => `/api/sourcing/events/${event}/withdraw-draft`;
  const withdraw = (event:number,key = crypto.randomUUID(),text = reason) => post(endpoint(event),{reason:text},key);
  const snapshot = async ({req,event}:{req:number;event:number}) => (await pool.query(`SELECT r.status AS requisition,s.status AS event,r.approver_id,
    r.approval_date::text, s.version,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM budget_commitments c
       WHERE c.organization_id=1 AND c.source_type='REQUISITION' AND c.source_id=r.id) AS commitments,
    (SELECT count(*)::int FROM sourcing_event_lines WHERE organization_id=1 AND event_id=s.id) AS lines,
    (SELECT count(*)::int FROM sourcing_invitations WHERE organization_id=1 AND event_id=s.id) AS invitations,
    (SELECT count(*)::int FROM purchase_orders WHERE organization_id=1 AND requisition_id=r.id) AS orders
    FROM purchase_requisitions r JOIN sourcing_events s ON s.organization_id=r.organization_id AND s.requisition_id=r.id
    WHERE r.organization_id=1 AND r.id=$1 AND s.id=$2`,[req,event])).rows[0];
  const available = await fixture("available","policy");
  const initial = await snapshot(available);
  expect(initial).toMatchObject({requisition:"CONVERTED_TO_RFQ",event:"DRAFT",version:1,lines:1,invitations:1,orders:0});
  const anonymous = await browser.newContext({baseURL:new URL(page.url()).origin});
  try {
    expect([401,403]).toContain((await anonymous.request.post(endpoint(available.event), {data:{reason}})).status());
  } finally { await anonymous.close(); }
  expect((await post(endpoint(available.event),{reason,organizationId:1})).status()).toBe(400);
  expect((await withdraw(available.event,"")).status()).toBe(400);
  const foreignOrg = (await pool.query(`INSERT INTO organizations(id,name,slug)
    SELECT coalesce(max(id),0)+100,$1,$1 FROM organizations RETURNING id`,[`${label}-foreign`])).rows[0].id;
  const foreignEvent = (await pool.query(`INSERT INTO sourcing_events(organization_id,event_number,title,owner_user_id,deadline,status)
    VALUES($1,$2,$2,$3,now()+interval '1 day','DRAFT') RETURNING id`,[foreignOrg,label,maker])).rows[0].id;
  expect((await withdraw(foreignEvent)).status()).toBe(404);
  expect((await withdraw((await fixture("absent","none")).event)).status()).toBe(409);
  const stale = await fixture("stale");
  await pool.query("UPDATE purchase_requisition_items SET quantity=3 WHERE requisition_id=$1",[stale.req]);
  expect((await withdraw(stale.event)).status()).toBe(409);
  expect(await snapshot(stale)).toMatchObject({requisition:"CONVERTED_TO_RFQ",event:"DRAFT"});
  const used = await fixture("used");
  await pool.query("UPDATE sourcing_invitations SET viewed_at=now() WHERE organization_id=1 AND event_id=$1",[used.event]);
  expect((await withdraw(used.event)).status()).toBe(409);

  const key = crypto.randomUUID();
  await pool.query(`CREATE FUNCTION build2_reject_rfq_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='RFQ_DRAFT_WITHDRAWN' THEN RAISE EXCEPTION 'Synthetic RFQ withdrawal audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER build2_reject_rfq_withdrawal BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build2_reject_rfq_withdrawal()`);
  try {
    expect((await withdraw(available.event,key)).status()).toBe(500);
    expect(await snapshot(available)).toEqual(initial);
    expect((await pool.query("SELECT id FROM workflow_idempotency WHERE organization_id=1 AND idempotency_key=$1",[key])).rowCount).toBe(0);
  } finally {await pool.query("DROP TRIGGER build2_reject_rfq_withdrawal ON audit_logs; DROP FUNCTION build2_reject_rfq_withdrawal()");}

  await page.goto(`/procurement/sourcing/${available.event}`);
  await page.getByRole("button",{name:"Withdraw linked draft"}).click();
  const dialog = page.getByRole("dialog",{name:"Withdraw linked RFQ draft?"});
  const confirm = dialog.getByRole("button",{name:"Withdraw draft and restore requisition"});
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Withdrawal reason").fill(reason);
  await confirm.focus();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith(endpoint(available.event)) && response.status()===200),
    confirm.press("Enter"),
  ]);
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("sourcing-event-detail").getByText("CANCELLED",{exact:true})).toBeVisible();
  expect(await snapshot(available)).toEqual({...initial,requisition:"APPROVED",event:"CANCELLED",version:2});
  const records = (await pool.query(`SELECT a.reason,a.details,w.idempotency_key FROM audit_logs a JOIN workflow_idempotency w
    ON w.organization_id=a.organization_id AND w.resource_id=a.resource_id AND w.action='RFQ_DRAFT_WITHDRAW'
    WHERE a.organization_id=1 AND a.resource_type='sourcing_event' AND a.resource_id=$1 AND a.action='RFQ_DRAFT_WITHDRAWN'`,[available.event])).rows;
  expect(records).toEqual([expect.objectContaining({reason,details:expect.objectContaining({creationAuditId:expect.any(String),
    approval:expect.objectContaining({approvalKind:"budget_policy"})})})]);
  expect((await (await withdraw(available.event,records[0].idempotency_key)).json()).data.duplicate).toBe(true);
  expect((await withdraw(available.event,records[0].idempotency_key,"Different reason")).status()).toBe(409);
  expect((await withdraw(stale.event,records[0].idempotency_key)).status()).toBe(409);
  await page.screenshot({path:test.info().outputPath("linked-rfq-withdrawn.png")});

  const publish = await fixture("publish");
  const publication = await Promise.all([withdraw(publish.event),post(`/api/sourcing/events/${publish.event}/publish`,{})]);
  expect(publication.map(r=>r.status()).sort()).toEqual([200,409]);
  const published = publication[1].ok();
  expect(await snapshot(publish)).toMatchObject(published?{event:"OPEN",requisition:"CONVERTED_TO_RFQ"}:{event:"CANCELLED",requisition:"APPROVED"});
  if(published) expect((await withdraw(publish.event)).status()).toBe(409);
  const clarification = await fixture("clarification");
  const note = await Promise.all([withdraw(clarification.event),post(`/api/sourcing/events/${clarification.event}/clarifications`,
    {subject:"Synthetic question",message:"Confirm synthetic delivery date.",visibility:"ALL_INVITED"})]);
  expect(note[0].ok()?note[1].status():note[0].status()).toBe(409);
  expect(note[0].ok()||note[1].status()===201).toBe(true);

  const po = await fixture("po");
  const convert = () => post(`/api/purchase-requisitions/${po.req}/convert`,{});
  const concurrent = await Promise.all([withdraw(po.event),convert()]);
  expect(concurrent[0].status()).toBe(200);
  if(concurrent[1].status()===409) expect((await convert()).status()).toBe(201);
  else expect(concurrent[1].status()).toBe(201);
  expect(await snapshot(po)).toMatchObject({event:"CANCELLED",requisition:"CONVERTED_TO_PO",orders:1});
});

test("sourcing award approval and conversion conserve the linked reservation and audit atomically", async ({ page }) => {
  test.setTimeout(120000);
  await guarded();
  const ref = `Atomic-award-${crypto.randomUUID()}`;
  const admin = (await pool.query("SELECT id FROM users WHERE username='admin'")).rows[0].id;
  const maker = (await pool.query("SELECT id FROM users WHERE username='planner'")).rows[0].id;
  const supplier = (await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,$1,'active') RETURNING id", [ref])).rows[0].id;
  const otherSupplier = (await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,$1,'active') RETURNING id", [`${ref}-other`])).rows[0].id;
  const item = (await pool.query("SELECT id FROM inventory_items WHERE organization_id=1 AND status='active' ORDER BY id LIMIT 1")).rows[0].id;
  const budget = (await pool.query(`INSERT INTO finance_budgets(organization_id,fiscal_year,currency_code,approved_amount)
    VALUES(1,2099,'ZAR',1000) RETURNING id`)).rows[0].id;
  const foreignOrg = (await pool.query(`INSERT INTO organizations(id,name,slug)
    SELECT coalesce(max(id),0)+100,$1,$1 FROM organizations RETURNING id`, [ref])).rows[0].id;
  const fixture = async (suffix: string, status: string, split = false) => {
    const reference = `${ref}-${suffix}`;
    const req = (await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,requestor_id,supplier_id,status,currency_code,total_amount,exchange_rate_to_zar)
      VALUES(1,$1,$2,$3,$4,'ZAR',100,1) RETURNING id`, [reference, maker, supplier, status])).rows[0].id;
    await pool.query("INSERT INTO purchase_requisition_items(requisition_id,item_id,quantity,unit_price,total_price) VALUES($1,$2,2,50,100)", [req, item]);
    const commitment = (await pool.query(`INSERT INTO budget_commitments(organization_id,budget_id,source_type,source_id,amount,currency_code,status)
      VALUES(1,$1,'REQUISITION',$2,100,'ZAR','ACTIVE') RETURNING id`, [budget, req])).rows[0].id;
    const event = (await pool.query(`INSERT INTO sourcing_events(organization_id,event_number,title,owner_user_id,requisition_id,deadline,status)
      VALUES(1,$1,$1,$2,$3,now()+interval '1 day','EVALUATING') RETURNING id`, [reference, maker, req])).rows[0].id;
    const eventLine = (await pool.query(`INSERT INTO sourcing_event_lines(organization_id,event_id,line_number,item_id,description,quantity)
      VALUES(1,$1,1,$2,'Synthetic item',2) RETURNING id`, [event, item])).rows[0].id;
    const award = (await pool.query(`INSERT INTO sourcing_awards(organization_id,event_id,status,recommended_by_user_id,justification,override_reason)
      VALUES(1,$1,'SUBMITTED',$2,'Synthetic award','Independently reviewed exception') RETURNING id`, [event, maker])).rows[0].id;
    let line: number | undefined;
    for (const supplierId of split ? [supplier, otherSupplier] : [supplier]) {
      const quote = (await pool.query(`INSERT INTO supplier_quotes(organization_id,event_id,supplier_id,quote_number,status,currency_code)
        VALUES(1,$1,$2,$3,'SUBMITTED','ZAR') RETURNING id`, [event, supplierId, `${reference}-${supplierId}`])).rows[0].id;
      const q = (await pool.query(`INSERT INTO supplier_quote_lines(organization_id,quote_id,event_line_id,quantity,unit_price)
        VALUES(1,$1,$2,2,40) RETURNING id`, [quote, eventLine])).rows[0].id;
      line = (await pool.query(`INSERT INTO sourcing_award_lines(organization_id,award_id,event_line_id,quote_line_id,supplier_id,awarded_quantity,awarded_unit_price,currency_code,reporting_amount)
        VALUES(1,$1,$2,$3,$4,$5,40,'ZAR',$6) RETURNING id`, [award, eventLine, q, supplierId, split ? 1 : 2, split ? 40 : 80])).rows[0].id;
    }
    return { req, commitment, event, award, line };
  };
  const linked = await fixture("linked", "CONVERTED_TO_RFQ");
  await pool.query("UPDATE purchase_requisitions SET approver_id=$2,approval_date=now() WHERE organization_id=1 AND id=$1",[linked.req,admin]);
  await pool.query(`INSERT INTO purchase_budget_policy_evidence(organization_id,requisition_id,approved_at,approver_user_id,policy_revision,policy_mode,outcome,budget_id)
    SELECT organization_id,id,approval_date,approver_id,'synthetic-award-v1','HARD_BLOCK','within_budget',$2 FROM purchase_requisitions WHERE organization_id=1 AND id=$1`,[linked.req,budget]);
  const competing = await fixture("competing", "APPROVED");
  const split = await fixture("split", "APPROVED", true);
  const foreignAward = (await pool.query(`INSERT INTO sourcing_awards(organization_id,event_id,status,recommended_by_user_id,justification)
    VALUES($1,$2,'SUBMITTED',$3,'Foreign award') RETURNING id`, [foreignOrg, linked.event, maker])).rows[0].id;
  await gotoAuthed(page, "/procurement/overview");
  const headers = await csrf(page);
  const command = (award: number, action: "approve" | "convert-to-po", key: string = crypto.randomUUID()) =>
    page.request.post(`/api/sourcing/awards/${award}/${action}`, { headers: { ...headers, "Idempotency-Key": key },
      data: action === "approve" ? { reason: "Independent synthetic review" } : {} });
  const snapshot = async (f: typeof linked) => (await pool.query(`SELECT a.status AS award,e.status AS event,r.status AS req,b.status AS commitment,
    (SELECT count(*)::int FROM purchase_orders WHERE organization_id=1 AND requisition_id=r.id) AS orders,
    (SELECT count(*)::int FROM budget_commitments WHERE organization_id=1 AND parent_commitment_id=b.id) AS children,
    (SELECT count(*)::int FROM workflow_idempotency WHERE organization_id=1 AND resource_type='sourcing_award' AND resource_id=a.id) AS keys
    FROM sourcing_awards a JOIN sourcing_events e ON e.id=a.event_id JOIN purchase_requisitions r ON r.id=e.requisition_id
    JOIN budget_commitments b ON b.id=$2 WHERE a.organization_id=1 AND a.id=$1`, [f.award, f.commitment])).rows[0];
  const approveKey = crypto.randomUUID(), convertKey = crypto.randomUUID();
  expect((await command(foreignAward, "approve")).status()).toBe(404);
  await pool.query(`CREATE FUNCTION build2_reject_sourcing_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action IN ('RFQ_AWARD_APPROVED','RFQ_AWARD_CONVERTED_TO_PO') THEN RAISE EXCEPTION 'Synthetic sourcing audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER build2_reject_sourcing_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build2_reject_sourcing_audit()`);
  try {
    expect((await command(linked.award, "approve", approveKey)).status()).toBe(500);
    expect(await snapshot(linked)).toEqual({ award: "SUBMITTED", event: "EVALUATING", req: "CONVERTED_TO_RFQ", commitment: "ACTIVE", orders: 0, children: 0, keys: 0 });
  } finally { await pool.query("DROP TRIGGER build2_reject_sourcing_audit ON audit_logs"); }
  const approvals = await Promise.all([command(linked.award, "approve", approveKey), command(linked.award, "approve", approveKey)]);
  expect(approvals.map(r => r.status())).toEqual([200, 200]);
  expect((await Promise.all(approvals.map(async r => (await r.json()).data.duplicate))).sort()).toEqual([false, true]);
  expect((await command(competing.award, "approve", approveKey)).status()).toBe(409);
  await pool.query("CREATE TRIGGER build2_reject_sourcing_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build2_reject_sourcing_audit()");
  try {
    expect((await command(linked.award, "convert-to-po", convertKey)).status()).toBe(500);
    expect(await snapshot(linked)).toEqual({ award: "APPROVED", event: "AWARDED", req: "CONVERTED_TO_RFQ", commitment: "ACTIVE", orders: 0, children: 0, keys: 1 });
  } finally {
    await pool.query("DROP TRIGGER build2_reject_sourcing_audit ON audit_logs; DROP FUNCTION build2_reject_sourcing_audit()");
  }
  await pool.query("UPDATE sourcing_events SET requisition_id=$1 WHERE id=$2", [competing.req, linked.event]);
  await pool.query("UPDATE purchase_requisitions SET organization_id=$1 WHERE id=$2", [foreignOrg, competing.req]);
  try { expect((await command(linked.award, "convert-to-po", convertKey)).status()).toBe(404); }
  finally {
    await pool.query("UPDATE purchase_requisitions SET organization_id=1 WHERE id=$1", [competing.req]);
    await pool.query("UPDATE sourcing_events SET requisition_id=$1 WHERE id=$2", [linked.req, linked.event]);
  }
  const originalQuoteLine = (await pool.query("SELECT quote_line_id FROM sourcing_award_lines WHERE id=$1", [linked.line])).rows[0].quote_line_id;
  await pool.query(`UPDATE sourcing_award_lines SET quote_line_id=(SELECT quote_line_id FROM sourcing_award_lines WHERE id=$1) WHERE id=$2`, [competing.line, linked.line]);
  try {
    const mismatched = await command(linked.award, "convert-to-po", convertKey);
    expect(mismatched.status()).toBe(409);
    expect((await mismatched.json()).error.code).toBe("AWARD_SOURCE_UNAVAILABLE");
  } finally { await pool.query("UPDATE sourcing_award_lines SET quote_line_id=$1 WHERE id=$2", [originalQuoteLine, linked.line]); }
  const converted = await Promise.all([command(linked.award, "convert-to-po", convertKey), command(linked.award, "convert-to-po", convertKey)]);
  expect(converted.map(r => r.status())).toEqual([200, 200]);
  const payloads = await Promise.all(converted.map(async r => (await r.json()).data));
  const po = payloads.find(r => !r.duplicate).purchaseOrders[0].id;
  expect(payloads.find(r => r.duplicate).purchaseOrderIds).toEqual([po]);
  expect((await command(linked.award, "convert-to-po")).status()).toBe(409);
  expect(await snapshot(linked)).toEqual({ award: "CONVERTED", event: "AWARDED", req: "CONVERTED_TO_PO", commitment: "TRANSFERRED", orders: 1, children: 1, keys: 2 });
  const child = (await pool.query(`SELECT id,amount::text,currency_code,status,budget_id FROM budget_commitments
    WHERE organization_id=1 AND source_type='PURCHASE_ORDER' AND source_id=$1`, [po])).rows[0];
  expect(child).toMatchObject({ amount: "100.0000", currency_code: "ZAR", status: "ACTIVE", budget_id: budget });
  const evidence = (await pool.query(`SELECT action,details,event_hash FROM audit_logs WHERE organization_id=1 AND resource_type='sourcing_award'
    AND resource_id=$1 ORDER BY id`, [linked.award])).rows;
  expect(evidence.map(r => r.action)).toEqual(["RFQ_AWARD_APPROVED", "RFQ_AWARD_CONVERTED_TO_PO"]);
  expect(evidence.every(r => r.event_hash)).toBe(true);
  expect(evidence[1].details.after).toMatchObject({ purchaseOrderIds: [po], budgetTransfer: { sourceCommitmentId: linked.commitment, purchaseOrderCommitmentId: child.id } });
  await pool.query("UPDATE purchase_orders SET status='APPROVED',approval_status='APPROVED' WHERE organization_id=1 AND id=$1", [po]);
  const report = (await (await readBrowserApi(page, "/api/v2/procurement/maverick-spend?outcome=approved_override")).json()).data;
  expect(report.items.filter((row: { id: number }) => row.id === po)).toEqual([expect.objectContaining({
    coverage:expect.objectContaining({budget:"recorded"}),budgetConversionKind:"sourcing_award",
    sourcingAwardId: linked.award, approvedOverrideReason: "Independently reviewed exception", currencyCode: "ZAR",
  })]);
  expect((await command(split.award, "approve")).status()).toBe(200);
  const refused = await command(split.award, "convert-to-po");
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe("AWARD_BUDGET_SPLIT_REVIEW_REQUIRED");
  expect(await snapshot(split)).toMatchObject({ award: "APPROVED", req: "APPROVED", commitment: "ACTIVE", orders: 0, children: 0 });
  expect((await command(competing.award, "approve")).status()).toBe(200);
  const race = await Promise.all([command(competing.award, "convert-to-po"),
    page.request.post(`/api/purchase-requisitions/${competing.req}/convert`, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() }, data: {} })]);
  expect(race.filter(r => [200, 201].includes(r.status()))).toHaveLength(1);
  expect(race.filter(r => r.status() === 409)).toHaveLength(1);
  expect(await snapshot(competing)).toMatchObject({ req: "CONVERTED_TO_PO", commitment: "TRANSFERRED", orders: 1, children: 1 });
  expect(admin).not.toBe(maker);
});

test("requisition conversion commits sourcing evidence and budget transfer with exactly one PO", async ({ page }, info) => {
  test.setTimeout(120000);
  await guarded();
  const label = `Convert-${info.project.name}-${Date.now()}`;
  const supplier = (await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,$1,'active') RETURNING id", [label])).rows[0].id;
  const item = (await pool.query("SELECT id FROM inventory_items WHERE organization_id=1 AND status='active' ORDER BY id LIMIT 1")).rows[0].id;
  const req = (await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,supplier_id,status,currency_code,total_amount,exchange_rate_to_zar)
    VALUES(1,$1,$2,'APPROVED','ZAR',100,1) RETURNING id`, [label, supplier])).rows[0].id;
  await pool.query(`INSERT INTO purchase_requisition_items(requisition_id,item_id,quantity,unit_price,total_price)
    VALUES($1,$2,2,50,100)`, [req, item]);
  const budget = (await pool.query(`INSERT INTO finance_budgets(organization_id,fiscal_year,currency_code,approved_amount)
    VALUES(1,EXTRACT(YEAR FROM now())::int,'ZAR',1000) RETURNING id`)).rows[0].id;
  const commitment = (await pool.query(`INSERT INTO budget_commitments(organization_id,budget_id,source_type,source_id,amount,currency_code,status)
    VALUES(1,$1,'REQUISITION',$2,100,'ZAR','ACTIVE') RETURNING id`, [budget, req])).rows[0].id;
  await pool.query(`UPDATE purchase_requisitions SET requestor_id=(SELECT id FROM users WHERE username='viewer'),
    approver_id=(SELECT id FROM users WHERE username='admin'),approval_date=now()
    WHERE organization_id=1 AND id=$1`,[req]);
  await pool.query(`INSERT INTO purchase_budget_policy_evidence
    (organization_id,requisition_id,approved_at,approver_user_id,policy_revision,policy_mode,outcome,budget_id)
    SELECT organization_id,id,approval_date,approver_id,'synthetic-direct-v1','HARD_BLOCK','within_budget',$2
    FROM purchase_requisitions WHERE organization_id=1 AND id=$1`,[req,budget]);
  const previous = (await pool.query("UPDATE mdm_procurement_policies SET active=false WHERE organization_id=1 AND policy_type='sourcing' AND active=true RETURNING id")).rows.map(row => row.id);
  const policy = (await pool.query(`INSERT INTO mdm_procurement_policies(organization_id,code,name,policy_type,config,updated_at)
    VALUES(1,$1,'Disposable conversion competition','sourcing','{"competitionRequired":true,"competitionThreshold":50}','2026-01-01') RETURNING id`, [label])).rows[0].id;
  try {
    await gotoAuthed(page, "/procurement/overview");
    const key = crypto.randomUUID(), headers = { ...(await csrf(page)), "Idempotency-Key": key };
    const convert = (id = req) => page.request.post(`/api/purchase-requisitions/${id}/convert`, { headers });
    const denied = await convert();
    expect(denied.status()).toBe(409);
    expect((await denied.json()).error?.code).toBe("RFQ_EVIDENCE_REQUIRED");
    const foreignOrg = (await pool.query(`INSERT INTO organizations(id,name,slug,active)
      SELECT COALESCE(MAX(id),0)+1000,$1,$1,true FROM organizations RETURNING id`, [label])).rows[0].id;
    const foreignReq = (await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,status)
      VALUES($1,$2,'APPROVED') RETURNING id`, [foreignOrg, label])).rows[0].id;
    expect((await convert(foreignReq)).status()).toBe(404);
    await pool.query("UPDATE mdm_procurement_policies SET config='{\"competitionRequired\":true,\"competitionThreshold\":200}',updated_at='2026-01-02' WHERE id=$1", [policy]);
    const foreignItem = (await pool.query("INSERT INTO inventory_items(organization_id,name,sku,price) VALUES($1,$2,$2,10) RETURNING id", [foreignOrg, label])).rows[0].id;
    await pool.query("UPDATE purchase_requisition_items SET item_id=$2 WHERE requisition_id=$1", [req, foreignItem]);
    const deniedItem = await convert();
    expect(deniedItem.status()).toBe(409);
    expect((await deniedItem.json()).error?.code).toBe("REQUISITION_ITEM_UNAVAILABLE");
    await pool.query("UPDATE purchase_requisition_items SET item_id=$2 WHERE requisition_id=$1", [req, item]);
    await pool.query(`CREATE FUNCTION build2_inject_conversion_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='REQUISITION_CONVERTED_TO_PO' THEN RAISE EXCEPTION 'Synthetic conversion audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER build2_inject_conversion_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build2_inject_conversion_audit_failure()`);
    try {
      expect((await convert()).status()).toBe(500);
      const rollback = (await pool.query(`SELECT r.status,b.status AS "budgetStatus",
        (SELECT count(*)::int FROM purchase_orders WHERE organization_id=1 AND requisition_id=$1) AS orders,
        (SELECT count(*)::int FROM budget_commitments WHERE organization_id=1 AND parent_commitment_id=$2) AS transfers,
        (SELECT count(*)::int FROM workflow_idempotency WHERE organization_id=1 AND idempotency_key=$3) AS retries
        FROM purchase_requisitions r JOIN budget_commitments b ON b.organization_id=r.organization_id
        WHERE r.organization_id=1 AND r.id=$1 AND b.id=$2`, [req, commitment, key])).rows[0];
      expect(rollback).toEqual({ status: "APPROVED", budgetStatus: "ACTIVE", orders: 0, transfers: 0, retries: 0 });
    } finally {
      await pool.query("DROP TRIGGER build2_inject_conversion_audit_failure ON audit_logs; DROP FUNCTION build2_inject_conversion_audit_failure()");
    }
    const replies = await Promise.all([convert(), convert()]);
    expect(replies.map(reply => reply.status()).sort()).toEqual([200, 201]);
    const [first, second] = await Promise.all(replies.map(async reply => (await reply.json()).data));
    expect(first.id).toBe(second.id);
    expect(replies[0].status() === 200 ? first.duplicate : second.duplicate).toBe(true);
    expect(first.createdByUserId).toBeGreaterThan(0);
    const transferred = (await pool.query(`SELECT p.status,p.source_id,p.amount::text,p.currency_code,r.status AS "parentStatus"
      FROM budget_commitments p JOIN budget_commitments r ON r.organization_id=p.organization_id AND r.id=p.parent_commitment_id
      WHERE p.organization_id=1 AND r.id=$1`, [commitment])).rows;
    expect(transferred).toEqual([{ status: "ACTIVE", source_id: first.id, amount: "100.0000", currency_code: "ZAR", parentStatus: "TRANSFERRED" }]);
    expect((await pool.query("SELECT status FROM purchase_requisitions WHERE organization_id=1 AND id=$1", [req])).rows[0].status).toBe("CONVERTED_TO_PO");
    expect((await pool.query("SELECT count(*)::int n FROM purchase_order_items WHERE order_id=$1", [first.id])).rows[0].n).toBe(1);
    const proof = (await pool.query(`SELECT details->'conversionPolicyDecision' AS decision FROM audit_logs WHERE organization_id=1
      AND action='REQUISITION_CONVERTED_TO_PO' AND resource_type='purchase_order' AND resource_id=$1`, [first.id])).rows;
    expect(proof).toEqual([{ decision: expect.objectContaining({ budgetTransferred: true,
      supplier: expect.objectContaining({ supplierStatus: "active" }),
      sourcing: expect.objectContaining({ threshold: 200, outcome: "below_threshold", policy: expect.objectContaining({ id: policy }) }),
    }) }]);
    const other = (await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,status)
      VALUES(1,$1,'APPROVED') RETURNING id`, [`${label}-OTHER`])).rows[0].id;
    const conflict = await convert(other);
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    await pool.query("UPDATE mdm_procurement_policies SET config='{\"competitionRequired\":true,\"competitionThreshold\":5}',updated_at=now() WHERE id=$1", [policy]);
    await pool.query("UPDATE purchase_orders SET status='APPROVED',approval_status='APPROVED' WHERE organization_id=1 AND id=$1", [first.id]);
    const report = (await (await readBrowserApi(page, "/api/v2/procurement/maverick-spend?outcome=po_conversion")).json()).data;
    expect(report.items.filter((row: { id: number }) => row.id === first.id)).toEqual([expect.objectContaining({
      coverage:expect.objectContaining({budget:"recorded"}),budgetConversionKind:"requisition",
      conversionEvidence: expect.objectContaining({ budgetTransferred: true, sourcing: expect.objectContaining({ threshold: 200 }) }),
    })]);
    await page.getByRole("button", { name: "Review budget evidence" }).click();
    await page.getByLabel("Budget evidence outcome").selectOption("po_conversion");
    await expect(page.getByText("Budget commitment transferred.")).toBeVisible();
    await expect(page.getByText(/below the configured threshold · Threshold 200/)).toBeVisible();
  } finally {
    await pool.query("UPDATE mdm_procurement_policies SET active=false WHERE id=$1", [policy]);
    if (previous.length) await pool.query("UPDATE mdm_procurement_policies SET active=true WHERE organization_id=1 AND id=ANY($1::int[])", [previous]);
  }
});

test("PO submission retains the actual readiness and competition decisions atomically", async ({ page }, info) => {
  test.setTimeout(120000);
  await guarded();
  const label = `Submit-${info.project.name}-${Date.now()}`;
  const supplier = (await pool.query("SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0].id;
  const item = (await pool.query("SELECT id FROM inventory_items WHERE organization_id=1 AND status='active' ORDER BY id LIMIT 1")).rows[0].id;
  const req = (await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,supplier_id,status,currency_code,total_amount,exchange_rate_to_zar)
    VALUES(1,$1,$2,'APPROVED','ZAR',100,1) RETURNING id`, [label, supplier])).rows[0].id;
  const order = (await pool.query(`INSERT INTO purchase_orders(organization_id,order_number,supplier_id,requisition_id,status,approval_status,currency_code,total_amount)
    VALUES(1,$1,$2,$3,'DRAFT','DRAFT','ZAR',100) RETURNING id`, [label, supplier, req])).rows[0].id;
  await pool.query("INSERT INTO purchase_order_items(order_id,item_id,quantity,unit_price,total_price) VALUES($1,$2,1,100,100)", [order, item]);
  const previous = (await pool.query("UPDATE mdm_procurement_policies SET active=false WHERE organization_id=1 AND policy_type='sourcing' AND active=true RETURNING id")).rows.map(row => row.id);
  const readiness = (await pool.query(`INSERT INTO mdm_procurement_policies(organization_id,code,name,policy_type,config,updated_at)
    VALUES(1,$1,'Disposable PO readiness','purchase_order','{}','2026-01-01') RETURNING id`, [`${label}-READY`])).rows[0].id;
  const competition = (await pool.query(`INSERT INTO mdm_procurement_policies(organization_id,code,name,policy_type,config,updated_at)
    VALUES(1,$1,'Disposable competition','sourcing','{"competitionRequired":true,"competitionThreshold":50}','2026-01-01') RETURNING id`, [`${label}-COMPETE`])).rows[0].id;
  try {
    await gotoAuthed(page, "/procurement/overview");
    const key = crypto.randomUUID(), headers = { ...(await csrf(page)), "Idempotency-Key": key };
    const submit = () => page.request.post(`/api/purchase-orders/${order}/submit`, { headers, data: { reason: "Verify captured decision" } });
    const denied = await submit();
    expect(denied.status()).toBe(409);
    expect((await denied.json()).error?.code).toBe("RFQ_EVIDENCE_REQUIRED");
    await pool.query("UPDATE mdm_procurement_policies SET config='{\"competitionRequired\":true,\"competitionThreshold\":200}',updated_at='2026-01-02' WHERE id=$1", [competition]);
    await pool.query(`CREATE FUNCTION build2_inject_submit_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='PURCHASE_ORDER_SUBMITTED' THEN RAISE EXCEPTION 'Synthetic submission audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER build2_inject_submit_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build2_inject_submit_audit_failure()`);
    try {
      expect((await submit()).status()).toBe(500);
      const rollback = (await pool.query(`SELECT p.approval_status,
        (SELECT count(*)::int FROM approval_history WHERE organization_id=1 AND entity_type='purchase_order' AND entity_id=$1) AS history,
        (SELECT count(*)::int FROM workflow_idempotency WHERE organization_id=1 AND idempotency_key=$2) AS retries
        FROM purchase_orders p WHERE p.organization_id=1 AND p.id=$1`, [order, key])).rows[0];
      expect(rollback).toEqual({ approval_status: "DRAFT", history: 0, retries: 0 });
    } finally {
      await pool.query("DROP TRIGGER build2_inject_submit_audit_failure ON audit_logs; DROP FUNCTION build2_inject_submit_audit_failure()");
    }
    expect((await submit()).status()).toBe(200);
    expect((await (await submit()).json()).data.duplicate).toBe(true);
    const proof = await pool.query(`SELECT details->'submissionPolicyDecision' AS decision FROM audit_logs
      WHERE organization_id=1 AND resource_type='purchase_order' AND action='PURCHASE_ORDER_SUBMITTED' AND resource_id=$1`, [order]);
    expect(proof.rows).toHaveLength(1);
    expect(proof.rows[0].decision).toMatchObject({ schemaVersion: 1,
      readiness: { policy: { id: readiness, code: `${label}-READY` }, catalogueItemIds: [item], rules: { requireTaxCode: false } },
      sourcing: { policy: { id: competition, code: `${label}-COMPETE` }, threshold: 200, reportingValue: 100, outcome: "below_threshold" } });
    await pool.query("UPDATE mdm_procurement_policies SET config='{\"requireTaxCode\":true}',updated_at=now() WHERE id=$1", [readiness]);
    await pool.query("UPDATE mdm_procurement_policies SET config='{\"competitionRequired\":true,\"competitionThreshold\":5}',updated_at=now() WHERE id=$1", [competition]);
    await pool.query("UPDATE purchase_orders SET status='APPROVED',approval_status='APPROVED' WHERE organization_id=1 AND id=$1", [order]);
    const report = (await (await readBrowserApi(page, "/api/v2/procurement/maverick-spend?outcome=po_submission")).json()).data;
    expect(report.items.filter((row: { id: number }) => row.id === order)).toEqual([expect.objectContaining({
      submissionEvidence: expect.objectContaining({ readinessRules: expect.objectContaining({ requireTaxCode: false }),
        sourcing: expect.objectContaining({ threshold: 200, outcome: "below_threshold" }) }),
    })]);
    await page.getByRole("button", { name: "Review budget evidence" }).click();
    await page.getByLabel("Budget evidence outcome").selectOption("po_submission");
    await expect(page.getByText(/below the configured threshold · Threshold 200/)).toBeVisible();
  } finally {
    await pool.query("UPDATE mdm_procurement_policies SET active=false WHERE organization_id=1 AND id=ANY($1::int[])", [[readiness, competition]]);
    if (previous.length) await pool.query("UPDATE mdm_procurement_policies SET active=true WHERE organization_id=1 AND id=ANY($1::int[])", [previous]);
  }
});

test("agreement releases freeze the applied version and price tier without upgrading legacy evidence", async ({ page }, info) => {
  test.setTimeout(120000);
  await guarded();
  const label = `Release-${info.project.name}-${Date.now()}`;
  const owner = (await pool.query("SELECT id FROM users WHERE username='viewer'")).rows[0].id;
  const supplier = (await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,$1,'active') RETURNING id", [label])).rows[0].id;
  const item = (await pool.query("SELECT id FROM inventory_items WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0].id;
  const agreement = (await pool.query(`INSERT INTO supplier_contracts(organization_id,supplier_id,title,contract_type,contract_number,
    start_date,status,approval_status,currency,owner_user_id,version,maximum_value)
    VALUES(1,$1,$2,'blanket',$2,now()-interval '1 day','active','APPROVED','USD',$3,7,1000) RETURNING id`, [supplier, label, owner])).rows[0].id;
  const requisition = (await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,requestor_id,supplier_id,status,currency_code,total_amount)
    VALUES(1,$1,$2,$3,'APPROVED','USD',200) RETURNING id`, [label, owner, supplier])).rows[0].id;
  const budgetId = (await pool.query(`INSERT INTO finance_budgets(organization_id,fiscal_year,currency_code,approved_amount,status)
    VALUES(1,2099,'USD',500,'ACTIVE') RETURNING id`)).rows[0].id;
  const sourceCommitmentId = (await pool.query(`INSERT INTO budget_commitments(organization_id,budget_id,source_type,source_id,amount,currency_code,status)
    VALUES(1,$1,'REQUISITION',$2,200,'USD','ACTIVE') RETURNING id`, [budgetId, requisition])).rows[0].id;
  await pool.query("UPDATE purchase_requisitions SET approver_id=(SELECT id FROM users WHERE username='admin'),approval_date=now() WHERE organization_id=1 AND id=$1",[requisition]);
  await pool.query(`INSERT INTO purchase_budget_policy_evidence(organization_id,requisition_id,approved_at,approver_user_id,policy_revision,policy_mode,outcome,budget_id)
    SELECT organization_id,id,approval_date,approver_id,'synthetic-agreement-v1','HARD_BLOCK','within_budget',$2 FROM purchase_requisitions WHERE organization_id=1 AND id=$1`,[requisition,budgetId]);
  const reqLines = (await pool.query(`INSERT INTO purchase_requisition_items(requisition_id,item_id,line_number,line_type,quantity,unit_price,total_price)
    VALUES($1,$2,1,'CATALOG',5,20,100),($1,$2,2,'CATALOG',5,20,100) RETURNING id`, [requisition, item])).rows;
  const agreementLine = (await pool.query(`INSERT INTO supplier_contract_lines(organization_id,contract_id,line_number,item_id,
    description,currency_code,unit_price,minimum_quantity,maximum_quantity,valid_from,valid_to)
    VALUES(1,$1,1,$2,'Captured line','USD',20,1,9,now()-interval '2 days',now()-interval '1 day') RETURNING id`, [agreement, item])).rows[0].id;
  const tier = (await pool.query(`INSERT INTO supplier_contract_price_breaks(organization_id,contract_line_id,minimum_quantity,unit_price)
    VALUES(1,$1,5,12.3456) RETURNING id`, [agreementLine])).rows[0].id;
  await pool.query(`INSERT INTO procurement_feature_settings(organization_id,phase2_enabled) VALUES(1,true)
    ON CONFLICT (organization_id) DO UPDATE SET phase2_enabled=true`);
  await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND entity_type='contract_release'");
  const policy = (await pool.query(`INSERT INTO approval_policies(organization_id,name,entity_type,approval_level,approver_role,version)
    VALUES(1,$1,'contract_release',1,'admin',3) RETURNING id`, [label])).rows[0].id;
  await gotoAuthed(page, "/procurement/contracts");
  const root = `/api/v2/procurement/contracts/${agreement}`;
  const key = crypto.randomUUID();
  const headers = { ...(await csrf(page)), "Idempotency-Key": key };
  const mappings = reqLines.map(row => ({ requisitionItemId: row.id, contractLineId: Number(agreementLine) }));
  const release = (lineMappings = mappings) => page.request.post(`${root}/release-po`, { headers, data: { requisitionId: requisition, lineMappings } });
  const errorCode = async (response: Awaited<ReturnType<typeof release>>) => (await response.json()).error?.code;
  expect(await errorCode(await release())).toBe("INVALID_AGREEMENT_LINE_MAPPING");
  await pool.query("UPDATE supplier_contract_lines SET valid_to=NULL WHERE id=$1", [agreementLine]);
  expect(await errorCode(await release())).toBe("INSUFFICIENT_AGREEMENT_QUANTITY");
  await pool.query("UPDATE supplier_contract_lines SET maximum_quantity=10 WHERE id=$1", [agreementLine]);
  await pool.query("UPDATE suppliers SET status='blocked' WHERE organization_id=1 AND id=$1", [supplier]);
  expect(await errorCode(await release())).toBe("SUPPLIER_BLOCKED");
  await pool.query("UPDATE suppliers SET status='active' WHERE organization_id=1 AND id=$1", [supplier]);
  await pool.query(`CREATE FUNCTION build2_inject_release_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='AGREEMENT_RELEASE_POLICY_CAPTURED' THEN RAISE EXCEPTION 'Synthetic release audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER build2_inject_release_audit_failure BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION build2_inject_release_audit_failure()`);
  try {
    expect((await release()).status()).toBe(500);
    const rolledBack = (await pool.query(`SELECT c.version,c.committed_value::text,
      (SELECT count(*)::int FROM purchase_orders p WHERE p.organization_id=1 AND p.requisition_id=$2) AS orders,
      (SELECT count(*)::int FROM approval_history h WHERE h.organization_id=1 AND h.entity_type='contract_release' AND h.entity_id=$2) AS approvals
      FROM supplier_contracts c WHERE c.organization_id=1 AND c.id=$1`, [agreement, requisition])).rows[0];
    expect(rolledBack).toEqual({ version: 7, committed_value: "0.0000", orders: 0, approvals: 0 });
    expect((await pool.query(`SELECT status,(SELECT count(*)::int FROM budget_commitments WHERE organization_id=1
      AND parent_commitment_id=$1) AS children FROM budget_commitments WHERE organization_id=1 AND id=$1`,
    [sourceCommitmentId])).rows[0]).toEqual({ status: "ACTIVE", children: 0 });
  } finally {
    await pool.query("DROP TRIGGER build2_inject_release_audit_failure ON audit_logs; DROP FUNCTION build2_inject_release_audit_failure()");
  }
  const replies = await Promise.all([release(), release([...mappings].reverse())]);
  expect(replies.map(reply => reply.status())).toEqual([201, 201]);
  const [first, second] = await Promise.all(replies.map(async reply => (await reply.json()).data));
  expect(first).toMatchObject({ agreementVersion: 7, purchaseOrderId: second.purchaseOrderId, id: second.id });
  expect((await pool.query("SELECT count(*)::int AS count FROM supplier_contract_releases WHERE organization_id=1 AND contract_id=$1", [agreement])).rows[0].count).toBe(1);
  const budgetTransfers = (await pool.query(`SELECT p.id,p.budget_id,p.amount::text,p.currency_code,p.status,p.source_id,r.status AS parent_status
    FROM budget_commitments r JOIN budget_commitments p ON p.organization_id=r.organization_id AND p.parent_commitment_id=r.id
    WHERE r.organization_id=1 AND r.id=$1 AND p.source_type='PURCHASE_ORDER'`, [sourceCommitmentId])).rows;
  expect(budgetTransfers).toEqual([expect.objectContaining({ budget_id: budgetId, amount: "200.0000", currency_code: "USD",
    status: "ACTIVE", source_id: first.purchaseOrderId, parent_status: "TRANSFERRED" })]);
  expect(await errorCode(await release(mappings.slice(0, 1)))).toBe("AGREEMENT_RELEASE_KEY_CONFLICT");
  const evidenceUrl = `${root}/releases/${first.id}/evidence`;
  expect((await readBrowserApi(page, `${root}/releases/invalid/evidence`)).status()).toBe(400);
  expect((await readBrowserApi(page, `${evidenceUrl}?pageSize=200`)).status()).toBe(400);
  const evidence = (await (await readBrowserApi(page, evidenceUrl)).json()).data;
  expect(evidence).toMatchObject({ agreementVersion: 7, agreement: { reference: label, currencyCode: "USD", releaseAmount: "123.4560" },
    budgetReservation: { transferred: true, transfer: { sourceCommitmentId, purchaseOrderCommitmentId: budgetTransfers[0].id } },
    approval: { policyId: policy, policyVersion: 3 }, supplier: { id: supplier, status: "active" }, lineCount: 2,
    lines: [expect.objectContaining({ unitPrice: "12.3456", priceBreak: { id: tier, minimumQuantity: "5.0000" } }), expect.objectContaining({ unitPrice: "12.3456" })] });
  await expect(pool.query("UPDATE agreement_release_policy_evidence SET agreement_version=9 WHERE release_id=$1", [first.id])).rejects.toThrow(/immutable/);
  await pool.query("UPDATE supplier_contracts SET version=9,currency='ZAR' WHERE organization_id=1 AND id=$1", [agreement]);
  await pool.query("UPDATE supplier_contract_price_breaks SET unit_price=1 WHERE id=$1", [tier]);
  await pool.query("UPDATE approval_policies SET version=4 WHERE organization_id=1 AND id=$1", [policy]);
  expect((await (await readBrowserApi(page, evidenceUrl)).json()).data).toEqual(evidence);
  const other = (await pool.query("SELECT id FROM supplier_contracts WHERE organization_id=1 AND id<>$1 ORDER BY id LIMIT 1", [agreement])).rows[0].id;
  expect((await readBrowserApi(page, `/api/v2/procurement/contracts/${other}/releases/${first.id}/evidence`)).status()).toBe(404);
  const legacyOrder = (await pool.query(`INSERT INTO purchase_orders(organization_id,order_number,supplier_id,contract_id,status,approval_status)
    VALUES(1,$1,$2,$3,'APPROVED','APPROVED') RETURNING id`, [`${label}-OLD`, supplier, agreement])).rows[0].id;
  const legacyRelease = (await pool.query(`INSERT INTO supplier_contract_releases(organization_id,contract_id,purchase_order_id,release_amount,idempotency_key)
    VALUES(1,$1,$2,1,$3) RETURNING id`, [agreement, legacyOrder, crypto.randomUUID()])).rows[0].id;
  expect((await (await readBrowserApi(page, `${root}/releases/${legacyRelease}/evidence`)).json()).data).toMatchObject({ agreementVersion: null, lines: [] });
  // The report intentionally includes only the existing approved-order financial cohort.
  await pool.query("UPDATE purchase_orders SET status='APPROVED' WHERE organization_id=1 AND id=$1", [first.purchaseOrderId]);
  const report = (await (await readBrowserApi(page, "/api/v2/procurement/maverick-spend?outcome=agreement_release")).json()).data;
  expect(report.items.filter((row: { agreementId: number }) => row.agreementId === agreement)).toEqual([
    expect.objectContaining({ id: first.purchaseOrderId, agreementReleaseId: first.id, agreementVersion: 7, currencyCode: "USD",
      coverage:expect.objectContaining({budget:"recorded"}),budgetConversionKind:"agreement_release" }),
  ]);
  await page.goto("/procurement/overview");
  await page.getByRole("button", { name: "Review budget evidence" }).click();
  await page.getByLabel("Budget evidence outcome").selectOption("agreement_release");
  await page.getByRole("link", { name: `${label} v7` }).click();
  const panel = page.getByRole("region", { name: "Agreement release evidence" });
  await expect(panel.getByText(`${label} v7`, { exact: true })).toBeVisible();
  await expect(panel.getByText("Existing budget reservation transferred unchanged to the purchase order.")).toBeVisible();
  await expect(panel.getByText(/Unit price USD 12.3456 · Price tier from 5.0000/)).toHaveCount(2);
});

test("contract obligations record dated ownership, reject stale evidence and retain verified completion history", async ({ page }, info) => {
  test.setTimeout(120000);
  await guarded();
  const name = `Build 2 evidence ${info.project.name} ${Date.now()}`;
  const supplier = (await pool.query("SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0].id;
  const contract = (await pool.query(`INSERT INTO supplier_contracts(organization_id,supplier_id,title,contract_type,start_date)
    VALUES(1,$1,$2,'supply','2026-01-01') RETURNING id`, [supplier, name])).rows[0].id;
  const root = `/api/v2/procurement/contracts/${contract}/obligations`;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const selectContract = () => page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Review", exact: true }).click({ timeout: 25000 });
  await gotoAuthed(page, "/procurement/contracts");
  const foreign = (await pool.query("INSERT INTO organizations(id,name,slug,active) SELECT COALESCE(MAX(id),0)+1000,$1,$2,true FROM organizations RETURNING id",
    ["Disposable contract isolation", `b2-foreign-${Date.now()}`])).rows[0].id;
  const foreignSupplier = (await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES($1,'Foreign synthetic supplier','active') RETURNING id", [foreign])).rows[0].id;
  const foreignContract = (await pool.query(`INSERT INTO supplier_contracts(organization_id,supplier_id,title,contract_type,start_date)
    VALUES($1,$2,'Foreign synthetic contract','master','2026-01-01') RETURNING id`, [foreign, foreignSupplier])).rows[0].id;
  expect((await readBrowserApi(page, `/api/v2/procurement/contracts/${foreignContract}/obligations`)).status()).toBe(404);
  await selectContract();
  const panel = page.getByRole("region", { name: "Contract obligations" });
  await panel.getByRole("button", { name: "Review obligations" }).click();
  await expect(panel.getByText("No obligations recorded on this contract.")).toBeVisible();
  await panel.getByRole("button", { name: "Add obligation" }).click();
  await panel.getByLabel("Obligation title").fill("Submit service review");
  await panel.getByLabel("Due date").fill("2025-01-02");
  await panel.getByLabel("Reason or evidence note").fill("Record the agreed deliverable");
  await panel.getByRole("button", { name: "Save obligation change" }).click();
  await expect(panel.getByText(/Overdue · Due 2025-01-02/)).toBeVisible();
  const listing = await (await readBrowserApi(page, root)).json();
  const obligation = listing.data.items[0].obligationId;
  const direct = async (data: object, key = crypto.randomUUID()) => page.request.post(root, {
    headers: { ...(await csrf(page)), "Idempotency-Key": key }, data,
  });
  await pool.query(`CREATE FUNCTION build2_inject_obligation_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='CONTRACT_OBLIGATION_REVISE' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER build2_inject_obligation_audit_failure BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION build2_inject_obligation_audit_failure()`);
  const key = crypto.randomUUID();
  const revised = { action: "revise", obligationId: obligation, revision: 1, title: "Submit updated service review",
    ownerUserId: listing.data.items[0].ownerUserId, dueDate: "2025-02-01", note: "Revised deliverable date" };
  try {
    expect((await direct(revised, key)).status()).toBe(503);
    expect((await pool.query("SELECT count(*)::int AS n FROM contract_obligation_versions WHERE organization_id=1 AND contract_id=$1", [contract])).rows[0].n).toBe(1);
  } finally {
    await pool.query("DROP TRIGGER build2_inject_obligation_audit_failure ON audit_logs; DROP FUNCTION build2_inject_obligation_audit_failure()");
  }
  expect((await direct(revised, key)).status()).toBe(200);
  expect((await direct(revised, key)).status()).toBe(200);
  expect((await direct({ ...revised, note: "Different change" }, key)).status()).toBe(409);
  expect((await direct(revised)).status()).toBe(409);
  const uploaded = await page.request.post("/api/documents/upload", { headers: await csrf(page), multipart: { entityType: "contract",
    entityId: String(contract), file: { name: "Service-review-proof.txt", mimeType: "text/plain", buffer: Buffer.from("SYNTHETIC OBLIGATION PROOF") } } });
  expect(uploaded.status()).toBe(201);
  const document = await uploaded.json();
  expect((await direct({ action: "complete", obligationId: obligation, revision: 2, note: "Reviewed source", documentId: document.id, documentVersion: document.version + 1 })).status()).toBe(409);
  await page.reload();
  await selectContract();
  await panel.getByRole("button", { name: "Review obligations" }).click();
  await panel.getByRole("button", { name: "Record completion" }).click();
  await panel.getByLabel("Completion document").selectOption(String(document.id));
  await panel.getByLabel("Reason or evidence note").fill("Reviewed service delivery");
  await panel.getByRole("button", { name: "Save obligation change" }).click();
  await expect(panel.getByText(/completed · Due 2025-02-01/)).toBeVisible();
  await expect(panel.getByRole("link", { name: /Source document v/ })).toBeVisible();
  await panel.getByRole("button", { name: "Version history" }).click();
  await expect(panel.getByText(/v1 · open · Submit service review/)).toBeVisible();
  const inboxHistory=await (await readBrowserApi(page,"/api/v2/action-inbox?state=history&pageSize=100")).json();
  expect(inboxHistory.data.items).toContainEqual(expect.objectContaining({
    id:`obligation:${contract}:${obligation}`,state:"completed",
    targetPath:`/procurement/contracts?agreementId=${contract}&obligationId=${obligation}`,
  }));
  const audit = await pool.query(`SELECT action FROM audit_logs WHERE organization_id=1 AND resource_type='supplier_contract'
    AND resource_id=$1 AND action LIKE 'CONTRACT_OBLIGATION_%' ORDER BY id`, [contract]);
  expect(audit.rows.map(row => row.action)).toEqual(["CONTRACT_OBLIGATION_CREATE", "CONTRACT_OBLIGATION_REVISE", "CONTRACT_OBLIGATION_COMPLETE"]);
  await expect(pool.query("UPDATE contract_obligation_versions SET title='rewrite' WHERE organization_id=1 AND contract_id=$1", [contract])).rejects.toThrow(/immutable/);
  const bounds = await panel.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual((page.viewportSize()?.width ?? 1280) + 1);
  expect(errors).toEqual([]);
});

test("agreement obligation due dates use the organization day and preserve the recorded due date", async ({ page }) => {
  test.setTimeout(120000);
  await guarded();
  const label=`Calendar-${crypto.randomUUID()}`;
  const {rows:[fixture]}=await pool.query(`SELECT
    (SELECT timezone FROM organizations WHERE id=1) AS previous,
    (SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1) AS supplier,
    (SELECT id FROM users WHERE username='admin') AS owner,
    (now() AT TIME ZONE 'Etc/GMT+12')::date::text AS due,
    (now() AT TIME ZONE 'Pacific/Kiritimati')::date::text AS ahead`);
  expect(fixture.ahead>fixture.due).toBe(true);
  const contract=(await pool.query(`INSERT INTO supplier_contracts(organization_id,supplier_id,title,contract_type,start_date)
    VALUES(1,$1,$2,'blanket','2026-01-01') RETURNING id`,[fixture.supplier,label])).rows[0].id;
  await gotoAuthed(page,"/procurement/contracts");
  const root=`/api/v2/procurement/contracts/${contract}/obligations`;
  const saved=await page.request.post(root,{headers:{...(await csrf(page)),"Idempotency-Key":crypto.randomUUID()},
    data:{action:"create",title:"Check organization calendar",dueDate:fixture.due,ownerUserId:fixture.owner,note:"Synthetic timezone boundary evidence"}});
  expect(saved.status(),await saved.text()).toBe(200);
  const id=(await saved.json()).data.obligationId;
  const search=page.getByPlaceholder("Search number, agreement, or supplier");
  const panel=page.getByRole("region",{name:"Contract obligations"});
  const open=async()=>{
    await search.fill(label);
    await page.getByRole("row",{name:new RegExp(label)}).getByRole("button",{name:"Review",exact:true}).click();
    await panel.getByRole("button",{name:"Review obligations"}).click();
  };
  const useZone=(timezone:string)=>pool.query("UPDATE organizations SET timezone=$1 WHERE id=1",[timezone]);
  try {
    await useZone("Pacific/Kiritimati");
    await open();
    await expect(panel.getByText(`Checked for ${fixture.ahead} (Pacific/Kiritimati).`)).toBeVisible();
    await expect(panel.getByText(new RegExp(`Overdue · Due ${fixture.due}`))).toBeVisible();
    await useZone("Etc/GMT+12");
    await page.reload();
    await open();
    await expect(panel.getByText(`Checked for ${fixture.due} (Etc/GMT+12).`)).toBeVisible();
    await expect(panel.getByText(new RegExp(`open · Due ${fixture.due}`))).toBeVisible();
    const history=await readBrowserApi(page,`${root}/${id}/history`);
    expect(history.status()).toBe(200);
    expect((await history.json()).data).toMatchObject({today:fixture.due,timezone:"Etc/GMT+12",
      items:[{obligationId:id,revision:1,dueDate:fixture.due,overdue:false}]});
    await useZone("Invalid/Test_Zone");
    const invalid=await readBrowserApi(page,root);
    expect(invalid.status()).toBe(409);
    expect((await invalid.json()).error.code).toBe("OBLIGATION_TIMEZONE_SETUP_REQUIRED");
    await useZone("");
    const fallback=await readBrowserApi(page,root);
    expect(fallback.status()).toBe(200);
    expect((await fallback.json()).data).toMatchObject({timezone:"Africa/Johannesburg",items:[{obligationId:id,dueDate:fixture.due,revision:1}]});
  } finally {
    await useZone(fixture.previous);
  }
});

test("an obligation owner can open the exact assigned item from Action Inbox and histories follow the latest revision", async ({ page }) => {
  test.setTimeout(120000);
  await guarded();
  const title=`Owner work ${crypto.randomUUID()}`;
  const {rows:[actors]}=await pool.query(`SELECT (SELECT id FROM users WHERE username='admin') AS admin,
    (SELECT id FROM users WHERE username='planner') AS planner,
    (SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1) AS supplier,
    (SELECT id FROM warehouses WHERE organization_id=1 ORDER BY id LIMIT 1) AS warehouse`);
  const contract=(await pool.query(`INSERT INTO supplier_contracts(organization_id,supplier_id,title,contract_type,start_date)
    VALUES(1,$1,$2,'blanket','2026-01-01') RETURNING id`,[actors.supplier,title])).rows[0].id;
  await gotoAuthed(page,"/operations/action-inbox");
  const root=`/api/v2/procurement/contracts/${contract}/obligations`;
  const headers=await csrf(page);
  const mutate=async(data:object)=>{
    const response=await page.request.post(root,{headers:{...headers,"Idempotency-Key":crypto.randomUUID()},data});
    expect(response.status(),await response.text()).toBe(200);
    return (await response.json()).data;
  };
  const fields={title,ownerUserId:actors.admin,dueDate:"2001-04-01",note:"Synthetic contract owner assignment"};
  const created=await mutate({action:"create",...fields});
  const id=created.obligationId;
  await mutate({action:"create",...fields,title:"Do not show on the exact obligation page"});
  const foreignOrg=(await pool.query(`INSERT INTO organizations(id,name,slug)
    SELECT max(id)+1000,$1,$1 FROM organizations RETURNING id`,[`foreign-${id}`])).rows[0].id;
  const foreignSupplier=(await pool.query(`INSERT INTO suppliers(organization_id,name,status)
    VALUES($1,'Foreign owner fixture','active') RETURNING id`,[foreignOrg])).rows[0].id;
  const foreignContract=(await pool.query(`INSERT INTO supplier_contracts(organization_id,supplier_id,title,contract_type,start_date)
    VALUES($1,$2,'Foreign obligation source','blanket','2026-01-01') RETURNING id`,[foreignOrg,foreignSupplier])).rows[0].id;
  await pool.query(`INSERT INTO contract_obligation_versions(organization_id,contract_id,obligation_id,revision,command_id,
    command_payload,title,owner_user_id,due_date,state,note,actor_user_id)
    VALUES($1,$2,$3,1,$3,'{}','Foreign owner fixture',$4,'2000-01-01','open','Synthetic foreign owner',$4)`,
  [foreignOrg,foreignContract,crypto.randomUUID(),actors.admin]);
  const inbox=async(state="active")=>{
    const response=await readBrowserApi(page,`/api/v2/action-inbox?state=${state}&pageSize=100`);
    expect(response.status(),await response.text()).toBe(200);
    return (await response.json()).data.items;
  };
  const itemId=`obligation:${contract}:${id}`;
  const href=`/procurement/contracts?agreementId=${contract}&obligationId=${id}`;
  const match=(items:{id:string}[])=>items.filter(row=>row.id===itemId);
  const first=await inbox();
  expect(match(first)).toEqual([expect.objectContaining({type:"assigned_contract_obligation",dueDate:fields.dueDate,targetPath:href,state:"open"})]);
  expect(first.some((row:{title:string})=>row.title==="Foreign owner fixture")).toBe(false);
  const card=page.getByTestId(`action-inbox-item-${itemId}`);
  await page.reload();
  await expect(card.getByText("Due 2001-04-01 (organization date)")).toBeVisible();
  const link=card.getByRole("link",{name:"Open work item"});
  await expect(link).toHaveAttribute("href",href);
  await link.focus();
  await link.press("Enter");
  const panel=page.getByRole("region",{name:"Contract obligations"});
  const heading=panel.getByRole("heading",{name:title,exact:true});
  await expect(heading).toBeFocused({timeout:15000});
  await expect(panel.getByText("Do not show on the exact obligation page")).toHaveCount(0);
  const missing=await readBrowserApi(page,`${root}?obligationId=${crypto.randomUUID()}`);
  expect(missing.status()).toBe(404);
  expect((await readBrowserApi(page,`${root}?obligationId=${id}&page=2`)).status()).toBe(400);
  await page.goBack();
  await expect(card).toBeVisible();
  await page.goForward();
  await expect(heading).toBeFocused();

  const changed=await mutate({action:"revise",obligationId:id,revision:1,...fields,ownerUserId:actors.planner});
  expect(changed.revision).toBe(2);
  expect(match(await inbox("all"))).toHaveLength(0);
  const restored=await mutate({action:"revise",obligationId:id,revision:2,...fields});
  expect(restored.revision).toBe(3);
  expect(match(await inbox())).toHaveLength(1);
  const previousWarehouse=(await pool.query("SELECT warehouse_id FROM users WHERE id=$1",[actors.admin])).rows[0].warehouse_id;
  expect(actors.warehouse).toBeGreaterThan(0);
  try {
    await pool.query("UPDATE users SET warehouse_id=$1 WHERE id=$2",[actors.warehouse,actors.admin]);
    expect(match(await inbox("all"))).toHaveLength(0);
    expect((await readBrowserApi(page,`${root}?obligationId=${id}`)).status()).toBe(403);
  } finally { await pool.query("UPDATE users SET warehouse_id=$1 WHERE id=$2",[previousWarehouse,actors.admin]); }
  expect(match(await inbox())).toHaveLength(1);
  await mutate({action:"cancel",obligationId:id,revision:3,note:"Cancel this synthetic owner assignment"});
  expect(match(await inbox())).toHaveLength(0);
  expect(match(await inbox("history"))).toEqual([expect.objectContaining({state:"cancelled",targetPath:href})]);
  await page.goto(href);
  await expect(heading).toBeFocused();
  await expect(panel.getByText(/cancelled · Due 2001-04-01/)).toBeVisible();
  await page.screenshot({path:test.info().outputPath("obligation-inbox-deep-link.png")});
});

test("legacy and v2 requisition approvals share authority, level limits, replay and rollback", async ({ page }) => {
  test.setTimeout(120000);
  await guarded();
  const tag=crypto.randomUUID();
  const {rows:[users]}=await pool.query(`SELECT (SELECT id FROM users WHERE username='admin') AS admin,
    (SELECT id FROM users WHERE username='planner') AS planner,(SELECT id FROM users WHERE username='viewer') AS maker`);
  const previous=await pool.query(`UPDATE approval_policies SET is_active=false
    WHERE organization_id=1 AND entity_type='requisition' AND is_active RETURNING id`);
  const policies=await pool.query(`INSERT INTO approval_policies
    (organization_id,name,entity_type,amount_min,amount_max,approval_level,approver_role,approver_user_id)
    VALUES (1,$1,'requisition',100,130,1,'planner',$2),(1,$1,'requisition',100,130,2,'admin',$3) RETURNING id`,[tag,users.planner,users.admin]);
  const make=async (suffix:string,maker=users.maker)=>Number((await pool.query(`INSERT INTO purchase_requisitions
    (organization_id,requisition_number,requestor_id,status,currency_code,total_amount)
    VALUES(1,$1,$2,'PENDING_APPROVAL','ZAR',120) RETURNING id`,[`${tag}-${suffix}`,maker])).rows[0].id);
  const req=await make("levels"),self=await make("self",users.admin);
  const count=async()=> (await pool.query(`SELECT
    (SELECT count(*)::int FROM approval_history WHERE organization_id=1 AND entity_type='requisition' AND entity_id=$1 AND level>0) AS approvals,
    (SELECT count(*)::int FROM purchase_budget_policy_evidence WHERE organization_id=1 AND requisition_id=$1) AS evidence
  `,[req])).rows[0];
  try{
    await gotoAuthed(page,"/procurement/requisitions");
    const headers=await csrf(page);
    const post=(id:number,body:object={},key=crypto.randomUUID())=>page.request.post(`/api/v2/procurement/requisitions/${id}/approve`,{headers:{...headers,"Idempotency-Key":key},data:body});
    expect((await post(self)).status()).toBe(403);
    expect((await post(req,{approverId:users.planner})).status()).toBe(403);
    expect((await post(req)).status()).toBe(403);
    const cookie=await loginForTests("planner","Admin123!");
    expect(cookie).toBeTruthy();
    const ordered=await apiJsonRequest(`/purchase-requisitions/${req}/approve`,{method:"POST",cookie:cookie!,body:{}});
    expect(ordered.status,JSON.stringify(ordered.json)).toBe(200);
    expect(ordered.json).toMatchObject({data:{status:"PENDING_APPROVAL",approvalProgress:{completedLevels:[1],requiredLevels:[1,2],state:"pending"}}});
    expect(await count()).toEqual({approvals:1,evidence:0});
    await pool.query(`INSERT INTO user_approval_limits(organization_id,user_id,entity_type,amount_limit,currency_code)
      VALUES(1,$1,'requisition',100,'ZAR')`,[users.admin]);
    try { expect((await post(req)).status()).toBe(403); }
    finally {await pool.query("DELETE FROM user_approval_limits WHERE organization_id=1 AND user_id=$1 AND entity_type='requisition'",[users.admin]);}
    const key=crypto.randomUUID();
    await pool.query(`CREATE FUNCTION build2_requisition_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='REQUISITION_WORKFLOW_APPROVE' THEN RAISE EXCEPTION 'Synthetic requisition audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER build2_requisition_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION build2_requisition_audit_fault()`);
    try {
      expect((await post(req,{},key)).status()).toBe(500);
      expect(await count()).toEqual({approvals:1,evidence:0});
    } finally {await pool.query("DROP TRIGGER build2_requisition_audit_fault ON audit_logs; DROP FUNCTION build2_requisition_audit_fault()");}
    const replies=await Promise.all([post(req,{},key),post(req,{},key)]);
    expect(replies.map(r=>r.status())).toEqual([200,200]);
    const results=await Promise.all(replies.map(r=>r.json()));
    expect(results.filter(r=>r.data.duplicate)).toHaveLength(1);
    expect(results[0].data).toMatchObject({status:"APPROVED",approver_id:users.admin,approvalProgress:{completedLevels:[1,2],state:"approved"}});
    expect(await count()).toEqual({approvals:2,evidence:1});
  }finally{
    await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND id=ANY($1::int[])",[policies.rows.map(r=>r.id)]);
    if(previous.rowCount)await pool.query("UPDATE approval_policies SET is_active=true WHERE organization_id=1 AND id=ANY($1::int[])",[previous.rows.map(r=>r.id)]);
  }
});

test("budget decision history uses the policy evaluated at approval and exposes one contribution per order", async ({ page }, info) => {
  test.setTimeout(120000);
  await guarded();
  const suffix = `B2-${info.project.name}-${Date.now()}`;
  const original = (await pool.query("SELECT budget_control_mode,updated_at FROM procurement_feature_settings WHERE organization_id=1")).rows[0];
  const maker = (await pool.query("SELECT id FROM users WHERE username='viewer'")).rows[0].id;
  const supplier = (await pool.query("SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0].id;
  const department = (await pool.query("SELECT id FROM departments WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0].id;
  const budget = "3000000001";
  await pool.query(`INSERT INTO finance_budgets(id,organization_id,fiscal_year,currency_code,department_id,approved_amount)
    VALUES($1,1,EXTRACT(YEAR FROM now())::int,'USD',$2,1)`, [budget, department]);
  const draft = (await pool.query(`INSERT INTO purchase_requisitions(organization_id,requisition_number,requestor_id,department_id,status,currency_code,total_amount)
    VALUES(1,$1,$2,$3,'PENDING_APPROVAL','USD',98765432) RETURNING id`, [suffix, maker, department])).rows[0].id;
  const policyId=(await pool.query(`INSERT INTO approval_policies(organization_id,name,entity_type,amount_min,amount_max,approval_level,approver_role)
    VALUES(1,$1,'requisition',98765400,98765500,1,'admin') RETURNING id`,[suffix])).rows[0].id;
  try {
    await pool.query(`INSERT INTO procurement_feature_settings(organization_id,budget_control_mode) VALUES(1,'WARNING_ONLY')
      ON CONFLICT (organization_id) DO UPDATE SET budget_control_mode='WARNING_ONLY',updated_at=now()`);
    await gotoAuthed(page, "/procurement/overview");
    const approved = await page.request.post(`/api/v2/procurement/requisitions/${draft}/approve`, { headers: await csrf(page), data: { reason: "Independent disposable test approval" } });
    expect(approved.status()).toBe(200);
    const captured = await pool.query("SELECT * FROM purchase_budget_policy_evidence WHERE organization_id=1 AND requisition_id=$1", [draft]);
    expect(captured.rows).toHaveLength(1);
    expect(captured.rows[0].policy_mode).toBe("WARNING_ONLY");
    expect(captured.rows[0].outcome).toBe("over_budget");
    expect(captured.rows[0].budget_id).toBe(budget);
    await pool.query("UPDATE procurement_feature_settings SET budget_control_mode='HARD_BLOCK',updated_at=now() WHERE organization_id=1");
    const order = (await pool.query(`INSERT INTO purchase_orders(organization_id,order_number,supplier_id,requisition_id,order_date,total_amount,currency_code,status,approval_status)
      VALUES(1,$1,$2,$3,'2090-01-01',123.5,'USD','APPROVED','APPROVED') RETURNING id`, [suffix, supplier, draft])).rows[0].id;
    // Model an approved and converted sourcing award using canonical audit
    // entries. A second order borrowing the award ID must not inherit the waiver.
    const audit = await pool.connect();
    try {
      await audit.query("BEGIN");
      await audit.query("SELECT id FROM purchase_requisitions WHERE organization_id=1 AND id=$1 FOR UPDATE",[draft]);
      await bindPurchaseOrderBudgetProvenance(audit,1,draft,[order],"sourcing_award");
      const actor = { userId: captured.rows[0].approver_user_id };
      const event = (await audit.query(`INSERT INTO sourcing_events(organization_id,event_number,title,owner_user_id,deadline,status)
        VALUES(1,$1,'Disposable sourcing evidence',$2,now(),'AWARDED') RETURNING id`, [suffix, maker])).rows[0].id;
      const overrideReason = "Independently approved award override";
      const award = (await audit.query(`INSERT INTO sourcing_awards(organization_id,event_id,status,recommended_by_user_id,approved_by_user_id,justification,override_reason,approved_at)
        VALUES(1,$1,'CONVERTED',$2,$3,'Test award',$4,now()) RETURNING id,approved_at`, [event, maker, actor.userId, overrideReason])).rows[0];
      await audit.query("UPDATE purchase_orders SET sourcing_award_id=$1 WHERE organization_id=1 AND id=$2", [award.id, order]);
      await audit.query(`INSERT INTO purchase_orders(organization_id,order_number,supplier_id,sourcing_award_id,order_date,total_amount,currency_code,status,approval_status)
        VALUES(1,$1,$2,$3,'2090-01-01',12,'USD','APPROVED','APPROVED')`, [`${suffix}-not-converted`, supplier, award.id]);
      await appendAuditEventWithClient(audit, { organizationId: 1, actor, action: "RFQ_AWARD_APPROVED", resourceType: "sourcing_award", resourceId: award.id,
        before: { status: "SUBMITTED" }, after: { id: award.id, eventId: event, status: "APPROVED", overrideReason, version: 1, approvedAt: award.approved_at.toISOString() } });
      await appendAuditEventWithClient(audit, { organizationId: 1, actor, action: "RFQ_AWARD_CONVERTED_TO_PO", resourceType: "sourcing_award", resourceId: award.id,
        after: { purchaseOrderIds: [order] } });
      await audit.query("COMMIT");
    } catch (error) {
      await audit.query("ROLLBACK");
      throw error;
    } finally { audit.release(); }
    const response = await readBrowserApi(page, "/api/v2/procurement/maverick-spend");
    expect(response.status()).toBe(200);
    const rows = (await response.json()).data.items.filter((row: { id: number }) => row.id === order);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currencyCode: "USD", orderedAmount: "123.5", policyMode: "WARNING_ONLY", budgetId: budget, exceptionId: String(captured.rows[0].exception_id) });
    expect(rows[0].approvedOverrideReason).toBe("Independently approved award override");
    const overrides = await (await readBrowserApi(page, "/api/v2/procurement/maverick-spend?outcome=approved_override")).json();
    expect(overrides.data.items.filter((row: { orderNumber: string }) => row.orderNumber.startsWith(suffix)).map((row: { id: number }) => row.id)).toEqual([order]);
    expect((await readBrowserApi(page, "/api/v2/procurement/maverick-spend?pageSize=101")).status()).toBe(400);
    const panel = page.getByRole("region", { name: "Maverick spend evidence" });
    await panel.getByRole("button", { name: "Review budget evidence" }).click();
    await expect(panel.getByRole("link", { name: suffix, exact: true }).first()).toHaveAttribute("href", `/procurement/orders/${order}`);
    await expect(panel.getByText(/Policy: Warning only/).first()).toBeVisible();
    await panel.getByLabel("Budget evidence outcome").selectOption("unverified");
    await panel.getByLabel("Missing evidence type").selectOption("poSubmission");
    const item = panel.getByRole("listitem").filter({has:page.getByRole("link",{name:suffix,exact:true})});
    await item.getByText("Evidence coverage",{exact:true}).click();
    await expect(item.getByText("Requisition budget: Recorded",{exact:true})).toBeVisible();
    await expect(item.getByText("PO submission: Unverified",{exact:true})).toBeVisible();
    await expect(item.getByText("Agreement release: No source linked",{exact:true})).toBeVisible();
    await panel.getByLabel("Missing evidence type").selectOption("budget");
    const missingBudget = await readBrowserApi(page,`/api/v2/procurement/maverick-spend?outcome=unverified&evidenceFamily=budget&supplierId=${supplier}&from=2090-01-01&to=2090-01-01`);
    expect(missingBudget.status()).toBe(200);
    expect((await missingBudget.json()).data.items).toHaveLength(0);
    const borrowed=(await pool.query(`INSERT INTO purchase_orders(organization_id,order_number,supplier_id,requisition_id,order_date,total_amount,currency_code,status,approval_status)
      VALUES(1,$1,$2,$3,'2090-01-01',456,'USD','APPROVED','APPROVED') RETURNING id`, [`${suffix}-borrowed`, supplier, draft])).rows[0].id;
    await pool.query("UPDATE purchase_requisitions SET approval_date=now()+interval '3 hours' WHERE organization_id=1 AND id=$1",[draft]);
    await pool.query("UPDATE operational_exceptions SET related_refs='{}' WHERE organization_id=1 AND id=$1",[captured.rows[0].exception_id]);
    const retained = await (await readBrowserApi(page, "/api/v2/procurement/maverick-spend")).json();
    expect(retained.data.items).toContainEqual(expect.objectContaining({id:order,evaluatedAt:rows[0].evaluatedAt,exceptionRevision:rows[0].exceptionRevision}));
    expect(retained.data.items.some((row: { id: number }) => row.id === borrowed)).toBe(false);
    await expect(pool.query("DELETE FROM purchase_order_budget_provenance WHERE organization_id=1 AND purchase_order_id=$1", [order])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM purchase_budget_policy_evidence WHERE organization_id=1 AND requisition_id=$1", [draft])).rejects.toThrow(/immutable/);
  } finally {
    await pool.query("UPDATE approval_policies SET is_active=false WHERE organization_id=1 AND id=$1",[policyId]);
    if (original) await pool.query("UPDATE procurement_feature_settings SET budget_control_mode=$1,updated_at=$2 WHERE organization_id=1", [original.budget_control_mode, original.updated_at]);
    else await pool.query("DELETE FROM procurement_feature_settings WHERE organization_id=1");
  }
});

test("Maverick Spend keeps more than 5000 orders complete under date and supplier scope", async ({ page }) => {
  test.setTimeout(150000);
  await guarded();
  const marker=`Scope-${crypto.randomUUID()}`;
  const foreignOrg=(await pool.query(`INSERT INTO organizations(id,name,slug)
    SELECT max(id)+1000,$1,$1 FROM organizations RETURNING id`,[`${marker}-foreign`])).rows[0].id;
  const addSupplier=async(org:number,name:string)=>(await pool.query(`INSERT INTO suppliers(organization_id,name,status)
    VALUES($1,$2,'inactive') RETURNING id`,[org,name])).rows[0].id as number;
  const supplier=await addSupplier(1,marker), other=await addSupplier(1,`${marker}-other`), foreign=await addSupplier(foreignOrg,`${marker}-foreign`);
  await pool.query(`INSERT INTO purchase_orders(organization_id,order_number,supplier_id,order_date,total_amount,currency_code,status,approval_status)
    SELECT 1,$1::text||'-'||g,$2::int,'2087-05-10 23:59:59'::timestamp,10.5,'USD','APPROVED','APPROVED'
    FROM generate_series(1,5002) g
    UNION ALL VALUES (1,$1||'-earlier',$2,'2087-05-09 23:59:59',9.5,'ZAR','APPROVED','APPROVED'),
      (1,$1||'-later',$2,'2087-05-11 00:00:00',1.5,'EUR','APPROVED','APPROVED'),
      (1,$1||'-draft',$2,'2087-05-10',42,'USD','DRAFT','DRAFT'),
      (1,$1||'-other',$3::int,'2087-05-10'::timestamp,20,'EUR','APPROVED','APPROVED'),
      ($4::int,$1||'-foreign',$5::int,'2087-05-10'::timestamp,99,'ZAR','APPROVED','APPROVED')`,[marker,supplier,other,foreignOrg,foreign]);
  await gotoAuthed(page,"/procurement/overview");
  const endpoint="/api/v2/procurement/maverick-spend";
  const scope=`supplierId=${supplier}&from=2087-05-10&to=2087-05-10`;
  expect((await readBrowserApi(page,`${endpoint}?supplierId=${foreign}`)).status()).toBe(404);
  for(const query of ["from=2087-02-30","from=2087-05-11&to=2087-05-10","supplierId=2147483648","evidenceFamily=budget","outcome=unverified&evidenceFamily=__proto__"]) {
    expect((await readBrowserApi(page,`${endpoint}?${query}`)).status()).toBe(400);
  }
  const expected=(await pool.query(`SELECT id FROM purchase_orders WHERE organization_id=1 AND supplier_id=$1
    AND status='APPROVED' AND order_date::date='2087-05-10' ORDER BY id DESC`,[supplier])).rows.map(row=>row.id);
  const ids:number[]=[];
  for(let n=1;n<=51;n++){
    const result=await readBrowserApi(page,`${endpoint}?outcome=unverified&evidenceFamily=poSubmission&${scope}&pageSize=100&page=${n}`);
    expect(result.status(),await result.text()).toBe(200);
    const data=(await result.json()).data;
    expect(data).toMatchObject({page:n,pageSize:100,hasNext:n<51,filters:{supplierId:supplier,from:"2087-05-10",to:"2087-05-10"}});
    expect(data.items).toHaveLength(n<51 ? 100 : 2);
    for(const row of data.items){
      expect(row.currencyCode).toBe("USD");
      expect(row.orderedAmount).toBe("10.5");
      ids.push(row.id);
    }
  }
  expect(ids).toEqual(expected);
  expect(ids).toHaveLength(5002);
  for (const pageSize of [25,50]) {
    const response=await readBrowserApi(page,`${endpoint}?outcome=all&${scope}&pageSize=${pageSize}`);
    expect(response.status()).toBe(200);
    const data=(await response.json()).data;
    expect(data.items.map((row:{id:number})=>row.id)).toEqual(expected.slice(0,pageSize));
    expect(data.hasNext).toBe(true);
  }
  const panel=page.getByRole("region",{name:"Maverick spend evidence"});
  await panel.getByRole("button",{name:"Review budget evidence"}).click();
  await panel.getByLabel("PO date from").fill("2087-05-10");
  await panel.getByLabel("PO date through").fill("2087-05-10");
  await panel.getByLabel("Search suppliers").fill(marker);
  const supplierSelect=panel.getByRole("combobox",{name:"Supplier",exact:true});
  await supplierSelect.selectOption(String(supplier),{timeout:15000});
  await expect(supplierSelect).toHaveValue(String(supplier));
  await panel.getByLabel("Budget evidence outcome").selectOption("all");
  await expect(panel.getByRole("link",{name:`${marker}-5002`,exact:true})).toBeVisible();
  await expect(panel.getByRole("link",{name:`${marker}-other`,exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath("maverick-scoped-results.png")});
  await panel.getByLabel("PO date through").fill("2087-05-09");
  await expect(panel.getByRole("alert")).toHaveText("Start date must not follow the end date.");
  const bounds=await panel.boundingBox();
  expect((bounds?.x??0)+(bounds?.width??0)).toBeLessThanOrEqual((page.viewportSize()?.width??1280)+1);
});
