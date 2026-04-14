import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("Analytics workspace", () => {
  test("legacy dashboard route redirects to canonical analytics overview", async ({ page }) => {
    await gotoAuthed(page, "/dashboard");
    await expect(page).toHaveURL(/\/analytics\/overview$/);
    await expect(page.getByRole("heading", { name: /analytics workspace/i })).toBeVisible({ timeout: 10000 });
  });

  test("overview exposes canonical analytics sections", async ({ page }) => {
    await gotoAuthed(page, "/analytics/overview");
    const sectionNav = page.getByLabel(/section navigation/i);
    await expect(page.getByRole("heading", { name: /analytics workspace/i })).toBeVisible({ timeout: 10000 });
    await expect(sectionNav.getByRole("link", { name: /^Overview$/ })).toBeVisible();
    await expect(sectionNav.getByRole("link", { name: /^Inventory$/ })).toBeVisible();
    await expect(sectionNav.getByRole("link", { name: /^Procurement$/ })).toBeVisible();
    await expect(sectionNav.getByRole("link", { name: /^Finance$/ })).toBeVisible();
    await expect(sectionNav.getByRole("link", { name: /^Logistics$/ })).toBeVisible();
  });

  test("workspace drilldown navigates to finance analytics", async ({ page }) => {
    await gotoAuthed(page, "/analytics/overview");
    await page.getByLabel(/section navigation/i).getByRole("link", { name: /^Finance$/ }).click();
    await expect(page).toHaveURL(/\/analytics\/finance$/);
    await expect(page.getByRole("heading", { name: /outstanding ap/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/pending ap approvals/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("workspace actions link to current product surfaces", async ({ page }) => {
    await gotoAuthed(page, "/analytics/overview");
    await expect(page.getByRole("link", { name: /open control tower/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /export center/i }).nth(1)).toBeVisible();
  });
});
