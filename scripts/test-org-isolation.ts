/**
 * Lightweight org isolation sanity checks (no DB required) — AsyncLocalStorage only.
 * For HTTP cross-tenant checks against a running server, use `scripts/test-org-api-isolation.ts` (`npm run test:org-api`).
 * Run: npx tsx scripts/test-org-isolation.ts
 */
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import {
  organizationAsyncLocalStorage, getActiveOrganizationId, getOptionalTenantContext,
  getTenantContext, runWithTenantContext, TenantContextError, type TenantContext,
} from "../server/organization-context";

const context = (organizationId: number): TenantContext => ({
  organizationId, membershipId: organizationId + 100, userId: organizationId + 200,
  userRole: "viewer", membershipRole: "member", effectivePermissions: ["reports:read"],
  correlationId: `isolation-test-${organizationId}`,
});
function assertNoTenant() {
  assert.equal(getOptionalTenantContext(), null);
  assert.throws(getActiveOrganizationId, TenantContextError, "Missing context must never default to tenant 1");
  assert.throws(getTenantContext, { code: "TENANT_CONTEXT_REQUIRED" });
}

assertNoTenant();
await Promise.all([42, 73, 91].map(organizationId => runWithTenantContext(context(organizationId), async () => {
  assert.equal(getActiveOrganizationId(), organizationId);
  await pause(5);
  assert.deepEqual(getTenantContext(), context(organizationId), "Concurrent async work must retain its own membership");
  await organizationAsyncLocalStorage.run(context(organizationId + 1000), async () => {
    await pause(1);
    assert.equal(getActiveOrganizationId(), organizationId + 1000);
  });
  assert.equal(getActiveOrganizationId(), organizationId, "Nested work must restore its parent tenant");
  assert.throws(() => runWithTenantContext(context(999), () => { throw new Error("test-owned failure"); }), /test-owned failure/);
  assert.equal(getActiveOrganizationId(), organizationId, "Failed nested work must not leak its tenant");
})));
assertNoTenant();
await assert.rejects(runWithTenantContext(context(42), async () => { await pause(1); throw new Error("async test-owned failure"); }), /async test-owned failure/);
assertNoTenant();
console.log("Org isolation context passed: fail-closed access, concurrent/nested async memberships and failure cleanup.");
