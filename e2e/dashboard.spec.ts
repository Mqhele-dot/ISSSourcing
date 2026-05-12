import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

const CONTROL_TOWER = "/operations/control-tower";

test.describe("Control Tower dashboard", () => {
  test("executive dashboard loads with charts and filters", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoAuthed(page, CONTROL_TOWER);
    await expect(page.getByTestId("control-tower-page")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("dashboard-kpi-inventory-value")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dashboard-kpi-low-stock")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-open-requisitions")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-open-pos")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-delayed-shipments")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-ap-due")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-exceptions")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-supplier-risk")).toBeVisible();

    await expect(page.getByTestId("dashboard-procurement-pipeline-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-inventory-health-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-stock-value-category-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-ap-aging-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-logistics-risk-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-supplier-performance-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-operations-trend-chart")).toBeVisible();

    await expect(page.getByTestId("dashboard-needs-attention-panel")).toBeVisible();
    await expect(page.getByTestId("dashboard-recent-activity-panel")).toBeVisible();

    await page.getByTestId("dashboard-refresh-button").click();
    await expect(page.getByTestId("control-tower-page")).toBeVisible();

    await page.getByTestId("dashboard-date-range-filter").click();
    await page.getByRole("option", { name: /last 30 days/i }).click();
    await expect(page.getByTestId("dashboard-procurement-pipeline-chart")).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("control-tower-page")).toBeVisible();
  });
});
