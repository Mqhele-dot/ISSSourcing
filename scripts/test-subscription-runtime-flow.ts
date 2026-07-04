/**
 * Live subscription runtime proof.
 *
 * Requires a running local app and database. The script snapshots org 1 subscription
 * settings, uses the public APIs for plan lifecycle and entitlement checks, and
 * removes test records that it creates.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db.ts";
import { apiJsonRequest, apiRawRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";
import { exitTest } from "./test-exit.ts";

const ORG_ID = 1;
const TEST_PREFIX = `subrt-${Date.now()}-${randomUUID().slice(0, 8)}`;

type CurrentSubscription = {
  normalizedPlanTier: string;
  status: string;
  access: { code: string; label: string; restricted: boolean };
  usageLimits: Array<{ key: string; limit: number | null; current: number }>;
  featureCatalog: Array<{ key: string; enabled: boolean }>;
};

function unwrap<T>(json: unknown): T {
  if (json && typeof json === "object" && (json as { ok?: boolean }).ok === true && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

function errorCode(json: unknown): string | undefined {
  if (json && typeof json === "object" && "error" in json) {
    return (json as { error?: { code?: string } }).error?.code;
  }
  if (json && typeof json === "object" && "code" in json) {
    return String((json as { code?: unknown }).code);
  }
  return undefined;
}

async function snapshotOrgSettings() {
  const result = await pool.query(
    `
      SELECT plan_tier, subscription_status, billing_provider, billing_customer_id,
             billing_subscription_id, current_period_start, current_period_end,
             trial_ends_at, cancel_at_period_end, usage_snapshot
      FROM organization_settings
      WHERE organization_id = $1
    `,
    [ORG_ID],
  );
  return result.rows[0] ?? null;
}

async function restoreOrgSettings(snapshot: Record<string, unknown> | null) {
  if (!snapshot) return;
  await pool.query(
    `
      INSERT INTO organization_settings (
        organization_id, plan_tier, subscription_status, billing_provider,
        billing_customer_id, billing_subscription_id, current_period_start,
        current_period_end, trial_ends_at, cancel_at_period_end, usage_snapshot,
        last_billing_sync_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
      ON CONFLICT (organization_id) DO UPDATE SET
        plan_tier = EXCLUDED.plan_tier,
        subscription_status = EXCLUDED.subscription_status,
        billing_provider = EXCLUDED.billing_provider,
        billing_customer_id = EXCLUDED.billing_customer_id,
        billing_subscription_id = EXCLUDED.billing_subscription_id,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        trial_ends_at = EXCLUDED.trial_ends_at,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        usage_snapshot = EXCLUDED.usage_snapshot,
        last_billing_sync_at = EXCLUDED.last_billing_sync_at,
        updated_at = EXCLUDED.updated_at
    `,
    [
      ORG_ID,
      snapshot.plan_tier,
      snapshot.subscription_status,
      snapshot.billing_provider,
      snapshot.billing_customer_id,
      snapshot.billing_subscription_id,
      snapshot.current_period_start,
      snapshot.current_period_end,
      snapshot.trial_ends_at,
      snapshot.cancel_at_period_end,
      snapshot.usage_snapshot ?? {},
    ],
  );
}

async function cleanupTestRows() {
  await pool.query("DELETE FROM inventory_items WHERE organization_id = $1 AND sku LIKE $2", [ORG_ID, `${TEST_PREFIX}%`]);
  await pool.query("DELETE FROM warehouses WHERE organization_id = $1 AND name LIKE $2", [ORG_ID, `${TEST_PREFIX}%`]);
  await pool.query(
    `DELETE FROM organization_members
     WHERE organization_id = $1
       AND user_id IN (SELECT id FROM users WHERE username LIKE $2)`,
    [ORG_ID, `${TEST_PREFIX}%`],
  );
  await pool.query("DELETE FROM users WHERE username LIKE $1", [`${TEST_PREFIX}%`]);
}

async function setSubscriptionState(fields: {
  planTier?: string;
  status?: string;
  currentPeriodEnd?: Date | null;
  trialEndsAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
}) {
  await pool.query(
    `
      INSERT INTO organization_settings (
        organization_id, plan_tier, subscription_status, billing_provider,
        current_period_end, trial_ends_at, cancel_at_period_end, feature_flags,
        usage_snapshot, last_billing_sync_at, updated_at
      )
      VALUES ($1,$2,$3,'local',$4,$5,$6,'{}'::jsonb,'{}'::jsonb,NOW(),NOW())
      ON CONFLICT (organization_id) DO UPDATE SET
        plan_tier = COALESCE(EXCLUDED.plan_tier, organization_settings.plan_tier),
        subscription_status = COALESCE(EXCLUDED.subscription_status, organization_settings.subscription_status),
        billing_provider = 'local',
        current_period_end = EXCLUDED.current_period_end,
        trial_ends_at = EXCLUDED.trial_ends_at,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        last_billing_sync_at = NOW(),
        updated_at = NOW()
    `,
    [
      ORG_ID,
      fields.planTier ?? null,
      fields.status ?? null,
      fields.currentPeriodEnd ?? null,
      fields.trialEndsAt ?? null,
      fields.cancelAtPeriodEnd ?? false,
    ],
  );
}

async function countRows(table: "users" | "warehouses" | "inventory_items") {
  const result =
    table === "users"
      ? await pool.query<{ count: string }>(
          `
            SELECT COUNT(DISTINCT u.id)::text AS count
            FROM users u
            LEFT JOIN organization_members om
              ON om.user_id = u.id
             AND om.organization_id = $1
            WHERE om.id IS NOT NULL
               OR u.default_organization_id = $1
          `,
          [ORG_ID],
        )
      : await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table} WHERE organization_id = $1`, [
          ORG_ID,
        ]);
  return Number(result.rows[0]?.count ?? 0);
}

async function ensureUsersAtLimit() {
  let count = await countRows("users");
  for (let i = count; i < 3; i++) {
    const username = `${TEST_PREFIX}-user-${i}`;
    const result = await apiJsonRequest("/register", {
      method: "POST",
      body: {
        username,
        email: `${username}@example.com`,
        password: "Admin123!Test",
        confirmPassword: "Admin123!Test",
        fullName: `Subscription Runtime ${i}`,
        role: "viewer",
      },
    });
    assert.equal(result.status, 201, `user registration to reach Starter limit failed: ${JSON.stringify(result.json)}`);
    count++;
  }
  assert.ok(count >= 3, "Starter user usage should be at or above the limit before 4th-user proof");
}

async function ensureWarehousesAtLimit(adminCookie: string) {
  const count = await countRows("warehouses");
  if (count >= 1) return;
  const result = await apiJsonRequest("/warehouses", {
    method: "POST",
    cookie: adminCookie,
    body: { name: `${TEST_PREFIX}-warehouse-0`, location: "Runtime proof", address: "Subscription test" },
  });
  assert.equal(result.status, 201, `warehouse creation to reach Starter limit failed: ${JSON.stringify(result.json)}`);
}

async function ensureInventoryAtStarterLimit() {
  const current = await countRows("inventory_items");
  const needed = Math.max(0, 5000 - current);
  if (needed === 0) return;
  await pool.query(
    `
      INSERT INTO inventory_items (organization_id, name, sku, quantity, price, status)
      SELECT $1, $2 || '-' || gs::text, $3 || '-sku-' || gs::text, 0, 1, 'active'
      FROM generate_series(1, $4::int) AS gs
    `,
    [ORG_ID, `${TEST_PREFIX}-item`, TEST_PREFIX, needed],
  );
}

async function currentSubscription(adminCookie: string): Promise<CurrentSubscription> {
  const result = await apiJsonRequest("/subscription/current", { cookie: adminCookie });
  assert.equal(result.status, 200, `subscription current failed: ${JSON.stringify(result.json)}`);
  return unwrap<CurrentSubscription>(result.json);
}

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("Subscription runtime proof (BASE_URL=%s)\n", baseUrl);

  const snapshot = await snapshotOrgSettings();
  let adminCookie: string | undefined;
  try {
    adminCookie = await loginForTests("admin", "Admin123!");
    assert.ok(adminCookie, "Admin login is required");

    await cleanupTestRows();

    const starter = await apiJsonRequest("/subscription/change-plan", {
      method: "POST",
      cookie: adminCookie,
      body: { planTier: "starter", reason: "subscription_runtime_test_starter" },
    });
    assert.equal(starter.status, 200, `Starter plan change failed: ${JSON.stringify(starter.json)}`);
    assert.equal((await currentSubscription(adminCookie)).normalizedPlanTier, "starter");
    console.log("  ok active org set to Starter through local adapter");

    await ensureUsersAtLimit();
    const blockedUser = await apiJsonRequest("/register", {
      method: "POST",
      body: {
        username: `${TEST_PREFIX}-blocked-user`,
        email: `${TEST_PREFIX}-blocked-user@example.com`,
        password: "Admin123!Test",
        confirmPassword: "Admin123!Test",
        fullName: "Blocked Starter User",
        role: "viewer",
      },
    });
    assert.equal(blockedUser.status, 403, `4th user should be blocked: ${JSON.stringify(blockedUser.json)}`);
    assert.equal(errorCode(blockedUser.json), "PLAN_LIMIT_REACHED");
    console.log("  ok Starter user limit returns PLAN_LIMIT_REACHED");

    adminCookie = await loginForTests("admin", "Admin123!");
    assert.ok(adminCookie, "Admin session should be restored after unauthenticated registration checks");

    await ensureWarehousesAtLimit(adminCookie);
    const blockedWarehouse = await apiJsonRequest("/warehouses", {
      method: "POST",
      cookie: adminCookie,
      body: { name: `${TEST_PREFIX}-blocked-warehouse`, location: "Runtime proof", address: "Subscription test" },
    });
    assert.equal(blockedWarehouse.status, 403, `2nd warehouse should be blocked: ${JSON.stringify(blockedWarehouse.json)}`);
    assert.equal(errorCode(blockedWarehouse.json), "PLAN_LIMIT_REACHED");
    console.log("  ok Starter warehouse limit returns PLAN_LIMIT_REACHED");

    await ensureInventoryAtStarterLimit();
    const blockedSku = await apiJsonRequest("/inventory", {
      method: "POST",
      cookie: adminCookie,
      body: { name: `${TEST_PREFIX}-blocked-sku`, sku: `${TEST_PREFIX}-blocked-sku`, quantity: 0, price: 1 },
    });
    assert.equal(blockedSku.status, 403, `SKU limit should be blocked: ${JSON.stringify(blockedSku.json)}`);
    assert.equal(errorCode(blockedSku.json), "PLAN_LIMIT_REACHED");
    console.log("  ok Starter SKU limit returns PLAN_LIMIT_REACHED");

    const starterExport = await apiRawRequest("/export/inventory/csv", { cookie: adminCookie });
    const starterExportJson = await starterExport.clone().json().catch(() => null);
    assert.equal(starterExport.status, 403, "Starter export should be blocked");
    assert.equal(errorCode(starterExportJson), "FEATURE_NOT_INCLUDED");
    console.log("  ok Starter export returns FEATURE_NOT_INCLUDED");

    const standard = await apiJsonRequest("/subscription/change-plan", {
      method: "POST",
      cookie: adminCookie,
      body: { planTier: "standard", reason: "subscription_runtime_test_standard" },
    });
    assert.equal(standard.status, 200, `Standard plan change failed: ${JSON.stringify(standard.json)}`);
    const standardExport = await apiRawRequest("/export/inventory/csv", { cookie: adminCookie });
    const standardBody = await standardExport.clone().json().catch(() => null);
    assert.notEqual(errorCode(standardBody), "FEATURE_NOT_INCLUDED", "Standard export must not be entitlement-blocked");
    assert.notEqual(standardExport.status, 403, `Standard export should not be forbidden: ${JSON.stringify(standardBody)}`);
    console.log("  ok Standard unlocks export entitlement");

    const growth = await apiJsonRequest("/subscription/change-plan", {
      method: "POST",
      cookie: adminCookie,
      body: { planTier: "growth", reason: "subscription_runtime_test_growth" },
    });
    assert.equal(growth.status, 200, `Growth plan change failed: ${JSON.stringify(growth.json)}`);
    const growthCurrent = await currentSubscription(adminCookie);
    for (const key of ["analytics", "api_access", "document_branding"]) {
      assert.equal(growthCurrent.featureCatalog.find((feature) => feature.key === key)?.enabled, true, `${key} must be enabled on Growth`);
    }
    console.log("  ok Growth enables analytics, API access, and document branding");

    const enterprise = await apiJsonRequest("/subscription/change-plan", {
      method: "POST",
      cookie: adminCookie,
      body: { planTier: "enterprise", reason: "subscription_runtime_test_enterprise" },
    });
    assert.equal(enterprise.status, 200, `Enterprise plan change failed: ${JSON.stringify(enterprise.json)}`);
    const enterpriseCurrent = await currentSubscription(adminCookie);
    assert.ok(enterpriseCurrent.usageLimits.every((entry) => entry.limit === null), "Enterprise limits must be unlimited");
    console.log("  ok Enterprise reports unlimited limits");

    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await setSubscriptionState({ planTier: "growth", status: "trialing", currentPeriodEnd: expired, trialEndsAt: expired });
    const expiredWrite = await apiJsonRequest("/warehouses", {
      method: "POST",
      cookie: adminCookie,
      body: { name: `${TEST_PREFIX}-expired-write`, location: "Runtime proof" },
    });
    assert.equal(expiredWrite.status, 403, `expired trial write should be blocked: ${JSON.stringify(expiredWrite.json)}`);
    assert.equal(errorCode(expiredWrite.json), "TRIAL_EXPIRED");
    console.log("  ok expired trial blocks writes with TRIAL_EXPIRED");

    await setSubscriptionState({ planTier: "growth", status: "canceled", cancelAtPeriodEnd: true });
    const canceledWrite = await apiJsonRequest("/warehouses", {
      method: "POST",
      cookie: adminCookie,
      body: { name: `${TEST_PREFIX}-canceled-write`, location: "Runtime proof" },
    });
    assert.equal(canceledWrite.status, 403, `canceled subscription write should be blocked: ${JSON.stringify(canceledWrite.json)}`);
    assert.equal(errorCode(canceledWrite.json), "SUBSCRIPTION_INACTIVE");
    console.log("  ok canceled subscription blocks writes with SUBSCRIPTION_INACTIVE");

    await setSubscriptionState({ planTier: "enterprise", status: "past_due" });
    const graceWrite = await apiJsonRequest("/warehouses", {
      method: "POST",
      cookie: adminCookie,
      body: { name: `${TEST_PREFIX}-past-due-write`, location: "Runtime proof" },
    });
    assert.equal(graceWrite.status, 201, `past_due should allow writes in billing grace: ${JSON.stringify(graceWrite.json)}`);
    const graceCurrent = await currentSubscription(adminCookie);
    assert.equal(graceCurrent.access.code, "BILLING_GRACE");
    assert.equal(graceCurrent.access.restricted, false);
    console.log("  ok past_due allows writes and reports billing grace");

    const audit = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM plan_change_audit
        WHERE organization_id = $1
          AND reason IN (
            'subscription_runtime_test_starter',
            'subscription_runtime_test_standard',
            'subscription_runtime_test_growth',
            'subscription_runtime_test_enterprise'
          )
      `,
      [ORG_ID],
    );
    assert.ok(Number(audit.rows[0]?.count ?? 0) >= 4, "local subscription lifecycle changes should create audit evidence");
    console.log("  ok plan lifecycle changes create audit evidence");

    console.log("\nSubscription runtime proof passed.");
    exitTest(0);
  } catch (error) {
    if (isConnectionRefused(error)) {
      console.error("Server not reachable at", baseUrl, "- start with: npm run dev");
      exitTest(1);
      return;
    }
    console.error(error);
    exitTest(1);
  } finally {
    await restoreOrgSettings(snapshot);
    await cleanupTestRows();
    await pool.end().catch(() => undefined);
  }
}

main();
