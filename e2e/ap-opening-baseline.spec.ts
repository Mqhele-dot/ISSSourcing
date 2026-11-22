import {expect,test,type Page} from "@playwright/test";
import {gotoAuthed} from "./test-helpers";
import {requireDisposableE2eDatabase} from "./wave7-helpers";
import {pool} from "../server/db";

async function post(page:Page,url:string,data:unknown) {
  const tokenResponse=await page.request.get("/api/csrf-token");
  const token=await tokenResponse.json();
  return page.request.post(url,{headers:{"X-CSRF-Token":token.csrfToken??token.data?.csrfToken},data});
}

test("opening balances require independent review and payment capture rolls back atomically",async({page,browser})=>{
  test.setTimeout(120_000);
  requireDisposableE2eDatabase();
  expect(process.env.ENABLE_AP_HISTORY_TESTS).toBe("1");
  const invoiceNumber=`AP-HISTORY-${Date.now()}`;
  const supplier=(await pool.query("SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0].id;
  const invoice=(await pool.query(`INSERT INTO invoices(organization_id,invoice_number,supplier_id,status,issue_date,due_date,subtotal,total,paid_amount,due_amount,currency_code,created_by)
    VALUES(1,$1,$2,'APPROVED',now(),now(),0.30,0.30,0.10,0.20,'ZAR',1) RETURNING id`,[invoiceNumber,supplier])).rows[0].id;
  const username=`history_reviewer_${Date.now()}`;
  const reviewer=(await pool.query(`INSERT INTO users(username,password,email,role,active,email_verified,default_organization_id)
    SELECT $1,password,$2,'admin',true,true,1 FROM users WHERE username='admin' RETURNING id`,[username,`${username}@example.invalid`])).rows[0].id;
  await pool.query("INSERT INTO organization_members(organization_id,user_id,role,application_role,active,status) VALUES(1,$1,'member','admin',true,'active')",[reviewer]);
  await pool.query("INSERT INTO approval_policies(organization_id,name,entity_type,amount_min,approval_level,approver_role,is_active) VALUES(1,'Test-owned opening baseline review','ap_balance_baseline',0,1,'admin',true)");
  await gotoAuthed(page,"/finance/accounts-payable/aging");
  await page.getByText("AP reporting opening baselines",{exact:true}).click();
  await page.getByRole("checkbox",{name:`Select ${invoiceNumber}`,exact:true}).check();
  await page.getByRole("textbox",{name:"Finance review reason"}).fill("Reviewed original-currency opening evidence in disposable test data");
  const prepared=page.waitForResponse(r=>r.url().endsWith("/api/v2/ap/balance-baselines")&&r.request().method()==="POST");
  await page.getByRole("button",{name:"Prepare opening preview (1)",exact:true}).click();
  const preparedResponse=await prepared;expect(preparedResponse.status()).toBe(201);
  const body=await preparedResponse.json();const baseline=body.data??body;
  await page.getByRole("button",{name:"Submit reviewed baseline",exact:true}).click();
  await expect(page.getByText("A different authorized person must approve this baseline.",{exact:true})).toBeVisible();
  const denied=await post(page,`/api/v2/ap/balance-baselines/${baseline.id}/approve`,{});expect(denied.status()).toBe(403);
  const context=await browser.newContext({viewport:page.viewportSize()??{width:1280,height:720}});
  try {
    const second=await context.newPage();
    await second.addInitScript(id=>localStorage.setItem(`invtrack:first-run-coach:v2:${id}`,"done"),Number(reviewer));
    await second.goto(`${process.env.PLAYWRIGHT_BASE_URL}/auth`,{waitUntil:"load"});
    await second.getByPlaceholder("Enter your username").fill(username);
    await second.getByPlaceholder("Enter your password").fill("Admin123!");
    const signedIn=second.waitForResponse(response=>response.url().endsWith("/api/login")&&response.request().method()==="POST");
    await second.getByRole("button",{name:/sign in/i}).click();
    expect((await signedIn).status()).toBe(200);
    await second.waitForURL(url=>!url.pathname.startsWith("/auth"));
    await second.goto(`${process.env.PLAYWRIGHT_BASE_URL}/finance/accounts-payable/aging`,{waitUntil:"load"});
    await second.getByText("AP reporting opening baselines",{exact:true}).click();
    await second.getByRole("button",{name:`Review baseline ${baseline.id}`,exact:true}).click();
    await second.getByRole("button",{name:"Approve opening baseline",exact:true}).click();
    await expect(second.getByText(/Coverage starts/)).toBeVisible({timeout:15_000});
  }finally{await context.close();}
  const opening=await pool.query("SELECT actor_user_id,snapshot FROM ap_balance_events WHERE organization_id=1 AND invoice_id=$1 AND event_kind='OPENING_BASELINE'",[invoice]);
  expect(opening.rowCount).toBe(1);expect(opening.rows[0].actor_user_id).toBe(reviewer);
  expect(opening.rows[0].snapshot.remainingBalance).toBe("0.2");
  // The real storage transaction must roll back payment, balance and event if its audit write fails.
  await pool.query(`CREATE FUNCTION test_fail_history_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='AP_BALANCE_SOURCE_CAPTURED' THEN RAISE EXCEPTION 'Injected atomic source audit failure';END IF;RETURN NEW;END $$;
    CREATE TRIGGER test_fail_history_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_history_audit();`);
  try {
    expect((await post(page,`/api/invoices/${invoice}/payments`,{amount:0.20,method:"BANK_TRANSFER"})).status()).toBe(500);
    expect((await pool.query("SELECT count(*)::int n FROM payments WHERE invoice_id=$1",[invoice])).rows[0].n).toBe(0);
    expect(Number((await pool.query("SELECT due_amount FROM invoices WHERE id=$1",[invoice])).rows[0].due_amount)).toBe(0.20);
  }finally{await pool.query("DROP TRIGGER test_fail_history_audit ON audit_logs");}
  const payment=await post(page,`/api/invoices/${invoice}/payments`,{amount:0.20,method:"BANK_TRANSFER"});
  expect(payment.status()).toBe(201);
  const source=(await pool.query("SELECT paid_amount,due_amount,status FROM invoices WHERE id=$1",[invoice])).rows[0];
  expect(Number(source.paid_amount)).toBe(0.30);expect(Number(source.due_amount)).toBe(0);expect(source.status).toBe("PAID");
  const latest=(await pool.query("SELECT actor_user_id,actor_provenance,snapshot FROM ap_balance_events WHERE invoice_id=$1 ORDER BY id DESC LIMIT 1",[invoice])).rows[0];
  expect(latest.actor_user_id).toBe(1);expect(latest.actor_provenance).toBe("authenticated_command");expect(Number(latest.snapshot.remainingBalance)).toBe(0);
});
