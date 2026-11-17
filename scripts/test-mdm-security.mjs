import { readFileSync } from "node:fs";

const routes = readFileSync("server/modules/master-data/register-master-data-routes.ts", "utf8");
const control = readFileSync("server/modules/master-data/mdm-control-centre.ts", "utf8");
const whereUsed = readFileSync("server/modules/master-data/mdm-where-used-service.ts", "utf8");
const changeRequests = readFileSync("server/modules/master-data/mdm-change-request-service.ts", "utf8");
const permissionCatalog = readFileSync("server/rbac/permission-catalog.ts", "utf8");
const runtimeSecurity = readFileSync("scripts/test-mdm-runtime-security.ts", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(routes, "auth.ensureAuthenticated", "MDM read authentication");
assertIncludes(routes, 'auth.ensureRole(["manager", "admin"])', "MDM write deny-by-default role gate");
assertIncludes(routes, "getActiveOrganizationId()", "tenant-scoped route org resolution");
assertIncludes(control, "WHERE organization_id = $1", "tenant-scoped MDM queries");
assertIncludes(whereUsed, "organization_id = $1", "tenant-scoped where-used queries");
assertIncludes(changeRequests, "organization_id", "tenant-scoped change requests");
assertIncludes(control, "MDM_STALE_VERSION", "stale version structured error");
assertIncludes(routes, "MDM_STALE_VERSION", "stale version API error");
assertIncludes(changeRequests, "MDM_MAKER_CANNOT_APPROVE", "maker-checker security block");
assertIncludes(changeRequests, "MDM_CHANGE_ALREADY_APPLIED", "apply-once security block");
assertIncludes(routes, '"/api/mdm/change-requests/:id/reject"', "reject route");
assertIncludes(routes, '"/api/mdm/change-requests/:id/apply"', "apply route");
assertIncludes(routes, '"/api/mdm/change-requests/:id/comments"', "comment route");
assertIncludes(control, "writeMdmAudit", "MDM mutation audit");
assertIncludes(permissionCatalog, '"master_data"', "server-backed master_data permission resource");
assertIncludes(runtimeSecurity, "Tenant A must not read Tenant B MDM record", "runtime tenant isolation proof");
assertIncludes(runtimeSecurity, "MDM_STALE_VERSION", "runtime stale version proof");
assertIncludes(runtimeSecurity, "MDM_CHANGE_ALREADY_APPLIED", "runtime apply-once proof");

console.log("MDM security contracts passed.");
