import assert from "node:assert/strict";
import { pool } from "../../server/db";
import { apiJsonRequest } from "../test-http";

type ApiEnvelope<T> = { ok?: boolean; data?: T };

export function unwrapData<T>(json: unknown, label: string): T {
  const envelope = json as ApiEnvelope<T>;
  if (envelope?.ok === true && "data" in envelope) return envelope.data as T;
  if (json && typeof json === "object" && !("ok" in json)) return json as T;
  throw new Error(`${label}: expected API data, got ${JSON.stringify(json)}`);
}

export function errorCode(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const record = json as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  const error = record.error;
  return error && typeof error === "object" && typeof (error as Record<string, unknown>).code === "string"
    ? String((error as Record<string, unknown>).code)
    : undefined;
}

export type ProcurementEvidenceFixture = {
  supplierId: number;
  itemId: number;
  unitOfMeasureId: number;
  taxCodeId: number;
  departmentId: number;
  costCentreId: number;
  glAccountCode: string;
  suffix: string;
};

export async function seedProcurementEvidenceFixture(): Promise<ProcurementEvidenceFixture> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`.slice(-12);
  await pool.query(
    `INSERT INTO currencies (code, name, symbol, region_code, region_name, is_main_for_region, exchange_rate_to_zar, active, updated_at)
     VALUES ('ZAR', 'South African Rand', 'R', 'ZA', 'South Africa', TRUE, 1, TRUE, NOW())
     ON CONFLICT (code) DO UPDATE SET active = TRUE, exchange_rate_to_zar = 1, updated_at = NOW()`,
  );
  const uom = await pool.query<{ id: number }>(
    `INSERT INTO units_of_measure (code, name, symbol, active, updated_at)
     VALUES ($1, $2, 'ea', TRUE, NOW())
     ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW()
     RETURNING id`,
    [`W7-${suffix}`, `Wave 7 Each ${suffix}`],
  );
  const tax = await pool.query<{ id: number }>(
    `INSERT INTO tax_codes (code, name, rate, type, country_code, active, updated_at)
     VALUES ($1, $2, 15, 'vat', 'ZA', TRUE, NOW())
     ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW()
     RETURNING id`,
    [`W7V${suffix}`, `Wave 7 VAT ${suffix}`],
  );
  const department = await pool.query<{ id: number }>(
    `INSERT INTO departments (organization_id, code, name, active, updated_at)
     VALUES (1, $1, $2, TRUE, NOW())
     ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW()
     RETURNING id`,
    [`W7D${suffix}`, `Wave 7 Department ${suffix}`],
  );
  const glAccountCode = `W7-GL-${suffix}`;
  const costCentre = await pool.query<{ id: number }>(
    `INSERT INTO mdm_cost_centres (organization_id, code, name, department_id, gl_account_code, active, updated_at)
     VALUES (1, $1, $2, $3, $4, TRUE, NOW())
     ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW()
     RETURNING id`,
    [`W7CC${suffix}`, `Wave 7 Cost Centre ${suffix}`, department.rows[0].id, glAccountCode],
  );
  const supplier = await pool.query<{ id: number }>(
    `INSERT INTO suppliers (
       organization_id, name, status, contact_name, email, default_currency_code,
       tax_code_id, default_department_id, updated_at
     ) VALUES (1, $1, 'active', 'Wave 7 Test', $2, 'ZAR', $3, $4, NOW())
     RETURNING id`,
    [`Wave 7 Supplier ${suffix}`, `wave7-${suffix}@example.test`, tax.rows[0].id, department.rows[0].id],
  );
  const item = await pool.query<{ id: number }>(
    `INSERT INTO inventory_items (
       organization_id, name, sku, quantity, price, supplier_id, unit_of_measure,
       unit_of_measure_id, taxable, status, updated_at
     ) VALUES (1, $1, $2, 10, 125, $3, 'each', $4, TRUE, 'active', NOW())
     RETURNING id`,
    [`Wave 7 Item ${suffix}`, `W7-ITEM-${suffix}`, supplier.rows[0].id, uom.rows[0].id],
  );
  return {
    supplierId: supplier.rows[0].id,
    itemId: item.rows[0].id,
    unitOfMeasureId: uom.rows[0].id,
    taxCodeId: tax.rows[0].id,
    departmentId: department.rows[0].id,
    costCentreId: costCentre.rows[0].id,
    glAccountCode,
    suffix,
  };
}

export function mixedLineBody(fixture: ProcurementEvidenceFixture) {
  return {
    supplierId: fixture.supplierId,
    departmentId: fixture.departmentId,
    currencyCode: "ZAR",
    requiredDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    justification: `Wave 7 mixed-line runtime proof ${fixture.suffix}`,
    items: [
      {
        lineType: "CATALOG",
        itemId: fixture.itemId,
        quantity: 2,
        unitPrice: 125,
        unitOfMeasureId: fixture.unitOfMeasureId,
        taxCodeId: fixture.taxCodeId,
        costCentreId: fixture.costCentreId,
        glAccountCode: fixture.glAccountCode,
      },
      {
        lineType: "NON_STOCK",
        description: "Temporary site consumables",
        manualEntryReason: "One-time purchase outside the maintained catalogue",
        quantity: 3,
        unitPrice: 40,
        unitOfMeasureId: fixture.unitOfMeasureId,
        taxCodeId: fixture.taxCodeId,
        costCentreId: fixture.costCentreId,
        glAccountCode: fixture.glAccountCode,
        receiptRequired: true,
      },
      {
        lineType: "SERVICE",
        description: "Equipment calibration service",
        manualEntryReason: "Specialist service is not stocked",
        quantity: 1,
        unitPrice: 600,
        unitOfMeasureId: fixture.unitOfMeasureId,
        taxCodeId: fixture.taxCodeId,
        costCentreId: fixture.costCentreId,
        glAccountCode: fixture.glAccountCode,
        receiptRequired: true,
      },
    ],
  };
}

export async function createAndConvertMixedLineRequisition(cookie: string, fixture: ProcurementEvidenceFixture) {
  const createdResponse = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie,
    body: mixedLineBody(fixture),
  });
  assert.equal(createdResponse.status, 201, `create mixed requisition failed: ${JSON.stringify(createdResponse.json)}`);
  const requisition = unwrapData<{ id: number; requisitionNumber: string }>(
    createdResponse.json,
    "create mixed requisition",
  );
  const approve = await apiJsonRequest(`/purchase-requisitions/${requisition.id}/approve`, {
    method: "POST",
    cookie,
    body: { comment: "Wave 7 runtime evidence approval" },
  });
  assert.equal(approve.status, 200, `approve mixed requisition failed: ${JSON.stringify(approve.json)}`);
  const convertedResponse = await apiJsonRequest(`/purchase-requisitions/${requisition.id}/convert`, {
    method: "POST",
    cookie,
    body: {},
  });
  assert.equal(convertedResponse.status, 201, `convert mixed requisition failed: ${JSON.stringify(convertedResponse.json)}`);
  const purchaseOrder = unwrapData<{ id: number; orderNumber: string }>(
    convertedResponse.json,
    "convert mixed requisition",
  );
  return { requisition, purchaseOrder };
}
