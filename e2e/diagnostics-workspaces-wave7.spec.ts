import { expect, test } from "@playwright/test";
import { pool } from "../server/db";
import { seedCustomPermissionUser } from "../scripts/runtime-fixtures/expanded-security-fixtures";
import { loginAsSeededUser, requireDisposableE2eDatabase } from "./wave7-helpers";

const workspaces = [
  "overview",
  "frontend",
  "backend",
  "business",
  "integrations",
  "consistency",
  "notifications",
  "security",
  "audit",
] as const;

test.describe.configure({ mode: "serial" });

test.describe("diagnostics workspace browser evidence", () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  let unauthorizedUserId = 0;

  test.beforeAll(async () => {
    requireDisposableE2eDatabase();
    await pool.query(
      `INSERT INTO export_jobs (
         organization_id, created_by, dataset, format, filters, status, last_error, created_at, updated_at
       ) VALUES (1, 1, 'purchase_orders', 'xlsx', '{}'::jsonb, 'failed',
         '{"code":"W7_DIAGNOSTICS_BROWSER","message":"Controlled export failure"}', NOW(), NOW())`,
    );
    await pool.query(
      `INSERT INTO notifications (
         organization_id, user_id, type, title, body, occurrence_count, last_occurred_at, created_at
       )
       SELECT 1, 1, 'w7_browser_backlog', 'Wave 7 browser backlog', 'Controlled evidence', 1, NOW(), NOW()
       FROM generate_series(1, 101)`,
    );
    await pool.query(
      `INSERT INTO approval_policies (
         organization_id, name, entity_type, amount_min, amount_max, approval_level,
         approver_role, is_active, version, created_at, updated_at
       ) VALUES
         (1, $1, $3, 0, 1000, 1, 'manager', TRUE, 1, NOW(), NOW()),
         (1, $2, $3, 500, 1500, 1, 'admin', TRUE, 1, NOW(), NOW())`,
      [`W7 browser diagnostics A ${suffix}`, `W7 browser diagnostics B ${suffix}`, `w7_browser_diag_${suffix}`],
    );
    await pool.query(
      `INSERT INTO suppliers (
         organization_id, name, status, contact_name, email, default_currency_code, updated_at
       ) VALUES (1, $1, 'active', 'Runtime Test', $2, 'ZAR', NOW())`,
      [`Runtime Supplier browser ${suffix}`, `w7-browser-${suffix}@example.test`],
    );
    unauthorizedUserId = await seedCustomPermissionUser({
      username: `w7_diagnostics_denied_${suffix}`,
      permissions: [{ resource: "reports", actions: ["read"] }],
    });
  });

  for (const workspace of workspaces) {
    test(`${workspace} opens from URL state with distinct controlled content`, async ({ page }) => {
      await loginAsSeededUser(page, "admin", 1);
      await page.goto(`/admin/system-diagnostics?view=${workspace}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId(`diagnostics-tab-${workspace}`)).toHaveAttribute("data-state", "active");
      await expect(page.getByTestId(`diagnostics-workspace-${workspace}`)).toBeVisible();
      await expect(page.getByTestId(`diagnostics-visible-count-${workspace}`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId(`diagnostics-filters-${workspace}`)).toBeVisible();
    });
  }

  test("known failures are categorized, filtered, probed, and safely redacted", async ({ page }) => {
    await loginAsSeededUser(page, "admin", 1);
    await page.goto("/admin/system-diagnostics?view=integrations", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("diagnostic-finding-EXPORT_JOB_FAILURES")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("diagnostics-status-filter-integrations").click();
    await page.getByRole("option", { name: "Failed" }).click();
    await expect(page.getByTestId("diagnostic-finding-EXPORT_JOB_FAILURES")).toBeVisible();
    await page.getByTestId("diagnostics-run-probes-integrations").click();
    await expect(page.getByTestId("diagnostics-run-probes-integrations")).toBeEnabled({ timeout: 15_000 });

    await page.getByTestId("diagnostics-tab-notifications").click();
    await expect(page.getByTestId("diagnostic-finding-NOTIFICATION_BACKLOG")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("diagnostics-tab-business").click();
    await expect(page.getByTestId("diagnostic-finding-APPROVAL_POLICY_OVERLAP")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("diagnostics-tab-consistency").click();
    await expect(page.getByTestId("diagnostic-finding-TEST_FIXTURE_POLLUTION")).toBeVisible({ timeout: 15_000 });

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/DATABASE_URL|SESSION_SECRET|STRIPE_SECRET|SELECT\s+\*|INSERT\s+INTO|at\s+\w+\s+\([^)]*:\d+:\d+\)/i);
    await expect(page.getByText(/Next step:/i).first()).toBeVisible();
  });

  test("unauthorized user receives a controlled denial", async ({ page }) => {
    await loginAsSeededUser(page, `w7_diagnostics_denied_${suffix}`, unauthorizedUserId);
    await page.goto("/admin/system-diagnostics?view=overview", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/permission|not authorized|access denied|forbidden/i).first()).toBeVisible({ timeout: 15_000 });
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("SELECT *");
  });
});
