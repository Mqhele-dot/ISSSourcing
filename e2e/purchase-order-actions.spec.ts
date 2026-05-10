import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

/**
 * PO approve / send / commercial terms / activity — assumes `seed:functional-qa` from global setup.
 * Mutates PO-FQA-001 (open → approved → sent); re-run global seed before full suite if order matters.
 */
test.describe.configure({ mode: "serial" });

test.describe("Purchase order actions (FQA)", () => {
  test("approve, send, commercial save, locked PO, activity panel, diagnostics marker", async ({ page }) => {
    test.setTimeout(120_000);

    const asyncResourceWarnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning" && /useAsyncResource/i.test(msg.text())) {
        asyncResourceWarnings.push(msg.text());
      }
    });

    await gotoAuthed(page, "/procurement/orders/PO-FQA-001");
    await expect(page.getByTestId("po-detail-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("po-detail-title")).toContainText("PO-FQA-001", { timeout: 20_000 });

    await expect(page.getByTestId("po-approve-button")).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId("po-approve-button").click();
    await expect(page.getByTestId("po-detail-status")).toContainText(/approved/i, { timeout: 20_000 });

    await expect(page.getByTestId("po-send-button")).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId("po-send-button").click();
    await expect(page.getByTestId("po-detail-status")).toContainText(/sent/i, { timeout: 20_000 });

    await page.goto("/procurement/orders/PO-FQA-002", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await expect(page.getByTestId("po-detail-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("po-commercial-save-button")).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId("po-commercial-save-button").click();
    await expect(page.getByTestId("po-commercial-error")).toBeHidden({ timeout: 15_000 });

    await page.goto("/procurement/orders/PO-FQA-003", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await expect(page.getByTestId("po-detail-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("po-commercial-save-button")).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByTestId("po-commercial-disabled-message")).toBeVisible();

    await expect(page.getByTestId("entity-activity-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("entity-activity-panel-disabled")).toHaveCount(0);

    expect(asyncResourceWarnings, "useAsyncResource fetcher churn should not appear on PO detail").toEqual([]);

    await gotoAuthed(page, "/admin/system-diagnostics");
    await expect(page.getByTestId("system-diagnostics-page")).toBeVisible({ timeout: 30_000 });
  });
});
