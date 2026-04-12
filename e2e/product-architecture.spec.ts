import { expect, test } from "@playwright/test";

test.describe("Product architecture", () => {
  test("legacy procurement and mobile routes redirect to canonical destinations", async ({ page }) => {
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/procurement\/orders$/);

    await page.goto("/requisitions");
    await expect(page).toHaveURL(/\/procurement\/requisitions$/);

    await page.goto("/mobile/receive");
    await expect(page).toHaveURL(/\/m\/receive$/);
  });

  test("sidebar shows canonical product sections", async ({ page }) => {
    await page.goto("/analytics/overview");
    await expect(page.getByText("Operations", { exact: true })).toBeVisible();
    await expect(page.getByText("Inventory", { exact: true })).toBeVisible();
    await expect(page.getByText("Procurement", { exact: true })).toBeVisible();
    await expect(page.getByText("Finance", { exact: true })).toBeVisible();
    await expect(page.getByText("Analytics", { exact: true })).toBeVisible();
    await expect(page.getByText("Admin", { exact: true })).toBeVisible();
  });

  test("analytics workspace drilldown uses canonical subroutes", async ({ page }) => {
    await page.goto("/analytics/overview");
    await expect(page.getByRole("heading", { name: /analytics workspace/i })).toBeVisible();
    await page.getByRole("link", { name: /^Inventory$/ }).first().click();
    await expect(page).toHaveURL(/\/analytics\/inventory$/);
  });

  test("mobile shell stays on /m routes only", async ({ page }) => {
    await page.goto("/m/home");
    await expect(page.getByRole("navigation", { name: /mobile primary/i })).toBeVisible();

    await page.goto("/finance/accounts-payable");
    await expect(page.getByRole("navigation", { name: /mobile primary/i })).toHaveCount(0);
  });

  test("saved reports and export center surfaces render", async ({ page }) => {
    await page.goto("/analytics/saved-reports");
    await expect(page.getByRole("heading", { name: /saved reports/i })).toBeVisible();

    await page.goto("/analytics/export-center");
    await expect(page.getByRole("heading", { name: /export center/i })).toBeVisible();
    await expect(page.getByText(/recent exports/i)).toBeVisible();
  });
});
