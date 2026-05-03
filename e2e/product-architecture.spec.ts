import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("Product architecture", () => {
  test("legacy procurement and mobile routes redirect to canonical destinations", async ({ page }) => {
    await gotoAuthed(page, "/orders");
    await expect(page).toHaveURL(/\/procurement\/orders$/);

    await gotoAuthed(page, "/requisitions");
    await expect(page).toHaveURL(/\/procurement\/requisitions$/);

    await gotoAuthed(page, "/mobile/receive");
    await expect(page).toHaveURL(/\/m\/receive$/);
  });

  test("sidebar shows canonical product sections", async ({ page }) => {
    await gotoAuthed(page, "/analytics/overview");
    const sidebar = page.getByRole("complementary");
    await expect(page.getByText("Operations", { exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /^Inventory$/ })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /^Purchase orders$/i })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /^Accounts payable$/i })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /^Reports$/ })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /^Settings$/ })).toBeVisible();
    await expect(page.getByTestId("sidebar-get-educated")).toBeVisible();
  });

  test("analytics workspace drilldown uses canonical subroutes", async ({ page }) => {
    await gotoAuthed(page, "/analytics/overview");
    await expect(page.getByRole("heading", { name: /analytics workspace/i })).toBeVisible();
    await page.getByLabel(/section navigation/i).getByRole("link", { name: /^Inventory$/ }).click();
    await expect(page).toHaveURL(/\/analytics\/inventory$/);
  });

  test("mobile shell stays on /m routes only", async ({ page }) => {
    await gotoAuthed(page, "/m/home");
    await expect(page.getByRole("navigation", { name: /mobile primary/i })).toBeVisible();

    await gotoAuthed(page, "/finance/accounts-payable");
    await expect(page.getByRole("navigation", { name: /mobile primary/i })).toHaveCount(0);
  });

  test("saved reports and export center surfaces render", async ({ page }) => {
    await gotoAuthed(page, "/analytics/saved-reports");
    await expect(page.getByRole("heading", { name: /saved reports/i })).toBeVisible();

    await gotoAuthed(page, "/analytics/export-center");
    await expect(page.getByRole("heading", { name: /export center/i })).toBeVisible();
    await expect(page.getByText(/recent exports/i)).toBeVisible();
  });
});
