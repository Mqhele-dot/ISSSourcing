import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./test-helpers";

test.use({ trace: "retain-on-failure" });

/**
 * Runtime harvest for P0 boot issues: blank /auth, lazy-route failures, post-login shell stalls.
 */
test.describe("Boot and auth shell", () => {
  test.describe.configure({ mode: "serial" });

  test("cold /auth exposes login chrome", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/auth", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /inventory manager/i })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({ timeout: 20_000 });
  });

  test("after login, protected shell can render Control Tower", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    await expect(page).not.toHaveURL(/\/auth/);
    await page.goto("/operations/control-tower", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("control-tower-page")).toBeVisible({ timeout: 60_000 });
  });
});
