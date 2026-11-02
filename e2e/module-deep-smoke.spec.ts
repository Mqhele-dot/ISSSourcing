import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

/**
 * Phase 9: partial modules — primary shell + one safe interaction per route (FQA seed via global-setup).
 */
const DEEP_ROUTES = [
  {
    path: "/inventory/warehouses",
    label: "warehouses",
    interact: async (page: import("@playwright/test").Page) => {
      const ref = page.getByRole("button", { name: /refresh/i });
      if (await ref.isVisible().catch(() => false)) await ref.click();
    },
  },
  {
    path: "/inventory/warehouse-operations",
    label: "warehouse-operations",
    interact: async (page: import("@playwright/test").Page) => {
      const ref = page.getByRole("button", { name: /refresh/i });
      if (await ref.isVisible().catch(() => false)) await ref.click();
    },
  },
  {
    path: "/inventory/cycle-counts",
    label: "cycle-counts",
    interact: async (page: import("@playwright/test").Page) => {
      const s = page.getByPlaceholder(/search/i);
      if (await s.first().isVisible().catch(() => false)) await s.first().fill("test");
    },
  },
  {
    path: "/inventory/reorder",
    label: "reorder",
    interact: async (page: import("@playwright/test").Page) => {
      const s = page.getByPlaceholder(/search/i);
      if (await s.first().isVisible().catch(() => false)) await s.first().fill("a");
    },
  },
  {
    path: "/inventory/barcodes",
    label: "barcodes",
    interact: async () => {},
  },
  {
    path: "/procurement/suppliers",
    label: "suppliers",
    interact: async (page: import("@playwright/test").Page) => {
      const s = page.getByPlaceholder(/search/i);
      if (await s.first().isVisible().catch(() => false)) await s.first().fill("a");
    },
  },
  {
    path: "/procurement/contracts",
    label: "contracts",
    interact: async (page: import("@playwright/test").Page) => {
      const s = page.getByPlaceholder(/search/i);
      if (await s.first().isVisible().catch(() => false)) await s.first().fill("a");
    },
  },
  {
    path: "/finance/billing",
    label: "billing",
    interact: async () => {},
  },
  {
    path: "/finance/invoices",
    label: "invoices",
    interact: async (page: import("@playwright/test").Page) => {
      const s = page.getByPlaceholder(/search/i);
      if (await s.first().isVisible().catch(() => false)) await s.first().fill("INV");
    },
  },
  {
    path: "/analytics/reports",
    label: "reports-root",
    interact: async () => {},
  },
  {
    path: "/analytics/export-center",
    label: "export-center",
    interact: async () => {},
  },
  {
    path: "/admin/settings/general",
    label: "settings-general",
    interact: async () => {},
  },
  {
    path: "/admin/master-data",
    label: "master-data",
    interact: async () => {},
  },
  {
    path: "/admin/system-diagnostics",
    label: "system-diagnostics",
    interact: async (page: import("@playwright/test").Page) => {
      const btn = page.getByRole("button", { name: /copy|json|refresh/i });
      if (await btn.first().isVisible().catch(() => false)) await btn.first().click();
    },
  },
] as const;

test.describe("Module deep smoke (partial + one action)", () => {
  // Independent tests retain a per-route deadline and identify the exact failed
  // module. Fourteen navigations must not share a single 30-second budget.
  for (const { path, label, interact } of DEEP_ROUTES) {
    test(label, async ({ page }) => {
        await gotoAuthed(page, path);
        await expect(page).not.toHaveURL(/\/auth(\/|\?|$)/);
        await expect(page.locator("#bootstrap-recovery")).toHaveCount(0);
        const h1 = page.locator("h1").first();
        const titled = page.getByTestId("page-title");
        await expect(h1.or(titled)).toBeVisible({ timeout: 25_000 });
        await interact(page);
    });
  }
});
