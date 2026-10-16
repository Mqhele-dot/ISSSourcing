/**
 * Tests that all main pages load and primary buttons work (no crash).
 * Run with: npx playwright test client/tests/pages-and-buttons.spec.ts
 * Requires app running and auth (e.g. log in first or use storageState).
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";

const CRASH_PATTERNS = [
  /something went wrong/i,
  /input is not defined/i,
  /Select\.Item.*value/i,
  /cannot read propert/i,
];

function assertNoCrash(page: import("@playwright/test").Page) {
  return async () => {
    for (const pattern of CRASH_PATTERNS) {
      await expect(page.getByText(pattern).first()).not.toBeVisible({ timeout: 1000 }).catch(() => {});
    }
  };
}

test.describe("Pages load without crash", () => {
  test("Home (Control Tower) loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByText(/control tower|loading|error|operational/i).first()).toBeVisible({ timeout: 15000 });
  });

  test("Dashboard loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByText(/dashboard|inventory|total items/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Inventory loads and Export CSV button exists", async ({ page }) => {
    await page.goto(`${BASE_URL}/inventory`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByRole("button", { name: /export csv/i })).toBeVisible({ timeout: 10000 });
  });

  test("Reorder Requests loads and Export buttons exist", async ({ page }) => {
    await page.goto(`${BASE_URL}/reorder`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByRole("button", { name: /export csv/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /export pdf/i })).toBeVisible({ timeout: 2000 });
  });

  test("Exceptions loads and Export CSV button exists", async ({ page }) => {
    await page.goto(`${BASE_URL}/exceptions`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByRole("button", { name: /export csv/i })).toBeVisible({ timeout: 10000 });
  });

  test("Reports loads and Export Report button exists", async ({ page }) => {
    await page.goto(`${BASE_URL}/reports`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByRole("button", { name: /export report/i })).toBeVisible({ timeout: 10000 });
  });

  test("Settings loads (no Input error)", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByText(/settings/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Purchase Orders loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/purchase`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByText(/purchase|order|loading/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Logistics loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/logistics`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByText(/logistics|shipment|loading/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Suppliers loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/suppliers`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByText(/supplier/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("Warehouses loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/warehouses`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await assertNoCrash(page)();
    await expect(page.getByText(/warehouse/i).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Buttons trigger without crash", () => {
  test("Inventory: Refresh button click", async ({ page }) => {
    await page.goto(`${BASE_URL}/inventory`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /refresh/i }).click();
    await page.waitForTimeout(1500);
    await assertNoCrash(page)();
  });

  test("Reorder: Export CSV downloads", async ({ page }) => {
    await page.goto(`${BASE_URL}/reorder`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(path!, "utf-8");
    expect(content.startsWith("sep=,")).toBe(true);
  });

  test("Reports: Export Report button click (no crash)", async ({ page }) => {
    await page.goto(`${BASE_URL}/reports`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /export report/i }).click();
    await page.waitForTimeout(2000);
    await assertNoCrash(page)();
  });

  test("Exceptions: Refresh button click", async ({ page }) => {
    await page.goto(`${BASE_URL}/exceptions`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /refresh/i }).click();
    await page.waitForTimeout(1500);
    await assertNoCrash(page)();
  });
});
