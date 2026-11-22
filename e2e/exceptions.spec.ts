import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

const EXCEPTIONS = "/operations/exceptions";

test.describe("Operational exceptions", () => {
  test("list page filters and table", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoAuthed(page, EXCEPTIONS);

    await expect(page.getByTestId("exceptions-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("exception-filter-severity")).toBeVisible();
    await expect(page.getByTestId("exception-filter-status")).toBeVisible();
    await expect(page.getByTestId("exception-filter-type")).toBeVisible();
    await expect(page.getByTestId("exceptions-run-checks")).toBeVisible();

    const row = page.getByTestId("exception-list-row").first();
    if (await row.count()) {
      await row.click();
      await expect(page.getByTestId("exception-detail-page")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("exception-detail-incident")).toBeVisible();
    }
  });
});
