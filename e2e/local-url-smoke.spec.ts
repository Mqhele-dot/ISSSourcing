import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loginAsAdmin } from "./test-helpers";

const targetPath = process.env.LOCAL_BROWSER_TEST_PATH || "/inventory/cycle-counts";
const expectedText = process.env.LOCAL_BROWSER_EXPECT_TEXT;
const screenshotDir =
  process.env.BROWSER_URL_SMOKE_SCREENSHOTS_DIR ||
  path.join("test-results", "local-url-smoke");

function safeScreenshotName(value: string) {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "route";
}

test.describe("Local URL smoke", () => {
  test(`opens ${targetPath}`, async ({ page }) => {
    test.setTimeout(90_000);

    await loginAsAdmin(page);
    await page.goto(targetPath, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");

    await expect(page).not.toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/this page isn't working|cannot get|internal server error/i);

    if (expectedText) {
      await expect(page.getByText(new RegExp(expectedText, "i")).first()).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.locator("h1").first().or(page.getByTestId("page-title"))).toBeVisible({ timeout: 30_000 });
    }

    await fs.mkdir(screenshotDir, { recursive: true });
    const filePath = path.join(screenshotDir, `${safeScreenshotName(targetPath)}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    test.info().attachments.push({
      name: safeScreenshotName(targetPath),
      path: filePath,
      contentType: "image/png",
    });
  });
});
