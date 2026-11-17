import { expect, test } from "@playwright/test";
import { pool } from "../server/db";
import { gotoAuthed } from "./test-helpers";
import { apiJsonRequest, loginForTests } from "../scripts/test-http";
import { createAndConvertMixedLineRequisition, mixedLineBody, seedProcurementEvidenceFixture, unwrapData } from "../scripts/runtime-fixtures/procurement-line-evidence-fixture";
import { requireDisposableE2eDatabase } from "./wave7-helpers";

test("Action Inbox, reorder planning, and supplier history remain connected", async ({ page }) => {
  const browserErrors: string[] = [];
  await gotoAuthed(page, "/operations/action-inbox");
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await expect(page.getByTestId("action-inbox-page")).toBeVisible();
  const inbox = await page.request.get("/api/v2/action-inbox?state=active&page=1&pageSize=25");
  expect(inbox.ok()).toBeTruthy();
  const inboxData = (await inbox.json()).data;
  expect(inboxData.items.length).toBeLessThanOrEqual(25);
  await expect(page.getByText(`${inboxData.total} active item(s)`)).toBeVisible();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText(/historical item\(s\)/)).toBeVisible();

  await page.goto("/inventory/reorder", { waitUntil: "load" });
  await expect(page.getByText("Demand-based suggestions")).toBeVisible();
  await expect(page.getByText(/do not confirm quality-eligible stock/)).toBeVisible();
  const planning = await page.request.get("/api/v2/inventory/reorder-suggestions?page=1&pageSize=25&lookbackDays=90");
  expect(planning.ok()).toBeTruthy();
  const planningData = (await planning.json()).data;
  expect(planningData.items.length).toBeLessThanOrEqual(25);
  await expect(page.getByText(`${planningData.total} item(s).`, { exact: false })).toBeVisible();

  const supplier = await pool.query<{ id: number }>("SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1");
  expect(supplier.rowCount).toBeGreaterThan(0);
  await page.goto(`/procurement/suppliers/${supplier.rows[0].id}`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Communication history" })).toBeVisible();
  const timeline = await page.request.get(`/api/v2/suppliers/${supplier.rows[0].id}/communications?page=1&pageSize=25`);
  expect(timeline.ok()).toBeTruthy();
  expect((await timeline.json()).data.items.length).toBeLessThanOrEqual(25);
  if (browserErrors.length) console.log("Small-business browser console errors:", browserErrors);
  expect(browserErrors).toEqual([]);
});

test("a supplier contact note appears on its profile and in the tenant-scoped timeline", async ({ page }) => {
  const supplier = await pool.query<{ id: number }>("SELECT id FROM suppliers WHERE organization_id=1 ORDER BY id LIMIT 1");
  expect(supplier.rowCount).toBeGreaterThan(0);
  const id = supplier.rows[0].id;
  const uniqueNote = `Release-gate contact ${Date.now()}`;
  await gotoAuthed(page, `/procurement/suppliers/${id}`);
  await expect(page.getByRole("heading", { name: "Communication history" })).toBeVisible();
  await page.getByRole("textbox", { name: "Contact summary" }).fill(uniqueNote);
  const [saveResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/v2/suppliers/${id}/communications/notes`) && response.request().method() === "POST"),
    page.getByRole("button", { name: "Save contact note" }).click(),
  ]);
  expect(saveResponse.status(), await saveResponse.text()).toBe(201);
  await expect(page.locator("ol").getByText(uniqueNote, { exact: false })).toBeVisible();
  const timeline = await page.request.get(`/api/v2/suppliers/${id}/communications?page=1&pageSize=25`);
  expect((await timeline.json()).data.items.some((event: { summary: string }) => event.summary.includes(uniqueNote))).toBeTruthy();
});

test("company setup immediately changes the server-derived checklist", async ({ page }) => {
  await gotoAuthed(page, "/admin/company-setup");
  await expect(page.getByTestId("company-setup-page")).toBeVisible();
  const before = await page.request.get("/api/onboarding/setup-progress");
  expect(before.ok()).toBeTruthy();
  expect((await before.json()).steps).toHaveLength(5);
  await page.getByLabel("Trading/display name *").fill("Release Gate Company");
  await page.getByLabel("Registered legal name *").fill("Release Gate Company (Pty) Ltd");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(page.getByText("Company profile saved").first()).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get("/api/onboarding/setup-progress");
    return (await response.json()).steps.find((step: { id: string }) => step.id === "company")?.complete;
  }).toBe(true);
});

test("recent PO repeat opens a new requisition draft without inherited approval state", async ({ page }) => {
  await gotoAuthed(page, "/procurement/requisitions/new");
  const recentResponse = await page.request.get("/api/v2/procurement/purchase-orders/recent");
  expect(recentResponse.ok()).toBeTruthy();
  const recent = (await recentResponse.json()).data.items as Array<{ id: number; orderNumber: string }>;
  expect(recent.length).toBeGreaterThan(0);
  await page.goto(`/procurement/requisitions/new?copyPoFrom=${recent[0].id}`, { waitUntil: "load" });
  await expect(page.getByTestId("requisition-form-page")).toContainText(`Repeated from PO ${recent[0].orderNumber}`);
  await expect(page.getByTestId("requisition-form-page")).toContainText("new requisition draft");
});

test("historical requisition and PO copies save as independent drafts and enter approval work", async ({ page }) => {
  test.setTimeout(120_000);
  requireDisposableE2eDatabase();
  const fixture = await seedProcurementEvidenceFixture();
  const adminCookie = await loginForTests("admin", "Admin123!");
  const plannerCookie = await loginForTests("planner", "Admin123!");
  expect(adminCookie).toBeTruthy();
  expect(plannerCookie).toBeTruthy();
  const source = await createAndConvertMixedLineRequisition(adminCookie!, fixture);
  await gotoAuthed(page, "/procurement/requisitions/new");

  for (const copy of [
    { query: `copyFrom=${source.requisition.id}`, label: `Copied from ${source.requisition.requisitionNumber}` },
    { query: `copyPoFrom=${source.purchaseOrder.id}`, label: `Repeated from PO ${source.purchaseOrder.orderNumber}` },
  ]) {
    await page.goto(`/procurement/requisitions/new?${copy.query}`, { waitUntil: "load" });
    await expect(page.getByTestId("requisition-form-page")).toContainText(copy.label);
    await expect(page.getByTestId("requisition-line-qty-0")).toHaveValue("2");
    await expect(page.getByTestId("requisition-save-button")).toBeEnabled();
    const [savedResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/purchase-requisitions") && response.request().method() === "POST"),
      page.getByTestId("requisition-save-button").click(),
    ]);
    expect(savedResponse.status(), await savedResponse.text()).toBe(201);
    const saved = unwrapData<{ id: number; requisitionNumber: string; status: string }>(await savedResponse.json(), "copied requisition");
    expect(saved.id).not.toBe(source.requisition.id);
    expect(saved.requisitionNumber).not.toBe(source.requisition.requisitionNumber);
    expect(saved.status).toBe("DRAFT");
    await expect(page).toHaveURL(/\/procurement\/requisitions$/);

    const evidence = await pool.query<{ status: string; approval_count: number; line_count: number }>(
      `SELECT r.status,
        (SELECT count(*)::int FROM approval_history h WHERE h.organization_id=r.organization_id AND h.entity_type='requisition' AND h.entity_id=r.id) AS approval_count,
        (SELECT count(*)::int FROM purchase_requisition_items i WHERE i.requisition_id=r.id) AS line_count
       FROM purchase_requisitions r WHERE r.organization_id=1 AND r.id=$1`, [saved.id],
    );
    expect(evidence.rows[0]).toMatchObject({ status: "DRAFT", approval_count: 0, line_count: 3 });

    const submitted = await apiJsonRequest(`/v2/procurement/requisitions/${saved.id}/submit`, { method: "POST", cookie: adminCookie!, body: {} });
    expect(submitted.status, JSON.stringify(submitted.json)).toBe(200);
    const inbox = await apiJsonRequest("/v2/action-inbox?state=active&page=1&pageSize=25", { cookie: plannerCookie! });
    expect(inbox.status).toBe(200);
    const work = unwrapData<{ items: Array<{ entityType: string; entityId: number; targetPath: string }> }>(inbox.json, "approval inbox");
    expect(work.items).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: "requisition", entityId: saved.id, targetPath: `/procurement/requisitions/${saved.id}` })]));

    const approved = await apiJsonRequest(`/v2/procurement/requisitions/${saved.id}/approve`, { method: "POST", cookie: plannerCookie!, body: {} });
    expect(approved.status, JSON.stringify(approved.json)).toBe(200);
    const after = await apiJsonRequest("/v2/action-inbox?state=active&page=1&pageSize=25", { cookie: plannerCookie! });
    const active = unwrapData<{ items: Array<{ entityId: number }> }>(after.json, "completed approval inbox");
    expect(active.items.some((item) => Number(item.entityId) === saved.id)).toBe(false);
  }

  const original = await pool.query<{ status: string }>("SELECT status FROM purchase_requisitions WHERE organization_id=1 AND id=$1", [source.requisition.id]);
  expect(original.rows[0].status).toMatch(/CONVERTED/i);
  const purchaseOrder = await pool.query<{ order_number: string }>("SELECT order_number FROM purchase_orders WHERE organization_id=1 AND id=$1", [source.purchaseOrder.id]);
  expect(purchaseOrder.rows[0].order_number).toBe(source.purchaseOrder.orderNumber);
});

test("stale copied Master Data blocks saving with a readable correction", async ({ page }) => {
  requireDisposableE2eDatabase();
  const fixture = await seedProcurementEvidenceFixture();
  const adminCookie = await loginForTests("admin", "Admin123!");
  const source = await createAndConvertMixedLineRequisition(adminCookie!, fixture);
  const created = await apiJsonRequest("/purchase-requisitions", { method: "POST", cookie: adminCookie!, body: mixedLineBody(fixture) });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const draft = unwrapData<{ id: number }>(created.json, "draft before Master Data change");
  await pool.query("UPDATE inventory_items SET status='inactive' WHERE organization_id=1 AND id=$1", [fixture.itemId]);
  await gotoAuthed(page, `/procurement/requisitions/new?copyFrom=${source.requisition.id}`);
  await expect(page.getByRole("alert").filter({ hasText: "original item is no longer available" })).toBeVisible();
  await expect(page.getByTestId("requisition-save-button")).toBeDisabled();
  await expect(page.getByText(/Complete required setup before saving/i)).toBeVisible();
  const submitted = await apiJsonRequest(`/v2/procurement/requisitions/${draft.id}/submit`, { method: "POST", cookie: adminCookie!, body: {} });
  expect(submitted.status).toBe(409);
  expect(JSON.stringify(submitted.json)).toMatch(/item that is no longer active/i);
  const stillDraft = await pool.query<{ status: string }>("SELECT status FROM purchase_requisitions WHERE organization_id=1 AND id=$1", [draft.id]);
  expect(stillDraft.rows[0].status).toBe("DRAFT");
});

test.describe("390px mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("Action Inbox and reorder planning fit the viewport", async ({ page }) => {
    await gotoAuthed(page, "/operations/action-inbox");
    await expect(page.getByTestId("action-inbox-page")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.goto("/inventory/reorder", { waitUntil: "load" });
    await expect(page.getByText("Demand-based suggestions")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
