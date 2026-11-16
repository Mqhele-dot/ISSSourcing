import { expect, type Page } from "@playwright/test";

// Browser transport probes use the same authenticated cookie jar. Tolerate one
// Node/Playwright socket reset on a read only; never retry HTTP failures or writes.
export function readBrowserApi(page: Page, url: string) {
  return page.request.get(url, { maxRetries: 1 });
}

export async function loginAsAdmin(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("invtrack:first-run-coach:v2:1", "done");
  });

  if (process.env.PLAYWRIGHT_USE_DEV_TEST_LOGIN !== "0") {
    await page.goto("/dev-test-login?redirect=/operations/control-tower", { waitUntil: "load" });
    if (!page.url().includes("/auth") && !page.url().includes("/dev-test-login")) {
      return;
    }
  }

  await page.goto("/auth", { waitUntil: "load" });
  const usernameInput = page.getByPlaceholder("Enter your username");
  // Auth may redirect an already established test session after the shell loads.
  // Wait for the actual outcome instead of assuming it settles within 800ms.
  await expect.poll(async () => !new URL(page.url()).pathname.startsWith("/auth") || await usernameInput.isVisible(), {timeout:25_000}).toBe(true);

  if (!page.url().includes("/auth")) {
    return;
  }

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
