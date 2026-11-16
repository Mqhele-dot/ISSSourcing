import { expect, test, type Page } from "@playwright/test";
import { pool } from "../server/db";
import { requireDisposableE2eDatabase } from "./wave7-helpers";
import { readBrowserApi } from "./test-helpers";

let fixture: { eventId: number; draftId: number; cancelledId: number; title: string; supplierName: string };
const userIds = new Map<string, number>();

async function login(page: Page, username: string) {
  const userId = userIds.get(username);
  if (!userId) throw new Error(`Missing sourcing E2E identity for ${username}.`);
  await page.addInitScript((id) => {
    window.localStorage.setItem(`invtrack:first-run-coach:v2:${id}`, "done");
  }, userId);
  await page.context().clearCookies();
  await page.goto("/auth", { waitUntil: "load" });
  await page.getByPlaceholder("Enter your username").fill(username);
  await page.getByPlaceholder("Enter your password").fill("Admin123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20_000 });
}

test.beforeAll(async () => {
  requireDisposableE2eDatabase();
  expect((await pool.query("SELECT current_database() AS name")).rows[0].name).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
  const suffix = Date.now().toString().slice(-9);
  const users = await pool.query<{ id: number; username: string; role: string }>("SELECT id, username, role::text FROM users WHERE username IN ('admin', 'planner', 'supplierdemo')");
  const admin = users.rows.find((row) => row.username === "admin");
  const planner = users.rows.find((row) => row.username === "planner");
  const supplierUser = users.rows.find((row) => row.username === "supplierdemo");
  if (!admin || !planner || !supplierUser) throw new Error("admin, planner, and supplierdemo seed users are required for sourcing E2E");
  for (const user of [admin, planner, supplierUser]) {
    userIds.set(user.username, user.id);
    await pool.query("INSERT INTO organization_members (organization_id, user_id, role, application_role, active, status) VALUES (1, $1, $2, $3, TRUE, 'active') ON CONFLICT (organization_id, user_id) DO UPDATE SET application_role = EXCLUDED.application_role, active = TRUE, status = 'active'", [user.id, user.username === "admin" ? "owner" : "member", user.role]);
    await pool.query("UPDATE users SET default_organization_id = 1 WHERE id = $1", [user.id]);
  }
  const supplierName = `E2E Sourcing Supplier ${suffix}`;
  const supplier = await pool.query<{ id: number }>("INSERT INTO suppliers (organization_id, name, status, onboarding_status, compliance_status, contact_name, email, default_currency_code, approved_at, approved_by_user_id, updated_at) VALUES (1, $1, 'active', 'APPROVED', 'compliant', 'E2E Supplier', $2, 'ZAR', NOW(), $3, NOW()) RETURNING id", [supplierName, `e2e-sourcing-${suffix}@example.com`, admin.id]);
  await pool.query("UPDATE users SET supplier_id = $1 WHERE id = $2", [supplier.rows[0].id, supplierUser.id]);
  await pool.query("INSERT INTO supplier_portal_mappings (organization_id, user_id, supplier_id, active, created_by_user_id) VALUES (1, $1, $2, TRUE, $3) ON CONFLICT (organization_id, user_id) DO UPDATE SET supplier_id = EXCLUDED.supplier_id, active = TRUE, updated_at = NOW()", [supplierUser.id, supplier.rows[0].id, admin.id]);
  const item = await pool.query<{ id: number }>("INSERT INTO inventory_items (organization_id, name, sku, quantity, price, supplier_id, unit_of_measure, taxable, status, updated_at) VALUES (1, $1, $2, 0, 200, $3, 'each', TRUE, 'active', NOW()) RETURNING id", [`E2E Sourcing Item ${suffix}`, `E2E-SRC-${suffix}`, supplier.rows[0].id]);
  const title = `E2E Controlled RFQ ${suffix}`;
  const event = await pool.query<{ id: number }>("INSERT INTO sourcing_events (organization_id, event_number, title, description, status, owner_user_id, reporting_currency_code, deadline, minimum_responses, competition_required, published_at, updated_at) VALUES (1, $1, $2, 'Browser supplier quote proof', 'OPEN', $3, 'ZAR', NOW() + INTERVAL '3 days', 1, TRUE, NOW(), NOW()) RETURNING id", [`E2E-RFQ-${suffix}`, title, admin.id]);
  const line = await pool.query<{ id: number }>("INSERT INTO sourcing_event_lines (organization_id, event_id, line_number, item_id, description, quantity, target_unit_price, target_currency_code) VALUES (1, $1, 1, $2, 'Managed endpoint security service', 2, 200, 'ZAR') RETURNING id", [event.rows[0].id, item.rows[0].id]);
  await pool.query("INSERT INTO sourcing_evaluation_criteria (organization_id, event_id, name, criterion_type, weight, sort_order) VALUES (1, $1, 'Landed cost', 'commercial', 70, 0), (1, $1, 'Service delivery', 'delivery', 30, 1)", [event.rows[0].id]);
  await pool.query("INSERT INTO sourcing_invitations (organization_id, event_id, supplier_id, status, invited_by_user_id) VALUES (1, $1, $2, 'INVITED', $3)", [event.rows[0].id, supplier.rows[0].id, admin.id]);
  const hidden = await pool.query<{id:number;status:string}>(`INSERT INTO sourcing_events
    (organization_id,event_number,title,status,owner_user_id,deadline)
    VALUES(1,$1,'Unpublished example','DRAFT',$3,now()+interval '1 day'),
          (1,$2,'Withdrawn example','CANCELLED',$3,now()+interval '1 day') RETURNING id,status`,
  [`E2E-RFQ-DRAFT-${suffix}`,`E2E-RFQ-CANCELLED-${suffix}`,admin.id]);
  for(const row of hidden.rows) await pool.query(`INSERT INTO sourcing_invitations(organization_id,event_id,supplier_id,invited_by_user_id)
    VALUES(1,$1,$2,$3)`,[row.id,supplier.rows[0].id,admin.id]);
  fixture = { eventId: event.rows[0].id, draftId:hidden.rows[0].id, cancelledId:hidden.rows[1].id, title, supplierName };
  expect(line.rows[0].id).toBeGreaterThan(0);
});

test("supplier submits a structured quote and buyer sees it for evaluation", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, "supplierdemo");
  const supplierEvents = await readBrowserApi(page,"/api/sourcing/supplier/events");
  expect(supplierEvents.status()).toBe(200);
  const visibleIds = (await supplierEvents.json()).data.map((row:{event:{id:number}})=>row.event.id);
  expect(visibleIds).toContain(fixture.eventId);
  const supplierToken = await (await readBrowserApi(page,"/api/csrf-token")).json();
  const postHeaders = {"X-CSRF-Token":supplierToken.data?.csrfToken??supplierToken.csrfToken,"Idempotency-Key":crypto.randomUUID()};
  for(const id of [fixture.draftId,fixture.cancelledId]) {
    expect(visibleIds).not.toContain(id);
    expect((await readBrowserApi(page,`/api/sourcing/supplier/events/${id}`)).status()).toBe(404);
    expect((await page.request.post(`/api/sourcing/supplier/events/${id}/clarifications`,{headers:postHeaders,
      data:{subject:"Synthetic probe",message:"Check whether this draft can be accessed.",visibility:"PRIVATE"}})).status()).toBe(409);
    expect((await page.request.post(`/api/sourcing/events/${id}/withdraw-draft`,{headers:postHeaders,
      data:{reason:"Supplier must not withdraw this RFQ."}})).status()).toBe(403);
  }
  expect((await pool.query(`SELECT status,viewed_at FROM sourcing_invitations WHERE organization_id=1 AND event_id IN ($1,$2) ORDER BY id`,
    [fixture.draftId,fixture.cancelledId])).rows).toEqual(Array(2).fill({status:"INVITED",viewed_at:null}));
  await page.goto("/procurement/supplier-portal", { waitUntil: "load" });
  await page.getByTestId("supplier-portal-sourcing-tab").click();
  await expect(page.getByTestId("supplier-sourcing-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`supplier-rfq-invitation-${fixture.eventId}`)).toContainText(fixture.title);
  await expect(page.getByTestId("supplier-rfq-quote-editor")).toBeVisible();
  await page.getByLabel("Unit price for line 1").fill("180");
  await page.getByLabel("Tax for line 1").fill("54");
  await page.getByLabel("Freight for line 1").fill("12");
  await page.getByTestId("supplier-quote-submit").click();
  await expect(page.getByText("Quote submitted", { exact: true })).toBeVisible({ timeout: 20_000 });

  await login(page, "admin");
  await page.goto(`/procurement/sourcing/${fixture.eventId}`, { waitUntil: "load" });
  await expect(page.getByTestId("sourcing-event-detail")).toContainText(fixture.title);
  await expect(page.getByTestId("sourcing-event-detail")).toContainText(fixture.supplierName);
  await page.getByLabel("Early-close reason").fill("All invited supplier responses are received and commercial evaluation must proceed.");
  await page.getByRole("button", { name: "Close for evaluation" }).click();
  await expect(page.getByTestId("sourcing-evaluation-award-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/Landed cost/).fill("92");
  await page.getByLabel(/Service delivery/).fill("86");
  await page.getByRole("button", { name: "Save evaluation" }).click();
  await expect(page.getByText("Evaluation saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Award justification").fill("Best compliant landed cost with a strong service delivery score.");
  const endpoint = `/api/sourcing/events/${fixture.eventId}/awards`;
  const submitted = (status:number) => page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==="POST"&&r.status()===status);
  const submit = page.getByRole("button", { name: "Submit award" });
  await pool.query(`CREATE FUNCTION reject_test_award_submission() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='RFQ_AWARD_SUBMITTED' THEN RAISE EXCEPTION 'Synthetic submission audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_award_submission BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_test_award_submission()`);
  const failure=submitted(500);
  let attemptedKey:string|undefined;
  try {
    await submit.click();
    attemptedKey=(await failure).request().headers()["idempotency-key"];
    expect(attemptedKey).toBeTruthy();
    await expect(page.getByText("Award was not submitted",{exact:true})).toBeVisible();
    expect((await pool.query("SELECT count(*)::int AS n FROM sourcing_awards WHERE organization_id=1 AND event_id=$1",[fixture.eventId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM workflow_idempotency WHERE organization_id=1 AND idempotency_key=$1",[attemptedKey])).rows[0].n).toBe(0);
  } finally { await pool.query("DROP TRIGGER reject_test_award_submission ON audit_logs; DROP FUNCTION reject_test_award_submission()"); }
  const success=submitted(201);
  await submit.click();
  const response=await success;
  expect(response.request().headers()["idempotency-key"]).toBe(attemptedKey);
  const command=response.request().postDataJSON();
  const awardId=(await response.json()).data.award.id;
  await expect(page.getByText("Award submitted", { exact: true })).toBeVisible({ timeout: 20_000 });
  const tokenResponse=await readBrowserApi(page,"/api/csrf-token"), token=await tokenResponse.json();
  const post=(key:string,body:object)=>page.request.post(endpoint,{headers:{"X-CSRF-Token":token.data?.csrfToken??token.csrfToken,"Idempotency-Key":key},data:body});
  const replays=await Promise.all([post(attemptedKey!,command),post(attemptedKey!,command)]);
  for(const replay of replays) {
    expect(replay.status()).toBe(201);
    expect((await replay.json()).data).toMatchObject({duplicate:true,awardId,award:{id:awardId}});
  }
  const changed=await post(attemptedKey!,{...command,justification:"Changed recommendation must not replay."});
  expect(changed.status()).toBe(409);
  expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  const second=await post(crypto.randomUUID(),command);
  expect(second.status()).toBe(409);
  expect((await second.json()).error.code).toBe("RFQ_AWARD_ALREADY_EXISTS");
  const audit=(await pool.query(`SELECT details,event_hash FROM audit_logs WHERE organization_id=1 AND action='RFQ_AWARD_SUBMITTED'
    AND resource_type='sourcing_award' AND resource_id=$1`,[awardId])).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({event_hash:expect.any(String),details:{after:{lines:[expect.objectContaining({
    quoteLineId:command.lines[0].quoteLineId,awardedUnitPrice:180,currencyCode:"ZAR",
  })]}}});

  await login(page, "planner");
  await page.goto(`/procurement/sourcing/${fixture.eventId}`, { waitUntil: "load" });
  await expect(page.getByTestId("sourcing-evaluation-award-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Independent approval reason").fill("Independent commercial review completed and approved.");
  await page.getByRole("button", { name: "Approve award" }).click();
  await expect(page.getByText("Award approved", { exact: true })).toBeVisible({ timeout: 20_000 });

  await login(page, "admin");
  await page.goto(`/procurement/sourcing/${fixture.eventId}`, { waitUntil: "load" });
  await expect(page.getByTestId("sourcing-evaluation-award-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Convert award to PO" }).click();
  await expect(page.getByText("Purchase order created", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("This award has been converted to controlled purchase order records.")).toBeVisible();
});
