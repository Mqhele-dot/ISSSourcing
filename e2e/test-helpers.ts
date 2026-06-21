import { expect, type Page } from "@playwright/test";

export async function loginAsAdmin(page: Page) {
  if (process.env.PLAYWRIGHT_USE_DEV_TEST_LOGIN !== "0") {
    await page.goto("/dev-test-login?redirect=/operations/control-tower", { waitUntil: "load" });
    if (!page.url().includes("/auth") && !page.url().includes("/dev-test-login")) {
      return;
    }
  }

  await page.goto("/auth", { waitUntil: "load" });
  await page.waitForTimeout(800);

  if (!page.url().includes("/auth")) {
    return;
  }

  const usernameInput = page.getByPlaceholder("Enter your username");
  await expect(usernameInput).toBeVisible({ timeout: 25_000 });
  await usernameInput.fill("admin");
  await page.getByPlaceholder("Enter your password").fill("Admin123!");
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20_000 });
}

export async function gotoAuthed(page: Page, path: string) {
  await loginAsAdmin(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/);
}
