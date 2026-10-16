import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("system diagnostics command center", () => {
  test("shows health, scan, live events, self-checks, and export controls", async ({ page }) => {
    await gotoAuthed(page, "/admin/system-diagnostics");

    await expect(page.getByTestId("system-diagnostics-page")).toBeVisible();
    await expect(page.getByTestId("diagnostics-health-summary")).toBeVisible();
    await page.getByTestId("diagnostics-advanced-evidence").locator("summary").click();
    await expect(page.getByTestId("diagnostics-live-events")).toBeVisible();
    await expect(page.getByText(/Internal calculation\/filter self-checks/i)).toBeVisible();
    await expect(page.getByTestId("diagnostics-run-scan-button")).toBeVisible();
    await expect(page.getByTestId("diagnostics-export-json")).toBeVisible();
    await expect(page.getByTestId("diagnostics-export-markdown")).toBeVisible();
    await expect(page.getByTestId("diagnostics-copy-summary")).toBeVisible();

    await page.getByTestId("diagnostics-run-scan-button").click();
    await expect(page.getByTestId("diagnostics-scan-results")).toBeVisible();

    const jsonDownload = page.waitForEvent("download");
    await page.getByTestId("diagnostics-export-json").click();
    await expect((await jsonDownload).suggestedFilename()).toBe("invtrack-diagnostics-report.json");

    const mdDownload = page.waitForEvent("download");
    await page.getByTestId("diagnostics-export-markdown").click();
    await expect((await mdDownload).suggestedFilename()).toBe("invtrack-diagnostics-report.md");

    await page.getByTestId("diagnostics-copy-summary").click();
  });
});
