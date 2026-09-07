import { expect, type Page } from "@playwright/test";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";

export function requireDisposableE2eDatabase(): void {
  assertDisposableDatabaseUrl(process.env.TEST_DATABASE_URL);
}

export async function loginAsSeededUser(
  page: Page,
  username: string,
  userId: number,
  password = "Admin123!",
): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem(`invtrack:first-run-coach:v1:${id}`, "done");
  }, userId);
  await page.context().clearCookies();
  await page.goto("/auth", { waitUntil: "load" });
  await expect(page.getByPlaceholder("Enter your username")).toBeVisible({ timeout: 25_000 });
  await page.getByPlaceholder("Enter your username").fill(username);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20_000 });
}

export async function chooseSearchableOption(
  page: Page,
  trigger: ReturnType<Page["getByTestId"]> | ReturnType<Page["getByRole"]>,
  searchPlaceholder: string,
  search: string,
  optionName: string | RegExp,
): Promise<void> {
  await trigger.click();
  await page.getByPlaceholder(searchPlaceholder).fill(search);
  await page.getByRole("option", { name: optionName }).first().click();
}
