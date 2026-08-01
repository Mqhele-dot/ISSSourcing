import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import { pool } from "../server/db";
import { apiJsonRequest, loginForTests } from "../scripts/test-http";
import {
  seedProcurementEvidenceFixture,
  unwrapData,
} from "../scripts/runtime-fixtures/procurement-line-evidence-fixture";
import {
  chooseSearchableOption,
  loginAsSeededUser,
  requireDisposableE2eDatabase,
} from "./wave7-helpers";

test.describe.configure({ mode: "serial" });

test.describe("manual procurement line browser evidence", () => {
  let fixture: Awaited<ReturnType<typeof seedProcurementEvidenceFixture>>;
  let adminCookie = "";
  let requisitionId = 0;
  let purchaseOrderId = 0;
  let purchaseOrderNumber = "";
  let invoiceNumber = "";

  test.beforeAll(async () => {
    requireDisposableE2eDatabase();
    fixture = await seedProcurementEvidenceFixture();
    adminCookie = (await loginForTests("admin", "Admin123!")) ?? "";
    assert.ok(adminCookie, "seeded admin cookie is required");
  });

  test("user sees validation, creates catalogue/non-stock/service lines, and submits", async ({ page }) => {
    await loginAsSeededUser(page, "admin", 1);
    await page.goto("/procurement/requisitions/new", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("requisition-form-page")).toBeVisible();

    await page.getByTestId("requisition-line-type-0-non_stock").click();
    await page.getByTestId("requisition-line-description-0").fill("Incomplete controlled line");
    await page.getByTestId("requisition-line-unit-price-0").fill("10");
    await page.getByTestId("requisition-save-button").click();
    await expect(page.getByText(/Add a valid catalogue or manual line/i)).toBeVisible();

    await chooseSearchableOption(
      page,
      page.getByRole("combobox", { name: "Select supplier" }),
      "Search supplier, code, email, or currency...",
      fixture.suffix,
      new RegExp(`Wave 7 Supplier ${fixture.suffix}`),
    );
    await chooseSearchableOption(
      page,
      page.getByRole("combobox", { name: "Select department" }),
      "Search department code or name...",
      fixture.suffix,
      new RegExp(`Wave 7 Department ${fixture.suffix}`),
    );
    await page.getByLabel("Required date").fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
    await page.getByLabel("Justification").fill(`Wave 7 browser mixed-line ${fixture.suffix}`);

    await page.getByTestId("requisition-line-type-0-catalog").click();
    await chooseSearchableOption(
      page,
      page.getByTestId("requisition-line-item-0"),
      "Search item name, SKU, or supplier part...",
      fixture.suffix,
      new RegExp(`Wave 7 Item ${fixture.suffix}`),
    );
    await chooseSearchableOption(
      page,
      page.getByTestId("requisition-line-cost-centre-0"),
      "Search cost centre...",
      fixture.suffix,
      new RegExp(`Wave 7 Cost Centre ${fixture.suffix}`),
    );

    await page.getByTestId("requisition-add-line-button").click();
    await page.getByTestId("requisition-line-type-1-non_stock").click();
    await page.getByTestId("requisition-line-description-1").fill("Temporary site consumables");
    await page.getByTestId("requisition-line-reason-1").fill("One-time purchase outside the maintained catalogue");
    await page.getByTestId("requisition-line-qty-1").fill("3");
    await page.getByTestId("requisition-line-unit-price-1").fill("40");
    await chooseSearchableOption(page, page.getByTestId("requisition-line-uom-1"), "Search unit code or name...", fixture.suffix, new RegExp(`Wave 7 Each ${fixture.suffix}`));
    await chooseSearchableOption(page, page.getByTestId("requisition-line-tax-1"), "Search tax code or name...", fixture.suffix, new RegExp(`Wave 7 VAT ${fixture.suffix}`));
    await chooseSearchableOption(page, page.getByTestId("requisition-line-cost-centre-1"), "Search cost centre...", fixture.suffix, new RegExp(`Wave 7 Cost Centre ${fixture.suffix}`));

    await page.getByTestId("requisition-add-line-button").click();
    await page.getByTestId("requisition-line-type-2-service").click();
    await page.getByTestId("requisition-line-description-2").fill("Equipment calibration service");
    await page.getByTestId("requisition-line-reason-2").fill("Specialist service is not stocked");
    await page.getByTestId("requisition-line-qty-2").fill("1");
    await page.getByTestId("requisition-line-unit-price-2").fill("600");
    await chooseSearchableOption(page, page.getByTestId("requisition-line-uom-2"), "Search unit code or name...", fixture.suffix, new RegExp(`Wave 7 Each ${fixture.suffix}`));
    await chooseSearchableOption(page, page.getByTestId("requisition-line-tax-2"), "Search tax code or name...", fixture.suffix, new RegExp(`Wave 7 VAT ${fixture.suffix}`));
    await chooseSearchableOption(page, page.getByTestId("requisition-line-cost-centre-2"), "Search cost centre...", fixture.suffix, new RegExp(`Wave 7 Cost Centre ${fixture.suffix}`));

    await page.getByTestId("requisition-save-button").click();
    await expect(page).toHaveURL(/\/procurement\/requisitions$/, { timeout: 15_000 });
    await expect
      .poll(async () => {
        const result = await pool.query<{ id: number }>(
          `SELECT id FROM purchase_requisitions WHERE organization_id = 1 AND justification = $1 ORDER BY id DESC LIMIT 1`,
          [`Wave 7 browser mixed-line ${fixture.suffix}`],
        );
        requisitionId = result.rows[0]?.id ?? 0;
        return requisitionId;
      })
      .toBeGreaterThan(0);
  });

  test("approval and conversion preserve line evidence and lock the requisition", async ({ page }) => {
    const approve = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, {
      method: "POST",
      cookie: adminCookie,
      body: { comment: "Independent Wave 7 browser evidence approval" },
    });
    expect(approve.status).toBe(200);
    const convert = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/convert`, {
      method: "POST",
      cookie: adminCookie,
      body: {},
    });
    expect(convert.status).toBe(201);
    const po = unwrapData<{ id: number; orderNumber: string }>(convert.json, "convert browser requisition");
    purchaseOrderId = po.id;
    purchaseOrderNumber = po.orderNumber;

    await loginAsSeededUser(page, "admin", 1);
    await page.goto(`/procurement/requisitions/${requisitionId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("requisition-header-locked-message")).toBeVisible();
    await expect(page.getByTestId("requisition-save-button")).toBeDisabled();

    await page.goto(`/procurement/orders/${encodeURIComponent(purchaseOrderNumber)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("po-detail-page")).toBeVisible();
    await expect(page.getByTestId("po-line-catalog-1")).toContainText(`W7-ITEM-${fixture.suffix}`);
    await expect(page.getByTestId("po-line-non_stock-2")).toContainText("Temporary site consumables");
    await expect(page.getByTestId("po-line-service-3")).toContainText("Equipment calibration service");
    await expect(page.getByTestId("po-line-service-3")).toContainText("Service confirmation required");
  });

  test("AP invoice line links to the service PO line", async ({ page }) => {
    const poLinesResponse = await apiJsonRequest(`/purchase-orders/${purchaseOrderId}/items`, { cookie: adminCookie });
    const poLines = unwrapData<Array<Record<string, unknown>>>(poLinesResponse.json, "load PO lines");
    const serviceLine = poLines.find((line) => line.lineType === "SERVICE");
    assert.ok(serviceLine?.id, "service PO line is required");
    invoiceNumber = `W7-UI-INV-${fixture.suffix}`;
    const invoiceResponse = await apiJsonRequest("/invoices", {
      method: "POST",
      cookie: adminCookie,
      body: {
        supplierId: fixture.supplierId,
        purchaseOrderId,
        invoiceNumber,
        subtotal: 600,
        total: 600,
        dueAmount: 600,
        items: [{
          itemId: null,
          purchaseOrderItemId: serviceLine.id,
          lineType: "SERVICE",
          description: serviceLine.description,
          quantity: 1,
          unitPrice: 600,
          totalPrice: 600,
        }],
      },
    });
    expect(invoiceResponse.status).toBe(201);
    const invoice = unwrapData<{ id: number }>(invoiceResponse.json, "create service invoice");
    const invoiceItems = await apiJsonRequest(`/invoices/${invoice.id}/items`, { cookie: adminCookie });
    const linked = unwrapData<Array<Record<string, unknown>>>(invoiceItems.json, "load service invoice lines");
    expect(Number(linked[0]?.purchaseOrderItemId)).toBe(Number(serviceLine.id));

    await loginAsSeededUser(page, "admin", 1);
    await page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(invoiceNumber, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Awaiting PO\/GRN match/i).first()).toBeVisible();
  });
});
