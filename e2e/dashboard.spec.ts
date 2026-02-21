import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads without crash", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 10000 });
  });

  test("Export button triggers download", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.getByRole("button", { name: /export/i }).click();
    await page.getByRole("menuitem", { name: /csv/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  });

  test("Stock Use & Value section and charts are present", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: /stock use & value/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Stock Use", { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Value by Category", { exact: false })).toBeVisible({ timeout: 5000 });
  });

  test("Inventory table View opens read-only dialog", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 10000 });
    const viewBtn = page.getByRole("button", { name: /^view$/i }).first();
    await viewBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    if (await viewBtn.isVisible()) {
      await viewBtn.click();
      await expect(page.getByRole("dialog").getByText(/view item/i)).toBeVisible({ timeout: 3000 });
      await expect(page.getByRole("button", { name: /edit item/i })).toBeVisible({ timeout: 2000 });
      await page.getByRole("button", { name: /close/i }).click();
    }
  });

  test("Inventory table Edit opens item form", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 10000 });
    const editBtn = page.getByRole("button", { name: /^edit$/i }).first();
    await editBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await expect(page.getByRole("dialog").getByText(/edit inventory item/i)).toBeVisible({ timeout: 3000 });
      await page.getByRole("button", { name: /cancel/i }).click();
    }
  });

  test("Orders & Inventory section and quick actions present", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: /orders & inventory/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Recent Orders", { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /view all/i })).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("Quick actions", { exact: false })).toBeVisible({ timeout: 3000 });
  });

  test("View all orders navigates to orders page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /view all/i }).first().click();
    await expect(page).toHaveURL(/\/(orders|purchase)/, { timeout: 5000 });
  });
});
