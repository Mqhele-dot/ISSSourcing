/**
 * Runtime proof: AP invoice matching must use PO + GRN/receipt evidence, block
 * above-tolerance/unmatched payments, and audit match/payment decisions.
 */
import assert from "node:assert/strict";
import { pool } from "../server/db.ts";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";
import {
  assertActivityOrAuditRecord,
  createSentWorkflowPo,
  ensureWorkflowFixture,
  receiveWorkflowPo,
  unwrapData,
} from "./workflow-proof-fixtures.ts";

type InvoiceResult = {
  id: number;
  invoiceNumber: string;
  status: string;
  total: number;
  dueAmount?: number | null;
};

type MatchResult = {
  matched: boolean;
  recommendedNextState: string;
  matchResult: { id: number; status: string; matchType: string; mismatchCount: number; reviewedBy?: number };
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
          description: `Invoice line ${params.invoiceNumber}`,
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

async function main(): Promise<void> {
  const baseUrl = getTestBaseUrl();
  console.log("AP PO/GRN matching runtime flow (BASE_URL=%s)\n", baseUrl);

  let cookie: string | undefined;
  try {
    cookie = await loginForTests("admin", "Admin123!");
  } catch (error) {
    if (isConnectionRefused(error)) {
      console.log("  Server not reachable at %s - start with: npm run dev", baseUrl);
      exitTest(1);
      return;
    }
    throw error;
  }
  if (!cookie) throw new Error("Admin login failed; seed users are required.");

  const fixture = await ensureWorkflowFixture("ap");
  const po = await createSentWorkflowPo(cookie, fixture, 2);
  const receive = await receiveWorkflowPo(cookie, po.poNumber, fixture, 2, `GRN-AP-${fixture.suffix}`);
  assert.equal(receive.status, 200, `receive PO failed: ${receive.status} ${JSON.stringify(receive.json)}`);
  console.log("  ok PO received and AP receipt bridge is available");

  const matchedInvoice = await createInvoice(cookie, {
    invoiceNumber: `INV-MATCH-${fixture.suffix}`,
    supplierId: fixture.supplierId,
    poId: po.poId,
    itemId: fixture.itemId,
    quantity: 2,
    unitPrice: 100,
  });
  const matched = await runMatch(cookie, matchedInvoice.id);
  assert.equal(matched.matched, true, `expected clean AP match: ${JSON.stringify(matched)}`);
  assert.match(matched.matchResult.status, /MATCHED/);
  assert.equal(matched.matchResult.matchType, "three_way");
  assert.equal(Number(matched.matchResult.mismatchCount), 0);
  assert.ok(Number(matched.matchResult.reviewedBy ?? 0) > 0, "match should capture reviewing actor");
  await assertActivityOrAuditRecord({
    actionLike: "AP_INVOICE_MATCH",
    referenceType: "invoice",
    referenceId: matchedInvoice.id,
    label: "invoice matched",
  });
  console.log("  ok matched invoice uses PO/receipt evidence and records audit/activity");

  const batchBeforeApproval = await apiJsonRequest("/ap/payment-batches", {
    method: "POST",
    cookie,
    body: {
      paymentMethod: "BANK_TRANSFER",
      invoiceIds: [matchedInvoice.id],
      notes: "Should fail before approval",
    },
  });
  assert.equal(batchBeforeApproval.status, 400, "DRAFT/PENDING invoice should not be batchable before approval");
  assert.match(JSON.stringify(batchBeforeApproval.json), /No eligible|approved invoice/i);
  console.log("  ok matched invoice cannot enter payment workflow before AP approval");

  const submit = await apiJsonRequest(`/ap/invoices/${matchedInvoice.id}/submit-approval`, {
    method: "POST",
    cookie,
    body: {},
  });
  assert.equal(submit.status, 200, `submit invoice failed: ${submit.status} ${JSON.stringify(submit.json)}`);

  const approve = await apiJsonRequest(`/ap/invoices/${matchedInvoice.id}/approve`, {
    method: "POST",
    cookie,
    body: {
      adminOverride: true,
      overrideReason: "Runtime workflow proof uses a single seeded admin user.",
      comment: "Runtime AP approval after successful match",
    },
  });
  assert.equal(approve.status, 200, `approve invoice failed: ${approve.status} ${JSON.stringify(approve.json)}`);
  await assertActivityOrAuditRecord({
    actionLike: "AP_INVOICE_APPROVED",
    referenceType: "invoice",
    referenceId: matchedInvoice.id,
    label: "invoice approval",
  });

  const batchCreate = await apiJsonRequest("/ap/payment-batches", {
    method: "POST",
    cookie,
    body: {
      paymentMethod: "BANK_TRANSFER",
      invoiceIds: [matchedInvoice.id],
      notes: "Runtime matched AP payment proof",
    },
  });
  assert.equal(batchCreate.status, 201, `create payment batch failed: ${batchCreate.status} ${JSON.stringify(batchCreate.json)}`);
  const batch = unwrapData<{ id: number; status: string }>(batchCreate.json, "create payment batch");
  await assertActivityOrAuditRecord({
    actionLike: "AP_PAYMENT_BATCH_CREATED",
    referenceType: "payment_batch",
    referenceId: batch.id,
    label: "payment batch created",
  });

  const batchApprove = await apiJsonRequest(`/ap/payment-batches/${batch.id}/approve`, {
    method: "POST",
    cookie,
    body: {
      adminOverride: true,
      overrideReason: "Runtime workflow proof uses a single seeded admin user.",
      comment: "Runtime payment approval",
    },
  });
  assert.equal(batchApprove.status, 200, `approve payment batch failed: ${batchApprove.status} ${JSON.stringify(batchApprove.json)}`);

  const batchRelease = await apiJsonRequest(`/ap/payment-batches/${batch.id}/release`, {
    method: "POST",
    cookie,
    body: {
      adminOverride: true,
      overrideReason: "Runtime workflow proof uses a single seeded admin user.",
      comment: "Runtime payment release",
    },
  });
  assert.equal(batchRelease.status, 200, `release payment batch failed: ${batchRelease.status} ${JSON.stringify(batchRelease.json)}`);
  await assertActivityOrAuditRecord({
    actionLike: "AP_PAYMENT_BATCH_RELEASED",
    referenceType: "payment_batch",
    referenceId: batch.id,
    label: "payment batch released",
  });
  console.log("  ok matched and approved invoice can enter and complete payment workflow");

  const badFixture = await ensureWorkflowFixture("apx");
  const badPo = await createSentWorkflowPo(cookie, badFixture, 2);
  const badReceive = await receiveWorkflowPo(cookie, badPo.poNumber, badFixture, 1, `GRN-APX-${badFixture.suffix}`);
  assert.equal(badReceive.status, 200, `receive bad PO fixture failed: ${badReceive.status} ${JSON.stringify(badReceive.json)}`);

  const badInvoice = await createInvoice(cookie, {
    invoiceNumber: `INV-EXC-${badFixture.suffix}`,
    supplierId: badFixture.supplierId,
    poId: badPo.poId,
    itemId: badFixture.itemId,
    quantity: 2,
    unitPrice: 140,
  });
  const badMatch = await runMatch(cookie, badInvoice.id);
  assert.equal(badMatch.matched, false, "above tolerance invoice should not match");
  assert.equal(badMatch.matchResult.status, "EXCEPTION");
  assert.ok(
    badMatch.mismatches.some((entry) => ["PRICE_MISMATCH", "QTY_MISMATCH"].includes(String(entry.code))),
    `expected price/quantity mismatch: ${JSON.stringify(badMatch.mismatches)}`,
  );
  await assertActivityOrAuditRecord({
    actionLike: "AP_INVOICE_MATCH",
    referenceType: "invoice",
    referenceId: badInvoice.id,
    label: "invoice disputed/blocked",
  });
  console.log("  ok above-tolerance invoice is blocked by AP match exception");

  const badSubmit = await apiJsonRequest(`/ap/invoices/${badInvoice.id}/submit-approval`, {
    method: "POST",
    cookie,
    body: {},
  });
  assert.equal(badSubmit.status, 400, "invoice with match exception should not submit for approval");
  assert.match(JSON.stringify(badSubmit.json), /unresolved matching exceptions|INVOICE_SUBMIT_APPROVAL_FAILED/i);

  await pool.query(`UPDATE invoices SET status = 'APPROVED', updated_at = NOW() WHERE id = $1`, [badInvoice.id]);
  const badBatch = await apiJsonRequest("/ap/payment-batches", {
    method: "POST",
    cookie,
    body: {
      paymentMethod: "BANK_TRANSFER",
      invoiceIds: [badInvoice.id],
      notes: "Should fail because match result is EXCEPTION",
    },
  });
  assert.equal(badBatch.status, 400, "approved invoice with unresolved match exception should not be batchable");
  assert.match(JSON.stringify(badBatch.json), /unresolved matching exceptions|cannot be paid/i);
  console.log("  ok disputed/exception invoice cannot be paid or batched");

  const matchRows = await pool.query<{ status: string; reviewed_by: number | null; reviewed_at: Date | null }>(
    `
      SELECT status, reviewed_by, reviewed_at
      FROM ap_invoice_match_results
      WHERE invoice_id IN ($1, $2)
      ORDER BY id DESC
    `,
    [matchedInvoice.id, badInvoice.id],
  );
  assert.ok(matchRows.rows.length >= 2, "AP matching should persist match result rows");
  for (const row of matchRows.rows) {
    assert.ok(row.status, "match row should include status");
    assert.ok(row.reviewed_by, "match row should capture actor/user");
    assert.ok(row.reviewed_at, "match row should capture timestamp");
  }

  console.log("\nAP PO/GRN matching runtime flow passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
