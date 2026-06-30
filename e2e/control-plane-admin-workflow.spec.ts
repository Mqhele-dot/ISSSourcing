import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { apiJsonRequest, loginForTests } from "../scripts/test-http.ts";
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

  await pool.query("DELETE FROM organization_members WHERE organization_id = 1 AND user_id = $1", [result.rows[0].id]);
  await pool.query(
    `
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (1, $1, 'member')
    `,
    [result.rows[0].id],
  );
  return result.rows[0].id;
}

async function loginAs(page: Page, username: string) {
  await page.context().clearCookies();
  await page.goto("/auth", { waitUntil: "load" });
  await expect(page.getByPlaceholder("Enter your username")).toBeVisible({ timeout: 25_000 });
  await page.getByPlaceholder("Enter your username").fill(username);
  await page.getByPlaceholder("Enter your password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20_000 });
}

async function expectActivity(action: string, referenceType: string) {
  await expect
    .poll(async () => {
      const result = await pool.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM activity_logs
          WHERE action = $1 AND reference_type = $2
        `,
        [action, referenceType],
      );
      return Number(result.rows[0]?.count ?? 0);
    })
    .toBeGreaterThan(0);
}

test.describe.configure({ mode: "serial" });

test.describe("control-plane production controls", () => {
  test.beforeAll(async () => {
    await ensureTestUser("e2e_control_requester", "viewer", "Requester");
  });

  test("admin can change safe settings and requester cannot", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("settings-control-plane")).toBeVisible();

    const companyName = `InvTrack Control E2E ${Date.now()}`;
    await page.getByTestId("settings-control-company-name").fill(companyName);
    await page.getByTestId("settings-control-currency").fill("ZAR");
    await page.getByTestId("settings-control-low-stock").fill("12");
    await page.getByTestId("settings-control-save").click();
    await expect(page.getByText(/settings updated/i)).toBeVisible({ timeout: 10_000 });
    await expectActivity("SETTINGS_UPDATED", "settings");

    await loginAs(page, "e2e_control_requester");
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("settings-control-denied")).toBeVisible();
    await expect(page.getByTestId("settings-control-save")).toBeDisabled();

    const requesterCookie = (await loginForTests("e2e_control_requester", TEST_PASSWORD)) ?? "";
    const denied = await apiJsonRequest("/settings", {
      method: "PUT",
      cookie: requesterCookie,
      body: { companyName: "Requester denied" },
    });
    expect(denied.status).toBe(403);
  });

  test("admin can view real user access and requester cannot update roles", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/user-roles", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("user-roles-page")).toBeVisible();
    await expect(page.getByTestId("role-manager-users-card")).toBeVisible();
    await expect(page.getByTestId("role-user-row-admin")).toBeVisible();

    const adminCookie = (await loginForTests("admin", TEST_PASSWORD)) ?? "";
    const requesterCookie = (await loginForTests("e2e_control_requester", TEST_PASSWORD)) ?? "";
    const users = await apiJsonRequest("/users", { cookie: adminCookie });
    const rows = Array.isArray(users.json) ? users.json : (users.json as { data?: Array<{ id: number; username: string }> })?.data ?? [];
    const requester = rows.find((row) => row.username === "e2e_control_requester");
    expect(requester?.id).toBeTruthy();

    const denied = await apiJsonRequest(`/users/${requester?.id}`, {
      method: "PUT",
      cookie: requesterCookie,
      body: { role: "admin" },
    });
    expect(denied.status).toBe(403);

    const updated = await apiJsonRequest(`/users/${requester?.id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { workPersona: `Control E2E ${Date.now()}` },
    });
    expect(updated.status).toBe(200);
    await expectActivity("USER_ACCESS_UPDATED", "user");
  });

  test("admin can create approval policy and audit captures it", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/finance/approval-policies", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("approval-policies-page")).toBeVisible();

    const policyName = `Control plane E2E policy ${Date.now()}`;
    await page.getByTestId("approval-policy-name").fill(policyName);
    await page.getByTestId("approval-policy-min").fill("2000001");
    await page.getByTestId("approval-policy-max").fill("2000100");
    await page.getByTestId("approval-policy-level").fill("1");
    await page.getByTestId("approval-policy-save").click();
    await expect(page.getByText(/policy created/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(policyName)).toBeVisible();
    await expectActivity("APPROVAL_POLICY_CREATED", "approval_policy");

    await loginAs(page, "e2e_control_requester");
    await page.goto("/finance/approval-policies", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("approval-policies-denied")).toBeVisible();
    await expect(page.getByTestId("approval-policy-save")).toBeDisabled();
  });
});
