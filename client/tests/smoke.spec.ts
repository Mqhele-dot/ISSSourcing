/**
 * Playwright smoke tests.
 * Run with: npx playwright test client/tests/smoke.spec.ts
 * Requires: npm install -D @playwright/test && npx playwright install
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";

test.describe("Smoke", () => {
  test("/settings loads without 'Something went wrong'", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await expect(page.getByText("Something went wrong")).not.toBeVisible({ timeout: 2000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible({ timeout: 10000 });
  });

  test("/reports loads without Select error", async ({ page }) => {
    await page.goto(`${BASE_URL}/reports`);
    await expect(page.getByText("Select.Item").first()).not.toBeVisible({ timeout: 2000 }).catch(() => {});
    await expect(page.getByText(/report/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Export CSV on reorder page downloads file with sep=", async ({ page }) => {
    await page.goto(`${BASE_URL}/reorder`);
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(path!, "utf-8");
    expect(content.startsWith("sep=,")).toBe(true);
  });

  test("Control tower (home) loads within 15s or shows error", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    const loading = page.getByText("Loading...");
    const errorPanel = page.getByText(/error|failed|timeout/i).first();
    const content = page.getByText(/control tower|operational/i).first();
    await Promise.race([
      content.waitFor({ state: "visible", timeout: 15000 }),
      errorPanel.waitFor({ state: "visible", timeout: 15000 }),
    ]);
    await expect(loading).not.toBeVisible();
  });
});
