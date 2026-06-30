/**
 * Runtime proof for production control-plane authorization and audit evidence.
 */
import assert from "node:assert/strict";
import { pool } from "../server/db.ts";
import { apiJsonRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";
import { exitTest } from "./test-exit.ts";

function unwrapData<T>(json: unknown, label: string): T {
  if (json && typeof json === "object" && (json as { ok?: boolean }).ok === true && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

async function assertActivity(action: string, referenceType: string, label: string) {
  const result = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM activity_logs
      WHERE action = $1 AND reference_type = $2
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    [action, referenceType],
  );
  assert.ok(result.rows[0]?.id, `${label} should create activity evidence`);
}

async function main() {
  const baseUrl = getTestBaseUrl();
  console.log("Control-plane runtime proof (BASE_URL=%s)\n", baseUrl);

  let adminCookie: string | undefined;
  try {
    adminCookie = await loginForTests("admin", "Admin123!");
  } catch (error) {
    if (isConnectionRefused(error)) {
      console.log("  Server not reachable at %s - start with: npm run dev", baseUrl);
      exitTest(1);
      return;
    }
    throw error;
  }
  const viewerCookie = await loginForTests("viewer", "Admin123!");
  assert.ok(adminCookie, "Admin login is required");
  assert.ok(viewerCookie, "Viewer login is required");

  const users = unwrapData<Array<{ id: number; username: string; role?: string; workPersona?: string | null }>>(
    (await apiJsonRequest("/users", { cookie: adminCookie })).json,
    "users",
  );
  assert.ok(Array.isArray(users) && users.length > 0, "admin can load real users");
  assert.ok("organizationRole" in users[0], "users response includes organization role");
  const target = users.find((u) => u.username !== "admin") ?? users[0];
  const originalPersona = target.workPersona ?? null;

  const deniedRole = await apiJsonRequest(`/users/${target.id}`, {
    method: "PUT",
    cookie: viewerCookie,
    body: { workPersona: "Denied requester edit" },
  });
  assert.equal(deniedRole.status, 403, "viewer cannot update user roles/access");

  const roleUpdate = await apiJsonRequest(`/users/${target.id}`, {
    method: "PUT",
    cookie: adminCookie,
    body: { workPersona: `Control Plane ${Date.now()}` },
  });
  assert.equal(roleUpdate.status, 200, `admin role update failed: ${JSON.stringify(roleUpdate.json)}`);
  await assertActivity("USER_ACCESS_UPDATED", "user", "user role/access update");

  await apiJsonRequest(`/users/${target.id}`, {
    method: "PUT",
    cookie: adminCookie,
    body: { workPersona: originalPersona },
  });
  console.log("  ok user role/access updates are admin-only and audited");

  const deniedSettings = await apiJsonRequest("/settings", {
    method: "PUT",
    cookie: viewerCookie,
    body: { companyName: "Viewer denied" },
  });
  assert.equal(deniedSettings.status, 403, "viewer cannot update settings");

  const settingsUpdate = await apiJsonRequest("/settings", {
    method: "PUT",
    cookie: adminCookie,
    body: {
      companyName: `InvTrack Control ${Date.now()}`,
      currencyCode: "ZAR",
      lowStockDefaultThreshold: 11,
      requireLocationForItems: true,
    },
  });
  assert.equal(settingsUpdate.status, 200, `admin settings update failed: ${JSON.stringify(settingsUpdate.json)}`);
  await assertActivity("SETTINGS_UPDATED", "settings", "settings update");
  console.log("  ok settings changes are admin-only and audited");

  const deniedPolicy = await apiJsonRequest("/approval-policies", {
    method: "POST",
    cookie: viewerCookie,
    body: {
      name: "Viewer denied policy",
      entityType: "requisition",
      amountMin: 0,
      approvalLevel: 1,
      approverRole: "manager",
      isActive: true,
    },
  });
  assert.equal(deniedPolicy.status, 403, "viewer cannot create approval policies");

  const suffix = Date.now();
  const createPolicy = await apiJsonRequest("/approval-policies", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name: `Control plane policy ${suffix}`,
      entityType: "requisition",
      amountMin: 999999,
      amountMax: 1000000,
      approvalLevel: 1,
      approverRole: "manager",
      isActive: true,
    },
  });
  assert.equal(createPolicy.status, 201, `create policy failed: ${JSON.stringify(createPolicy.json)}`);
  const policy = unwrapData<{ id: number }>(createPolicy.json, "policy");
  const updatePolicy = await apiJsonRequest(`/approval-policies/${policy.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { amountMax: 1000001 },
  });
  assert.equal(updatePolicy.status, 200, `update policy failed: ${JSON.stringify(updatePolicy.json)}`);
  await assertActivity("APPROVAL_POLICY_CREATED", "approval_policy", "approval policy creation");
  await assertActivity("APPROVAL_POLICY_UPDATED", "approval_policy", "approval policy update");

  const suggestions = await apiJsonRequest("/approval-suggestions?entityType=requisition&amount=1000000", {
    cookie: adminCookie,
  });
  assert.equal(suggestions.status, 200, "approval policy preview should remain connected to policy data");
  assert.match(JSON.stringify(suggestions.json), /Control plane policy/);

  await apiJsonRequest(`/approval-policies/${policy.id}`, { method: "DELETE", cookie: adminCookie });
  console.log("  ok approval policy changes are permission-protected, persisted, routed, and audited");

  console.log("\nControl-plane runtime proof passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
