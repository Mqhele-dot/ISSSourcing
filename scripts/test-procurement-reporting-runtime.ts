import assert from "node:assert/strict";
import { pool } from "../server/db";
import { getProcurementLineReportRows } from "../server/services/procurement-line-report-service";
import { apiJsonRequest, loginForTests } from "./test-http";
import { exitTest } from "./test-exit";
import {
  createAndConvertMixedLineRequisition,
  seedProcurementEvidenceFixture,
  unwrapData,
} from "./runtime-fixtures/procurement-line-evidence-fixture";

async function main() {
  const cookie = await loginForTests("admin", "Admin123!");
  assert.ok(cookie, "Seeded admin login is required");
  const fixture = await seedProcurementEvidenceFixture();
  const { requisition, purchaseOrder } = await createAndConvertMixedLineRequisition(cookie, fixture);

  const emptyNumber = `W7-EMPTY-${fixture.suffix}`;
  await pool.query(
    `INSERT INTO purchase_requisitions (
       organization_id, requisition_number, requestor_id, status, supplier_id,
       department_id, currency_code, exchange_rate_to_zar, total_amount, justification
     ) VALUES (1, $1, 1, 'DRAFT', $2, $3, 'ZAR', 1, 0, 'Wave 7 no-line data quality proof')`,
    [emptyNumber, fixture.supplierId, fixture.departmentId],
  );

  const requisitionRows = await getProcurementLineReportRows({
    organizationId: 1,
    dataset: "purchase_requisitions",
    limit: 100,
  });
  const mixedRows = requisitionRows.filter((row) => row.documentId === requisition.id);
  assert.equal(mixedRows.length, 3, "one report row is required per requisition line");
  assert.deepEqual(new Set(mixedRows.map((row) => row.lineType)), new Set(["CATALOG", "NON_STOCK", "SERVICE"]));
  assert.ok(mixedRows.every((row) => row.documentNumber === requisition.requisitionNumber));
  assert.ok(mixedRows.every((row) => row.supplierName && row.currencyCode === "ZAR"));
  assert.ok(mixedRows.find((row) => row.lineType === "SERVICE")?.lineDescription.includes("calibration"));
  const noLineRow = requisitionRows.find((row) => row.documentNumber === emptyNumber);
  assert.equal(noLineRow?.dataQualityStatus, "DOCUMENT_HAS_NO_LINES");

  const poRows = await getProcurementLineReportRows({
    organizationId: 1,
    dataset: "purchase_orders",
    limit: 100,
  });
  const mixedPoRows = poRows.filter((row) => row.documentId === purchaseOrder.id);
  assert.equal(mixedPoRows.length, 3);
  assert.ok(mixedPoRows.every((row) => row.documentNumber === purchaseOrder.orderNumber));
  assert.ok(mixedPoRows.every((row) => row.costCentre && row.glAccount));

  const preview = await apiJsonRequest("/reports/preview", {
    method: "POST",
    cookie,
    body: {
      dataset: "purchase_requisitions",
      page: 1,
      pageSize: 2,
      columns: ["documentNumber", "lineNumber", "lineType", "lineDescription"],
      filters: {},
    },
  });
  assert.equal(preview.status, 200, `report preview failed: ${JSON.stringify(preview.json)}`);
  const previewData = unwrapData<{
    rows: Array<Record<string, unknown>>;
    page: number;
    pageSize: number;
    hasNext: boolean;
    generatedAt: string;
  }>(preview.json, "report preview");
  assert.equal(previewData.page, 1);
  assert.equal(previewData.pageSize, 2);
  assert.ok(previewData.rows.length <= 2);
  assert.ok(typeof previewData.hasNext === "boolean");
  assert.ok(Number.isFinite(Date.parse(previewData.generatedAt)));

  const retainedUntil = new Date(Date.now() + 3_600_000);
  const exportJob = await pool.query<{ id: number }>(
    `INSERT INTO export_jobs (
       organization_id, created_by, dataset, format, filters, status, file_name,
       file_path, file_size, mime_type, row_count, retention_expires_at, created_at, updated_at
     ) VALUES (1, 1, 'purchase_orders', 'csv', '{}'::jsonb, 'succeeded',
       'wave7.csv.gz', 'tmp/wave7.csv.gz', 10, 'application/gzip', 3, $1, NOW(), NOW())
     RETURNING id`,
    [retainedUntil],
  );
  const unauthenticated = await apiJsonRequest(`/export-jobs/${exportJob.rows[0].id}/download-token`, {
    method: "POST",
    body: {},
  });
  assert.ok([401, 403].includes(unauthenticated.status), "download token refresh must require authentication");
  const tokenResponse = await apiJsonRequest(`/export-jobs/${exportJob.rows[0].id}/download-token`, {
    method: "POST",
    cookie,
    body: {},
  });
  assert.equal(tokenResponse.status, 200, `token refresh failed: ${JSON.stringify(tokenResponse.json)}`);
  const token = unwrapData<{ downloadUrl: string; expiresAt: string }>(tokenResponse.json, "fresh export token");
  const ttlMs = Date.parse(token.expiresAt) - Date.now();
  assert.ok(token.downloadUrl.includes(`/api/export/download/${exportJob.rows[0].id}?token=`));
  assert.ok(ttlMs > 0 && ttlMs <= 60 * 60_000, "export token must remain short-lived");

  await pool.query(
    `INSERT INTO export_jobs (
       organization_id, created_by, dataset, format, filters, status, last_error, created_at, updated_at
     ) VALUES (1, 1, 'purchase_orders', 'xlsx', '{}'::jsonb, 'failed',
       '{"code":"W7_REPORT_FAILURE","message":"Controlled Wave 7 report failure"}', NOW(), NOW())`,
  );
  const findingsResponse = await apiJsonRequest("/diagnostics/findings?category=integrations", { cookie });
  assert.equal(findingsResponse.status, 200);
  const findings = findingsResponse.json as { findings?: Array<{ code?: string; status?: string }> };
  assert.ok(
    findings.findings?.some((finding) => finding.code === "EXPORT_JOB_FAILURES" && finding.status === "failed"),
    "controlled report failure must appear in integration diagnostics",
  );

  console.log("Procurement reporting runtime proof passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => pool.end().catch(() => undefined));
