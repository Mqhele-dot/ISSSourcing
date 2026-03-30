/**
 * Lightweight org isolation sanity checks (no DB required) — AsyncLocalStorage only.
 * For HTTP cross-tenant checks against a running server, use `scripts/test-org-api-isolation.ts` (`npm run test:org-api`).
 * Run: npx tsx scripts/test-org-isolation.ts
 */
import {
  organizationAsyncLocalStorage,
  getActiveOrganizationId,
  DEFAULT_ORGANIZATION_ID,
} from "../server/organization-context";

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed = true;
  }
}

assert(getActiveOrganizationId() === DEFAULT_ORGANIZATION_ID, "default org id outside ALS");

organizationAsyncLocalStorage.run({ organizationId: 42 }, () => {
  assert(getActiveOrganizationId() === 42, "org id inside ALS");
});

assert(getActiveOrganizationId() === DEFAULT_ORGANIZATION_ID, "org id restored after ALS");

if (failed) {
  process.exit(1);
}
console.log("org isolation context OK");
