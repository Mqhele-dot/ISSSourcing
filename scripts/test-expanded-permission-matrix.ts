import assert from "node:assert/strict";
import process from "node:process";
import { pool } from "../server/db";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";
import { apiJsonRequest, loginForTests } from "./test-http";
import { exitTest } from "./test-exit";
import {
  errorCode,
  mixedLineBody,
  seedProcurementEvidenceFixture,
  unwrapData,
  type ProcurementEvidenceFixture,
} from "./runtime-fixtures/procurement-line-evidence-fixture";
import {
  getSeededAdmin,
  removeEvidenceUsers,
  seedCustomPermissionUser,
  seedSystemRoleUser,
  type SeededEvidenceUser,
} from "./runtime-fixtures/expanded-security-fixtures";

function errorHint(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const error = (json as Record<string, unknown>).error;
  return error && typeof error === "object" && typeof (error as Record<string, unknown>).hint === "string"
    ? String((error as Record<string, unknown>).hint)
    : "";
}

function assertControlledDenial(response: { status: number; json: unknown }, label: string): void {
  assert.ok([401, 403, 404, 409].includes(response.status), `${label}: expected controlled denial, got ${response.status}`);
  assert.ok(errorCode(response.json), `${label}: structured error code is required`);
  assert.ok(errorHint(response.json), `${label}: remediation guidance is required`);
}

async function cleanupFixture(fixture: ProcurementEvidenceFixture | null): Promise<void> {
  if (!fixture) return;
  await pool.query(`DELETE FROM purchase_requisition_items WHERE requisition_id IN (
    SELECT id FROM purchase_requisitions WHERE justification LIKE $1
  )`, [`%${fixture.suffix}%`]);
  await pool.query(`DELETE FROM purchase_requisitions WHERE justification LIKE $1`, [`%${fixture.suffix}%`]);
  await pool.query(`DELETE FROM invoice_items WHERE item_id = $1`, [fixture.itemId]);
  await pool.query(`DELETE FROM inventory_items WHERE id = $1`, [fixture.itemId]);
  await pool.query(`DELETE FROM suppliers WHERE id = $1`, [fixture.supplierId]);
  await pool.query(`DELETE FROM mdm_cost_centres WHERE id = $1`, [fixture.costCentreId]);
  await pool.query(`DELETE FROM departments WHERE id = $1`, [fixture.departmentId]);
  await pool.query(`DELETE FROM tax_codes WHERE id = $1`, [fixture.taxCodeId]);
  await pool.query(`DELETE FROM units_of_measure WHERE id = $1`, [fixture.unitOfMeasureId]);
}

async function main() {
  assertDisposableDatabaseUrl(process.env.TEST_DATABASE_URL);
  const admin = await getSeededAdmin();
  const adminCookie = await loginForTests("admin", "Admin123!");
  assert.ok(adminCookie, "Seeded admin login is required.");
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  const users: SeededEvidenceUser[] = [];
  let fixture: ProcurementEvidenceFixture | null = null;
  let requisitionId: number | null = null;
  let policyId: number | null = null;
  let poOneId: number | null = null;
  let poTwoId: number | null = null;
  let poOneLineId: number | null = null;
  let poTwoLineId: number | null = null;
  let invoiceId: number | null = null;

  try {
    fixture = await seedProcurementEvidenceFixture();
    const requester = await seedCustomPermissionUser({
      suffix,
      label: "Requester",
      permissions: [
        { resource: "purchases", permissionType: "read" },
        { resource: "purchases", permissionType: "create" },
      ],
    });
    const approver = await seedCustomPermissionUser({
      suffix,
      label: "Approver",
      permissions: [
        { resource: "purchases", permissionType: "read" },
        { resource: "purchases", permissionType: "approve" },
      ],
    });
    const reportViewer = await seedCustomPermissionUser({
      suffix,
      label: "Report Viewer",
      permissions: [{ resource: "reports", permissionType: "read" }],
    });
    const policyViewer = await seedCustomPermissionUser({
      suffix,
      label: "Policy Viewer",
      permissions: [{ resource: "reports", permissionType: "read" }],
    });
    const apUser = await seedSystemRoleUser({ suffix, label: "AP User", role: "manager" });
    users.push(requester, approver, reportViewer, policyViewer, apUser);

    const requesterCookie = await loginForTests(requester.username, requester.password);
    assert.ok(requesterCookie);
    const created = await apiJsonRequest("/purchase-requisitions", {
      method: "POST",
      cookie: requesterCookie,
      body: mixedLineBody(fixture),
    });
    assert.equal(created.status, 201, `requester create failed: ${JSON.stringify(created.json)}`);
    requisitionId = unwrapData<{ id: number }>(created.json, "requester requisition").id;
    const requesterApproval = await apiJsonRequest(`/purchase-requisitions/${requisitionId}/approve`, {
      method: "POST",
      cookie: requesterCookie,
      body: { comment: "Requester must not approve" },
    });
    assert.equal(requesterApproval.status, 403);
    assertControlledDenial(requesterApproval, "requester approval");

    const approverCookie = await loginForTests(approver.username, approver.password);
    assert.ok(approverCookie);
    const masterDataMutation = await apiJsonRequest("/suppliers", {
      method: "POST",
      cookie: approverCookie,
      body: {
        name: `W7B Forbidden Supplier ${suffix}`,
        email: `forbidden-${suffix}@example.test`,
        status: "active",
      },
    });
    assert.equal(masterDataMutation.status, 403);
    assertControlledDenial(masterDataMutation, "approver master-data mutation");

    const reportCookie = await loginForTests(reportViewer.username, reportViewer.password);
    assert.ok(reportCookie);
    const preview = await apiJsonRequest("/reports/preview", {
      method: "POST",
      cookie: reportCookie,
      body: {
        dataset: "purchase_requisitions",
        page: 1,
        pageSize: 10,
        filters: {},
      },
    });
    assert.equal(preview.status, 200, "report viewer must be able to preview reports");
    const deniedExport = await apiJsonRequest("/export-center/custom-export", {
      method: "POST",
      cookie: reportCookie,
      body: {
        dataset: "purchase_requisitions",
        reportName: "forbidden-export",
        format: "csv",
        filters: {},
      },
    });
    assert.equal(deniedExport.status, 403);
    assertControlledDenial(deniedExport, "report export");

    const policy = await apiJsonRequest("/approval-policies", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: `W7B Permission Policy ${suffix}`,
        entityType: `w7b_permission_${suffix}`,
        amountMin: 0,
        amountMax: 100,
        approvalLevel: 1,
        approverRole: "manager",
        isActive: true,
      },
    });
    assert.equal(policy.status, 201);
    const createdPolicy = unwrapData<{ id: number; version: number }>(policy.json, "permission policy");
    policyId = createdPolicy.id;
    const policyCookie = await loginForTests(policyViewer.username, policyViewer.password);
    assert.ok(policyCookie);
    const policyList = await apiJsonRequest("/approval-policies?page=1&pageSize=5", { cookie: policyCookie });
    assert.equal(policyList.status, 200, "policy viewer may read approval policies");
    const deniedPolicyEdit = await apiJsonRequest(`/approval-policies/${policyId}`, {
      method: "PATCH",
      cookie: policyCookie,
      body: { expectedVersion: createdPolicy.version, name: "Forbidden policy change" },
    });
    assert.equal(deniedPolicyEdit.status, 403);
    assertControlledDenial(deniedPolicyEdit, "policy update");
    const deniedPolicyDelete = await apiJsonRequest(`/approval-policies/${policyId}`, {
      method: "DELETE",
      cookie: policyCookie,
    });
    assert.equal(deniedPolicyDelete.status, 403);
    assertControlledDenial(deniedPolicyDelete, "policy delete");

    const deniedDiagnostics = await apiJsonRequest("/diagnostics/summary", { cookie: reportCookie });
    assert.equal(deniedDiagnostics.status, 403);
    assertControlledDenial(deniedDiagnostics, "diagnostics access");

    const poOne = await pool.query<{ id: number }>(
      `INSERT INTO purchase_orders (
         organization_id, order_number, supplier_id, currency_code, status, approval_status,
         total_amount, created_by_user_id, created_at, updated_at
       ) VALUES (1, $1, $2, 'ZAR', 'DRAFT', 'DRAFT', 125, $3, NOW(), NOW()) RETURNING id`,
      [`W7B-AP-PO1-${suffix}`, fixture.supplierId, admin.id],
    );
    poOneId = poOne.rows[0].id;
    const poTwo = await pool.query<{ id: number }>(
      `INSERT INTO purchase_orders (
         organization_id, order_number, supplier_id, currency_code, status, approval_status,
         total_amount, created_by_user_id, created_at, updated_at
       ) VALUES (1, $1, $2, 'ZAR', 'DRAFT', 'DRAFT', 125, $3, NOW(), NOW()) RETURNING id`,
      [`W7B-AP-PO2-${suffix}`, fixture.supplierId, admin.id],
    );
    poTwoId = poTwo.rows[0].id;
    const lineOne = await pool.query<{ id: number }>(
      `INSERT INTO purchase_order_items (
         order_id, item_id, line_number, line_type, fulfilment_type, receipt_required,
         quantity, unit_price, total_price, received_quantity
       ) VALUES ($1, $2, 1, 'CATALOG', 'GOODS_RECEIPT', TRUE, 1, 125, 125, 0) RETURNING id`,
      [poOneId, fixture.itemId],
    );
    poOneLineId = lineOne.rows[0].id;
    const lineTwo = await pool.query<{ id: number }>(
      `INSERT INTO purchase_order_items (
         order_id, item_id, line_number, line_type, fulfilment_type, receipt_required,
         quantity, unit_price, total_price, received_quantity
       ) VALUES ($1, $2, 1, 'CATALOG', 'GOODS_RECEIPT', TRUE, 1, 125, 125, 0) RETURNING id`,
      [poTwoId, fixture.itemId],
    );
    poTwoLineId = lineTwo.rows[0].id;
    const invoice = await pool.query<{ id: number }>(
      `INSERT INTO invoices (
         organization_id, invoice_number, supplier_id, purchase_order_id, status,
         issue_date, due_date, subtotal, total, created_by, created_at, updated_at
       ) VALUES (1, $1, $2, $3, 'DRAFT', NOW(), NOW() + INTERVAL '14 days', 125, 125, $4, NOW(), NOW())
       RETURNING id`,
      [`W7B-AP-INV-${suffix}`, fixture.supplierId, poOneId, admin.id],
    );
    invoiceId = invoice.rows[0].id;
    const apCookie = await loginForTests(apUser.username, apUser.password);
    assert.ok(apCookie);
    const unrelatedLine = await apiJsonRequest(`/invoices/${invoiceId}/items`, {
      method: "POST",
      cookie: apCookie,
      body: {
        purchaseOrderItemId: poTwoLineId,
        lineType: "CATALOG",
        description: "Unrelated PO line",
        quantity: 1,
        unitPrice: 125,
        totalPrice: 125,
      },
    });
    assert.equal(unrelatedLine.status, 409);
    assert.equal(errorCode(unrelatedLine.json), "AP_INVOICE_PO_LINE_MISMATCH");
    assertControlledDenial(unrelatedLine, "unrelated AP line");

    console.log("Expanded permission-matrix proof passed.");
  } finally {
    if (invoiceId) {
      await pool.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]).catch(() => undefined);
      await pool.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]).catch(() => undefined);
    }
    if (poOneLineId || poTwoLineId) {
      await pool.query(`DELETE FROM purchase_order_items WHERE id = ANY($1::int[])`, [
        [poOneLineId, poTwoLineId].filter((id): id is number => id != null),
      ]).catch(() => undefined);
    }
    if (poOneId || poTwoId) {
      await pool.query(`DELETE FROM purchase_orders WHERE id = ANY($1::int[])`, [
        [poOneId, poTwoId].filter((id): id is number => id != null),
      ]).catch(() => undefined);
    }
    if (policyId) {
      await pool.query(`DELETE FROM activity_logs WHERE reference_type = 'approval_policy' AND reference_id = $1`, [policyId]).catch(() => undefined);
      await pool.query(`DELETE FROM approval_policies WHERE id = $1`, [policyId]).catch(() => undefined);
    }
    await removeEvidenceUsers(users).catch(() => undefined);
    await cleanupFixture(fixture).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => pool.end().catch(() => undefined));
