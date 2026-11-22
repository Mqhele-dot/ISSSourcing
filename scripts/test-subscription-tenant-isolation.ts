import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pool } from "../server/db.ts";
import { countOrganizationUsers } from "../server/plan-limit-service.ts";
import { exitTest } from "./test-exit.ts";

const suffix = `tenantiso-${Date.now()}-${randomUUID().slice(0, 8)}`;

async function main() {
  const idSeed = await pool.query<{ next_id: number }>(
    `SELECT COALESCE(MAX(id), 0)::int + 1000 AS next_id FROM organizations`,
  );
  const orgAId = idSeed.rows[0].next_id;
  const orgBId = orgAId + 1;
  const orgA = await pool.query<{ id: number }>(
    `INSERT INTO organizations (id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING id`,
    [orgAId, `Tenant Isolation A ${suffix}`, `${suffix}-a`],
  );
  const orgB = await pool.query<{ id: number }>(
    `INSERT INTO organizations (id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING id`,
    [orgBId, `Tenant Isolation B ${suffix}`, `${suffix}-b`],
  );
  assert.equal(orgA.rows[0].id, orgAId);
  assert.equal(orgB.rows[0].id, orgBId);

  try {
    await pool.query(
      `INSERT INTO organization_settings (organization_id, plan_tier, subscription_status, billing_provider, feature_flags, usage_snapshot, updated_at)
       VALUES ($1, 'starter', 'active', 'local', '{}'::jsonb, '{}'::jsonb, NOW())`,
      [orgAId],
    );

    for (let i = 0; i < 3; i += 1) {
      const user = await pool.query<{ id: number }>(
        `INSERT INTO users (username, password, email, role, default_organization_id, email_verified, created_at, updated_at)
         VALUES ($1, 'test.hash', $2, 'viewer', $3, TRUE, NOW(), NOW())
         RETURNING id`,
        [`${suffix}-a-${i}`, `${suffix}-a-${i}@example.com`, orgAId],
      );
      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role, created_at)
         VALUES ($1, $2, 'member', NOW())
         ON CONFLICT DO NOTHING`,
        [orgAId, user.rows[0].id],
      );
    }

    for (let i = 0; i < 5; i += 1) {
      const user = await pool.query<{ id: number }>(
        `INSERT INTO users (username, password, email, role, default_organization_id, email_verified, created_at, updated_at)
         VALUES ($1, 'test.hash', $2, 'viewer', $3, TRUE, NOW(), NOW())
         RETURNING id`,
        [`${suffix}-b-${i}`, `${suffix}-b-${i}@example.com`, orgBId],
      );
      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role, created_at)
         VALUES ($1, $2, 'member', NOW())
         ON CONFLICT DO NOTHING`,
        [orgBId, user.rows[0].id],
      );
    }

    assert.equal(await countOrganizationUsers(orgAId), 3, "Tenant A count should include only Tenant A users");
    assert.equal(await countOrganizationUsers(orgBId), 5, "Tenant B count should not affect Tenant A users");

    const planLimitSource = readFileSync("server/plan-limit-service.ts", "utf8");
    const authSource = readFileSync("server/auth.ts", "utf8");
    const organizationRouteSource = readFileSync("server/modules/organization/register-organization-routes.ts", "utf8");
    assert.match(planLimitSource, /organization_members/, "user counting must use organization memberships");
    assert.match(authSource, /createdOrganizationId/, "public registration must create a tenant instead of using an implicit organization");
    assert.match(authSource, /role: "owner"/, "the registering user must become the new tenant owner");
    assert.match(organizationRouteSource, /\/api\/organization\/members/, "tenant users must be added through the protected membership endpoint");
    assert.match(organizationRouteSource, /countOrganizationUsers\(organizationId\)/, "membership creation must use an organization-scoped user count");
    assert.match(organizationRouteSource, /ensureTwoFactorAuthenticated[\s\S]*ensurePermission\("users", "manage"\)/, "membership creation requires 2FA and user-management permission");
    assert.match(organizationRouteSource, /ORGANIZATION_MEMBER_ADDED/, "membership creation must append audit evidence");
    assert.match(planLimitSource, /limitKey[\s\S]*currentCount/, "PLAN_LIMIT_REACHED details include limit key and current count");

    await pool.query(
      `INSERT INTO warehouses (organization_id, name, location, address, updated_at)
       VALUES ($1, $2, 'Test', 'Test', NOW()), ($3, $4, 'Test', 'Test', NOW())`,
      [orgAId, `${suffix}-warehouse-a`, orgBId, `${suffix}-warehouse-b`],
    );
    const warehouseCounts = await pool.query<{ organization_id: number; count: string }>(
      `SELECT organization_id, COUNT(*)::text AS count
       FROM warehouses
       WHERE organization_id IN ($1, $2)
       GROUP BY organization_id`,
      [orgAId, orgBId],
    );
    const byOrg = new Map(warehouseCounts.rows.map((row) => [Number(row.organization_id), Number(row.count)]));
    assert.equal(byOrg.get(orgAId), 1, "Tenant A warehouse usage is tenant scoped");
    assert.equal(byOrg.get(orgBId), 1, "Tenant B warehouse usage is tenant scoped");

    await pool.query(
      `INSERT INTO inventory_items (organization_id, name, sku, quantity, price, updated_at)
       VALUES ($1, $2, $3, 1, 1, NOW()), ($4, $5, $6, 1, 1, NOW())`,
      [orgAId, `${suffix} SKU A`, `${suffix}-SKU-A`, orgBId, `${suffix} SKU B`, `${suffix}-SKU-B`],
    );
    const skuCounts = await pool.query<{ organization_id: number; count: string }>(
      `SELECT organization_id, COUNT(*)::text AS count
       FROM inventory_items
       WHERE organization_id IN ($1, $2)
       GROUP BY organization_id`,
      [orgAId, orgBId],
    );
    const skusByOrg = new Map(skuCounts.rows.map((row) => [Number(row.organization_id), Number(row.count)]));
    assert.equal(skusByOrg.get(orgAId), 1, "Tenant A SKU usage is tenant scoped");
    assert.equal(skusByOrg.get(orgBId), 1, "Tenant B SKU usage is tenant scoped");

    console.log("subscription tenant isolation regression passed");
  } finally {
    await pool.query(`DELETE FROM inventory_items WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
    await pool.query(`DELETE FROM warehouses WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
    await pool.query(`DELETE FROM organization_members WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
    await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`${suffix}%`]);
    await pool.query(`DELETE FROM organization_settings WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
    await pool.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [orgAId, orgBId]);
  }
}

main()
  .then(() => exitTest(0))
  .catch((error) => {
    console.error(error);
    exitTest(1);
  });
