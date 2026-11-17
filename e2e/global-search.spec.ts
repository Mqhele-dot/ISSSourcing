import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("global search", () => {
  test("header search returns live results and navigates to the selected record", async ({ page }) => {
    await gotoAuthed(page, "/operations/control-tower");
    const input = page.getByTestId("global-search-input");
    await expect(input).toBeVisible({ timeout: 20_000 });
    await input.fill("Tech Solutions");
    await expect(page.getByTestId("global-search-results")).toBeVisible();
    const supplierResult = page.getByTestId("global-search-result-supplier").first();
    await expect(supplierResult).toContainText("Tech Solutions Inc.");
    await supplierResult.click();
    await expect(page).toHaveURL(/\/procurement\/suppliers\/\d+$/);
    await expect(page.getByTestId("supplier-detail-page")).toBeVisible({ timeout: 20_000 });
  });
});
