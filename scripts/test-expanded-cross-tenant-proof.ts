import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import process from "node:process";
import { pool } from "../server/db";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";
import { apiJsonRequest, apiRawRequest, loginForTests } from "./test-http";
import { exitTest } from "./test-exit";
import { errorCode, unwrapData } from "./runtime-fixtures/procurement-line-evidence-fixture";
import { getSeededAdmin } from "./runtime-fixtures/expanded-security-fixtures";

type ForeignFixture = {
  organizationId: number;
  supplierId: number;
  itemId: number;
  requisitionId: number;
  requisitionItemId: number;
  purchaseOrderId: number;
  purchaseOrderItemId: number;
  policyId: number;
  exportJobId: number;
  exportToken: string;
  requisitionNumber: string;
  policyName: string;
};

async function seedForeignFixture(suffix: string): Promise<ForeignFixture> {
  const admin = await getSeededAdmin();
  // The development seed uses explicit organization IDs, which can leave the
  // serial sequence behind on a newly bootstrapped disposable database.
  await pool.query(
    `SELECT setval(
       pg_get_serial_sequence('organizations', 'id'),
       GREATEST(COALESCE((SELECT MAX(id) FROM organizations), 0), 1),
       TRUE
     )`,
  );
  const organization = await pool.query<{ id: number }>(
    `INSERT INTO organizations (
       name, slug, active, country_code, default_currency_code, locale, timezone, created_at, updated_at
     ) VALUES ($1, $2, TRUE, 'ZA', 'ZAR', 'en-ZA', 'Africa/Johannesburg', NOW(), NOW())
     RETURNING id`,
    [`Wave 7B Foreign Organization ${suffix}`, `w7b-foreign-${suffix}`],
  );
  const organizationId = organization.rows[0].id;
  const supplier = await pool.query<{ id: number }>(
    `INSERT INTO suppliers (
       organization_id, name, status, default_currency_code, contact_name, email, created_at, updated_at
     ) VALUES ($1, $2, 'active', 'ZAR', 'Foreign Contact', $3, NOW(), NOW())
     RETURNING id`,
    [organizationId, `W7B Foreign Supplier ${suffix}`, `foreign-${suffix}@example.test`],
  );
  const item = await pool.query<{ id: number }>(
    `INSERT INTO inventory_items (
       organization_id, name, sku, quantity, price, status, created_at, updated_at
     ) VALUES ($1, $2, $3, 0, 55, 'active', NOW(), NOW())
     RETURNING id`,
    [organizationId, `W7B Foreign Item ${suffix}`, `W7B-F-${suffix}`],
  );
  const requisitionNumber = `W7B-F-REQ-${suffix}`;
  const requisition = await pool.query<{ id: number }>(
    `INSERT INTO purchase_requisitions (
       organization_id, requisition_number, requestor_id, status, supplier_id,
       currency_code, exchange_rate_to_zar, total_amount, justification, created_at, updated_at
     ) VALUES ($1, $2, $3, 'DRAFT', $4, 'ZAR', 1, 55, 'Foreign tenant evidence', NOW(), NOW())
     RETURNING id`,
    [organizationId, requisitionNumber, admin.id, supplier.rows[0].id],
  );
  const requisitionItem = await pool.query<{ id: number }>(
    `INSERT INTO purchase_requisition_items (
       requisition_id, item_id, line_number, line_type, description, manual_entry_reason,
       fulfilment_type, receipt_required, quantity, unit_price, total_price
     ) VALUES ($1, NULL, 1, 'SERVICE', $2, 'Foreign tenant service evidence',
       'SERVICE_CONFIRMATION', TRUE, 1, 55, 55)
     RETURNING id`,
    [requisition.rows[0].id, `W7B Foreign Service ${suffix}`],
  );
  const purchaseOrder = await pool.query<{ id: number }>(
    `INSERT INTO purchase_orders (
       organization_id, order_number, supplier_id, requisition_id, currency_code,
       status, approval_status, total_amount, created_by_user_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'ZAR', 'DRAFT', 'DRAFT', 55, $5, NOW(), NOW())
     RETURNING id`,
    [organizationId, `W7B-F-PO-${suffix}`, supplier.rows[0].id, requisition.rows[0].id, admin.id],
  );
  const purchaseOrderItem = await pool.query<{ id: number }>(
    `INSERT INTO purchase_order_items (
       order_id, item_id, line_number, line_type, description, manual_entry_reason,
       fulfilment_type, receipt_required, quantity, unit_price, total_price, received_quantity
     ) VALUES ($1, NULL, 1, 'SERVICE', $2, 'Foreign tenant service evidence',
       'SERVICE_CONFIRMATION', TRUE, 1, 55, 55, 0)
     RETURNING id`,
    [purchaseOrder.rows[0].id, `W7B Foreign Service ${suffix}`],
  );
  const policyName = `W7B Foreign Policy ${suffix}`;
  const policy = await pool.query<{ id: number }>(
    `INSERT INTO approval_policies (
       organization_id, name, entity_type, amount_min, amount_max, approval_level,
       approver_role, is_active, version, created_at, updated_at
     ) VALUES ($1, $2, $3, 0, 500, 1, 'manager', TRUE, 1, NOW(), NOW())
     RETURNING id`,
    [organizationId, policyName, `w7b_foreign_${suffix}`],
  );
  const exportToken = `w7b-foreign-token-${suffix}`;
  const exportJob = await pool.query<{ id: number }>(
    `INSERT INTO export_jobs (
       organization_id, created_by, dataset, format, filters, status, file_name, file_path,
       file_size, mime_type, row_count, download_token, download_token_expires_at,
       retention_expires_at, created_at, updated_at
     ) VALUES ($1, $2, 'purchase_requisitions', 'csv', '{}'::jsonb, 'succeeded',
       'foreign.csv.gz', 'tmp/foreign.csv.gz', 10, 'application/gzip', 1, $3,
       NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '1 day', NOW(), NOW())
     RETURNING id`,
    [organizationId, admin.id, exportToken],
  );
  await pool.query(
    `INSERT INTO notifications (
       organization_id, user_id, type, title, body, occurrence_count, last_occurred_at, created_at
     )
     SELECT $1, $2, 'w7b_foreign_backlog', $3, 'Foreign diagnostic evidence', 1, NOW(), NOW()
     FROM generate_series(1, 101)`,
    [organizationId, admin.id, `W7B Foreign Notification ${suffix}`],
  );
  await pool.query(
    `UPDATE export_jobs SET status = 'failed', last_error = $2, updated_at = NOW()
     WHERE id = $1`,
    [exportJob.rows[0].id, JSON.stringify({ code: `W7B_FOREIGN_EXPORT_${suffix}`, message: "Foreign failure" })],
  );
  return {
    organizationId,
    supplierId: supplier.rows[0].id,
    itemId: item.rows[0].id,
    requisitionId: requisition.rows[0].id,
    requisitionItemId: requisitionItem.rows[0].id,
    purchaseOrderId: purchaseOrder.rows[0].id,
    purchaseOrderItemId: purchaseOrderItem.rows[0].id,
    policyId: policy.rows[0].id,
    exportJobId: exportJob.rows[0].id,
    exportToken,
    requisitionNumber,
    policyName,
  };
}

async function cleanupForeignFixture(fixture: ForeignFixture | null): Promise<void> {
  if (!fixture) return;
  await pool.query(`DELETE FROM notifications WHERE organization_id = $1`, [fixture.organizationId]);
  await pool.query(`DELETE FROM export_jobs WHERE organization_id = $1`, [fixture.organizationId]);
  await pool.query(`DELETE FROM approval_policies WHERE organization_id = $1`, [fixture.organizationId]);
  await pool.query(`DELETE FROM purchase_order_items WHERE order_id = $1`, [fixture.purchaseOrderId]);
  await pool.query(`DELETE FROM purchase_orders WHERE id = $1`, [fixture.purchaseOrderId]);
  await pool.query(`DELETE FROM purchase_requisition_items WHERE requisition_id = $1`, [fixture.requisitionId]);
  await pool.query(`DELETE FROM purchase_requisitions WHERE id = $1`, [fixture.requisitionId]);
  await pool.query(`DELETE FROM inventory_items WHERE id = $1`, [fixture.itemId]);
  await pool.query(`DELETE FROM suppliers WHERE id = $1`, [fixture.supplierId]);
  await pool.query(`DELETE FROM organization_settings WHERE organization_id = $1`, [fixture.organizationId]);
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [fixture.organizationId]);
}

async function main() {
  assertDisposableDatabaseUrl(process.env.TEST_DATABASE_URL);
  const admin = await getSeededAdmin();
  const cookie = await loginForTests("admin", "Admin123!");
  assert.ok(cookie, "Seeded admin login is required.");
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  let foreign: ForeignFixture | null = null;
  let localPolicyId: number | null = null;
  let localInvoiceId: number | null = null;
  let localPoId: number | null = null;
  let localPoItemId: number | null = null;
  let localSupplierId: number | null = null;
  let localItemId: number | null = null;

  try {
    const summaryBefore = await apiJsonRequest("/diagnostics/summary", { cookie });
    assert.equal(summaryBefore.status, 200);
    foreign = await seedForeignFixture(suffix);
    const summaryAfter = await apiJsonRequest("/diagnostics/summary", { cookie });
    assert.equal(summaryAfter.status, 200);
    const beforeSummary = summaryBefore.json as Record<string, unknown>;
    const afterSummary = summaryAfter.json as Record<string, unknown>;
    assert.deepEqual(
      {
        total: afterSummary.total,
        openCount: afterSummary.openCount,
        byCategory: afterSummary.byCategory,
        byStatus: afterSummary.byStatus,
        bySeverity: afterSummary.bySeverity,
        affectedModules: afterSummary.affectedModules,
      },
      {
        total: beforeSummary.total,
        openCount: beforeSummary.openCount,
        byCategory: beforeSummary.byCategory,
        byStatus: beforeSummary.byStatus,
        bySeverity: beforeSummary.bySeverity,
        affectedModules: beforeSummary.affectedModules,
      },
      "Organization B diagnostic records must not change Organization A summaries.",
    );

    const foreignReq = await apiJsonRequest(`/purchase-requisitions/${foreign.requisitionId}`, { cookie });
    assert.equal(foreignReq.status, 404);
    const foreignLines = await apiJsonRequest(`/purchase-requisitions/${foreign.requisitionId}/items`, { cookie });
    assert.equal(foreignLines.status, 404);

    const preview = await apiJsonRequest("/reports/preview", {
      method: "POST",
      cookie,
      body: {
        dataset: "purchase_requisitions",
        page: 1,
        pageSize: 25,
        filters: { q: foreign.requisitionNumber },
      },
    });
    assert.equal(preview.status, 200);
    const previewData = unwrapData<{ rows: unknown[]; resultCount: number; hasNext: boolean }>(
      preview.json,
      "cross-tenant report preview",
    );
    assert.equal(previewData.rows.length, 0);
    assert.equal(previewData.resultCount, 0);
    assert.equal(previewData.hasNext, false);

    const exported = await apiRawRequest("/export-center/custom-export", {
      method: "POST",
      cookie,
      body: {
        dataset: "purchase_requisitions",
        format: "csv",
        reportName: "tenant-isolation",
        filters: { q: foreign.requisitionNumber },
      },
    });
    assert.equal(exported.status, 200);
    const exportedText = gunzipSync(Buffer.from(await exported.arrayBuffer())).toString("utf8");
    assert.ok(!exportedText.includes(foreign.requisitionNumber), "Foreign requisition must not appear in exports.");

    const history = await apiJsonRequest("/export-center/history", { cookie });
    assert.equal(history.status, 200);
    const historyRows = unwrapData<Array<{ id: number }>>(history.json, "export history");
    assert.ok(!historyRows.some((row) => row.id === foreign!.exportJobId));

    const refresh = await apiJsonRequest(`/export-jobs/${foreign.exportJobId}/download-token`, {
      method: "POST",
      cookie,
      body: {},
    });
    assert.ok([404, 410].includes(refresh.status));
    const download = await apiRawRequest(
      `/export/download/${foreign.exportJobId}?token=${encodeURIComponent(foreign.exportToken)}`,
      { cookie },
    );
    assert.equal(download.status, 404);

    const policyList = await apiJsonRequest(`/approval-policies?q=${encodeURIComponent(foreign.policyName)}&page=1&pageSize=25`, {
      cookie,
    });
    assert.equal(policyList.status, 200);
    const policyPage = unwrapData<{ items: Array<{ id: number }>; total: number }>(policyList.json, "foreign policy search");
    assert.equal(policyPage.total, 0);
    assert.equal(policyPage.items.length, 0);
    const policyEdit = await apiJsonRequest(`/approval-policies/${foreign.policyId}`, {
      method: "PATCH",
      cookie,
      body: { expectedVersion: 1, name: "Cross-tenant edit must fail" },
    });
    assert.equal(policyEdit.status, 404);

    const diagnostics = await apiJsonRequest("/diagnostics/findings?category=overview", { cookie });
    assert.equal(diagnostics.status, 200);
    assert.ok(!JSON.stringify(diagnostics.json).includes(`W7B_FOREIGN_EXPORT_${suffix}`));
    assert.ok(!JSON.stringify(diagnostics.json).includes(`W7B Foreign Notification ${suffix}`));

    const localSupplier = await pool.query<{ id: number }>(
      `INSERT INTO suppliers (
         organization_id, name, status, default_currency_code, email, created_at, updated_at
       ) VALUES (1, $1, 'active', 'ZAR', $2, NOW(), NOW()) RETURNING id`,
      [`W7B Local Supplier ${suffix}`, `local-${suffix}@example.test`],
    );
    localSupplierId = localSupplier.rows[0].id;
    const localItem = await pool.query<{ id: number }>(
      `INSERT INTO inventory_items (
         organization_id, name, sku, quantity, price, status, created_at, updated_at
       ) VALUES (1, $1, $2, 0, 50, 'active', NOW(), NOW()) RETURNING id`,
      [`W7B Local Item ${suffix}`, `W7B-L-${suffix}`],
    );
    localItemId = localItem.rows[0].id;
    const localPo = await pool.query<{ id: number }>(
      `INSERT INTO purchase_orders (
         organization_id, order_number, supplier_id, currency_code, status, approval_status,
         total_amount, created_by_user_id, created_at, updated_at
       ) VALUES (1, $1, $2, 'ZAR', 'DRAFT', 'DRAFT', 50, $3, NOW(), NOW()) RETURNING id`,
      [`W7B-L-PO-${suffix}`, localSupplierId, admin.id],
    );
    localPoId = localPo.rows[0].id;
    const localPoItem = await pool.query<{ id: number }>(
      `INSERT INTO purchase_order_items (
         order_id, item_id, line_number, line_type, fulfilment_type, receipt_required,
         quantity, unit_price, total_price, received_quantity
       ) VALUES ($1, $2, 1, 'CATALOG', 'GOODS_RECEIPT', TRUE, 1, 50, 50, 0) RETURNING id`,
      [localPoId, localItemId],
    );
    localPoItemId = localPoItem.rows[0].id;
    const localInvoice = await pool.query<{ id: number }>(
      `INSERT INTO invoices (
         organization_id, invoice_number, supplier_id, purchase_order_id, status,
         issue_date, due_date, subtotal, total, created_by, created_at, updated_at
       ) VALUES (1, $1, $2, $3, 'DRAFT', NOW(), NOW() + INTERVAL '14 days', 50, 50, $4, NOW(), NOW())
       RETURNING id`,
      [`W7B-L-INV-${suffix}`, localSupplierId, localPoId, admin.id],
    );
    localInvoiceId = localInvoice.rows[0].id;
    const crossTenantInvoiceLine = await apiJsonRequest(`/invoices/${localInvoiceId}/items`, {
      method: "POST",
      cookie,
      body: {
        purchaseOrderItemId: foreign.purchaseOrderItemId,
        lineType: "SERVICE",
        description: "Cross-tenant line substitution",
        quantity: 1,
        unitPrice: 55,
        totalPrice: 55,
      },
    });
    assert.equal(crossTenantInvoiceLine.status, 404);
    assert.equal(errorCode(crossTenantInvoiceLine.json), "AP_PURCHASE_ORDER_LINE_NOT_FOUND");

    const localPolicy = await apiJsonRequest("/approval-policies", {
      method: "POST",
      cookie,
      body: {
        name: `W7B Audited Policy ${suffix}`,
        entityType: `w7b_audit_${suffix}`,
        amountMin: 0,
        amountMax: 100,
        approvalLevel: 1,
        approverRole: "manager",
        isActive: true,
      },
    });
    assert.equal(localPolicy.status, 201);
    const createdPolicy = unwrapData<{ id: number; version: number }>(localPolicy.json, "local audited policy");
    localPolicyId = createdPolicy.id;
    const updatedPolicy = await apiJsonRequest(`/approval-policies/${createdPolicy.id}`, {
      method: "PATCH",
      cookie,
      body: { expectedVersion: createdPolicy.version, name: `W7B Audited Policy Updated ${suffix}` },
    });
    assert.equal(updatedPolicy.status, 200);
    const audit = await pool.query<{ organization_id: number; user_id: number }>(
      `SELECT organization_id, user_id
       FROM activity_logs
       WHERE reference_type = 'approval_policy' AND reference_id = $1 AND action = 'APPROVAL_POLICY_UPDATED'
       ORDER BY timestamp DESC LIMIT 1`,
      [createdPolicy.id],
    );
    assert.equal(audit.rows[0]?.organization_id, 1);
    assert.equal(audit.rows[0]?.user_id, admin.id);

    console.log("Expanded cross-tenant proof passed.");
  } finally {
    if (localInvoiceId) {
      await pool.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [localInvoiceId]).catch(() => undefined);
      await pool.query(`DELETE FROM invoices WHERE id = $1`, [localInvoiceId]).catch(() => undefined);
    }
    if (localPoItemId) await pool.query(`DELETE FROM purchase_order_items WHERE id = $1`, [localPoItemId]).catch(() => undefined);
    if (localPoId) await pool.query(`DELETE FROM purchase_orders WHERE id = $1`, [localPoId]).catch(() => undefined);
    if (localItemId) await pool.query(`DELETE FROM inventory_items WHERE id = $1`, [localItemId]).catch(() => undefined);
    if (localSupplierId) await pool.query(`DELETE FROM suppliers WHERE id = $1`, [localSupplierId]).catch(() => undefined);
    if (localPolicyId) {
      await pool.query(`DELETE FROM activity_logs WHERE reference_type = 'approval_policy' AND reference_id = $1`, [localPolicyId]).catch(() => undefined);
      await pool.query(`DELETE FROM approval_policies WHERE id = $1`, [localPolicyId]).catch(() => undefined);
    }
    await cleanupForeignFixture(foreign).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => pool.end().catch(() => undefined));
