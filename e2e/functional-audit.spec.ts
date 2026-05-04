import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

/**
 * Non-destructive functional checks. Strongest assertions apply when optional QA seed ran:
 * `npm run seed:functional-qa` after main `db:seed` / demo data.
 */
test.describe("Functional QA audit (smoke)", () => {
  test("inventory: search, filters, export, and table", async ({ page }) => {
    await gotoAuthed(page, "/inventory");
    await expect(page.getByTestId("inventory-page")).toBeVisible({ timeout: 25000 });
    await expect(page.getByTestId("inventory-search-input")).toBeVisible();
    await expect(page.getByTestId("inventory-location-filter")).toBeVisible();
    await expect(page.getByTestId("inventory-category-filter")).toBeVisible();
    await expect(page.getByTestId("inventory-low-stock-filter")).toBeVisible();
    await expect(page.getByTestId("inventory-export-button")).toBeVisible();
    await expect(page.getByTestId("inventory-table")).toBeVisible();

    await page.getByTestId("inventory-search-input").fill("PEN-BP");
    await expect(page.getByTestId("inventory-table")).toContainText("PEN-BP", { timeout: 20000 });
  });

  test("procurement: orders and requisition routes align with shell", async ({ page }) => {
    await gotoAuthed(page, "/procurement/orders");
    await expect(page).toHaveURL(/\/procurement\/orders/);
    await expect(page.getByTestId("purchase-orders-page")).toBeVisible({ timeout: 20000 });

    await page.goto("/procurement/requisitions");
    await expect(page).toHaveURL(/\/procurement\/requisitions/);
    await expect(page.getByTestId("purchase-orders-page")).toBeVisible({ timeout: 20000 });
  });

  test("AP payments tab: selection updates batch total when invoices are ready", async ({ page }) => {
    await gotoAuthed(page, "/finance/accounts-payable/payments");
    await expect(page.getByTestId("accounts-payable-page")).toBeVisible({ timeout: 25000 });
    await expect(page.getByTestId("ap-tab-payments")).toBeVisible();
    const checkboxes = page.getByTestId("ap-ready-invoice-checkbox");
    const n = await checkboxes.count();
    if (n === 0) {
      test.info().annotations.push({
        type: "note",
        description: "No ready-for-batch invoices in this environment; skipped total assertion.",
      });
      return;
    }
    const total = page.getByTestId("ap-selected-batch-total");
    const before = (await total.textContent())?.trim() ?? "";
    await checkboxes.first().click();
    await expect(total).not.toHaveText(before, { timeout: 5000 });
  });

  test("analytics overview: workspace title and section nav", async ({ page }) => {
    await gotoAuthed(page, "/analytics/overview");
    await expect(page.getByTestId("page-title")).toBeVisible({ timeout: 25000 });
    await expect(page.getByLabel(/section navigation/i)).toBeVisible();
  });

  test("Get Educated: search AP and open Accounts Payable lesson", async ({ page }) => {
    await gotoAuthed(page, "/get-educated");
    await expect(page.getByTestId("get-educated-page")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("training-search-input").fill("AP");
    const apCard = page.getByTestId("training-module-card").filter({ hasText: /Accounts Payable/ }).first();
    await expect(apCard).toBeVisible({ timeout: 10000 });
    await apCard.getByTestId("training-start-button").click();
    await expect(page).toHaveURL(/\/get-educated\/accounts-payable/);
  });
});
