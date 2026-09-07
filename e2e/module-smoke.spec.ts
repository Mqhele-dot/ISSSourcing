import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

/** Safe navigation smoke: authenticated shell, no redirect to /auth. */
const MODULE_ROUTES = [
  { path: "/inventory/warehouses", label: "warehouses" },
  { path: "/inventory/warehouse-operations", label: "warehouse-operations" },
  { path: "/inventory/cycle-counts", label: "cycle-counts" },
  { path: "/inventory/reorder", label: "reorder" },
  { path: "/inventory/barcodes", label: "barcodes" },
  { path: "/procurement/suppliers", label: "suppliers" },
  { path: "/procurement/contracts", label: "contracts" },
  { path: "/finance/billing", label: "billing" },
  { path: "/finance/invoices", label: "invoices" },
  { path: "/admin/settings/general", label: "settings-general" },
  { path: "/admin/master-data", label: "master-data" },
  { path: "/admin/system-diagnostics", label: "system-diagnostics" },
] as const;

test.describe("Module route smoke (partial coverage)", () => {
  test("loads canonical module routes with one login", async ({ page }) => {
    await gotoAuthed(page, "/");
    for (const { path } of MODULE_ROUTES) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      await expect(page).not.toHaveURL(/\/auth(\/|\?|$)/);
      await expect(page.locator("body")).toBeVisible();
    }
  });
});
