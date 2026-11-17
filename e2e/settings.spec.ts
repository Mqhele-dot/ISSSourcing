import { test, expect } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("Settings", () => {
  test("legacy settings route redirects to canonical admin settings", async ({ page }) => {
    await gotoAuthed(page, "/settings");
    await expect(page).toHaveURL(/\/admin\/settings(?:\/general)?$/);
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("tab", { name: /overview/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /security/i })).toBeVisible();
  });

  test("settings sections navigate through canonical subroutes", async ({ page }) => {
    await gotoAuthed(page, "/admin/settings");
    await page.getByRole("tab", { name: /workflow controls/i }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/configuration$/);
    await expect(page.getByTestId("company-configuration-center")).toBeVisible();
  });

  test("database settings fail closed in the browser build", async ({ page }) => {
    await gotoAuthed(page, "/admin/settings/database");
    await expect(page).toHaveURL(/\/admin\/settings\/database$/);
    await expect(page.getByTestId("database-settings-web-only")).toBeVisible();
    await expect(page.getByTestId("database-settings-unsupported-config")).toContainText(/desktop shell/i);
    await expect(page.getByText(/no longer pretends to save database credentials/i)).toBeVisible();
  });
});
