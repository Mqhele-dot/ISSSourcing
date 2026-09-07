/**
 * Runtime API/DB proof for requisition-line Master Data propagation.
 *
 * Requires a live app server and database. This complements the static
 * `test:requisition-line-mdm-propagation` guard by proving data survives:
 * requisition create -> fetch -> approve -> convert -> PO fetch.
 */
import assert from "node:assert/strict";
import { pool } from "../server/db.ts";
import { assertProductionSchemaColumns, requisitionAndPoMdmColumns } from "./production-schema-preflight.ts";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

type ApiEnvelope<T> = { ok?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } };

function unwrapData<T>(json: unknown, label: string): T {
  const envelope = json as ApiEnvelope<T>;
  if (envelope && envelope.ok === true && "data" in envelope) return envelope.data as T;
  throw new Error(`${label}: expected { ok: true, data }, got ${JSON.stringify(json)}`);
}

async function ensureFixture() {
  const suffix = Date.now().toString().slice(-8);
  await assertProductionSchemaColumns(requisitionAndPoMdmColumns);

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
      VALUES ($1, $2, $3, TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`EA-${suffix}`, `Each ${suffix}`, "ea"],
  );

  const tax = await pool.query<{ id: number }>(
    `
      INSERT INTO tax_codes (code, name, rate, type, country_code, active, updated_at)
      VALUES ($1, $2, 15, 'vat', 'ZA', TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`VAT-${suffix}`, `VAT ${suffix}`],
  );

  const department = await pool.query<{ id: number }>(
    `
      INSERT INTO departments (organization_id, code, name, active, updated_at)
      VALUES (1, $1, $2, TRUE, NOW())
      ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`D${suffix}`, `Runtime Department ${suffix}`],
  );

  const costCentre = await pool.query<{ id: number; gl_account_code: string }>(
    `
      INSERT INTO mdm_cost_centres (organization_id, code, name, department_id, gl_account_code, active, updated_at)
      VALUES (1, $1, $2, $3, $4, TRUE, NOW())
      ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id, gl_account_code
    `,
    [`CC${suffix}`, `Runtime Cost Centre ${suffix}`, department.rows[0].id, `5000-${suffix}`],
  );

  const supplier = await pool.query<{ id: number }>(
    `
      INSERT INTO suppliers (organization_id, name, status, contact_name, email, default_currency_code, tax_code_id, default_department_id, updated_at)
      VALUES (1, $1, 'active', 'Runtime Test', $2, 'ZAR', $3, $4, NOW())
      RETURNING id
    `,
    [`Runtime Supplier ${suffix}`, `runtime-supplier-${suffix}@example.com`, tax.rows[0].id, department.rows[0].id],
  );

  const item = await pool.query<{ id: number }>(
    `
      INSERT INTO inventory_items (
        organization_id, name, sku, quantity, price, supplier_id, unit_of_measure, unit_of_measure_id, taxable, status, updated_at
      )
      VALUES (1, $1, $2, 25, 125.5, $3, 'each', $4, TRUE, 'active', NOW())
      ON CONFLICT (organization_id, sku) DO UPDATE SET
        supplier_id = EXCLUDED.supplier_id,
        unit_of_measure_id = EXCLUDED.unit_of_measure_id,
        taxable = TRUE,
        status = 'active',
        updated_at = NOW()
      RETURNING id
    `,
    [`Runtime Item ${suffix}`, `RUNTIME-${suffix}`, supplier.rows[0].id, uom.rows[0].id],
  );

  return {
    supplierId: supplier.rows[0].id,
    itemId: item.rows[0].id,
    unitOfMeasureId: uom.rows[0].id,
    taxCodeId: tax.rows[0].id,
    departmentId: department.rows[0].id,
    costCentreId: costCentre.rows[0].id,
    glAccountCode: costCentre.rows[0].gl_account_code,
  };
}

async function main(): Promise<void> {
  const baseUrl = getTestBaseUrl();
  console.log("Requisition line MDM runtime flow (BASE_URL=%s)\n", baseUrl);

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

  const fixture = await ensureFixture();
  const create = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie,
    body: {
      supplierId: fixture.supplierId,
      departmentId: fixture.departmentId,
      currencyCode: "ZAR",
      requiredDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      justification: "Runtime MDM propagation proof",
      notes: "Created by test:requisition-line-mdm-flow",
      items: [
        {
          itemId: fixture.itemId,
          quantity: 3,
          unitPrice: 125.5,
          unitOfMeasureId: fixture.unitOfMeasureId,
          taxCodeId: fixture.taxCodeId,
          costCentreId: fixture.costCentreId,
          glAccountCode: fixture.glAccountCode,
        },
      ],
    },
  });
  assert.equal(create.status, 201, `create requisition failed: ${create.status} ${JSON.stringify(create.json)}`);
  const created = unwrapData<{ id: number }>(create.json, "create requisition");

  const fetchedReq = await apiJsonRequest(`/purchase-requisitions/${created.id}`, { cookie });
  assert.equal(fetchedReq.status, 200, `fetch requisition failed: ${fetchedReq.status}`);
  const req = unwrapData<{ items?: Array<Record<string, unknown>> }>(fetchedReq.json, "fetch requisition");
  const reqLine = req.items?.[0];
  assert.ok(reqLine, "created requisition should include line items");
  assert.equal(Number(reqLine.itemId), fixture.itemId);
  assert.equal(Number(reqLine.quantity), 3);
  assert.equal(Number(reqLine.unitPrice), 125.5);
  assert.equal(Number(reqLine.unitOfMeasureId), fixture.unitOfMeasureId);
  assert.equal(Number(reqLine.taxCodeId), fixture.taxCodeId);
  assert.equal(Number(reqLine.costCentreId), fixture.costCentreId);
  assert.equal(String(reqLine.glAccountCode), fixture.glAccountCode);
  console.log("  ok requisition line persisted UOM/tax/finance metadata");

  const approve = await apiJsonRequest(`/purchase-requisitions/${created.id}/approve`, {
    method: "POST",
    cookie,
    body: { comment: "Runtime propagation approval" },
  });
  assert.equal(approve.status, 200, `approve requisition failed: ${approve.status} ${JSON.stringify(approve.json)}`);

  const convert = await apiJsonRequest(`/purchase-requisitions/${created.id}/convert`, {
    method: "POST",
    cookie,
    body: {},
  });
  assert.equal(convert.status, 201, `convert requisition failed: ${convert.status} ${JSON.stringify(convert.json)}`);
  const po = unwrapData<{ id: number }>(convert.json, "convert requisition");

  const poItemsRes = await apiJsonRequest(`/purchase-orders/${po.id}/items`, { cookie });
  assert.equal(poItemsRes.status, 200, `fetch PO items failed: ${poItemsRes.status}`);
  const poItems = unwrapData<Array<Record<string, unknown>>>(poItemsRes.json, "fetch PO items");
  const poLine = poItems[0];
  assert.ok(poLine, "converted PO should include line items");
  assert.equal(Number(poLine.itemId), fixture.itemId);
  assert.equal(Number(poLine.quantity), 3);
  assert.equal(Number(poLine.unitPrice), 125.5);
  assert.equal(Number(poLine.unitOfMeasureId), fixture.unitOfMeasureId);
  assert.equal(Number(poLine.taxCodeId), fixture.taxCodeId);
  assert.equal(Number(poLine.costCentreId), fixture.costCentreId);
  assert.equal(String(poLine.glAccountCode), fixture.glAccountCode);
  console.log("  ok converted PO line preserved UOM/tax/finance metadata");

  const updatePoLine = await apiJsonRequest(`/purchase-order-items/${poLine.id}`, {
    method: "PUT",
    cookie,
    body: { notes: "Runtime update keeps finance mapping" },
  });
  assert.equal(updatePoLine.status, 200, `update PO item failed: ${updatePoLine.status} ${JSON.stringify(updatePoLine.json)}`);
  const updatedPoLine = unwrapData<Record<string, unknown>>(updatePoLine.json, "update PO item");
  assert.equal(Number(updatedPoLine.costCentreId), fixture.costCentreId);
  assert.equal(String(updatedPoLine.glAccountCode), fixture.glAccountCode);
  console.log("  ok PO item update preserved finance metadata");

  console.log("\nRequisition line MDM runtime flow passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
