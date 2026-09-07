/**
 * Runtime API proof for MDM where-used dependency blocking.
 *
 * Requires a live app server and database. This proves API responses, not just
 * source-code presence, for protected Master Data deactivation.
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

function errorCode(json: unknown): string | undefined {
  return (json as ApiEnvelope<unknown>)?.error?.code;
}

async function createFixture() {
  const suffix = Date.now().toString().slice(-8);
  await assertProductionSchemaColumns(requisitionAndPoMdmColumns);

  await pool.query(
    `
      INSERT INTO currencies (code, name, symbol, region_code, region_name, is_main_for_region, exchange_rate_to_zar, active, updated_at)
      VALUES ('ZAR', 'South African Rand', 'R', 'ZA', 'South Africa', TRUE, 1, TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, exchange_rate_to_zar = 1, updated_at = NOW()
    `,
  );

  const fromUom = await pool.query<{ id: number }>(
    `
      INSERT INTO units_of_measure (code, name, symbol, active, updated_at)
      VALUES ($1, $2, 'ea', TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`DEP-EA-${suffix}`, `Dependency Each ${suffix}`],
  );
  const toUom = await pool.query<{ id: number }>(
    `
      INSERT INTO units_of_measure (code, name, symbol, active, updated_at)
      VALUES ($1, $2, 'box', TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`DEP-BOX-${suffix}`, `Dependency Box ${suffix}`],
  );

  const tax = await pool.query<{ id: number }>(
    `
      INSERT INTO tax_codes (code, name, rate, type, country_code, active, updated_at)
      VALUES ($1, $2, 15, 'vat', 'ZA', TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`DEP-VAT-${suffix}`, `Dependency VAT ${suffix}`],
  );

  const department = await pool.query<{ id: number }>(
    `
      INSERT INTO departments (organization_id, code, name, active, updated_at)
      VALUES (1, $1, $2, TRUE, NOW())
      ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`DEP-D${suffix}`, `Dependency Department ${suffix}`],
  );

  const costCentre = await pool.query<{ id: number; gl_account_code: string }>(
    `
      INSERT INTO mdm_cost_centres (organization_id, code, name, department_id, gl_account_code, active, updated_at)
      VALUES (1, $1, $2, $3, $4, TRUE, NOW())
      ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW()
      RETURNING id, gl_account_code
    `,
    [`DEP-CC${suffix}`, `Dependency Cost Centre ${suffix}`, department.rows[0].id, `6100-${suffix}`],
  );

  const glMapping = await pool.query<{ id: number }>(
    `
      INSERT INTO mdm_gl_mappings (
        organization_id, mapping_type, source_type, source_id, gl_account_code, cost_centre_id, active, updated_at
      )
      VALUES (1, 'expense', 'cost_centre', $1, $2, $3, TRUE, NOW())
      ON CONFLICT (organization_id, mapping_type, source_type, source_id)
      DO UPDATE SET gl_account_code = EXCLUDED.gl_account_code, cost_centre_id = EXCLUDED.cost_centre_id, active = TRUE, updated_at = NOW()
      RETURNING id
    `,
    [`DEP-CC${suffix}`, costCentre.rows[0].gl_account_code, costCentre.rows[0].id],
  );

  const supplier = await pool.query<{ id: number }>(
    `
      INSERT INTO suppliers (organization_id, name, status, contact_name, email, default_currency_code, tax_code_id, default_department_id, updated_at)
      VALUES (1, $1, 'active', 'Dependency Test', $2, 'ZAR', $3, $4, NOW())
      RETURNING id
    `,
    [`Dependency Supplier ${suffix}`, `dependency-supplier-${suffix}@example.com`, tax.rows[0].id, department.rows[0].id],
  );

  const item = await pool.query<{ id: number }>(
    `
      INSERT INTO inventory_items (
        organization_id, name, sku, quantity, price, supplier_id, unit_of_measure, unit_of_measure_id, taxable, status, updated_at
      )
      VALUES (1, $1, $2, 10, 89.25, $3, 'each', $4, TRUE, 'active', NOW())
      ON CONFLICT (organization_id, sku) DO UPDATE SET
        supplier_id = EXCLUDED.supplier_id,
        unit_of_measure_id = EXCLUDED.unit_of_measure_id,
        taxable = TRUE,
        status = 'active',
        updated_at = NOW()
      RETURNING id
    `,
    [`Dependency Item ${suffix}`, `DEP-ITEM-${suffix}`, supplier.rows[0].id, fromUom.rows[0].id],
  );

  const conversion = await pool.query<{ id: number }>(
    `
      INSERT INTO mdm_uom_conversions (organization_id, from_uom_id, to_uom_id, item_id, factor, active, updated_at)
      VALUES (1, $1, $2, $3, 1, TRUE, NOW())
      RETURNING id
    `,
    [fromUom.rows[0].id, toUom.rows[0].id, item.rows[0].id],
  );

  return {
    supplierId: supplier.rows[0].id,
    itemId: item.rows[0].id,
    unitOfMeasureId: fromUom.rows[0].id,
    taxCodeId: tax.rows[0].id,
    departmentId: department.rows[0].id,
    costCentreId: costCentre.rows[0].id,
    glAccountCode: costCentre.rows[0].gl_account_code,
    conversionId: conversion.rows[0].id,
    glMappingId: glMapping.rows[0].id,
  };
}

async function createOpenRequisition(cookie: string, fixture: Awaited<ReturnType<typeof createFixture>>): Promise<number> {
  const create = await apiJsonRequest("/purchase-requisitions", {
    method: "POST",
    cookie,
    body: {
      supplierId: fixture.supplierId,
      departmentId: fixture.departmentId,
      currencyCode: "ZAR",
      requiredDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      justification: "Runtime dependency proof",
      items: [
        {
          itemId: fixture.itemId,
          quantity: 1,
          unitPrice: 89.25,
          unitOfMeasureId: fixture.unitOfMeasureId,
          taxCodeId: fixture.taxCodeId,
          costCentreId: fixture.costCentreId,
          glAccountCode: fixture.glAccountCode,
        },
      ],
    },
  });
  assert.equal(create.status, 201, `create requisition failed: ${create.status} ${JSON.stringify(create.json)}`);
  return unwrapData<{ id: number }>(create.json, "create dependency requisition").id;
}

function assertDependencyBlocked(label: string, response: Awaited<ReturnType<typeof apiJsonRequest>>): void {
  assert.equal(response.status, 409, `${label}: expected 409, got ${response.status} ${JSON.stringify(response.json)}`);
  assert.equal(errorCode(response.json), "MDM_RECORD_IN_USE", `${label}: expected MDM_RECORD_IN_USE`);
  const usage = (response.json as ApiEnvelope<unknown>)?.error?.details as { usage?: unknown } | undefined;
  assert.ok(Array.isArray(usage?.usage), `${label}: expected usage details`);
  assert.ok(usage.usage.length > 0, `${label}: expected at least one usage entry`);
  console.log("  ok %s blocked with usage details", label);
}

async function main(): Promise<void> {
  const baseUrl = getTestBaseUrl();
  console.log("MDM dependency runtime proof (BASE_URL=%s)\n", baseUrl);

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

  const fixture = await createFixture();
  await createOpenRequisition(cookie, fixture);

  const conversionPatch = await apiJsonRequest(`/mdm/uom-conversions/${fixture.conversionId}`, {
    method: "PATCH",
    cookie,
    body: { active: false },
  });
  assertDependencyBlocked("UOM conversion deactivation", conversionPatch);

  const glPatch = await apiJsonRequest(`/mdm/gl-mappings/${fixture.glMappingId}`, {
    method: "PATCH",
    cookie,
    body: { active: false },
  });
  assertDependencyBlocked("GL mapping deactivation", glPatch);

  console.log("\nMDM dependency runtime proof passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
