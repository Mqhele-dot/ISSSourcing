import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("Requisitions and supplier portal readiness", () => {
  test("requisition workbench and form expose release markers", async ({ page }) => {
    await gotoAuthed(page, "/procurement/requisitions");
    await expect(page.getByTestId("requisitions-page")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("requisition-kpi-draft")).toBeVisible();
    await expect(page.getByTestId("requisition-results-count")).toContainText(/\d+[–-]\d+ of \d+ requisitions/);

    await page.getByTestId("requisition-status-filter").click();
    await page.getByRole("option", { name: /^Pending approval$/ }).click();
    await expect(page).toHaveURL(/status=PENDING_APPROVAL/);

    const firstRow = page.locator('[data-testid^="requisition-row-"]').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await expect(page.getByTestId("requisition-preview-panel")).toBeVisible();
    }

    await gotoAuthed(page, "/procurement/requisitions/new");
    await expect(page.getByTestId("requisition-form-page")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("requisition-lines-editor")).toBeVisible();
    await expect(page.getByTestId("requisition-add-line-button")).toBeVisible();
  });

  test("supplier portal tabs, invoice validation, and optional PO preview", async ({ page }) => {
    await gotoAuthed(page, "/procurement/supplier-portal");
    await expect(page.getByTestId("supplier-portal-page")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("supplier-portal-tabs")).toBeVisible();
    await expect(page.getByTestId("supplier-portal-open-pos-tab")).toBeVisible();
    await expect(page.getByTestId("supplier-portal-confirmations-tab")).toBeVisible();
    await expect(page.getByTestId("supplier-portal-delivery-updates-tab")).toBeVisible();
    await expect(page.getByTestId("supplier-portal-invoices-tab")).toBeVisible();
    await expect(page.getByTestId("supplier-portal-payment-status-tab")).toBeVisible();
    await expect(page.getByTestId("supplier-portal-documents-tab")).toBeVisible();

    const supplierSelect = page.locator("#supplier-scope-select");
    if (await supplierSelect.isVisible()) {
      await supplierSelect.click();
      await page.getByRole("option").first().click();
    }

    await page.getByTestId("supplier-portal-invoices-tab").click();
    await expect(page.getByTestId("supplier-portal-order-picker")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("supplier-portal-submit-invoice").click();
    await expect(page.getByTestId("supplier-portal-page").getByText("Choose a valid purchase order")).toBeVisible();

    const firstPoPreview = page.getByRole("button", { name: "Preview" }).first();
    if (await firstPoPreview.isVisible()) {
      await firstPoPreview.click();
      await expect(page.getByTestId("supplier-portal-po-preview")).toBeVisible();
      await expect(page.getByTestId("supplier-portal-po-preview-title")).toBeVisible();
      await page.getByTestId("supplier-portal-po-preview-close").click();
    }

    await page.getByTestId("supplier-portal-payment-status-tab").click();
    await expect(page.getByTestId("supplier-portal-payment-status")).toBeVisible();
  });
});
