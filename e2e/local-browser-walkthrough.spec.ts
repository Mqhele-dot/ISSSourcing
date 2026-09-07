import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loginAsAdmin } from "./test-helpers";

const screenshotDir =
  process.env.BROWSER_WALKTHROUGH_SCREENSHOTS_DIR ||
  path.join("test-results", "local-browser-walkthrough");

type WalkthroughStep = {
  name: string;
  path: string;
  readyText: string | RegExp;
  actions?: Array<{ name: string; text: string | RegExp }>;
};

const STEPS: WalkthroughStep[] = [
  {
    name: "control-tower",
    path: "/operations/control-tower",
    readyText: /control tower/i,
    actions: [
      { name: "refresh", text: /^refresh$/i },
      { name: "learning-expand", text: /learn this tab/i },
    ],
  },
  {
    name: "operations-exceptions",
    path: "/operations/exceptions",
    readyText: /exception/i,
    actions: [{ name: "refresh-or-filter", text: /refresh|filter|all statuses/i }],
  },
  {
    name: "cycle-counts",
    path: "/inventory/cycle-counts",
    readyText: /cycle count|count/i,
    actions: [{ name: "search-or-filter", text: /search|filter|all statuses/i }],
  },
  {
    name: "master-data-warehouses",
    path: "/admin/master-data/warehouses",
    readyText: /warehouse/i,
    actions: [{ name: "add-warehouse", text: /add warehouse/i }],
  },
  {
    name: "warehouse-operations",
    path: "/inventory/warehouse-operations",
    readyText: /warehouse/i,
    actions: [
      { name: "receive-or-transfer", text: /receive|transfer|adjust/i },
    ],
  },
  {
    name: "supplier-list",
    path: "/procurement/suppliers",
    readyText: /supplier/i,
    actions: [{ name: "add-supplier", text: /add supplier|new supplier/i }],
  },
  {
    name: "accounts-payable",
    path: "/finance/invoices",
    readyText: /invoice|accounts payable/i,
    actions: [{ name: "invoice-action", text: /new invoice|add invoice|filter|refresh/i }],
  },
  {
    name: "user-roles",
    path: "/admin/user-roles",
    readyText: /role|permission/i,
    actions: [{ name: "custom-roles", text: /custom roles/i }],
  },
  {
    name: "system-diagnostics",
    path: "/admin/system-diagnostics",
    readyText: /diagnostics/i,
    actions: [{ name: "run-or-refresh", text: /refresh|run|export/i }],
  },
];

async function screenshot(page: Page, name: string) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const filePath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  test.info().attachments.push({
    name,
    path: filePath,
    contentType: "image/png",
  });
}

async function clickFirstVisibleButton(page: Page, step: string, action: { name: string; text: string | RegExp }) {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(150);
  const button = page
    .getByRole("button", { name: action.text })
    .or(page.getByText(action.text))
    .first();

  if ((await button.count()) === 0) {
    test.info().annotations.push({
      type: "walkthrough-skip",
      description: `${step}: no visible control matched ${String(action.text)}`,
    });
    return;
  }

  if (!(await button.isVisible().catch(() => false))) {
    test.info().annotations.push({
      type: "walkthrough-skip",
      description: `${step}: matched control was not visible for ${String(action.text)}`,
    });
    return;
  }

  try {
    await button.click({ timeout: 10_000 });
  } catch (error) {
    test.info().annotations.push({
      type: "walkthrough-skip",
      description: `${step}: optional action ${action.name} could not be clicked (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
    });
    await screenshot(page, `${step}-${action.name}-blocked`);
    await page.keyboard.press("Escape").catch(() => undefined);
    return;
  }
  await page.waitForTimeout(500);
  await screenshot(page, `${step}-${action.name}`);
}

test.describe("Local browser walkthrough", () => {
  test("logs in, clicks core features, and captures screenshots", async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto("/auth", { waitUntil: "load" });
    await screenshot(page, "00-auth");
    await loginAsAdmin(page);
    await expect(page).not.toHaveURL(/\/auth(?:\?|$)/);
    await screenshot(page, "01-after-login");

    for (const step of STEPS) {
      await page.goto(step.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      await expect(page).not.toHaveURL(/\/auth(?:\?|$)/);
      await expect(page.getByText(step.readyText).first()).toBeVisible({ timeout: 30_000 });
      await screenshot(page, `page-${step.name}`);

      for (const action of step.actions ?? []) {
        await clickFirstVisibleButton(page, step.name, action);
      }
    }
  });
});
