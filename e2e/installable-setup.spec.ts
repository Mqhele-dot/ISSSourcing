import { expect, test } from "@playwright/test";
import pg from "pg";
import {
  readProductOnboardingForOrg,
  resolveE2EDatabaseUrl,
  writeProductOnboardingForOrg,
  type ProductOnboardingSnap,
} from "./product-onboarding-test-db";
import { gotoAuthed, loginAsAdmin } from "./test-helpers";

/** Seeded demo / e2e prep use organization_id = 1 for app_settings. */
const E2E_DEFAULT_ORG_ID = 1;

test.describe("Installable setup (verification)", () => {
  test.describe.configure({ timeout: 60_000 });
  test("system diagnostics shows summary and copy JSON", async ({ page }) => {
    await gotoAuthed(page, "/admin/system-diagnostics");
    await expect(page.getByRole("heading", { name: /system diagnostics/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("heading", { name: /^Summary$/ })).toBeVisible();
    await expect(page.getByText(/Database \(authenticated check\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: /copy diagnostics json/i })).toBeVisible();
  });

  test("requisitions page loads with status=PENDING in URL", async ({ page }) => {
    await gotoAuthed(page, "/procurement/requisitions?status=PENDING");
    await expect(page).toHaveURL(/status=PENDING/);
    await expect(page.getByLabel(/purchase orders and requisitions/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder(/search requisition number/i)).toBeVisible();
  });

  test("home checklist links include Approve requisition and Accounts payable", async ({ page }) => {
    await gotoAuthed(page, "/");
    await expect(page.getByRole("heading", { name: /first procurement cycle/i })).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("link", { name: /approve requisition/i }).first(),
    ).toHaveAttribute("href", /requisitions\?status=PENDING/i);
    await expect(page.getByRole("link", { name: /^accounts payable$/i }).first()).toHaveAttribute(
      "href",
      /\/finance\/accounts-payable/,
    );
  });

  test("when setup status request fails, non-setup routes show safe blocking UI", async ({ page }) => {
    await page.route("**/api/setup/status", (route) => route.abort("failed"));
    await loginAsAdmin(page);
    await page.goto("/analytics/overview", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/could not load product setup status/i)).toBeVisible({ timeout: 15000 });
  });

  test("product setup shows resume banner when onboarding incomplete and checkpoint exists", async ({ page }) => {
    const dbUrl = resolveE2EDatabaseUrl();
    if (!dbUrl) {
      test.skip();
      return;
    }

    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();

    let previous: ProductOnboardingSnap | undefined;
    let restoreNeeded = false;

    try {
      previous = await readProductOnboardingForOrg(client, E2E_DEFAULT_ORG_ID);
      if (previous === undefined) {
        test.skip();
        return;
      }

      const checkpoint = {
        step: "business",
        draft: { companyName: "E2E Resume Banner Co" },
        savedAt: new Date().toISOString(),
      };
      await client.query(
        `UPDATE app_settings
         SET product_onboarding_completed_at = NULL,
             product_onboarding_state = $1::jsonb
         WHERE organization_id = $2`,
        [JSON.stringify(checkpoint), E2E_DEFAULT_ORG_ID],
      );
      restoreNeeded = true;

      await loginAsAdmin(page);
      await page.goto("/setup", { waitUntil: "domcontentloaded" });

      const resumeAlert = page.getByRole("alert").filter({ hasText: /resume setup/i });
      await expect(resumeAlert).toBeVisible({ timeout: 15_000 });
      await expect(resumeAlert.getByRole("heading", { name: /resume setup/i })).toBeVisible();
      await expect(resumeAlert).toContainText(/saved progress at step/i);
      await expect(resumeAlert.getByText(/\bbusiness\b/)).toBeVisible();
    } finally {
      if (restoreNeeded && previous !== undefined) {
        await writeProductOnboardingForOrg(client, E2E_DEFAULT_ORG_ID, previous);
      }
      await client.end().catch(() => {});
    }
  });
});
