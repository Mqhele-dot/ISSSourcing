import { expect, test } from "@playwright/test";
import { pool } from "../server/db";
import { seedCustomPermissionUser } from "../scripts/runtime-fixtures/expanded-security-fixtures";
import { loginAsSeededUser, requireDisposableE2eDatabase } from "./wave7-helpers";

test.describe.configure({ mode: "serial" });

test.describe("approval policy browser evidence", () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  const entityType = `wave7_ui_${suffix}`;
  let policyId = 0;
  let viewerUserId = 0;

  test.beforeAll(async () => {
    requireDisposableE2eDatabase();
    const base = await pool.query<{ id: number }>(
      `INSERT INTO approval_policies (
         organization_id, name, entity_type, amount_min, amount_max, approval_level,
         approver_role, is_active, version, created_at, updated_at
       ) VALUES
         (1, $1, $3, 0, 1000, 1, 'manager', TRUE, 1, NOW(), NOW()),
         (1, $2, $3, 500, 1500, 1, 'admin', TRUE, 1, NOW(), NOW())
       RETURNING id`,
      [`Wave 7 UI Base ${suffix}`, `Wave 7 UI Overlap ${suffix}`, entityType],
    );
    policyId = base.rows[0].id;
    viewerUserId = await seedCustomPermissionUser({
      username: `w7_policy_viewer_${suffix}`,
      permissions: [{ resource: "approvals", actions: ["read"] }],
    });
  });

  test("overlap filter and ambiguous create expose controlled guidance", async ({ page }) => {
    await loginAsSeededUser(page, "admin", 1);
    await page.goto("/finance/approval-policies", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Search policy name or entity").fill(entityType);
    await page.getByTestId("approval-policy-overlap-filter").click();
    await expect(page.getByTestId("approval-policy-overlap-warning")).toBeVisible();
    await expect(page.getByTestId(`approval-policy-row-${policyId}`)).toBeVisible();

    await page.getByTestId("approval-policy-name").fill(`Wave 7 UI Rejected ${suffix}`);
    await page.getByTestId("approval-policy-min").fill("700");
    await page.getByTestId("approval-policy-max").fill("900");
    await page.getByTestId("approval-policy-level").fill("1");
    await page.getByTestId("approval-policy-save").click();
    await expect(page.getByText(/APPROVAL_POLICY_OVERLAP|overlap/i).last()).toBeVisible({ timeout: 10_000 });
  });

  test("stale edit offers reload and a valid edit increments the version", async ({ page }) => {
    await loginAsSeededUser(page, "admin", 1);
    await page.goto("/finance/approval-policies", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Search policy name or entity").fill(`Wave 7 UI Base ${suffix}`);
    await page.getByTestId(`approval-policy-edit-${policyId}`).click();
    await expect(page.getByTestId("approval-policy-edit-sheet")).toBeVisible();

    await pool.query(`UPDATE approval_policies SET version = version + 1, updated_at = NOW() WHERE id = $1`, [policyId]);
    await page.getByLabel("Name").last().fill(`Wave 7 UI stale attempt ${suffix}`);
    await page.getByTestId("approval-policy-change-reason").fill("Browser stale version proof");
    await page.getByTestId("approval-policy-edit-save").click();
    await expect(page.getByTestId("approval-policy-stale-guidance")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("approval-policy-edit-save")).toBeDisabled();
    await page.getByTestId("approval-policy-reload-latest").click();
    await expect(page.getByTestId("approval-policy-stale-guidance")).toBeHidden();

    await page.getByLabel("Name").last().fill(`Wave 7 UI corrected ${suffix}`);
    await page.getByTestId("approval-policy-change-reason").fill("Approved browser correction");
    await page.getByTestId("approval-policy-edit-save").click();
    await expect(page.getByText("Policy updated", { exact: true })).toBeVisible({ timeout: 10_000 });
    const updated = await pool.query<{ version: number }>(`SELECT version FROM approval_policies WHERE id = $1`, [policyId]);
    expect(updated.rows[0].version).toBe(3);
    const audit = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM activity_logs
       WHERE organization_id = 1 AND action = 'APPROVAL_POLICY_UPDATED'
         AND reference_type = 'approval_policy' AND reference_id = $1`,
      [policyId],
    );
    expect(Number(audit.rows[0].count)).toBeGreaterThan(0);
  });

  test("read-only policy user cannot mutate controls", async ({ page }) => {
    await loginAsSeededUser(page, `w7_policy_viewer_${suffix}`, viewerUserId);
    await page.goto("/finance/approval-policies", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("approval-policies-denied")).toBeVisible();
    await expect(page.getByTestId("approval-policy-save")).toBeDisabled();
    await expect(page.getByTestId(`approval-policy-edit-${policyId}`)).toBeDisabled();
    await expect(page.getByTestId(`approval-policy-delete-${policyId}`)).toBeDisabled();
  });
});
