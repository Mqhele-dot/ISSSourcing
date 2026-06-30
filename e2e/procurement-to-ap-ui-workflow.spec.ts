import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./test-helpers";
import { apiJsonRequest, loginForTests } from "../scripts/test-http.ts";
import {
  createSentWorkflowPo,
  ensureWorkflowFixture,
  receiveWorkflowPo,
  unwrapData,
  type WorkflowFixture,
  type WorkflowPo,
} from "../scripts/workflow-proof-fixtures.ts";

type InvoiceResult = {
  id: number;
  invoiceNumber: string;
  status: string;
  total: number;
};

type MatchResult = {
  matched: boolean;
  matchResult: { status: string; matchType: string; mismatchCount: number };
  mismatches: Array<{ code?: string; message?: string }>;
};

async function createInvoice(cookie: string, params: {
  invoiceNumber: string;
  supplierId: number;
  poId: number;
  itemId: number;
  quantity: number;
  unitPrice: number;
}) {
  const total = Number((params.quantity * params.unitPrice).toFixed(2));
  const res = await apiJsonRequest("/ap/invoices", {
    method: "POST",
    cookie,
    body: {
      supplierId: params.supplierId,
      purchaseOrderId: params.poId,
      invoiceNumber: params.invoiceNumber,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: "DRAFT",
      subtotal: total,
      tax: 0,
      total,
      dueAmount: total,
      items: [
        {
          itemId: params.itemId,
          description: `Browser workflow invoice ${params.invoiceNumber}`,
          quantity: params.quantity,
          unitPrice: params.unitPrice,
          taxRate: 0,
          taxAmount: 0,
          totalPrice: total,
        },
      ],
    },
  });
  assert.equal(res.status, 201, `create invoice failed: ${res.status} ${JSON.stringify(res.json)}`);
  return unwrapData<InvoiceResult>(res.json, "create invoice");
}

async function runMatch(cookie: string, invoiceId: number) {
  const res = await apiJsonRequest(`/ap/invoices/${invoiceId}/match`, {
    method: "POST",
    cookie,
    body: { priceTolerancePct: 0, quantityTolerancePct: 0, taxTolerancePct: 0 },
  });
  assert.equal(res.status, 200, `match invoice failed: ${res.status} ${JSON.stringify(res.json)}`);
  return unwrapData<MatchResult>(res.json, "match invoice");
}

async function approveMatchedInvoice(cookie: string, invoiceId: number) {
  const submit = await apiJsonRequest(`/ap/invoices/${invoiceId}/submit-approval`, {
    method: "POST",
    cookie,
    body: {},
  });
  assert.equal(submit.status, 200, `submit invoice failed: ${submit.status} ${JSON.stringify(submit.json)}`);

  const approve = await apiJsonRequest(`/ap/invoices/${invoiceId}/approve`, {
    method: "POST",
    cookie,
    body: {
      adminOverride: true,
      overrideReason: "Browser workflow proof uses the seeded admin account.",
      comment: "Browser workflow AP approval after successful PO/GRN match",
    },
  });
  assert.equal(approve.status, 200, `approve invoice failed: ${approve.status} ${JSON.stringify(approve.json)}`);
}

test.describe.configure({ mode: "serial" });

test.describe("procurement to AP browser workflow", () => {
  let adminCookie: string;
  let receiveFixture: WorkflowFixture;
  let receivePo: WorkflowPo;
  let matchedInvoiceNumber: string;
  let exceptionInvoiceNumber: string;

  test.beforeAll(async () => {
    adminCookie = (await loginForTests("admin", "Admin123!")) ?? "";
    assert.ok(adminCookie, "admin login cookie is required for browser workflow setup");

    receiveFixture = await ensureWorkflowFixture("uie2e-recv");
    receivePo = await createSentWorkflowPo(adminCookie, receiveFixture, 3);

    const matchedFixture = await ensureWorkflowFixture("uie2e-ap");
    const matchedPo = await createSentWorkflowPo(adminCookie, matchedFixture, 2);
    const matchedReceive = await receiveWorkflowPo(
      adminCookie,
      matchedPo.poNumber,
      matchedFixture,
      2,
      `GRN-UI-${matchedFixture.suffix}`,
    );
    assert.equal(matchedReceive.status, 200, `receive matched PO failed: ${JSON.stringify(matchedReceive.json)}`);
    matchedInvoiceNumber = `INV-UI-MATCH-${matchedFixture.suffix}`;
    const matchedInvoice = await createInvoice(adminCookie, {
      invoiceNumber: matchedInvoiceNumber,
      supplierId: matchedFixture.supplierId,
      poId: matchedPo.poId,
      itemId: matchedFixture.itemId,
      quantity: 2,
      unitPrice: 100,
    });
    const matched = await runMatch(adminCookie, matchedInvoice.id);
    assert.equal(matched.matched, true, `expected matched invoice: ${JSON.stringify(matched)}`);
    await approveMatchedInvoice(adminCookie, matchedInvoice.id);

    const exceptionFixture = await ensureWorkflowFixture("uie2e-exc");
    const exceptionPo = await createSentWorkflowPo(adminCookie, exceptionFixture, 2);
    const exceptionReceive = await receiveWorkflowPo(
      adminCookie,
      exceptionPo.poNumber,
      exceptionFixture,
      1,
      `GRN-UIX-${exceptionFixture.suffix}`,
    );
    assert.equal(exceptionReceive.status, 200, `receive exception PO failed: ${JSON.stringify(exceptionReceive.json)}`);
    exceptionInvoiceNumber = `INV-UI-EXC-${exceptionFixture.suffix}`;
    const exceptionInvoice = await createInvoice(adminCookie, {
      invoiceNumber: exceptionInvoiceNumber,
      supplierId: exceptionFixture.supplierId,
      poId: exceptionPo.poId,
      itemId: exceptionFixture.itemId,
      quantity: 2,
      unitPrice: 140,
    });
    const exceptionMatch = await runMatch(adminCookie, exceptionInvoice.id);
    assert.equal(exceptionMatch.matched, false, "above-tolerance invoice should stay blocked for browser proof");
  });

  test("receives a PO, shows inventory update, and surfaces AP match controls", async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto(`/m/receive/${encodeURIComponent(receivePo.poNumber)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mobile-receive-detail")).toBeVisible();
    await expect(page.getByText(receivePo.poNumber)).toBeVisible();
    await expect(page.getByText(receiveFixture.sku)).toBeVisible();
    await expect(page.getByText(/Ordered 3/i)).toBeVisible();
    await expect(page.getByText(/Received 0/i)).toBeVisible();
    await expect(page.getByText(/Remaining 3/i)).toBeVisible();
    await expect(page.getByLabel("Receiver name")).toBeVisible();
    await expect(page.getByLabel("GRN number")).toBeVisible();

    await page.getByTestId("mobile-receive-warehouse-select").click();
    await page.getByRole("option", { name: new RegExp(`Workflow Warehouse ${receiveFixture.suffix}`) }).click();
    await page.getByTestId("mobile-receive-aisle-select").click();
    await page.getByRole("option", { name: "A1" }).click();
    await page.getByTestId("mobile-receive-bin-select").click();
    await page.getByRole("option", { name: "B1" }).click();
    await page.getByLabel("Receiver name").fill("Browser Receiver");
    await page.getByLabel("GRN number").fill(`GRN-BROWSER-${receiveFixture.suffix}`);
    await page.getByTestId(`mobile-receive-qty-${receiveFixture.sku}`).fill("3");
    await page.getByTestId("mobile-receive-post-button").click();

    await expect(page.getByText(/receipt posted|PO receive processed|no remaining quantity/i)).toBeVisible({
      timeout: 20_000,
    });

    await page.goto("/inventory", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inventory-page")).toBeVisible();
    await page.getByTestId("inventory-search-input").fill(receiveFixture.sku);
    const inventoryRow = page.getByTestId(`inventory-row-${receiveFixture.sku}`);
    await expect(inventoryRow).toBeVisible({ timeout: 20_000 });
    await expect(inventoryRow.locator("[data-on-hand]")).toHaveAttribute("data-on-hand", "3");

    await page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(matchedInvoiceNumber)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Receipt evidence: PO\/GRN match checked/i)).toBeVisible();
    await expect(page.getByText(/PAYMENT READY|MATCHED/i)).toBeVisible();
    await expect(page.getByText(exceptionInvoiceNumber)).toBeVisible();
    await expect(page.getByText(/PAYMENT BLOCKED/i)).toBeVisible();

    await page.goto("/finance/accounts-payable/payments", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("accounts-payable-page")).toBeVisible();
    await expect(page.getByText(/PO\/GRN match/i)).toBeVisible();
    await expect(page.getByText(/pending-match invoices stay blocked/i)).toBeVisible();
    await expect(page.getByText(matchedInvoiceNumber)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(exceptionInvoiceNumber)).toHaveCount(0);
  });
});
