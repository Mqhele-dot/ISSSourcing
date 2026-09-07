/** Live tenant-scoped RFQ -> quote -> evaluation -> award -> PO workflow proof. */
import assert from "node:assert/strict";
import { pool } from "../server/db.ts";
import { assertProductionSchemaColumns } from "./production-schema-preflight.ts";
import { exitTest } from "./test-exit.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

type Envelope<T> = { ok?: boolean; data?: T; error?: { code?: string; message?: string } };

function unwrap<T>(value: unknown, label: string): T {
  const envelope = value as Envelope<T>;
  if (envelope?.ok === true && "data" in envelope) return envelope.data as T;
  throw new Error(`${label}: expected success envelope, got ${JSON.stringify(value)}`);
}

function key(label: string): string {
  return `runtime-sourcing-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function ensureFixture() {
  await assertProductionSchemaColumns([
    { table: "sourcing_events", column: "organization_id" },
    { table: "sourcing_event_lines", column: "cost_centre_id" },
    { table: "sourcing_event_lines", column: "gl_account_code" },
    { table: "supplier_quotes", column: "exchange_rate_to_reporting" },
    { table: "sourcing_awards", column: "recommended_by_user_id" },
    { table: "workflow_idempotency", column: "idempotency_key" },
    { table: "purchase_orders", column: "sourcing_award_id" },
    { table: "audit_logs", column: "event_hash" },
  ]);
  const suffix = Date.now().toString().slice(-9);
  const users = await pool.query<{ id: number; username: string; role: string }>("SELECT id, username, role::text FROM users WHERE username IN ('admin', 'planner', 'supplierdemo')");
  const byName = new Map(users.rows.map((row) => [row.username, row]));
  for (const username of ["admin", "planner", "supplierdemo"]) assert.ok(byName.has(username), `seed user ${username} is required`);
  for (const user of users.rows) {
    await pool.query(`INSERT INTO organization_members (organization_id, user_id, role, application_role, active, status) VALUES (1, $1, $2, $3, TRUE, 'active') ON CONFLICT (organization_id, user_id) DO UPDATE SET application_role = EXCLUDED.application_role, active = TRUE, status = 'active'`, [user.id, user.username === "admin" ? "owner" : "member", user.role]);
    await pool.query("UPDATE users SET default_organization_id = 1 WHERE id = $1", [user.id]);
  }
  const supplier = await pool.query<{ id: number }>(`
    INSERT INTO suppliers (organization_id, name, status, onboarding_status, compliance_status, contact_name, email, default_currency_code, approved_at, approved_by_user_id, updated_at)
    VALUES (1, $1, 'active', 'APPROVED', 'compliant', 'Supplier Workflow User', $2, 'ZAR', NOW(), $3, NOW()) RETURNING id
  `, [`Sourcing Supplier ${suffix}`, `sourcing-${suffix}@example.com`, byName.get("planner")!.id]);
  const supplierId = supplier.rows[0].id;
  await pool.query("UPDATE users SET supplier_id = $1 WHERE id = $2", [supplierId, byName.get("supplierdemo")!.id]);
  await pool.query(`INSERT INTO supplier_portal_mappings (organization_id, user_id, supplier_id, active) VALUES (1, $1, $2, TRUE) ON CONFLICT (organization_id, user_id) DO UPDATE SET supplier_id = EXCLUDED.supplier_id, active = TRUE, updated_at = NOW()`, [byName.get("supplierdemo")!.id, supplierId]);

  const uom = await pool.query<{ id: number }>(`INSERT INTO units_of_measure (code, name, symbol, active, updated_at) VALUES ($1, $2, 'ea', TRUE, NOW()) ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW() RETURNING id`, [`SRC-EA-${suffix}`, `Sourcing Each ${suffix}`]);
  const tax = await pool.query<{ id: number }>(`INSERT INTO tax_codes (code, name, rate, type, country_code, active, updated_at) VALUES ($1, $2, 15, 'vat', 'ZA', TRUE, NOW()) ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW() RETURNING id`, [`SRC-VAT-${suffix}`, `Sourcing VAT ${suffix}`]);
  const department = await pool.query<{ id: number }>(`INSERT INTO departments (organization_id, code, name, active, updated_at) VALUES (1, $1, $2, TRUE, NOW()) ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW() RETURNING id`, [`SRC-D${suffix}`, `Sourcing Department ${suffix}`]);
  const glAccountCode = `6100-${suffix}`;
  const costCentre = await pool.query<{ id: number }>(`INSERT INTO mdm_cost_centres (organization_id, code, name, department_id, gl_account_code, active, updated_at) VALUES (1, $1, $2, $3, $4, TRUE, NOW()) ON CONFLICT (organization_id, code) DO UPDATE SET active = TRUE, updated_at = NOW() RETURNING id`, [`SRC-CC${suffix}`, `Sourcing Cost Centre ${suffix}`, department.rows[0].id, glAccountCode]);
  const item = await pool.query<{ id: number }>(`INSERT INTO inventory_items (organization_id, name, sku, quantity, price, supplier_id, unit_of_measure, unit_of_measure_id, taxable, status, updated_at) VALUES (1, $1, $2, 0, 125, $3, 'each', $4, TRUE, 'active', NOW()) RETURNING id`, [`Sourcing Item ${suffix}`, `SRC-${suffix}`, supplierId, uom.rows[0].id]);
  const requisition = await pool.query<{ id: number }>(`INSERT INTO purchase_requisitions (organization_id, requisition_number, requestor_id, status, required_date, department_id, justification, supplier_id, currency_code, exchange_rate_to_zar, total_amount, approver_id, approval_date, updated_at) VALUES (1, $1, $2, 'APPROVED', NOW() + INTERVAL '14 days', $3, 'Runtime competitive sourcing proof', $4, 'ZAR', 1, 250, $5, NOW(), NOW()) RETURNING id`, [`SRC-REQ-${suffix}`, byName.get("admin")!.id, department.rows[0].id, supplierId, byName.get("planner")!.id]);
  await pool.query(`INSERT INTO purchase_requisition_items (requisition_id, item_id, quantity, unit_price, total_price, unit_of_measure_id, tax_code_id, cost_centre_id, gl_account_code) VALUES ($1, $2, 2, 125, 250, $3, $4, $5, $6)`, [requisition.rows[0].id, item.rows[0].id, uom.rows[0].id, tax.rows[0].id, costCentre.rows[0].id, glAccountCode]);
  return { supplierId, itemId: item.rows[0].id, uomId: uom.rows[0].id, taxId: tax.rows[0].id, departmentId: department.rows[0].id, costCentreId: costCentre.rows[0].id, glAccountCode, requisitionId: requisition.rows[0].id };
}

async function main() {
  console.log("Strategic sourcing runtime workflow (BASE_URL=%s)\n", getTestBaseUrl());
  let adminCookie: string | undefined;
  try { adminCookie = await loginForTests("admin", "Admin123!"); }
  catch (error) { if (isConnectionRefused(error)) { console.error("Start the app before this test: npm run dev"); exitTest(1); return; } throw error; }
  assert.ok(adminCookie, "admin login is required");
  const fixture = await ensureFixture();
  const supplierCookie = await loginForTests("supplierdemo", "Admin123!");
  const plannerCookie = await loginForTests("planner", "Admin123!");
  assert.ok(supplierCookie && plannerCookie, "supplierdemo and planner logins are required");

  const create = await apiJsonRequest("/sourcing/events", { method: "POST", cookie: adminCookie, body: {
    title: `Runtime RFQ ${Date.now()}`, description: "Tenant-scoped sourcing workflow proof", deadline: new Date(Date.now() + 3 * 86400000).toISOString(), requisitionId: fixture.requisitionId, reportingCurrencyCode: "ZAR", minimumResponses: 1, competitionRequired: true, supplierIds: [fixture.supplierId],
    lines: [{ itemId: fixture.itemId, description: "Runtime sourced item", quantity: 2, unitOfMeasureId: fixture.uomId, taxCodeId: fixture.taxId, costCentreId: fixture.costCentreId, glAccountCode: fixture.glAccountCode, targetUnitPrice: 125, targetCurrencyCode: "ZAR" }],
    criteria: [{ name: "Landed cost", criterionType: "commercial", weight: 70 }, { name: "Delivery", criterionType: "delivery", weight: 30 }],
  }});
  assert.equal(create.status, 201, `RFQ create failed: ${JSON.stringify(create.json)}`);
  const created = unwrap<{ event: { id: number }; lines: Array<{ id: number }> }>(create.json, "RFQ create");
  const eventId = created.event.id;
  const publishKey = key("publish");
  const publish = await apiJsonRequest(`/sourcing/events/${eventId}/publish`, { method: "POST", cookie: adminCookie, body: {}, headers: { "Idempotency-Key": publishKey } });
  assert.equal(publish.status, 200, `RFQ publish failed: ${JSON.stringify(publish.json)}`);
  const duplicatePublish = await apiJsonRequest(`/sourcing/events/${eventId}/publish`, { method: "POST", cookie: adminCookie, body: {}, headers: { "Idempotency-Key": publishKey } });
  assert.equal(duplicatePublish.status, 200, "repeat idempotency key should return the recorded publication result");

  const supplierDetailsResponse = await apiJsonRequest(`/sourcing/supplier/events/${eventId}`, { cookie: supplierCookie });
  assert.equal(supplierDetailsResponse.status, 200, `supplier RFQ fetch failed: ${JSON.stringify(supplierDetailsResponse.json)}`);
  assert.doesNotMatch(JSON.stringify(supplierDetailsResponse.json), /targetUnitPrice/, "supplier response must not expose buyer target pricing");
  const supplierDetails = unwrap<{ lines: Array<{ id: number }> }>(supplierDetailsResponse.json, "supplier RFQ details");
  const quote = await apiJsonRequest(`/sourcing/supplier/events/${eventId}/quotes`, { method: "POST", cookie: supplierCookie, headers: { "Idempotency-Key": key("quote") }, body: { currencyCode: "ZAR", validityDate: new Date(Date.now() + 30 * 86400000).toISOString(), paymentTerms: "Net 30", deliveryDays: 7, lines: [{ eventLineId: supplierDetails.lines[0].id, quantity: 2, unitPrice: 120, taxAmount: 36, freightAmount: 10, compliant: true }] } });
  assert.equal(quote.status, 201, `supplier quote failed: ${JSON.stringify(quote.json)}`);

  const buyerCapture = await apiJsonRequest("/procurement/quotations", { method: "POST", cookie: adminCookie, headers: { "Idempotency-Key": key("buyer-capture") }, body: { eventId, supplierId: fixture.supplierId, currencyCode: "ZAR", validityDate: new Date(Date.now() + 30 * 86400000).toISOString(), paymentTerms: "Net 30", deliveryDays: 6, notes: "Revision received by controlled email channel", lines: [{ eventLineId: supplierDetails.lines[0].id, quantity: 2, unitPrice: 118, taxAmount: 35.4, freightAmount: 10, compliant: true }] } });
  assert.equal(buyerCapture.status, 201, `buyer quotation capture failed: ${JSON.stringify(buyerCapture.json)}`);
  const capturedQuoteId = unwrap<{ quote: { id: number; version: number } }>(buyerCapture.json, "buyer quotation capture").quote.id;
  const quotationList = await apiJsonRequest(`/v2/procurement/quotations?page=1&pageSize=25&eventId=${eventId}&sort=newest`, { cookie: adminCookie });
  assert.equal(quotationList.status, 200, `quotation list failed: ${JSON.stringify(quotationList.json)}`);
  const quotationPage = unwrap<{ items: Array<{ id: number }>; total: number }>(quotationList.json, "quotation list");
  assert.equal(quotationPage.total, 2, "quotation history should preserve the superseded supplier version and captured revision");
  assert.ok(quotationPage.items.some((entry) => entry.id === capturedQuoteId), "captured quotation should appear in the bounded buyer list");
  const quotationDetail = await apiJsonRequest(`/procurement/quotations/${capturedQuoteId}`, { cookie: adminCookie });
  assert.equal(quotationDetail.status, 200, `quotation detail failed: ${JSON.stringify(quotationDetail.json)}`);

  const close = await apiJsonRequest(`/sourcing/events/${eventId}/close`, { method: "POST", cookie: adminCookie, headers: { "Idempotency-Key": key("close") }, body: {} });
  assert.equal(close.status, 200, `RFQ close failed: ${JSON.stringify(close.json)}`);
  const comparison = unwrap<Array<{ quote: { id: number }; lines: Array<{ id: number; eventLineId: number }> }>>((await apiJsonRequest(`/sourcing/events/${eventId}/comparison`, { cookie: adminCookie })).json, "quote comparison");
  assert.equal(comparison.length, 1, "one supplier response should be available for evaluation");
  const quoteId = comparison[0].quote.id;
  const evaluation = await apiJsonRequest(`/sourcing/events/${eventId}/quotes/${quoteId}/evaluation`, { method: "POST", cookie: adminCookie, body: { scores: [{ criterionId: unwrap<{ criteria: Array<{ id: number }> }>(create.json, "created criteria").criteria[0].id, score: 90 }, { criterionId: unwrap<{ criteria: Array<{ id: number }> }>(create.json, "created criteria").criteria[1].id, score: 80 }] } });
  assert.equal(evaluation.status, 200, `evaluation failed: ${JSON.stringify(evaluation.json)}`);
  const awardSubmit = await apiJsonRequest(`/sourcing/events/${eventId}/awards`, { method: "POST", cookie: adminCookie, headers: { "Idempotency-Key": key("award") }, body: { justification: "Best evaluated compliant total cost and delivery response.", lines: [{ eventLineId: created.lines[0].id, quoteLineId: comparison[0].lines[0].id, awardedQuantity: 2 }] } });
  assert.equal(awardSubmit.status, 201, `award submission failed: ${JSON.stringify(awardSubmit.json)}`);
  const awardId = unwrap<{ award: { id: number } }>(awardSubmit.json, "award submission").award.id;

  const selfApprove = await apiJsonRequest(`/sourcing/awards/${awardId}/approve`, { method: "POST", cookie: adminCookie, headers: { "Idempotency-Key": key("self-approve") }, body: { reason: "Self approval must fail" } });
  assert.equal(selfApprove.status, 403, "event owner must not approve their own award");
  assert.match(JSON.stringify(selfApprove.json), /SEGREGATION_OF_DUTIES_VIOLATION/);
  const approval = await apiJsonRequest(`/sourcing/awards/${awardId}/approve`, { method: "POST", cookie: plannerCookie, headers: { "Idempotency-Key": key("approve") }, body: { reason: "Independent commercial approval completed" } });
  assert.equal(approval.status, 200, `independent award approval failed: ${JSON.stringify(approval.json)}`);
  const conversion = await apiJsonRequest(`/sourcing/awards/${awardId}/convert-to-po`, { method: "POST", cookie: plannerCookie, headers: { "Idempotency-Key": key("convert") }, body: {} });
  assert.equal(conversion.status, 200, `award conversion failed: ${JSON.stringify(conversion.json)}`);
  const converted = unwrap<{ purchaseOrders: Array<{ id: number; sourcingAwardId: number }> }>(conversion.json, "award conversion");
  assert.equal(converted.purchaseOrders[0].sourcingAwardId, awardId);
  const poLine = await pool.query<{ cost_centre_id: number; gl_account_code: string; tax_code_id: number; unit_of_measure_id: number }>("SELECT cost_centre_id, gl_account_code, tax_code_id, unit_of_measure_id FROM purchase_order_items WHERE order_id = $1", [converted.purchaseOrders[0].id]);
  assert.equal(poLine.rows[0].cost_centre_id, fixture.costCentreId);
  assert.equal(poLine.rows[0].gl_account_code, fixture.glAccountCode);
  assert.equal(poLine.rows[0].tax_code_id, fixture.taxId);
  assert.equal(poLine.rows[0].unit_of_measure_id, fixture.uomId);
  const audit = await pool.query<{ action: string; event_hash: string; previous_hash: string | null }>("SELECT action, event_hash, previous_hash FROM audit_logs WHERE organization_id = 1 AND resource_type IN ('sourcing_event', 'supplier_quote', 'sourcing_award') AND resource_id IN ($1, $2) ORDER BY created_at", [eventId, awardId]);
  assert.ok(audit.rows.length >= 6, "sourcing workflow should create append-only audit evidence");
  assert.ok(audit.rows.every((row) => row.event_hash), "every sourcing audit event must be hash chained");
  console.log("  ok tenant-scoped event, supplier and buyer-captured quotation versions, bounded review, weighted evaluation, independent award, PO conversion, and audit chain");
  console.log("\nStrategic sourcing runtime workflow passed.");
}

main().catch((error) => { console.error(error); exitTest(1); }).finally(async () => { await pool.end().catch(() => undefined); });
