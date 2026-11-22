import { expect, test } from "@playwright/test";
import { pool } from "../server/db";
import { gotoAuthed, readBrowserApi } from "./test-helpers";
import { requireDisposableE2eDatabase, loginAsSeededUser } from "./wave7-helpers";
import { extractPdfTestText } from "../scripts/helpers/pdf-test-text";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import path from "node:path";
import {gunzipSync} from "node:zlib";
import {exportsDir} from "../server/http/upload-config";

test("Prospective non-carrier suppliers create and update without inventing carrier profiles", async ({page},testInfo)=>{
  test.setTimeout(90000);requireDisposableE2eDatabase();
  expect((await pool.query("SELECT current_database() name")).rows[0].name).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await gotoAuthed(page,"/procurement/suppliers");
  const csrfResponse=await readBrowserApi(page, "/api/csrf-token");
  expect(csrfResponse.status()).toBe(200);
  const token=await csrfResponse.json();
  const headers={"X-CSRF-Token":token.data?.csrfToken??token.csrfToken};
  const ids:number[]=[];
  for(const supplierType of ["goods","service","contractor","fuel"]){
    const name=`Prospective ${supplierType} ${testInfo.project.name} ${Date.now()}`;
    const forged=await page.request.post("/api/suppliers",{headers,data:{name,supplierType,status:"active",onboardingStatus:"approved"}});
    expect(forged.status()).toBe(409);
    const created=await page.request.post("/api/suppliers",{headers,data:{name,supplierType,status:"active"}});
    expect(created.status()).toBe(201);
    const supplier=await created.json();ids.push(supplier.id);
    expect(supplier.status).toBe("prospective");expect(supplier.onboardingStatus).toBe("prospective");expect(supplier.approvedAt).toBeNull();
    expect(supplier.bankingDisclosure).toBe("governed_workflow_only");
    const changed=await page.request.patch(`/api/suppliers/${supplier.id}`,{headers,data:{name:`${name} revised`}});
    expect(changed.status()).toBe(200);expect((await changed.json()).name).toBe(`${name} revised`);
    expect((await pool.query("SELECT count(*) FROM carriers WHERE organization_id=1 AND supplier_id=$1",[supplier.id])).rows[0].count).toBe("0");
    expect((await pool.query("SELECT count(*) FROM audit_logs WHERE organization_id=1 AND action='SUPPLIER_ONBOARDING_STARTED' AND resource_id=$1",[supplier.id])).rows[0].count).toBe("1");
  }
  await page.goto(`/procurement/suppliers/${ids[0]}`,{waitUntil:"load"});
  await expect(page.getByTestId("supplier-banking-guidance")).toBeVisible({timeout:25000});
  await expect(page.getByRole("heading",{name:/Prospective goods.*revised/})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("prospective-non-carrier-profile.png"),fullPage:false,scale:"css"});
  expect(errors).toEqual([]);
});

test("Supplier 360 delivery evidence retains dates, bounded sources, retry and safe denied states", async ({ page }, testInfo) => {
  test.setTimeout(120000); requireDisposableE2eDatabase();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const identity = await pool.query("SELECT current_database() AS name");
  expect(identity.rows[0].name).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
  const supplier = await pool.query("INSERT INTO suppliers(organization_id,name,status) VALUES(1,$1,'active') RETURNING id", [`Delivery evidence ${Date.now()}`]);
  const supplierId = supplier.rows[0].id;
  const item = await pool.query("SELECT id FROM inventory_items WHERE organization_id=1 ORDER BY id LIMIT 1");
  expect(item.rowCount).toBe(1);
  const orders = await pool.query(`INSERT INTO purchase_orders(organization_id,supplier_id,order_number,order_date,expected_delivery_date,approval_status,status)
    SELECT 1,$1::int,'S360-'||$1::int::text||'-'||n,'2026-01-01','2026-01-10','APPROVED','SENT'
    FROM generate_series(1,30) n RETURNING id,order_number`, [supplierId]);
  const receipt = await pool.query(`INSERT INTO ap_receipts(organization_id,supplier_id,purchase_order_id,receipt_number,status,received_date)
    SELECT 1,$1,id,'S360-REC-'||id,'POSTED','2026-01-09' FROM purchase_orders WHERE organization_id=1 AND supplier_id=$1 AND id=ANY($2::int[]) RETURNING id`,
  [supplierId, orders.rows.slice(0, 15).map(row => row.id)]);
  await pool.query("INSERT INTO ap_receipt_items(receipt_id,item_id,quantity,accepted_quantity) SELECT unnest($1::int[]),$2,1,1", [receipt.rows.map(row => row.id), item.rows[0].id]);
  await gotoAuthed(page, `/procurement/suppliers/${supplierId}`);
  const consoleErrors: string[] = [];
  let injectingFailure = false;
  page.on("console", message => {
    if (message.type() === "error" && !(injectingFailure && /Failed to load resource:.*(?:403|503)/.test(message.text()))) consoleErrors.push(message.text());
  });
  const card = page.getByTestId("supplier-delivery-scorecard");
  await expect(card.getByText("First accepted receipt on time: 100.0%", { exact: true })).toBeVisible({ timeout: 25000 });
  await expect(card.getByText(/15 measured of 30 eligible orders/)).toBeVisible();
  await card.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(card.getByText(/PO dates and statuses may change/)).toBeVisible();
  await expect(card.getByRole("link", { name: /^S360-/ })).toHaveCount(25);
  await card.getByRole("button", { name: "Next delivery page", exact: true }).click();
  await expect(card.getByRole("link", { name: /^S360-/ })).toHaveCount(5);
  await expect(card.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  const link = card.getByRole("link", { name: /^S360-/ }).first();
  await expect(link).toHaveAttribute("href", /^\/procurement\/orders\/\d+$/);
  await link.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("supplier-delivery-contributions.png"), fullPage: false, scale: "css" });
  await card.getByLabel("PO order date from").fill("2026-02-01");
  await card.getByRole("button", { name: "Apply delivery dates", exact: true }).click();
  await expect(card.getByText("No eligible orders in this period.", { exact: true })).toBeVisible();
  await expect(card.getByText("First accepted receipt on time: Unavailable", { exact: true })).toBeVisible();
  await card.getByLabel("PO order date from").fill("");
  await card.getByRole("button", { name: "Apply delivery dates", exact: true }).click();
  await expect(card.getByText(/15 measured of 30 eligible orders/)).toBeVisible();
  const layout = await card.evaluate(element => ({ right: element.getBoundingClientRect().right, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1); expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
  await card.getByRole("heading", { name: "Delivery evidence", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("supplier-delivery-evidence.png"), fullPage: false, scale: "css" });
  // Only failure presentation is injected; successful calculations above use real tenant-owned sources.
  const endpoint = `**/api/v2/suppliers/${supplierId}/delivery-scorecard?*`;
  injectingFailure = true;
  await page.route(endpoint, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "SUPPLIER_SCORECARD_UNAVAILABLE", message: "Synthetic unavailable", requestId: "synthetic-retry" } }) }));
  await card.getByRole("button", { name: "Refresh delivery evidence", exact: true }).click();
  await expect(card.getByRole("alert")).toBeVisible();
  await page.unroute(endpoint);
  await card.getByRole("button", { name: "Retry delivery evidence", exact: true }).click();
  await expect(card.getByText(/15 measured of 30 eligible orders/)).toBeVisible();
  injectingFailure = false;
  await page.route(endpoint, route => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "SUPPLIER_SCORECARD_SCOPE_DENIED", message: "Synthetic denied", requestId: "synthetic-denied" } }) }));
  injectingFailure = true;
  await card.getByRole("button", { name: "Refresh delivery evidence", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText("You do not have access");
  await page.unroute(endpoint);
  await card.getByRole("button", { name: "Retry delivery evidence", exact: true }).click();
  await expect(card.getByText(/15 measured of 30 eligible orders/)).toBeVisible();
  injectingFailure = false;
  await card.getByRole("button", { name: "Save current observation" }).click();
  await expect(card.getByText("Saved observation — frozen at capture time.")).toBeVisible();
  await expect(card.getByText("First accepted receipt on time: 100.0%", { exact: true })).toBeVisible();
  await pool.query("UPDATE purchase_orders SET expected_delivery_date='2026-01-02',updated_at=now() WHERE organization_id=1 AND supplier_id=$1", [supplierId]);
  await card.getByRole("button", { name: "Refresh delivery evidence", exact: true }).click();
  await expect(card.getByText("First accepted receipt on time: 100.0%", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Return to live evidence" }).click();
  await card.getByRole("button", { name: "Refresh delivery evidence", exact: true }).click();
  await expect(card.getByText("First accepted receipt on time: 0.0%", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: /^Open / }).click();
  await expect(card.getByText("First accepted receipt on time: 100.0%", { exact: true })).toBeVisible();
  const source = card.getByRole("link", { name: /^S360-/ }).first();
  const sourceName = await source.textContent(), sourceHref = await source.getAttribute("href");
  expect(sourceName).toBeTruthy(); expect(sourceHref).toBeTruthy();
  const sourceUrl = new URL(sourceHref!, page.url()).href;
  await source.focus(); await source.press("Enter");
  await expect(page).toHaveURL(sourceUrl);
  await expect(page.getByTestId("po-detail-title")).toHaveText(`PO ${sourceName}`, { timeout: 25000 });
  await page.screenshot({ path: testInfo.outputPath("supplier-delivery-source-po.png"), fullPage: false, scale: "css" });
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Supplier compliance proposal publishes independently and unlocks reviewed onboarding", async ({ page }) => {
  test.setTimeout(120000); requireDisposableE2eDatabase();
  expect((await pool.query("SELECT current_database() AS name")).rows[0].name).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
  await gotoAuthed(page, "/procurement/suppliers");
  const csrf = async () => {
    const response = await readBrowserApi(page, "/api/csrf-token");
    expect(response.status()).toBe(200);
    const body = await response.json(); return { "X-CSRF-Token": body.data?.csrfToken ?? body.csrfToken };
  };
  const reviewedPost = async (url: string, data: object) => {
    let response = await page.request.post(url, { headers: await csrf(), data });
    // The real client refreshes once on this pre-mutation rejection after login.
    // Never retry a permission denial, ambiguous failure, or failed domain action.
    if (response.status() === 403 && (await response.json()).error?.code === "CSRF_TOKEN_INVALID") {
      response = await page.request.post(url, { headers: await csrf(), data });
    }
    return response;
  };
  const taxId = (await pool.query("SELECT id FROM tax_codes WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0].id;
  const created = await page.request.post("/api/suppliers", { headers: await csrf(), data: {
    name: `Dated compliance fixture ${Date.now()}`, supplierType: "goods", paymentTermsId: 1, taxCodeId: taxId, defaultCurrencyCode: "ZAR",
  } });
  expect(created.status()).toBe(201);
  const supplier = await created.json(), supplierId = supplier.id;
  const path = `/procurement/suppliers/${supplierId}`;
  const uploaded = await page.request.post("/api/documents/upload", { headers: await csrf(), multipart: { entityType: "supplier", entityId: String(supplierId), file: { name: "compliance-test-evidence.txt", mimeType: "text/plain", buffer: Buffer.from("SYNTHETIC TEST EVIDENCE") } } });
  expect(uploaded.status()).toBe(201);
  const document = await uploaded.json();
  await page.goto(path, { waitUntil: "load" });
  const card = page.getByTestId("supplier-compliance-evidence");
  await card.getByRole("button", { name: "Review compliance evidence" }).click();
  await expect(card.getByText("No dated evidence published.")).toBeVisible();
  const evidence = await (await readBrowserApi(page, `/api/v2/suppliers/${supplierId}/compliance-evidence`)).json();
  const types: string[] = evidence.data.requiredTypes;
  expect(types.length).toBeGreaterThan(0);
  const requests: number[] = [];
  for (const type of types) {
    await card.getByLabel("Evidence type").selectOption(type);
    await card.getByLabel("Evidence document").selectOption(String(document.id));
    await card.getByLabel("Compliance change reason").fill(`Review synthetic ${type} evidence`);
    const pending = page.waitForResponse(response => response.url().endsWith("/api/mdm/change-requests") && response.request().method() === "POST");
    await card.getByRole("button", { name: "Submit compliance request" }).click();
    const submitted = await pending;
    expect(submitted.status()).toBe(201);
    const body = await submitted.json(); expect(body.data.status).toBe("pending_approval"); requests.push(body.data.id);
  }
  const self = await reviewedPost(`/api/mdm/change-requests/${requests[0]}/approve`, { reason: "Maker cannot approve" });
  expect(self.status()).toBe(403);
  expect((await self.json()).error.code).toBe("SUPPLIER_COMPLIANCE_INDEPENDENT_APPROVAL");
  const checker = (await pool.query("SELECT id,role,warehouse_id FROM users WHERE username='viewer'")).rows[0];
  expect(checker?.id).toBeTruthy();
  const membership = (await pool.query("SELECT application_role FROM organization_members WHERE organization_id=1 AND user_id=$1", [checker.id])).rows[0];
  expect(membership).toBeTruthy();
  try {
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [checker.id]);
    await pool.query("UPDATE organization_members SET application_role='admin' WHERE organization_id=1 AND user_id=$1", [checker.id]);
    await loginAsSeededUser(page, "viewer", checker.id);
    // Keep the API approval sequence separate from concurrent app boot requests.
    // The authenticated cookie jar remains shared with the subsequent UI check.
    await page.goto("about:blank");
    for (const id of requests) {
      const approved = await reviewedPost(`/api/mdm/change-requests/${id}/approve`, { reason: "Independent test review" });
      expect(approved.status(), await approved.text()).toBe(200);
      const applied = await reviewedPost(`/api/mdm/change-requests/${id}/apply`, { reason: "Publish test evidence" });
      expect(applied.status(), await applied.text()).toBe(200);
    }
    await page.goto(path, { waitUntil: "load" });
    await card.getByRole("button", { name: "Review compliance evidence" }).click();
    await expect(card.getByRole("link", { name: /^Source document/ })).toHaveCount(types.length);
    await card.getByLabel("Independent onboarding approval reason").fill("Reviewed profile and published evidence");
    const pending = page.waitForResponse(response => response.url().endsWith(`/api/suppliers/${supplierId}/approve`) && response.request().method() === "POST");
    await card.getByRole("button", { name: "Approve reviewed supplier profile" }).click();
    const approved = await pending; expect(approved.status(), await approved.text()).toBe(200);
    expect((await approved.json()).onboardingStatus).toBe("approved");
    await expect(card.getByRole("button", { name: "Approve reviewed supplier profile" })).toHaveCount(0);
    const warehouse = (await pool.query("SELECT id FROM warehouses WHERE organization_id=1 ORDER BY id LIMIT 1")).rows[0];
    expect(warehouse?.id).toBeTruthy();
    await pool.query("UPDATE users SET warehouse_id=$2 WHERE id=$1", [checker.id, warehouse.id]);
    expect((await readBrowserApi(page, `/api/v2/suppliers/${supplierId}/compliance-evidence`)).status()).toBe(403);
    const scoped = await (await readBrowserApi(page, "/api/mdm/change-requests")).json();
    expect(scoped.data.some((row: { id: number }) => requests.includes(row.id))).toBe(false);
    expect((await readBrowserApi(page, `/api/mdm/change-requests/${requests[0]}`)).status()).toBe(404);
    const analytics = await (await readBrowserApi(page, "/api/analytics/suppliers")).json();
    expect(analytics.data.kpis.supplierRisk.value).toBe("Unavailable");
  } finally {
    await pool.query("UPDATE users SET role=$2,warehouse_id=$3 WHERE id=$1", [checker.id, checker.role, checker.warehouse_id]);
    await pool.query("UPDATE organization_members SET application_role=$2 WHERE organization_id=1 AND user_id=$1", [checker.id, membership.application_role]);
  }
});

test("General supplier profiles and new exports withhold legacy bank values without changing them", async ({ page }, testInfo) => {
  test.setTimeout(120000); requireDisposableE2eDatabase();
  const secret = `PRIVATE-BANK-${Date.now()}`;
  const fixtures = await pool.query(`INSERT INTO suppliers(organization_id,name,bank_name,bank_account_number,bank_swift,status)
    SELECT 1,'Visibility-profile-'||n,$1::text,$1::text,$1::text,'active' FROM generate_series(1,5000) n RETURNING id`, [secret]);
  const id = fixtures.rows[0].id;
  const foreignOrganization = (await pool.query("INSERT INTO organizations(id,name) SELECT COALESCE(MAX(id),0)+1,'Foreign profile visibility' FROM organizations RETURNING id")).rows[0].id;
  const foreign = (await pool.query("INSERT INTO suppliers(organization_id,name,bank_account_number) VALUES($1,'FOREIGN-SUPPLIER-VISIBILITY',$2) RETURNING id", [foreignOrganization, secret])).rows[0].id;
  const before = (await pool.query("SELECT md5(string_agg(row_to_json(s)::text,',' ORDER BY id)) AS hash FROM suppliers s WHERE organization_id=1 AND bank_account_number=$1", [secret])).rows[0].hash;
  await gotoAuthed(page, `/procurement/suppliers/${id}`);
  await expect(page.getByTestId("supplier-banking-guidance")).toContainText("not a payment instruction");
  await expect(page.getByRole("link", { name: "Open governed Master Data", exact: true })).toHaveAttribute("href", "/admin/master-data");
  const check = async (endpoint: string) => {
    const response = await readBrowserApi(page, endpoint); expect(response.status()).toBe(200);
    const text = await response.text(); expect(text).not.toContain(secret); expect(text).not.toContain("FOREIGN-SUPPLIER-VISIBILITY");
    expect(text).not.toContain('"bankAccountNumber"'); expect(text).not.toContain('"bankSwift"'); expect(text).toContain('"bankingDisclosure":"governed_workflow_only"');
    return JSON.parse(text);
  };
  await check(`/api/suppliers/${id}?includeBank=true`);
  expect((await readBrowserApi(page, `/api/suppliers/${foreign}`)).status()).toBe(404);
  await check("/api/suppliers");
  const bounded = await check("/api/v2/suppliers?pageSize=100"); expect(bounded.data.items).toHaveLength(100); expect(bounded.data.total).toBeGreaterThanOrEqual(5000);
  const pdf = await readBrowserApi(page, `/api/export/suppliers/pdf?supplierId=${id}`); expect(pdf.status()).toBe(200);
  const text = extractPdfTestText(await pdf.body());
  expect(text.replace(/\s/g, "")).not.toContain(secret); expect(text).toContain("not a verified beneficiary or payment instruction");
  const csrfBody = await (await readBrowserApi(page, "/api/csrf-token")).json();
  const blocked = await page.request.patch(`/api/suppliers/${id}`, { headers: { "X-CSRF-Token": csrfBody.data?.csrfToken ?? csrfBody.csrfToken }, data: { bankAccountNumber: "should-not-be-applied" } });
  expect(blocked.status()).toBe(409);
  const viewer = (await pool.query("SELECT id FROM users WHERE username='viewer'")).rows[0];
  await loginAsSeededUser(page, "viewer", viewer.id);
  await check(`/api/suppliers/${id}`); await check("/api/v2/suppliers?pageSize=25");
  const [viewerProfile]=await Promise.all([
    page.waitForResponse(response=>response.request().method()==="GET"&&new URL(response.url()).pathname===`/api/suppliers/${id}`,{timeout:10000}),
    page.goto(`/procurement/suppliers/${id}`, { waitUntil: "load" }),
  ]);
  expect(viewerProfile.status()).toBe(200);
  await expect(page.getByTestId("supplier-banking-guidance")).toContainText("authorized Master Data steward");
  await expect(page.getByRole("link", { name: "Open governed Master Data", exact: true })).toHaveCount(0);
  expect(await page.locator("body").textContent()).not.toContain(secret);
  await page.getByTestId("supplier-banking-guidance").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("supplier-banking-source-guidance.png"), fullPage: false, scale: "css" });
  const savedRead = await pool.query("SELECT row_to_json(p) AS row FROM permissions p WHERE role='viewer' AND resource='suppliers' AND permission_type='read'");
  await pool.query("DELETE FROM permissions WHERE role='viewer' AND resource='suppliers' AND permission_type='read'");
  try {
    for (const endpoint of ["/api/suppliers", `/api/suppliers/${id}`, "/api/v2/suppliers?pageSize=25"]) {
      const denied = await readBrowserApi(page, endpoint); expect(denied.status()).toBe(403); expect(await denied.text()).not.toContain(secret);
    }
  } finally {
    if (savedRead.rowCount) await pool.query("INSERT INTO permissions SELECT * FROM json_populate_recordset(NULL::permissions,$1::json) ON CONFLICT DO NOTHING", [JSON.stringify(savedRead.rows.map(row => row.row))]);
  }
  const after = (await pool.query("SELECT md5(string_agg(row_to_json(s)::text,',' ORDER BY id)) AS hash FROM suppliers s WHERE organization_id=1 AND bank_account_number=$1", [secret])).rows[0].hash;
  expect(after).toBe(before);
});

test("Combined supplier ratings deny Finance-revoked users without blocking supplier profiles", async ({ page }) => {
  test.setTimeout(90000); requireDisposableE2eDatabase();
  const viewer = (await pool.query("SELECT id FROM users WHERE username='viewer'")).rows[0];
  expect(viewer).toBeTruthy();
  const saved = await pool.query("SELECT row_to_json(p) AS row FROM permissions p WHERE role='viewer' AND resource='finance' AND permission_type='read'");
  await pool.query("DELETE FROM permissions WHERE role='viewer' AND resource='finance' AND permission_type='read'");
  try {
    await loginAsSeededUser(page, "viewer", viewer.id);
    expect((await readBrowserApi(page, "/api/v2/suppliers?pageSize=25")).status()).toBe(200);
    for (const endpoint of ["/api/v2/suppliers/performance?ids=1", "/api/suppliers/performance?ids=1"]) {
      const response = await readBrowserApi(page, endpoint);
      expect(response.status()).toBe(403); expect(await response.text()).not.toContain("invoicesMeasured");
    }
    let ratingRequests = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/v2/suppliers/performance") ratingRequests++; });
    await page.goto("/procurement/suppliers", { waitUntil: "load" });
    await expect(page.getByText("Combined supplier ratings require procurement, inventory and Finance read access with organization-wide warehouse scope. Supplier profiles remain available according to your permissions.", { exact: true })).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("Supplier List", { exact: true })).toBeVisible();
    expect(ratingRequests).toBe(0);
  } finally {
    if (saved.rowCount) await pool.query("INSERT INTO permissions SELECT * FROM json_populate_recordset(NULL::permissions,$1::json) ON CONFLICT DO NOTHING", [JSON.stringify(saved.rows.map(row => row.row))]);
  }
});

test("Retained supplier exports require immutable safe publication and current access", async ({page},testInfo)=>{
  test.setTimeout(120000);requireDisposableE2eDatabase();
  expect(path.resolve(exportsDir)).toBe(path.join(path.resolve(process.env.TEST_UPLOADS_DIR!),"exports"));
  const orgDir=path.join(exportsDir,"org-1");await mkdir(orgDir,{recursive:true});
  const supplier=(await pool.query("INSERT INTO suppliers(organization_id,name,bank_account_number,status) VALUES(1,'Publication privacy fixture','PRIVATE-LEGACY-ACCOUNT','active') RETURNING id")).rows[0];
  await gotoAuthed(page,"/analytics/export-center");
  const csrf=async()=>{const body=await(await readBrowserApi(page, "/api/csrf-token")).json();return {"X-CSRF-Token":body.data?.csrfToken??body.csrfToken};};
  const old=(await pool.query(`INSERT INTO export_jobs(organization_id,created_by,dataset,format,status,download_token,download_token_expires_at,retention_expires_at)
    VALUES(1,1,'suppliers','csv','succeeded','synthetic-old-token',now()+interval '1 hour',now()+interval '1 day') RETURNING id`)).rows[0];
  const oldPath=path.join(orgDir,`job-${old.id}-old-suppliers.csv`),oldBytes=Buffer.from("Synthetic historical file,PRIVATE-LEGACY-ACCOUNT\r\n");await writeFile(oldPath,oldBytes);
  await pool.query("UPDATE export_jobs SET file_path=$2,file_name='old-suppliers.csv',file_size=$3,mime_type='text/csv' WHERE organization_id=1 AND id=$1",[old.id,oldPath,oldBytes.length]);
  for(const directory of ["exports","%65xports","EXPORTS","exports.","exports%20","exports%5corg-1%5c.."]){
    const staticFile=await readBrowserApi(page, `/uploads/${directory}/org-1/job-${old.id}-old-suppliers.csv`);
    expect(staticFile.status()).toBe(404);expect(await staticFile.text()).not.toContain("PRIVATE-LEGACY-ACCOUNT");
  }
  const before=(await pool.query("SELECT row_to_json(j) AS row FROM export_jobs j WHERE organization_id=1 AND id=$1",[old.id])).rows[0].row;
  const readOld=await readBrowserApi(page, `/api/export/download/${old.id}?token=synthetic-old-token`);expect(readOld.status()).toBe(409);expect(await readOld.text()).not.toContain("PRIVATE-LEGACY-ACCOUNT");
  const renewOld=await page.request.post(`/api/export-jobs/${old.id}/download-token`,{headers:await csrf(),data:{}});expect(renewOld.status()).toBe(409);
  const oldInfo=await(await readBrowserApi(page, `/api/export-jobs/${old.id}`)).json();expect(oldInfo.data.downloadBlocked).toBe(true);expect(oldInfo.data.downloadUrl).toBeNull();expect(oldInfo.data.downloadToken).toBeNull();
  expect((await readBrowserApi(page, "/api/export-jobs/not-an-id")).status()).toBe(400);
  await page.reload();const oldRow=page.getByTestId(`export-history-job-${old.id}`);
  await expect(oldRow.getByRole("status")).toContainText("no verified banking-disclosure evidence");await expect(oldRow.getByRole("button",{name:"Download",exact:true})).toHaveCount(0);
  await oldRow.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("supplier-retained-file-refusal.png"),fullPage:false,scale:"css"});
  const nextLink=oldRow.getByRole("link",{name:"Open suppliers to generate a new export"});await nextLink.focus();await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/procurement\/suppliers$/);await expect(page.getByText("Supplier List",{exact:true})).toBeVisible();
  const queued=await page.request.post("/api/export-jobs",{headers:await csrf(),data:{dataset:"suppliers",format:"csv",filters:{supplierId:supplier.id,disclosurePolicy:"caller-cannot-certify"}}});expect(queued.status()).toBe(202);
  const job=(await queued.json()).data;
  await expect.poll(async()=>{const reply=await readBrowserApi(page, `/api/export-jobs/${job.id}`);expect(reply.status()).toBe(200);return(await reply.json()).data.status;},{timeout:45000}).toBe("succeeded");
  const proof=(await pool.query("SELECT * FROM supplier_export_publications WHERE organization_id=1 AND job_id=$1",[job.id])).rows[0];expect(proof.policy_version).toBe("supplier-profile-no-banking-v1");
  const renewed=await page.request.post(`/api/export-jobs/${job.id}/download-token`,{headers:await csrf(),data:{}});expect(renewed.status()).toBe(200);
  expect((await page.request.post(`/api/export-jobs/${job.id}/download-token`,{headers:await csrf(),data:{artifact:"archive"}})).status()).toBe(400);
  const safeUrl=(await renewed.json()).data.downloadUrl;const safe=await readBrowserApi(page, safeUrl);expect(safe.status()).toBe(200);
  const raw=gunzipSync(await safe.body()).toString("utf8");expect(raw).toContain("Publication privacy fixture");expect(raw).not.toContain("PRIVATE-LEGACY-ACCOUNT");
  expect((await pool.query("SELECT count(*) AS n FROM audit_logs WHERE organization_id=1 AND action='SUPPLIER_EXPORT_PUBLISHED' AND resource_id=$1",[job.id])).rows[0].n).toBe("1");
  const savedSafe=await readFile(path.resolve(proof.file_path));await writeFile(path.resolve(proof.file_path),Buffer.alloc(savedSafe.length,65));
  const tampered=await readBrowserApi(page, safeUrl);expect(tampered.status()).toBe(409);expect(await tampered.text()).toContain("saved publication evidence");
  expect((await page.request.post(`/api/export-jobs/${job.id}/download-token`,{headers:await csrf(),data:{}})).status()).toBe(409);
  await writeFile(path.resolve(proof.file_path),savedSafe);
  expect(await readFile(oldPath)).toEqual(oldBytes);expect((await pool.query("SELECT row_to_json(j) AS row FROM export_jobs j WHERE organization_id=1 AND id=$1",[old.id])).rows[0].row).toEqual(before);
  const viewer=(await pool.query("SELECT id FROM users WHERE username='viewer'")).rows[0];
  await pool.query("UPDATE export_jobs SET created_by=$2 WHERE organization_id=1 AND id=$1",[old.id,viewer.id]);
  const extraGrants=(await pool.query(`INSERT INTO permissions(role,resource,permission_type) VALUES('viewer','reports','read'),('viewer','reports','export')
    ON CONFLICT DO NOTHING RETURNING id`)).rows.map(row=>row.id);
  await loginAsSeededUser(page,"viewer",viewer.id);
  expect((await readBrowserApi(page, `/api/export-jobs/${old.id}`)).status()).toBe(200);
  expect((await readBrowserApi(page, `/api/export-jobs/${job.id}`)).status()).toBe(404);
  const saved=(await pool.query("SELECT row_to_json(p) AS row FROM permissions p WHERE role='viewer' AND resource='suppliers' AND permission_type='read'")).rows;
  await pool.query("DELETE FROM permissions WHERE role='viewer' AND resource='suppliers' AND permission_type='read'");
  try{expect((await readBrowserApi(page, `/api/export-jobs/${old.id}`)).status()).toBe(403);}
  finally{
    if(saved.length)await pool.query("INSERT INTO permissions SELECT * FROM json_populate_recordset(NULL::permissions,$1::json) ON CONFLICT DO NOTHING",[JSON.stringify(saved.map(row=>row.row))]);
    if(extraGrants.length)await pool.query("DELETE FROM permissions WHERE id=ANY($1::int[])",[extraGrants]);
  }
});
