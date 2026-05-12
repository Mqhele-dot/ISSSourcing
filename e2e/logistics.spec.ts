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
    await expect(page.getByTestId("logistics-eta-from")).toBeVisible();
    await expect(page.getByTestId("logistics-eta-to")).toBeVisible();
    await expect(page.getByTestId("logistics-tracking-filter")).toBeVisible();
    await expect(page.getByTestId("logistics-results-count")).toBeVisible();
    await expect(page.getByTestId("logistics-refresh-button")).toBeVisible();
    await expect(page.getByTestId("logistics-export-button")).toBeVisible();

    const row = page.getByTestId("logistics-shipment-row").first();
    if (await row.count()) {
      await expect(row).toBeVisible();
      await row.click();
      await expect(page).toHaveURL(/\/operations\/logistics\/\d+/, { timeout: 15_000 });
      await expect(page.getByTestId("logistics-detail-summary")).toBeVisible({ timeout: 20_000 });
    }
  });
});
