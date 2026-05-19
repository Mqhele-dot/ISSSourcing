import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

const LOGISTICS = "/operations/logistics";

test.describe("Logistics workspace", () => {
  test("toolbar filters and results count render", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoAuthed(page, LOGISTICS);

    await expect(page.getByTestId("logistics-status-filter")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("logistics-po-filter")).toBeVisible();
    await expect(page.getByTestId("logistics-carrier-filter")).toBeVisible();
    await expect(page.getByTestId("logistics-risk-filter")).toBeVisible();
    await expect(page.getByTestId("logistics-tracking-filter")).toBeVisible();
    await page.getByTestId("logistics-more-filters").click();
    await expect(page.getByTestId("logistics-eta-from")).toBeVisible();
    await expect(page.getByTestId("logistics-eta-to")).toBeVisible();
    await expect(page.getByTestId("logistics-supplier-filter")).toBeVisible();
    await expect(page.getByTestId("logistics-clear-filters")).toBeVisible();
    await expect(page.getByTestId("logistics-results-count")).toBeVisible();
    await expect(page.getByTestId("logistics-refresh-button")).toBeVisible();
    await expect(page.getByTestId("logistics-export-button")).toBeVisible();

    await page.getByTestId("logistics-status-filter").fill("trans");
    await expect(page.getByTestId("logistics-active-filters")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("logistics-clear-filters").click();
    await expect(page.getByTestId("logistics-active-filters")).toHaveCount(0);

    const row = page.getByTestId("logistics-shipment-row").first();
    if (await row.count()) {
      await expect(row).toBeVisible();
      await row.click();
      await expect(page).toHaveURL(/\/operations\/logistics\/\d+/, { timeout: 15_000 });
      await expect(page.getByTestId("logistics-detail-summary")).toBeVisible({ timeout: 20_000 });
    }
  });
});
