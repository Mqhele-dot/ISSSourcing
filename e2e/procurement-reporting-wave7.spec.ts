import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import { pool } from "../server/db";
import { loginForTests } from "../scripts/test-http";
import {
  createAndConvertMixedLineRequisition,
  seedProcurementEvidenceFixture,
} from "../scripts/runtime-fixtures/procurement-line-evidence-fixture";
import { loginAsSeededUser, requireDisposableE2eDatabase } from "./wave7-helpers";

test.describe.configure({ mode: "serial" });

test.describe("procurement reporting browser evidence", () => {
  let fixture: Awaited<ReturnType<typeof seedProcurementEvidenceFixture>>;
  let emptyNumber = "";

  test.beforeAll(async () => {
    requireDisposableE2eDatabase();
    fixture = await seedProcurementEvidenceFixture();
    const cookie = (await loginForTests("admin", "Admin123!")) ?? "";
    assert.ok(cookie);
    await createAndConvertMixedLineRequisition(cookie, fixture);
    for (let index = 0; index < 12; index += 1) {
      await createAndConvertMixedLineRequisition(cookie, fixture);
    }
    emptyNumber = `W7-UI-EMPTY-${fixture.suffix}`;
    await pool.query(
      `INSERT INTO purchase_requisitions (
         organization_id, requisition_number, requestor_id, status, supplier_id,
         department_id, currency_code, exchange_rate_to_zar, total_amount, justification
       ) VALUES (1, $1, 1, 'DRAFT', $2, $3, 'ZAR', 1, 0, 'Wave 7 browser no-line evidence')`,
      [emptyNumber, fixture.supplierId, fixture.departmentId],
    );
    await pool.query(
      `INSERT INTO export_jobs (
         organization_id, created_by, dataset, format, filters, status, last_error, created_at, updated_at
       ) VALUES (1, 1, 'purchase_requisitions', 'xlsx', '{}'::jsonb, 'failed',
         '{"code":"W7_BROWSER_EXPORT_FAILURE","message":"Controlled browser export failure"}', NOW(), NOW())`,
    );
  });

  test("line preview shows all line types, data-quality rows, and bounded paging", async ({ page }) => {
    await loginAsSeededUser(page, "admin", 1);
    await page.goto("/analytics/reports/purchase-requisitions", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reports-purchase_requisitions-line-preview")).toBeVisible();
    await expect(page.getByTestId("report-preview-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("report-line-catalog").first()).toBeVisible();
    await expect(page.getByTestId("report-line-non_stock").first()).toContainText("Temporary site consumables");
    await expect(page.getByTestId("report-line-service").first()).toContainText("Equipment calibration service");
    await expect(page.getByTestId("reports-purchase_requisitions-data-quality-warning")).toBeVisible();

    await page.getByTestId("reports-purchase_requisitions-page-size").click();
    await page.getByRole("option", { name: "10" }).click();
    await expect(page.getByTestId("reports-purchase_requisitions-next-page")).toBeEnabled();
    const firstStatus = await page.getByTestId("reports-purchase_requisitions-page-status").textContent();
    await page.getByTestId("reports-purchase_requisitions-next-page").click();
    await expect(page.getByTestId("reports-purchase_requisitions-page-status")).not.toHaveText(firstStatus ?? "");
    await expect(page.getByTestId("reports-purchase_requisitions-previous-page")).toBeEnabled();
  });

  test("report failure is controlled and appears in integration diagnostics", async ({ page }) => {
    await loginAsSeededUser(page, "admin", 1);
    await page.goto("/admin/system-diagnostics?view=integrations", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("diagnostics-workspace-integrations")).toBeVisible();
    await expect(page.getByTestId("diagnostic-finding-EXPORT_JOB_FAILURES")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("diagnostic-finding-EXPORT_JOB_FAILURES")).toContainText(/Next step:/i);
    const text = await page.getByTestId("diagnostic-finding-EXPORT_JOB_FAILURES").textContent();
    expect(text).not.toMatch(/SELECT\s|INSERT\s|password|DATABASE_URL|at\s+\w+\s+\(/i);
  });
});
