import { test, expect } from "@playwright/test";

test.describe("Reports", () => {
  test("loads without crash", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible({ timeout: 10000 });
  });

  test("Export Report button triggers download", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.getByRole("button", { name: /export report/i }).click();
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    expect(/\.(csv|pdf|xlsx)$/i.test(filename)).toBeTruthy();
  });
});
