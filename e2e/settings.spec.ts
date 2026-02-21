import { test, expect } from "@playwright/test";

test.describe("Settings", () => {
  test("loads without crash", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible({ timeout: 10000 });
  });
});
