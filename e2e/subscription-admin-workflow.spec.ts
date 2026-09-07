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

async function ensureTestUser(username: string, role: string): Promise<number> {
  const password = await hashPassword(TEST_PASSWORD);
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        username, password, email, full_name, role,
        active, email_verified, default_organization_id, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, 1, NOW())
      ON CONFLICT (username) DO UPDATE SET
        password = EXCLUDED.password,
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        active = TRUE,
        email_verified = TRUE,
        default_organization_id = 1,
        updated_at = NOW()
      RETURNING id
    `,
    [username, password, `${username}@example.com`, `E2E ${username}`, role],
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

async function snapshotOrgSettings() {
  const result = await pool.query(
    `
      SELECT plan_tier, subscription_status, billing_provider, billing_customer_id,
             billing_subscription_id, current_period_start, current_period_end,
             trial_ends_at, cancel_at_period_end, usage_snapshot
      FROM organization_settings
      WHERE organization_id = 1
    `,
  );
  return result.rows[0] ?? null;
}

async function restoreOrgSettings(snapshot: Record<string, unknown> | null) {
  if (!snapshot) return;
  await pool.query(
    `
      INSERT INTO organization_settings (
        organization_id, plan_tier, subscription_status, billing_provider,
        billing_customer_id, billing_subscription_id, current_period_start,
        current_period_end, trial_ends_at, cancel_at_period_end, usage_snapshot,
        last_billing_sync_at, updated_at
      )
      VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      ON CONFLICT (organization_id) DO UPDATE SET
        plan_tier = EXCLUDED.plan_tier,
        subscription_status = EXCLUDED.subscription_status,
        billing_provider = EXCLUDED.billing_provider,
        billing_customer_id = EXCLUDED.billing_customer_id,
        billing_subscription_id = EXCLUDED.billing_subscription_id,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        trial_ends_at = EXCLUDED.trial_ends_at,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        usage_snapshot = EXCLUDED.usage_snapshot,
        last_billing_sync_at = NOW(),
        updated_at = NOW()
    `,
    [
      snapshot.plan_tier,
      snapshot.subscription_status,
      snapshot.billing_provider,
      snapshot.billing_customer_id,
      snapshot.billing_subscription_id,
      snapshot.current_period_start,
      snapshot.current_period_end,
      snapshot.trial_ends_at,
      snapshot.cancel_at_period_end,
      snapshot.usage_snapshot ?? {},
    ],
  );
}

test.describe.configure({ mode: "serial" });

test.describe("subscription admin workflow", () => {
  let snapshot: Record<string, unknown> | null = null;
  let adminUserId: number;
  let viewerUserId: number;

  test.beforeAll(async () => {
    snapshot = await snapshotOrgSettings();
    viewerUserId = await ensureTestUser("e2e_subscription_viewer", "viewer");
    const admin = await pool.query<{ id: number }>("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
    if (!admin.rows[0]) throw new Error("Seeded admin user is required for subscription E2E proof.");
    adminUserId = admin.rows[0].id;
    const adminCookie = (await loginForTests("admin", TEST_PASSWORD)) ?? "";
    const starter = await apiJsonRequest("/subscription/change-plan", {
      method: "POST",
      cookie: adminCookie,
      body: { planTier: "starter", reason: "subscription_e2e_setup" },
    });
    expect(starter.status).toBe(200);
  });

  test.afterAll(async () => {
    await restoreOrgSettings(snapshot);
    await pool.end().catch(() => undefined);
  });

  test("admin can view plans, usage, locked features, and change plan in local mode", async ({ page }) => {
    await loginAs(page, "admin", adminUserId);
    await page.goto("/admin/subscription", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("subscription-admin-page")).toBeVisible();
    await expect(page.getByText(/Separate from AP billing/i)).toBeVisible();

    for (const plan of ["starter", "standard", "growth", "enterprise"]) {
      await expect(page.getByTestId(`subscription-plan-${plan}`)).toBeVisible();
    }

    await expect(page.getByRole("heading", { name: /Current plan/i })).toBeVisible();
    await expect(page.getByText(/Users/i).first()).toBeVisible();
    await expect(page.getByText(/Upgrade/i).first()).toBeVisible();
    await expect(page.getByText(/Exports/i).first()).toBeVisible();

    await page.getByTestId("subscription-change-plan-standard").click();
    await expect(page.getByText("Subscription updated", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("subscription-change-plan-standard")).toHaveText("Current plan", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("subscription-change-plan-standard")).toBeDisabled();
  });

  test("viewer can inspect subscription state but cannot manage lifecycle", async ({ page }) => {
    await loginAs(page, "e2e_subscription_viewer", viewerUserId);
    await page.goto("/admin/subscription", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("subscription-admin-page")).toBeVisible();
    await expect(page.getByTestId("subscription-permission-denied")).toContainText(
      "You need settings:configure permission to manage subscription.",
    );
    await expect(page.getByTestId("subscription-billing-portal")).toBeDisabled();
    await expect(page.getByTestId("subscription-change-plan-growth")).toBeDisabled();
    await expect(page.getByTestId("subscription-start-trial")).toBeDisabled();
    await expect(page.getByTestId("subscription-cancel")).toBeDisabled();

    const viewerCookie = (await loginForTests("e2e_subscription_viewer", TEST_PASSWORD)) ?? "";
    const denied = await apiJsonRequest("/subscription/change-plan", {
      method: "POST",
      cookie: viewerCookie,
      body: { planTier: "growth", reason: "viewer_denied" },
    });
    expect(denied.status).toBe(403);
  });
});
