import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";
import { expectFqaSkusSorted, FQA_SKU_LIST, skusFromOperationalExportCsv, visibleFqaSkus } from "./fqa-helpers";
import { FQA_INVENTORY_MASTER, FQA_SKUS } from "../shared/functional-qa-constants";

/**
 * Business-correctness audit against `seed:functional-qa` (runs in global-setup unless SKIP_E2E_FUNCTIONAL_QA_SEED=1).
 * Serial: shared session and deterministic table state.
 */
test.describe.configure({ mode: "serial" });

test.describe("Functional QA audit (FQA seed, business output)", () => {
  test("inventory: exact seeded rows, filters, stock math, status, clear, CSV export parity", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90000);
    await gotoAuthed(page, "/inventory");
    await expect(page.getByTestId("inventory-page")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("inventory-row-SKU-A")).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId("inventory-kpi-total-skus")).toBeVisible();
    await expect(page.getByTestId("inventory-kpi-low-stock")).toBeVisible();
    await expect(page.getByTestId("inventory-kpi-negative-availability")).toBeVisible();
    await expect(page.getByTestId("inventory-kpi-total-on-hand")).toBeVisible();
    await expect(page.getByTestId("inventory-kpi-total-allocated")).toBeVisible();
    await expect(page.getByTestId("inventory-kpi-total-available")).toBeVisible();

    const clearAll = async () => {
      await page.getByRole("button", { name: /clear filters/i }).click();
      await page.waitForTimeout(400);
    };

    await clearAll();
    await expectFqaSkusSorted(page, FQA_SKU_LIST);

    for (const sku of FQA_SKUS) {
      const row = page.getByTestId(`inventory-row-${sku}`);
      const exp = FQA_INVENTORY_MASTER[sku];
      const stock = row.locator("[data-available]");
      expect(Number(await stock.getAttribute("data-on-hand"))).toBe(exp.quantity);
      expect(Number(await stock.getAttribute("data-allocated"))).toBe(exp.allocatedUi);
      expect(Number(await stock.getAttribute("data-available"))).toBe(exp.availableUi);
      expect(Number(await stock.getAttribute("data-on-hand")) - Number(await stock.getAttribute("data-allocated"))).toBe(
        exp.availableUi,
      );
    }

    await expect(page.getByTestId("inventory-status-SKU-D")).toContainText(/error/i, { timeout: 5000 });
    await expect(page.getByTestId("inventory-status-SKU-B")).toContainText(/low/i, { timeout: 5000 });

    await page.getByTestId("inventory-sort-select").click();
    await page.getByRole("option", { name: /available low to high/i }).click();
    await expect(page.getByTestId("inventory-row-SKU-D")).toBeVisible();

    await page.getByTestId("inventory-view-cards-button").click();
    await expect(page.getByTestId("inventory-card-SKU-A")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("inventory-card-SKU-D").click();
    await expect(page.getByTestId("inventory-item-preview")).toBeVisible();
    await expect(page.getByTestId("inventory-item-preview-title")).toBeVisible();
    await expect(page.getByTestId("inventory-item-preview-status")).toContainText(/negative availability|error/i);
    await expect(page.getByTestId("inventory-item-preview")).toContainText("SKU-D");
    await expect(page.getByTestId("inventory-item-preview")).toContainText("-2");
    await page.getByTestId("inventory-item-preview-close").click();
    await page.getByTestId("inventory-view-table-button").click();

    await page.getByTestId("inventory-row-preview-SKU-A").click();
    await expect(page.getByTestId("inventory-item-preview")).toBeVisible();
    await page.getByTestId("inventory-item-preview-open-full").click();
    await expect(page).toHaveURL(/\/inventory\/SKU-A/);
    await gotoAuthed(page, "/inventory");
    await expect(page.getByTestId("inventory-page")).toBeVisible({ timeout: 30000 });
    await clearAll();

    await page.getByTestId("inventory-search-input").fill("SKU-A");
    await expect(page.getByTestId("inventory-active-filters")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("inventory-filter-chip-search")).toContainText("SKU-A");
    await expect(async () => expect(await visibleFqaSkus(page)).toEqual(["SKU-A"])).toPass({ timeout: 20000 });

    await page.getByTestId("inventory-search-input").fill("");
    await expect(async () =>
      expect((await visibleFqaSkus(page)).sort()).toEqual([...FQA_SKU_LIST].sort()),
    ).toPass({ timeout: 20000 });

    await clearAll();
    await page.getByTestId("inventory-category-filter").click();
    await page.getByRole("option", { name: "Electronics" }).click();
    await expect(page.getByTestId("inventory-filter-chip-category")).toBeVisible();
    await expect(async () =>
      expect((await visibleFqaSkus(page)).sort()).toEqual(["SKU-A", "SKU-B"].sort()),
    ).toPass({ timeout: 20000 });

    await clearAll();
    await page.getByTestId("inventory-location-filter").click();
    await page.getByRole("option", { name: "Johannesburg" }).click();
    await expect(page.getByTestId("inventory-filter-chip-location")).toBeVisible();
    await expect(async () =>
      expect((await visibleFqaSkus(page)).sort()).toEqual(["SKU-A", "SKU-D"].sort()),
    ).toPass({ timeout: 20000 });

    await clearAll();
    await page.getByTestId("inventory-low-stock-filter").click();
    await expect(page.getByTestId("inventory-filter-chip-low-stock")).toBeVisible();
    await expect(async () =>
      expect((await visibleFqaSkus(page)).sort()).toEqual(["SKU-B", "SKU-D"].sort()),
    ).toPass({ timeout: 20000 });

    await clearAll();
    await page.getByTestId("inventory-category-filter").click();
    await page.getByRole("option", { name: "Consumables" }).click();
    await page.getByTestId("inventory-low-stock-filter").click();
    await expect(async () => expect(await visibleFqaSkus(page)).toEqual(["SKU-D"])).toPass({ timeout: 20000 });

    await clearAll();
    await expect(page.getByTestId("inventory-search-input")).toHaveValue("");
    await expectFqaSkusSorted(page, FQA_SKU_LIST);

    const origin = baseURL ?? "http://127.0.0.1:5000";
    const r1 = await page.request.get(`${origin}/api/export/inventory/csv?q=SKU-A`);
    expect(r1.ok()).toBeTruthy();
    const skus1 = skusFromOperationalExportCsv(await r1.text());
    expect(skus1).toContain("SKU-A");
    expect(skus1).not.toContain("SKU-B");
    expect(skus1).not.toContain("SKU-C");
    expect(skus1).not.toContain("SKU-D");

    const r2 = await page.request.get(`${origin}/api/export/inventory/csv?low=1`);
    expect(r2.ok()).toBeTruthy();
    const skus2 = skusFromOperationalExportCsv(await r2.text());
    const fqaLow = skus2.filter((s) => /^SKU-[A-D]$/.test(s)).sort();
    expect(fqaLow).toEqual(["SKU-B", "SKU-D"].sort());
  });

  test("AP payments: batch totals 1250 then 1550, toggle idempotent", async ({ page }) => {
    await gotoAuthed(page, "/finance/accounts-payable/payments");
    await expect(page.getByTestId("accounts-payable-page")).toBeVisible({ timeout: 30000 });

    const row1 = page.getByTestId("ap-ready-invoice-row-INV-FQA-001");
    const row2 = page.getByTestId("ap-ready-invoice-row-INV-FQA-002");
    await expect(row1).toBeVisible({ timeout: 20000 });
    await expect(row2).toBeVisible();

    const totalEl = page.getByTestId("ap-selected-batch-total");
    await expect(totalEl).toHaveAttribute("data-batch-total-cents", "0");

    await page.getByTestId("ap-ready-invoice-checkbox-INV-FQA-001").click();
    await page.getByTestId("ap-ready-invoice-checkbox-INV-FQA-002").click();
    await expect(totalEl).toHaveAttribute("data-batch-total-cents", "125000");

    await page.getByTestId("ap-ready-invoice-checkbox-INV-FQA-001").click();
    await page.getByTestId("ap-ready-invoice-checkbox-INV-FQA-001").click();
    await expect(totalEl).toHaveAttribute("data-batch-total-cents", "125000");

    await page.getByTestId("ap-ready-invoice-checkbox-INV-FQA-003").click();
    await expect(totalEl).toHaveAttribute("data-batch-total-cents", "155000");
  });

  test("AP payments: empty selection shows validation", async ({ page }) => {
    await gotoAuthed(page, "/finance/accounts-payable/payments");
    await expect(page.getByTestId("accounts-payable-page")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("ap-create-batch-button").click();
    await expect(page.getByText(/select at least one invoice/i)).toBeVisible({ timeout: 8000 });
  });

  test("PO FQA: filters, header = line sum, API totals", async ({ page, baseURL }) => {
    await gotoAuthed(page, "/procurement/orders");
    await expect(page.getByTestId("purchase-orders-page")).toBeVisible({ timeout: 30000 });

    await expect(page.getByTestId("po-kpi-total")).toBeVisible();
    await expect(page.getByTestId("po-kpi-open")).toBeVisible();
    await expect(page.getByTestId("po-kpi-approved")).toBeVisible();
    await expect(page.getByTestId("po-kpi-sent")).toBeVisible();
    await expect(page.getByTestId("po-kpi-received")).toBeVisible();
    await page.getByTestId("po-search-input").fill("PO-FQA");
    await expect(page.getByTestId("po-row-PO-FQA-001")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("po-kpi-total-value")).toContainText(/4,?000|4000/);

    await page.getByTestId("po-sort-select").click();
    await page.getByRole("option", { name: /total high to low/i }).click();
    await expect(page.getByTestId("po-table")).toBeVisible();

    await page.getByTestId("po-search-input").fill("PO-FQA-001");
    await expect(page.getByTestId("po-active-filters")).toBeVisible();
    await expect(page.getByTestId("po-filter-chip-search")).toContainText("PO-FQA-001");
    await expect(page.getByTestId("po-row-PO-FQA-001")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("po-row-PO-FQA-002")).toHaveCount(0);

    await page.getByTestId("po-clear-filters-button").click();
    await page.getByTestId("po-status-filter").click();
    await page.getByRole("option", { name: "Approved" }).click();
    await expect(page.getByTestId("po-filter-chip-status")).toContainText(/approved/i);
    await expect(page.getByTestId("po-row-PO-FQA-002")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("po-row-PO-FQA-001")).toHaveCount(0);

    await page.getByTestId("po-status-filter").click();
    await page.getByRole("option", { name: "Received", exact: true }).click();
    await expect(page.getByTestId("po-row-PO-FQA-003")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("po-clear-filters-button").click();
    await page.getByTestId("po-row-preview-PO-FQA-001").click();
    await expect(page.getByTestId("po-preview-panel")).toBeVisible();
    await expect(page.getByTestId("po-preview-title")).toContainText("PO-FQA-001");
    await expect(page.getByTestId("po-preview-status")).toContainText(/open/i);
    await expect(page.getByTestId("po-preview-total")).toContainText(/1,?000|1000/);
    await expect(page.getByTestId("po-preview-panel")).toContainText(/0%|received progress/i);
    await page.getByTestId("po-preview-open-full").click();
    await expect(page).toHaveURL(/\/procurement\/orders\/PO-FQA-001/);
    await expect(page.getByTestId("po-detail-page")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("po-detail-title")).toContainText("PO-FQA-001");
    await expect(page.getByTestId("po-detail-total")).toContainText(/1,?000|1000/);
    await expect(page.getByTestId("po-quick-print-button")).toBeVisible();
    const popupPromise = page.waitForEvent("popup");
    await page.getByTestId("po-quick-print-button").click();
    const popup = await popupPromise;
    await expect(popup.locator("body")).not.toContainText("$");
    await popup.close();

    await gotoAuthed(page, "/procurement/orders/PO-FQA-002");
    await expect(page.getByTestId("po-detail-page")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("po-receive-qty-SKU-A").first().fill("999");
    await page.getByTestId("po-receive-submit-button").click();
    await expect(page.getByTestId("po-receive-error")).toContainText(/cannot exceed remaining quantity/i);

    const origin = baseURL ?? "http://127.0.0.1:5000";
    const listRes = await page.request.get(`${origin}/api/purchase/orders?q=PO-FQA-001`);
    expect(listRes.ok()).toBeTruthy();
    const listRaw = (await listRes.json()) as { ok?: boolean; data?: Array<{ totalAmount: number; poNumber: string }> };
    const rows = listRaw.ok && Array.isArray(listRaw.data) ? listRaw.data : [];
    const po1 = rows.find((r) => r.poNumber === "PO-FQA-001");
    expect(po1?.totalAmount).toBe(1000);

    const detailRes = await page.request.get(`${origin}/api/purchase/orders/${encodeURIComponent("PO-FQA-001")}`);
    expect(detailRes.ok()).toBeTruthy();
    const detailRaw = (await detailRes.json()) as {
      ok?: boolean;
      data?: { totalAmount: number; lines?: Array<{ qtyOrdered: number; unitPrice: number }> };
    };
    const d = detailRaw.ok ? detailRaw.data : undefined;
    expect(d?.totalAmount).toBe(1000);
    const lineSum = d?.lines?.reduce((s, l) => s + Number(l.qtyOrdered) * Number(l.unitPrice), 0) ?? 0;
    expect(lineSum).toBe(1000);

    const poAllRes = await page.request.get(`${origin}/api/purchase/orders?q=PO-FQA`);
    expect(poAllRes.ok()).toBeTruthy();
    const poAllRaw = (await poAllRes.json()) as { ok?: boolean; data?: Array<{ totalAmount: number; poNumber: string }> };
    const poRows = poAllRaw.ok && Array.isArray(poAllRaw.data) ? poAllRaw.data : [];
    const fqaPo = poRows.filter((r) => /^PO-FQA-/.test(r.poNumber));
    const sumPo = fqaPo.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
    expect(sumPo).toBe(1000 + 2500 + 500);
  });

  test("requisitions: tab URLs, REQ-FQA-001, new form back", async ({ page }) => {
    await gotoAuthed(page, "/procurement/orders");
    await expect(page).toHaveURL(/\/procurement\/orders/);
    await expect(page.getByTestId("purchase-orders-page")).toBeVisible({ timeout: 30000 });

    await page.goto("/procurement/requisitions?status=PENDING");
    await expect(page.getByTestId("requisitions-page")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("REQ-FQA-001")).toBeVisible({ timeout: 20000 });

    await page.goto("/procurement/orders");
    await expect(page).toHaveURL(/\/procurement\/orders/);
    await page.goBack();
    await expect(page).toHaveURL(/\/procurement\/requisitions/);

    await page.getByRole("link", { name: /new requisition/i }).first().click();
    await expect(page).toHaveURL(/\/procurement\/requisitions\/new/);
    await page.goBack();
    await expect(page).toHaveURL(/\/procurement\/requisitions/);
  });

  test("analytics: inventory-value and category rollups; reports analytics date window", async ({ page, baseURL }) => {
    await gotoAuthed(page, "/analytics/overview");
    await expect(page.getByTestId("page-title")).toBeVisible({ timeout: 30000 });

    const origin = baseURL ?? "http://127.0.0.1:5000";
    const res = await page.request.get(`${origin}/api/analytics/inventory-value`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      items?: Array<{ sku?: string; value?: number; categoryId?: number | null; categoryName?: string | null }>;
    };
    const items = body.items ?? [];
    const fqa = items.filter((i) => i.sku && /^SKU-[A-D]$/.test(String(i.sku)));
    expect(fqa.length).toBe(4);
    const sumVal = fqa.reduce((s, i) => s + Number(i.value ?? 0), 0);
    expect(sumVal).toBe(10 * 5 + 4 * 5 + 20 * 5 + 0 * 5);

    const byCat = new Map<string, number>();
    for (const row of fqa) {
      const k = String(row.categoryName ?? "none");
      byCat.set(k, (byCat.get(k) ?? 0) + Number(row.value ?? 0));
    }
    expect(byCat.get("Electronics")).toBe(70);
    expect(byCat.get("Consumables")).toBe(100);

    const inv = await page.request.get(`${origin}/api/ap/invoices`);
    expect(inv.ok()).toBeTruthy();
    const invRaw = (await inv.json()) as
      | { ok: true; data: Array<{ invoiceNumber: string; total: number | null; dueAmount: number | null }> }
      | Array<{ invoiceNumber: string; total: number | null; dueAmount: number | null }>;
    const invList = Array.isArray(invRaw) ? invRaw : invRaw.ok ? invRaw.data : [];
    const fqaRows = invList.filter((r) => /^INV-FQA-/.test(r.invoiceNumber));
    expect(fqaRows.length).toBe(3);
    let sumDollars = 0;
    for (const r of fqaRows) {
      const due = r.dueAmount;
      const useDue = due != null && Number.isFinite(Number(due));
      sumDollars += useDue ? Number(due) : Number(r.total ?? 0);
    }
    expect(sumDollars).toBe(1550);

    const future = encodeURIComponent("2099-01-01T00:00:00.000Z");
    const futureEnd = encodeURIComponent("2099-12-31T23:59:59.999Z");
    const ra = await page.request.get(`${origin}/api/reports/analytics?from=${future}&to=${futureEnd}`);
    expect(ra.ok()).toBeTruthy();
    const raRaw = (await ra.json()) as { ok?: boolean; data?: { spendBySupplier?: Array<{ totalSpend: number }> } };
    const analyticsData = raRaw.ok && raRaw.data ? raRaw.data : (raRaw as { spendBySupplier?: unknown });
    const spend = ("spendBySupplier" in analyticsData ? analyticsData.spendBySupplier : []) as Array<{ totalSpend: number }>;
    const maxSpend = spend.length ? Math.max(...spend.map((s) => Number(s.totalSpend ?? 0))) : 0;
    expect(maxSpend).toBe(0);
  });

  test("reports inventory: category filter updates preview; export CSV FQA subset matches", async ({ page, baseURL }) => {
    await gotoAuthed(page, "/analytics/reports/inventory");
    await expect(page.getByTestId("reports-page")).toBeVisible({ timeout: 30000 });

    const origin = baseURL ?? "http://127.0.0.1:5000";
    const catRes = await page.request.get(`${origin}/api/categories`);
    expect(catRes.ok()).toBeTruthy();
    const cats = (await catRes.json()) as Array<{ id: number; name: string }>;
    const electronics = (Array.isArray(cats) ? cats : []).find((c) => String(c?.name) === "Electronics");
    expect(electronics?.id).toBeTruthy();

    await page.getByTestId("reports-filter-category").click();
    await page.getByRole("option", { name: "Electronics" }).click();
    await expect(page.getByTestId("reports-inventory-preview-row-SKU-A")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("reports-inventory-preview-row-SKU-B")).toBeVisible();
    await expect(page.getByTestId("reports-inventory-preview-table")).not.toContainText("SKU-C");

    const csvRes = await page.request.get(`${origin}/api/export/inventory/csv?category=${electronics!.id}`);
    expect(csvRes.ok()).toBeTruthy();
    const skus = skusFromOperationalExportCsv(await csvRes.text());
    const fqa = skus.filter((s) => /^SKU-[A-D]$/.test(s));
    expect(fqa.sort()).toEqual(["SKU-A", "SKU-B"].sort());
  });

  test("export center: shell loads", async ({ page }) => {
    await gotoAuthed(page, "/analytics/export-center");
    await expect(page.getByTestId("export-center-page")).toBeVisible({ timeout: 30000 });
  });

  test("analytics overview: section nav and dashboard-stats anchor", async ({ page }) => {
    await gotoAuthed(page, "/analytics/overview");
    await expect(page.getByTestId("page-title")).toBeVisible({ timeout: 25000 });
    await expect(page.getByLabel(/section navigation/i)).toBeVisible();
    await expect(page.locator("#dashboard-stats")).toBeVisible();
    await expect(page.getByTestId("analytics-workspace-charts")).toBeVisible({ timeout: 20000 });
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
