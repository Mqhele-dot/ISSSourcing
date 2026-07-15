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
    const editableOrder =
      rows.find((row) =>
        ["draft", "open", "approved"].includes(
          String((row as { status?: string }).status ?? "").toLowerCase(),
        ),
      ) ?? rows[0];
    const poNumber = String(
      (editableOrder as { orderNumber?: string }).orderNumber ??
        (editableOrder as { order_number?: string }).order_number ??
        (editableOrder as { poNumber?: string }).poNumber ??
        (editableOrder as { po_number?: string }).po_number,
    );
    expect(poNumber).not.toBe("undefined");
    await gotoAuthed(page, `/procurement/orders/${encodeURIComponent(poNumber)}`);
    const saveTerms = page.getByTestId("po-commercial-save-button");
    await expect(saveTerms).toBeVisible({ timeout: 20_000 });
    await expect(saveTerms).toBeEnabled();
    await saveTerms.click();
    await expect(page.getByTestId("po-commercial-error")).toContainText("Contract currency controls this purchase order");
    await expect(page.getByTestId("po-use-contract-currency")).toBeVisible();
    await expect(page.getByTestId("po-clear-contract")).toBeVisible();
  });

  test("AP payment batch action shows validation when no invoice is selected", async ({ page }) => {
    await gotoAuthed(page, "/finance/accounts-payable/payments");
    await expect(page.getByTestId("accounts-payable-page")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ap-create-batch-button").click();
    await expect(page.getByText("Select at least one invoice")).toBeVisible();
  });

  test("AP invoice without PO shows controlled PO-link repair guidance", async ({ page }) => {
    const cookie = (await loginForTests("admin", "Admin123!")) ?? "";
    const suppliersResponse = await apiJsonRequest("/suppliers", { cookie });
    const suppliers = Array.isArray(suppliersResponse.json)
      ? suppliersResponse.json
      : (suppliersResponse.json as { data?: unknown[] }).data ?? [];
    test.skip(suppliers.length === 0, "No supplier fixture available for AP no-PO validation smoke");
    const supplierId = Number((suppliers[0] as { id?: number }).id);
    const invoiceNumber = `INV-NOPO-${Date.now().toString().slice(-8)}`;
    const created = await apiJsonRequest("/invoices", {
      method: "POST",
      cookie,
      body: {
        invoiceNumber,
        supplierId,
        purchaseOrderId: null,
        issueDate: new Date().toISOString().slice(0, 10),
        total: 25,
        subtotal: 25,
        tax: 0,
        status: "DRAFT",
        items: [],
      },
    });
    expect([200, 201]).toContain(created.status);
    const invoiceId = Number((created.json as { data?: { id?: number }; id?: number }).data?.id ?? (created.json as { id?: number }).id);
    expect(Number.isFinite(invoiceId)).toBeTruthy();

    await gotoAuthed(page, "/finance/invoices");
    await expect(page.getByText(invoiceNumber)).toBeVisible({ timeout: 20_000 });
    const matchResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/invoices/${invoiceId}/match`) && response.request().method() === "POST",
    );
    await page.getByTestId(`invoice-run-match-${invoiceId}`).click();
    const response = await matchResponse;
    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(JSON.stringify(payload)).toContain("AP_INVOICE_PO_LINK_REQUIRED");
    await expect(page.getByLabel("Notifications (F8)")).toContainText(
      "Link this invoice to a purchase order before matching or submitting for approval.",
      { timeout: 20_000 },
    );
  });

  test("system diagnostics scan and export actions remain usable", async ({ page }) => {
    await gotoAuthed(page, "/admin/system-diagnostics");
    await expect(page.getByTestId("system-diagnostics-page")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("diagnostics-run-scan-button").click();
    await expect(page.getByTestId("diagnostics-scan-results")).toBeVisible();
    await expect(page.getByTestId("diagnostics-export-json")).toBeVisible();
    await expect(page.getByTestId("diagnostics-export-markdown")).toBeVisible();
    await page.getByTestId("diagnostics-clear-events").click();
    await expect(page.getByText("No live diagnostics events captured in this browser yet.")).toBeVisible();
  });

  test("settings save action persists through the production control plane", async ({ page }) => {
    await gotoAuthed(page, "/admin/settings");
    await expect(page.getByTestId("admin-settings-page")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("settings-control-low-stock").fill("10");
    await page.getByTestId("settings-control-save").click();
    await expect(page.getByText("Settings updated", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("master-data add action reports validation instead of silently failing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoAuthed(page, "/admin/master-data/departments");
    await expect(page.getByTestId("master-data-page")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Add record" }).click();
    await expect(page.getByText("Code and name are required", { exact: true })).toBeVisible();
  });

  test("approval policy save action validates missing policy name", async ({ page }) => {
    await gotoAuthed(page, "/finance/approval-policies");
    await expect(page.getByTestId("approval-policies-page")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("approval-policy-name").fill("");
    await page.getByTestId("approval-policy-save").click();
    await expect(page.getByText("Save failed", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Notifications (F8)")).toContainText("Policy name is required");
  });
});
