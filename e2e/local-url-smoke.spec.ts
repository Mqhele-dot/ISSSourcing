import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { gotoAuthed } from "./test-helpers";

const screenshotDir =
  process.env.BROWSER_WALKTHROUGH_SCREENSHOTS_DIR || path.join("test-results", "local-url-smoke");
const targetPath = process.env.LOCAL_BROWSER_TEST_PATH || "/operations/control-tower";
const expectedText = process.env.LOCAL_BROWSER_EXPECT_TEXT || "";

async function screenshot(page, name) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const filePath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  test.info().attachments.push({
    name,
    path: filePath,
    contentType: "image/png",
  });
}

test.describe("Local URL smoke", () => {
  test("logs in and opens the requested route", async ({ page }) => {
    test.setTimeout(180_000);

    await gotoAuthed(page, targetPath);
    await expect(page).not.toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.locator("main").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/something went wrong|unexpected application error/i)).toHaveCount(0);

    if (expectedText) {
      await expect(page.getByText(new RegExp(expectedText, "i")).first()).toBeVisible({ timeout: 30_000 });
    }

    await screenshot(page, "route");
  });
});
