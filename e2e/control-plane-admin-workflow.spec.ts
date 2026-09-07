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

async function expectSettingsAudit(companyName: string) {
  const row = await expect
    .poll(async () => {
      const result = await pool.query<{
        after_company_name: string | null;
        after_currency_code: string | null;
        event_hash: string | null;
      }>(
        `
          SELECT
            details -> 'after' ->> 'companyName' AS after_company_name,
            details -> 'after' ->> 'currencyCode' AS after_currency_code,
            event_hash
          FROM audit_logs
          WHERE action = 'SETTINGS_UPDATED'
            AND resource_type = 'settings'
          ORDER BY id DESC
          LIMIT 1
        `,
      );
      return result.rows[0] ?? null;
    })
    .toMatchObject({
      after_company_name: companyName,
      after_currency_code: "ZAR",
    });
  expect(row?.event_hash).toBeTruthy();
}

test.describe.configure({ mode: "serial" });

test.describe("control-plane production controls", () => {
  let requesterUserId: number;
  let adminCookie = "";

  test.beforeAll(async () => {
    requesterUserId = await ensureTestUser("e2e_control_requester", "viewer", "Requester");
  });

  test("admin can change safe settings and requester cannot", async ({ page }) => {
    await loginAs(page, "admin", 1);
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("settings-control-plane")).toBeVisible();

    const companyName = `InvTrack Control E2E ${Date.now()}`;
    await page.getByTestId("settings-control-company-name").fill(companyName);
    await page.getByTestId("settings-control-currency").click();
    await page.getByRole("option", { name: "ZAR" }).click();
    await page.getByTestId("settings-control-low-stock").fill("12");
    await page.getByTestId("settings-control-save").click();
    await expect(page.getByText("Settings updated", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expectActivity("SETTINGS_UPDATED", "settings");
    await expectSettingsAudit(companyName);

    adminCookie = (await loginForTests("admin", TEST_PASSWORD)) ?? "";
    const invalidCurrency = await apiJsonRequest("/settings", {
      method: "PUT",
      cookie: adminCookie,
      body: { currencyCode: "ZZZ" },
    });
    expect(invalidCurrency.status).toBe(400);
    expect(invalidCurrency.text).toContain("INVALID_CURRENCY");

    await loginAs(page, "e2e_control_requester", requesterUserId);
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
    await loginAs(page, "admin", 1);
    await page.goto("/admin/user-roles", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("user-roles-page")).toBeVisible();
    await expect(page.getByTestId("role-manager-users-card")).toBeVisible();
    await expect(page.getByTestId("role-user-row-admin")).toBeVisible();

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
    await loginAs(page, "admin", 1);
    await page.goto("/finance/approval-policies", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("approval-policies-page")).toBeVisible();

    const policyName = `Control plane E2E policy ${Date.now()}`;
    await page.getByTestId("approval-policy-name").fill(policyName);
    await page.getByTestId("approval-policy-min").fill("2000001");
    await page.getByTestId("approval-policy-max").fill("2000100");
    await page.getByTestId("approval-policy-level").fill("1");
    await page.getByTestId("approval-policy-save").click();
    await expect(page.getByText("Policy created", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("cell", { name: policyName, exact: true })).toBeVisible();
    await expectActivity("APPROVAL_POLICY_CREATED", "approval_policy");

    await loginAs(page, "e2e_control_requester", requesterUserId);
    await page.goto("/finance/approval-policies", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("approval-policies-denied")).toBeVisible();
    await expect(page.getByTestId("approval-policy-save")).toBeDisabled();
  });
});
