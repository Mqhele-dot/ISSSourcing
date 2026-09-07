import assert from "node:assert/strict";
import { pool } from "../server/db";
import { apiJsonRequest, loginForTests } from "./test-http";
import { exitTest } from "./test-exit";
import { errorCode, unwrapData } from "./runtime-fixtures/procurement-line-evidence-fixture";

async function main() {
  const cookie = await loginForTests("admin", "Admin123!");
  assert.ok(cookie, "Seeded admin login is required");
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  const entityType = `wave7_${suffix}`;
  const created = await pool.query<{ id: number; version: number }>(
    `INSERT INTO approval_policies (
       organization_id, name, entity_type, amount_min, amount_max, approval_level,
       approver_role, is_active, version, created_at, updated_at
     ) VALUES (1, $1, $2, 0, 1000, 1, 'manager', TRUE, 1, NOW(), NOW())
     RETURNING id, version`,
    [`Wave 7 Base Policy ${suffix}`, entityType],
  );
  const policyId = created.rows[0].id;
  await pool.query(
    `INSERT INTO approval_policies (
       organization_id, name, entity_type, amount_min, amount_max, approval_level,
       approver_role, is_active, version, created_at, updated_at
     ) VALUES (1, $1, $2, 500, 1500, 1, 'admin', TRUE, 1, NOW(), NOW())`,
    [`Wave 7 Overlap Policy ${suffix}`, entityType],
  );

  const overlapList = await apiJsonRequest(
    `/approval-policies?page=1&pageSize=25&entityType=${encodeURIComponent(entityType)}&overlapOnly=true`,
    { cookie },
  );
  assert.equal(overlapList.status, 200);
  const overlaps = unwrapData<{ items: Array<{ id: number }>; total: number }>(
    overlapList.json,
    "overlap-only policies",
  );
  assert.ok(overlaps.total >= 2, "overlap-only filter must return both conflicting policies");

  const ambiguousCreate = await apiJsonRequest("/approval-policies", {
    method: "POST",
    cookie,
    body: {
      name: `Wave 7 Rejected Overlap ${suffix}`,
      entityType,
      amountMin: 700,
      amountMax: 900,
      approvalLevel: 1,
      approverRole: "manager",
      isActive: true,
    },
  });
  assert.equal(ambiguousCreate.status, 409);
  assert.equal(errorCode(ambiguousCreate.json), "APPROVAL_POLICY_OVERLAP");
  assert.match(JSON.stringify(ambiguousCreate.json), /conflicts/i);

  const stale = await apiJsonRequest(`/approval-policies/${policyId}`, {
    method: "PATCH",
    cookie,
    body: {
      expectedVersion: 0,
      name: `Stale Wave 7 ${suffix}`,
      changeReason: "Prove stale version protection",
    },
  });
  assert.equal(stale.status, 409);
  assert.equal(errorCode(stale.json), "APPROVAL_POLICY_STALE");

  const validUpdate = await apiJsonRequest(`/approval-policies/${policyId}`, {
    method: "PATCH",
    cookie,
    body: {
      expectedVersion: created.rows[0].version,
      name: `Wave 7 Corrected Policy ${suffix}`,
    },
  });
  assert.equal(validUpdate.status, 200, `policy correction failed: ${JSON.stringify(validUpdate.json)}`);
  const updated = unwrapData<{ version: number; name: string }>(validUpdate.json, "updated policy");
  assert.equal(updated.version, 2);
  assert.match(updated.name, /Corrected Policy/);

  const audit = await pool.query<{ description: string; user_id: number; organization_id: number }>(
    `SELECT description, user_id, organization_id
     FROM activity_logs
     WHERE organization_id = 1
       AND action = 'APPROVAL_POLICY_UPDATED'
       AND reference_type = 'approval_policy'
       AND reference_id = $1
     ORDER BY timestamp DESC
     LIMIT 1`,
    [policyId],
  );
  assert.ok(audit.rows[0], "policy mutation must create tenant-scoped audit evidence");
  assert.ok(Number(audit.rows[0].user_id) > 0);
  assert.match(audit.rows[0].description, /Old value:.*New value:.*Reason:/);

  // Development seeds use explicit organization IDs, so synchronize the
  // disposable database sequence before creating the foreign-tenant fixture.
  await pool.query(
    `SELECT setval(
       pg_get_serial_sequence('organizations', 'id'),
       GREATEST(COALESCE((SELECT MAX(id) FROM organizations), 0), 1),
       TRUE
     )`,
  );
  const secondOrg = await pool.query<{ id: number }>(
    `INSERT INTO organizations (name, slug, active, country_code, default_currency_code, locale, timezone)
     VALUES ($1, $2, TRUE, 'ZA', 'ZAR', 'en-ZA', 'Africa/Johannesburg')
     RETURNING id`,
    [`Wave 7 Isolated Org ${suffix}`, `wave7-isolated-${suffix}`],
  );
  const foreignPolicy = await pool.query<{ id: number }>(
    `INSERT INTO approval_policies (
       organization_id, name, entity_type, amount_min, amount_max, approval_level,
       approver_role, is_active, version, created_at, updated_at
     ) VALUES ($1, $2, 'requisition', 0, 100, 1, 'manager', TRUE, 1, NOW(), NOW())
     RETURNING id`,
    [secondOrg.rows[0].id, `Wave 7 Foreign Policy ${suffix}`],
  );
  const crossTenant = await apiJsonRequest(`/approval-policies/${foreignPolicy.rows[0].id}`, {
    method: "PATCH",
    cookie,
    body: { expectedVersion: 1, name: "Cross-tenant edit must fail" },
  });
  assert.equal(crossTenant.status, 404, "policy mutations must be tenant-scoped");

  await pool.query(
    `DELETE FROM approval_policies
     WHERE entity_type = $1 OR organization_id = $2`,
    [entityType, secondOrg.rows[0].id],
  );
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [secondOrg.rows[0].id]);

  console.log("Approval policy runtime hardening proof passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => pool.end().catch(() => undefined));
