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

  test("failed startup module shows recovery and explicit reload preserves the destination", async ({ page }) => {
    const moduleUrl = /\/(?:assets\/[^/?]+\.js|src\/main\.tsx)(?:\?.*)?$/;
    await page.route(moduleUrl, (route) => route.abort("connectionfailed"));
    await page.goto("/auth?redirect=%2Foperations%2Fcontrol-tower#retry", { waitUntil: "load" });
    const fallback = page.locator("#bootstrap-recovery");
    await expect(fallback.getByRole("heading")).toHaveText("The app could not finish loading");
    await expect(fallback).toContainText("Check your connection");
    await expect(page.getByPlaceholder("Enter your username")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("startup-load-failure.png"), fullPage: true });
    await page.unroute(moduleUrl);
    await fallback.getByRole("button", { name: "Reload app" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByPlaceholder("Enter your username")).toBeVisible({ timeout: 25_000 });
    await expect(fallback).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("redirect")).toBe("/operations/control-tower");
    expect(new URL(page.url()).hash).toBe("#retry");
  });

  test("after login, protected shell can render Control Tower", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    await expect(page).not.toHaveURL(/\/auth/);
    await page.goto("/operations/control-tower", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("control-tower-page")).toBeVisible({ timeout: 60_000 });
  });
});
