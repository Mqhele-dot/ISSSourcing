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
    await gotoAuthed(page, "/inventory");
    await expect(page.getByTestId("inventory-page")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("inventory-row-SKU-A")).toBeVisible({ timeout: 45000 });

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

    await page.getByTestId("inventory-search-input").fill("SKU-A");
    await expect(async () => expect(await visibleFqaSkus(page)).toEqual(["SKU-A"])).toPass({ timeout: 20000 });

    await page.getByTestId("inventory-search-input").fill("");
    await expect(async () =>
      expect((await visibleFqaSkus(page)).sort()).toEqual([...FQA_SKU_LIST].sort()),
    ).toPass({ timeout: 20000 });

    await clearAll();
    await page.getByTestId("inventory-category-filter").click();
    await page.getByRole("option", { name: "Electronics" }).click();
    await expect(async () =>
      expect((await visibleFqaSkus(page)).sort()).toEqual(["SKU-A", "SKU-B"].sort()),
    ).toPass({ timeout: 20000 });

    await clearAll();
    await page.getByTestId("inventory-location-filter").click();
    await page.getByRole("option", { name: "Johannesburg" }).click();
    await expect(async () =>
      expect((await visibleFqaSkus(page)).sort()).toEqual(["SKU-A", "SKU-D"].sort()),
    ).toPass({ timeout: 20000 });

    await clearAll();
    await page.getByTestId("inventory-low-stock-filter").click();
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

    const poTable = page.locator('[data-tour="po-list"] table');
    await page.getByPlaceholder(/search po number/i).fill("PO-FQA-001");
    await expect(poTable.getByText("PO-FQA-001").first()).toBeVisible({ timeout: 15000 });

    await page.getByPlaceholder(/search po number/i).fill("");
    await page.getByPlaceholder(/status/i).fill("approved");
    await expect(poTable.getByText("PO-FQA-002").first()).toBeVisible({ timeout: 15000 });
    await expect(poTable.locator("tbody").getByRole("cell", { name: "PO-FQA-001", exact: true })).toHaveCount(0);

    await page.getByPlaceholder(/status/i).fill("received");
    await expect(poTable.getByText("PO-FQA-003").first()).toBeVisible({ timeout: 15000 });

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
    await expect(page.getByTestId("purchase-orders-page")).toBeVisible({ timeout: 30000 });
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
