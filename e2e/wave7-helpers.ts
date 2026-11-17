import { expect, type Page } from "@playwright/test";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";

export function requireDisposableE2eDatabase(): void {
  assertDisposableDatabaseUrl(process.env.TEST_DATABASE_URL);
}

export async function verifyCompactDesktopGuidance(page: Page, feature: string): Promise<boolean> {
  if ((page.viewportSize()?.width ?? 1280) >= 1024) return false;
  const setupCoach = page.getByRole("dialog", { name: "Add company details", exact: true });
  await expect(async () => {
    if (await setupCoach.isVisible()) await setupCoach.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByText(new RegExp(`${feature} (?:is|are) available on large screens`))).toBeVisible({ timeout: 500 });
    await expect(page.getByRole("link", { name: "Open mobile hub", exact: true })).toHaveAttribute("href", "/m/home", { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  return true;
}

export async function loginAsSeededUser(
  page: Page,
  username: string,
  userId: number,
  password = "Admin123!",
): Promise<void> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Seeded browser login requires the fixture's numeric userId.");
  await page.addInitScript((id) => {
    window.localStorage.setItem(`invtrack:first-run-coach:v2:${id}`, "done");
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
  const searchInput = page.getByPlaceholder(searchPlaceholder);
  await searchInput.fill(search);
  await expect(page.getByRole("option", { name: optionName }).first()).toBeVisible();
  // Command-list results can be replaced while React applies the filtered
  // collection. Confirm the keyboard-selected result instead of clicking a
  // node that may detach between Playwright's actionability checks.
  await searchInput.press("Enter");
  await expect(searchInput).not.toBeVisible();
  await expect(trigger).toContainText(optionName);
}
