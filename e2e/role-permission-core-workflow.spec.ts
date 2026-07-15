import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { apiJsonRequest, loginForTests } from "../scripts/test-http.ts";
import {
  createSentWorkflowPo,
  ensureWorkflowFixture,
  type WorkflowFixture,
} from "../scripts/workflow-proof-fixtures.ts";
import { pool } from "../server/db.ts";

const scryptAsync = promisify(scrypt);
const TEST_PASSWORD = "Admin123!";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${hash.toString("hex")}.${salt}`;
}

async function ensureTestUser(username: string, role: string, workPersona: string): Promise<number> {
  const password = await hashPassword(TEST_PASSWORD);
  const email = `${username}@example.com`;
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        username, password, email, full_name, role, work_persona,
        active, email_verified, default_organization_id, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE, 1, NOW())
      ON CONFLICT (username) DO UPDATE SET
        password = EXCLUDED.password,
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        work_persona = EXCLUDED.work_persona,
        active = TRUE,
        email_verified = TRUE,
        default_organization_id = 1,
        updated_at = NOW()
      RETURNING id
    `,
    [username, password, email, `E2E ${workPersona}`, role, workPersona],
  );

  await pool.query(
    `
      INSERT INTO organization_members (organization_id, user_id, role, application_role)
      VALUES (1, $1, 'member', $2)
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        application_role = EXCLUDED.application_role
    `,
    [result.rows[0].id, role],
  );
  return result.rows[0].id;
}

async function loginAs(page: Page, username: string, userId: number) {
  await page.addInitScript((id) => {
    window.localStorage.setItem(`invtrack:first-run-coach:v1:${id}`, "done");
  }, userId);
  await page.context().clearCookies();
  await page.goto("about:blank");
  await page.goto("/auth", { waitUntil: "load" });
  const usernameInput = page.getByPlaceholder("Enter your username");
  await expect(usernameInput).toBeVisible({ timeout: 25_000 });
  await usernameInput.fill(username);
  await page.getByPlaceholder("Enter your password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("core workflow permission controls", () => {
  let receiverUserId: number;
  let requesterUserId: number;
  let apManagerUserId: number;
  let receiverFixture: WorkflowFixture;
  let receiverPoNumber: string;
  let requesterPoNumber: string;

  test.beforeAll(async () => {
    receiverUserId = await ensureTestUser("e2e_receiver", "warehouse_staff", "Warehouse receiver");
    requesterUserId = await ensureTestUser("e2e_requester", "viewer", "Requester");
    apManagerUserId = await ensureTestUser("e2e_ap_manager", "manager", "AP user");

    const adminCookie = (await loginForTests("admin", TEST_PASSWORD)) ?? "";
    expect(adminCookie).toBeTruthy();

    receiverFixture = await ensureWorkflowFixture("perm-rec");
    receiverPoNumber = (await createSentWorkflowPo(adminCookie, receiverFixture, 1)).poNumber;
    const requesterFixture = await ensureWorkflowFixture("perm-deny");
    requesterPoNumber = (await createSentWorkflowPo(adminCookie, requesterFixture, 1)).poNumber;
  });

  test("warehouse receiver can access and post receiving while requester is blocked", async ({ page }) => {
    await loginAs(page, "e2e_receiver", receiverUserId);
    await page.goto(`/m/receive/${encodeURIComponent(receiverPoNumber)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mobile-receive-detail")).toBeVisible();

    await page.getByTestId("mobile-receive-warehouse-select").click();
    await page.getByRole("option", { name: new RegExp(`Workflow Warehouse ${receiverFixture.suffix}`) }).click();
    await page.getByTestId("mobile-receive-aisle-select").click();
    await page.getByRole("option", { name: "A1" }).click();
    await page.getByTestId("mobile-receive-bin-select").click();
    await page.getByRole("option", { name: "B1" }).click();
    await page.getByLabel("Receiver name").fill("E2E Warehouse Receiver");
    await page.getByLabel("GRN number").fill(`GRN-PERM-${receiverFixture.suffix}`);
    await page.getByTestId(`mobile-receive-qty-${receiverFixture.sku}`).fill("1");
    await expect(page.getByTestId("mobile-receive-post-button")).toBeEnabled();
    await page.getByTestId("mobile-receive-post-button").click();
    await expect(page.getByText("Receipt posted", { exact: true })).toBeVisible({ timeout: 20_000 });

    const requesterCookie = (await loginForTests("e2e_requester", TEST_PASSWORD)) ?? "";
    const denied = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(requesterPoNumber)}/receive`, {
      method: "POST",
      cookie: requesterCookie,
      body: {
        receiverName: "Requester should not receive",
        warehouseLocation: "A1-B1",
        grnNumber: "GRN-DENIED",
        lines: [],
      },
    });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.json)).toContain("PO_RECEIVE_FORBIDDEN");

    const requesterPage = await page.context().newPage();
    await loginAs(requesterPage, "e2e_requester", requesterUserId);
    await requesterPage.goto(`/m/receive/${encodeURIComponent(requesterPoNumber)}`, { waitUntil: "domcontentloaded" });
    await expect(requesterPage.getByTestId("mobile-receive-detail")).toBeVisible();
    await expect(requesterPage.getByTestId("mobile-receive-post-button")).toBeDisabled();
  });

  test("AP and master-data controls enforce role boundaries", async ({ page }) => {
    await loginAs(page, "e2e_ap_manager", apManagerUserId);
    await page.goto("/finance/accounts-payable/payments", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("accounts-payable-page")).toBeVisible();
    await expect(page.getByText(/Create payment batch/i)).toBeVisible();

    const requesterCookie = (await loginForTests("e2e_requester", TEST_PASSWORD)) ?? "";
    const releaseDenied = await apiJsonRequest("/ap/payment-batches/1/release", {
      method: "POST",
      cookie: requesterCookie,
      body: { comment: "Requester should not release payments" },
    });
    expect(releaseDenied.status).toBe(403);

    const mdDenied = await apiJsonRequest("/currencies", {
      method: "POST",
      cookie: requesterCookie,
      body: {
        code: `ZZ${Date.now().toString().slice(-1)}`,
        name: "Denied test currency",
        symbol: "Z",
        exchangeRateToZar: 1,
        active: true,
      },
    });
    expect(mdDenied.status).toBe(403);

    const settingsDenied = await apiJsonRequest("/settings", {
      method: "PUT",
      cookie: requesterCookie,
      body: {},
    });
    expect(settingsDenied.status).toBe(403);

    await loginAs(page, "admin", 1);
    await page.goto("/admin/master-data", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("master-data-page")).toBeVisible();

    await page.goto("/admin/user-roles", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("user-roles-page")).toBeVisible();
    await expect(page.getByTestId("role-manager-card")).toBeVisible();

    await page.context().clearCookies();
    const anonymous = await page.context().newPage();
    await anonymous.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expect(anonymous).toHaveURL(/\/auth(?:\?|$)/);
  });
});
