import { expect, type Page } from "@playwright/test";

export async function loginAsAdmin(page: Page) {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  if (!page.url().includes("/auth")) {
    return;
  }

  const usernameInput = page.getByPlaceholder("Enter your username");
  await expect(usernameInput).toBeVisible({ timeout: 10000 });
  await usernameInput.fill("admin");
  await page.getByPlaceholder("Enter your password").fill("Admin123!");
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15000 });
}

export async function gotoAuthed(page: Page, path: string) {
  await loginAsAdmin(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/);
}
