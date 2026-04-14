import { test, expect } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("Reports", () => {
  test("legacy reports route redirects to canonical reports workspace", async ({ page }) => {
    await gotoAuthed(page, "/reports");
    await expect(page).toHaveURL(/\/analytics\/reports(?:\/inventory)?$/);
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible({ timeout: 10000 });
  });

  test("reports workspace renders export toolbar and default inventory preview", async ({ page }) => {
    await gotoAuthed(page, "/analytics/reports");
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /export report/i })).toBeVisible();
    await expect(page.getByText(/report preview/i)).toBeVisible();
    await expect(page.getByText(/items .* total value/i)).toBeVisible();
  });

  test("reports section nav switches to canonical purchase orders report route", async ({ page }) => {
    await gotoAuthed(page, "/analytics/reports");
    await page.getByLabel(/section navigation/i).getByRole("link", { name: /^Purchase orders$/i }).click();
    await expect(page).toHaveURL(/\/analytics\/reports\/purchase-orders$/);
    await expect(page.getByText(/purchase orders report/i)).toBeVisible({ timeout: 5000 });
  });
});
