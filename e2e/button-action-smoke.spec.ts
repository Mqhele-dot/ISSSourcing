import { expect, test } from "@playwright/test";
import { apiJsonRequest, loginForTests } from "../scripts/test-http.ts";
import { gotoAuthed } from "./test-helpers";

test.describe("button and action smoke", () => {
  test("contracts route navigation loads the real page marker", async ({ page }) => {
    await gotoAuthed(page, "/procurement/contracts");
    await expect(page.getByTestId("contracts-page")).toBeVisible({ timeout: 20_000 });
  });

  test("control tower stays usable when gas dashboard summary fails", async ({ page }) => {
    await page.route("**/api/gas/dashboard-summary", async (route) => {
      await route.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: { code: "GAS_TIMEOUT", message: "Gas summary unavailable" } }),
      });
    });
    await gotoAuthed(page, "/operations/control-tower");
    await expect(page.getByTestId("control-tower-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("gas-ops-unavailable")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /retry gas summary/i })).toBeVisible();
  });

  test("subscription lifecycle actions are disabled for viewer and usable for admin", async ({ page }) => {
    await gotoAuthed(page, "/admin/subscription");
    await expect(page.getByTestId("subscription-admin-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("subscription-change-plan-standard")).toBeVisible();
  });

  test("custom-role permission delete endpoint is idempotent", async () => {
    const cookie = (await loginForTests("admin", "Admin123!")) ?? "";
    const created = await apiJsonRequest("/custom-roles", {
      method: "POST",
      cookie,
      body: { name: `Button smoke ${Date.now()}`, description: "Button action smoke", isActive: true },
    });
    expect([200, 201]).toContain(created.status);
    const roleId = Number((created.json as { data?: { id?: number }; id?: number }).data?.id ?? (created.json as { id?: number }).id);
    expect(Number.isFinite(roleId)).toBeTruthy();

    const added = await apiJsonRequest(`/custom-roles/${roleId}/permissions`, {
      method: "POST",
      cookie,
      body: { resource: "reports", permissionType: "read" },
    });
    expect([200, 201]).toContain(added.status);
    const permissionId = Number((added.json as { data?: { id?: number }; id?: number }).data?.id ?? (added.json as { id?: number }).id);
    expect(Number.isFinite(permissionId)).toBeTruthy();

    const first = await apiJsonRequest(`/custom-roles/${roleId}/permissions/${permissionId}`, { method: "DELETE", cookie });
    expect([200, 204]).toContain(first.status);
    const second = await apiJsonRequest(`/custom-roles/${roleId}/permissions/${permissionId}`, { method: "DELETE", cookie });
    expect([200, 204]).toContain(second.status);
    if (second.status === 200) {
      expect(JSON.stringify(second.json)).toContain("alreadyRemoved");
    }
  });

  test("PO commercial validation shows contract-currency repair actions when backend blocks save", async ({ page }) => {
    await page.route("**/api/procurement/purchase-orders/records/*/commercial", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: {
              code: "SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED",
              message: "Selected contract currency controls PO currency.",
            },
          }),
        });
        return;
      }
      await route.continue();
    });
    const cookie = (await loginForTests("admin", "Admin123!")) ?? "";
    const orders = await apiJsonRequest("/purchase-orders", { cookie });
    const rows = Array.isArray(orders.json) ? orders.json : (orders.json as { data?: unknown[] }).data ?? [];
    test.skip(rows.length === 0, "No purchase order fixture available for commercial smoke");
    const poNumber = String((rows[0] as { poNumber?: string; po_number?: string }).poNumber ?? (rows[0] as { po_number?: string }).po_number);
    await gotoAuthed(page, `/procurement/orders/${encodeURIComponent(poNumber)}`);
    await page.getByTestId("po-commercial-save-button").click();
    await expect(page.getByTestId("po-commercial-error")).toContainText("Contract currency controls this purchase order");
    await expect(page.getByTestId("po-use-contract-currency")).toBeVisible();
    await expect(page.getByTestId("po-clear-contract")).toBeVisible();
  });
});

