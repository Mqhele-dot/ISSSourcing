import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db.ts";
import { assertProductionSchemaColumns, requisitionAndPoMdmColumns } from "./production-schema-preflight.ts";
import { apiJsonRequest } from "./test-http.ts";

type ApiEnvelope<T> = { ok?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } };

export type WorkflowFixture = {
  suffix: string;
  supplierId: number;
  itemId: number;
  sku: string;
  unitOfMeasureId: number;
  taxCodeId: number;
  departmentId: number;
  costCentreId: number;
  glAccountCode: string;
  warehouseId: number;
};

export type WorkflowPo = {
  requisitionId: number;
  poId: number;
  poNumber: string;
  poItemId: number;
};

export function unwrapData<T>(json: unknown, label: string): T {
  const envelope = json as ApiEnvelope<T>;
  if (envelope && envelope.ok === true && "data" in envelope) return envelope.data as T;
  throw new Error(`${label}: expected { ok: true, data }, got ${JSON.stringify(json)}`);
}

export async function ensureWorkflowFixture(label: string): Promise<WorkflowFixture> {
  const suffix = `${label}-${Date.now().toString(36)}-${process.pid}-${randomUUID().slice(0, 8)}`;
  await assertProductionSchemaColumns([
    ...requisitionAndPoMdmColumns,
    { table: "stock_movements", column: "warehouse_id" },
    { table: "stock_movements", column: "reference_type" },
    { table: "stock_movements", column: "receiver_user_id" },
    { table: "warehouse_inventory", column: "warehouse_id" },
    { table: "warehouse_inventory", column: "quantity" },
    { table: "ap_receipts", column: "purchase_order_id" },
    { table: "ap_invoice_match_results", column: "mismatch_summary" },
  ]);

  await pool.query(
    `
      INSERT INTO currencies (code, name, symbol, region_code, region_name, is_main_for_region, exchange_rate_to_zar, active, updated_at)
      VALUES ('ZAR', 'South African Rand', 'R', 'ZA', 'South Africa', TRUE, 1, TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, exchange_rate_to_zar = 1, updated_at = NOW()
    `,
  );

  const uom = await pool.query<{ id: number }>(
    `
      INSERT INTO units_of_measure (code, name, symbol, active, updated_at)
      VALUES ($1, $2, 'ea', TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`EA-${suffix}`, `Each ${suffix}`],
  );

  const tax = await pool.query<{ id: number }>(
    `
      INSERT INTO tax_codes (code, name, rate, type, country_code, active, updated_at)
      VALUES ($1, $2, 0, 'vat', 'ZA', TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, rate = 0, updated_at = NOW()
      RETURNING id
    `,
    [`VAT-${suffix}`, `VAT Zero ${suffix}`],
  );

  const department = await pool.query<{ id: number }>(
    `
      INSERT INTO departments (organization_id, code, name, active, updated_at)
      VALUES (1, $1, $2, TRUE, NOW())
      ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`D-${suffix}`, `Workflow Department ${suffix}`],
  );

  const costCentre = await pool.query<{ id: number; gl_account_code: string }>(
    `
      INSERT INTO mdm_cost_centres (organization_id, code, name, department_id, gl_account_code, active, updated_at)
      VALUES (1, $1, $2, $3, $4, TRUE, NOW())
      ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id, gl_account_code
    `,
    [`CC-${suffix}`, `Workflow Cost Centre ${suffix}`, department.rows[0].id, `5100-${suffix}`],
  );

  const warehouse = await pool.query<{ id: number }>(
    `
      INSERT INTO warehouses (organization_id, name, location, address, aisle, aisles, bins, updated_at)
      VALUES (1, $1, $2, $3, 'A1', '["A1"]'::jsonb, '[{"code":"B1","aisle":"A1"}]'::jsonb, NOW())
      ON CONFLICT (organization_id, name) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `,
    [`Workflow Warehouse ${suffix}`, `WH-${suffix}`, `100 Workflow Way ${suffix}`],
  );

  const supplier = await pool.query<{ id: number }>(
    `
      INSERT INTO suppliers (
        organization_id, name, supplier_code, status, contact_name, email,
        default_currency_code, tax_code_id, default_department_id, updated_at
      )
      VALUES (1, $1, $2, 'active', 'Workflow Test', $3, 'ZAR', $4, $5, NOW())
      RETURNING id
    `,
    [
      `Workflow Supplier ${suffix}`,
      `SUP-${suffix}`,
      `workflow-supplier-${suffix}@example.com`,
      tax.rows[0].id,
      department.rows[0].id,
    ],
  );

  const sku = `WF-${suffix}`;
  const item = await pool.query<{ id: number }>(
    `
      INSERT INTO inventory_items (
        organization_id, name, sku, quantity, price, supplier_id, unit_of_measure,
        unit_of_measure_id, taxable, status, location, default_warehouse_id, updated_at
      )
      VALUES (1, $1, $2, 25, 100, $3, 'each', $4, TRUE, 'active', $5, $6, NOW())
      ON CONFLICT (organization_id, sku) DO UPDATE SET
        supplier_id = EXCLUDED.supplier_id,
        unit_of_measure_id = EXCLUDED.unit_of_measure_id,
        default_warehouse_id = EXCLUDED.default_warehouse_id,
        taxable = TRUE,
        status = 'active',
        updated_at = NOW()
      RETURNING id
    `,
    [`Workflow Item ${suffix}`, sku, supplier.rows[0].id, uom.rows[0].id, `A1-B1`, warehouse.rows[0].id],
  );

  return {
    suffix,
    supplierId: supplier.rows[0].id,
    itemId: item.rows[0].id,
    sku,
    unitOfMeasureId: uom.rows[0].id,
    taxCodeId: tax.rows[0].id,
    departmentId: department.rows[0].id,
    costCentreId: costCentre.rows[0].id,
    glAccountCode: costCentre.rows[0].gl_account_code,
    warehouseId: warehouse.rows[0].id,
  };
}

export async function createSentWorkflowPo(cookie: string, fixture: WorkflowFixture, quantity: number): Promise<WorkflowPo> {
  const unitPrice = 100;
  const create = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie,
    body: {
      supplierId: fixture.supplierId,
      departmentId: fixture.departmentId,
      currencyCode: "ZAR",
      requisitionNumber: `REQ-WF-${fixture.suffix}`,
      requiredDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      justification: "Runtime receiving/AP workflow proof",
      notes: `Created by workflow proof ${fixture.suffix}`,
      items: [
        {
          itemId: fixture.itemId,
          quantity,
          unitPrice,
          unitOfMeasureId: fixture.unitOfMeasureId,
          taxCodeId: fixture.taxCodeId,
          costCentreId: fixture.costCentreId,
          glAccountCode: fixture.glAccountCode,
        },
      ],
    },
  });
  assert.equal(create.status, 201, `create requisition failed: ${create.status} ${JSON.stringify(create.json)}`);
  const requisition = unwrapData<{ id: number }>(create.json, "create requisition");

  const approve = await apiJsonRequest(`/purchase-requisitions/${requisition.id}/approve`, {
    method: "POST",
    cookie,
    body: { comment: "Runtime receiving/AP approval" },
  });
  assert.equal(approve.status, 200, `approve requisition failed: ${approve.status} ${JSON.stringify(approve.json)}`);

  const convert = await apiJsonRequest(`/purchase-requisitions/${requisition.id}/convert`, {
    method: "POST",
    cookie,
    body: {},
  });
  assert.equal(convert.status, 201, `convert requisition failed: ${convert.status} ${JSON.stringify(convert.json)}`);
  const po = unwrapData<{ id: number }>(convert.json, "convert requisition");

  const poRow = await pool.query<{ order_number: string }>(
    `SELECT order_number FROM purchase_orders WHERE id = $1 LIMIT 1`,
    [po.id],
  );
  const poItem = await pool.query<{ id: number }>(
    `SELECT id FROM purchase_order_items WHERE order_id = $1 AND item_id = $2 LIMIT 1`,
    [po.id, fixture.itemId],
  );
  assert.ok(poRow.rows[0]?.order_number, "converted PO should have an order number");
  assert.ok(poItem.rows[0]?.id, "converted PO should have a line for the fixture item");

  const send = await apiJsonRequest(`/purchase/orders/${encodeURIComponent(poRow.rows[0].order_number)}/send`, {
    method: "POST",
    cookie,
    body: { createShipment: false },
  });
  if (send.status !== 200) {
    await pool.query(`UPDATE purchase_orders SET status = 'sent', updated_at = NOW() WHERE id = $1`, [po.id]);
  }

  return {
    requisitionId: requisition.id,
    poId: po.id,
    poNumber: poRow.rows[0].order_number,
    poItemId: poItem.rows[0].id,
  };
}

export async function receiveWorkflowPo(
  cookie: string,
  poNumber: string,
  fixture: WorkflowFixture,
  quantity: number,
  grnNumber: string,
) {
  return apiJsonRequest(`/purchase/orders/${encodeURIComponent(poNumber)}/receive`, {
    method: "POST",
    cookie,
    body: {
      warehouseId: fixture.warehouseId,
      aisle: "A1",
      binCode: "B1",
      warehouseLocation: "A1-B1",
      receiverUserId: 1,
      receiverName: "Runtime Receiver",
      grnNumber,
      lines: [{ sku: fixture.sku, qtyReceivedNow: quantity }],
    },
  });
}

export async function assertActivityOrAuditRecord(params: {
  actionLike: string;
  referenceType?: string;
  referenceId?: number;
  label: string;
}) {
  const activity = await pool.query<{ id: number; user_id: number | null; timestamp: Date }>(
    `
      SELECT id, user_id, timestamp
      FROM activity_logs
      WHERE action ILIKE $1
        AND ($2::text IS NULL OR reference_type = $2)
        AND ($3::integer IS NULL OR reference_id = $3)
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    [`%${params.actionLike}%`, params.referenceType ?? null, params.referenceId ?? null],
  );
  if (activity.rows[0]) {
    assert.ok(activity.rows[0].timestamp, `${params.label} activity should include timestamp`);
    return;
  }

  const opsActivity = await pool.query<{ id: number; actor: string | null; summary_json: unknown; created_at: Date }>(
    `
      SELECT id, actor, summary_json, created_at
      FROM ops_activity
      WHERE action ILIKE $1
        AND ($2::text IS NULL OR entity_type = $2)
        AND ($3::text IS NULL OR entity_id = $3::text)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [`%${params.actionLike}%`, params.referenceType ?? null, params.referenceId == null ? null : String(params.referenceId)],
  );
  if (opsActivity.rows[0]) {
    assert.ok(opsActivity.rows[0].actor, `${params.label} ops activity should include actor`);
    assert.ok(opsActivity.rows[0].created_at, `${params.label} ops activity should include timestamp`);
    assert.ok(opsActivity.rows[0].summary_json, `${params.label} ops activity should include summary/comment details`);
    return;
  }

  const audit = await pool.query<{ id: number; user_id: number | null; created_at: Date; details: unknown }>(
    `
      SELECT id, user_id, created_at, details
      FROM audit_logs
      WHERE action ILIKE $1
        AND ($2::text IS NULL OR resource_type = $2)
        AND ($3::integer IS NULL OR resource_id = $3)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [`%${params.actionLike}%`, params.referenceType ?? null, params.referenceId ?? null],
  );
  assert.ok(audit.rows[0], `${params.label} should create activity or audit evidence`);
  assert.ok(audit.rows[0].created_at, `${params.label} audit should include timestamp`);
  assert.ok(audit.rows[0].details, `${params.label} audit should include details`);
}
