import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function assertContains(source: string, pattern: RegExp, label: string): void {
  assert.match(source, pattern, label);
}

function assertNotContains(source: string, pattern: RegExp, label: string): void {
  assert.doesNotMatch(source, pattern, label);
}

const routes = read("server/modules/master-data/register-master-data-routes.ts");
const service = read("server/modules/master-data/mdm-change-request-service.ts");
const registry = read("server/modules/master-data/mdm-domain-registry.ts");
const ui = read("client/src/pages/master-data.tsx");
const e2e = read("e2e/button-action-smoke.spec.ts");

console.log("MDM API authorization contract proof\n");

assertContains(routes, /function requireMdmPermission\(/, "MDM routes must expose requireMdmPermission helper");
assertContains(
  routes,
  /function requireMdmPermissionForChangeRequest\(/,
  "Change-request actions must resolve target domain before authorizing",
);
assertContains(routes, /MDM_PERMISSION_DENIED/, "Unauthorized MDM writes must return MDM_PERMISSION_DENIED");
assertContains(routes, /requiredPermissions/, "MDM permission denial must include requiredPermissions");
assertContains(routes, /domain,\s*\n\s*action,\s*\n\s*requiredPermissions/s, "MDM denial must include domain/action/details");
assertContains(routes, /Ask an administrator to grant the required domain permission/, "MDM denial must include repair hint");
assertContains(routes, /MDM_PERMISSION_ALIASES/, "Registry permissions must resolve through explicit RBAC aliases");
assertContains(routes, /MDM_REGISTRY_DOMAIN_ALIASES/, "Runtime MDM domains must map to registry domains");

const protectedRouteContracts = [
  {
    name: "POST /api/mdm/:domain",
    pattern: /app\.post\("\/api\/mdm\/:domain"[\s\S]*requireMdmPermission\(\(req\) => String\(req\.params\.domain \?\? ""\), "create"\)/,
  },
  {
    name: "PATCH /api/mdm/:domain/:id",
    pattern: /app\.patch\("\/api\/mdm\/:domain\/:id"[\s\S]*requireMdmPermission\(\(req\) => String\(req\.params\.domain \?\? ""\), "update"\)/,
  },
  {
    name: "POST /api/mdm/change-requests",
    pattern: /app\.post\(\s*"\/api\/mdm\/change-requests"[\s\S]*requireMdmPermission\(\(req\) => String\(req\.body\?\.domain \?\? ""\), "create"\)/,
  },
  {
    name: "approve change request",
    pattern: /\/api\/mdm\/change-requests\/:id\/approve[\s\S]*requireMdmPermissionForChangeRequest\(req, res, "approve"\)/,
  },
  {
    name: "reject change request",
    pattern: /\/api\/mdm\/change-requests\/:id\/reject[\s\S]*requireMdmPermissionForChangeRequest\(req, res, "approve"\)/,
  },
  {
    name: "apply change request",
    pattern: /\/api\/mdm\/change-requests\/:id\/apply[\s\S]*requireMdmPermissionForChangeRequest\(req, res, "apply"\)/,
  },
  {
    name: "comment change request",
    pattern: /\/api\/mdm\/change-requests\/:id\/comments[\s\S]*requireMdmPermissionForChangeRequest\(req, res, "comment"\)/,
  },
  {
    name: "data-quality scan",
    pattern: /\/api\/mdm\/data-quality\/scan[\s\S]*requireMdmPermission\("data-quality-issues", "scan"\)/,
  },
  {
    name: "import batches",
    pattern: /\/api\/mdm\/import-batches[\s\S]*requireMdmPermission\(\(req\) => String\(req\.body\?\.domain \?\? "import-batches"\), "import"\)/,
  },
];

for (const contract of protectedRouteContracts) {
  assertContains(routes, contract.pattern, `${contract.name} must be guarded by domain permission helper`);
}

assertNotContains(
  routes,
  /app\.post\("\/api\/mdm\/:domain", \.\.\.masterWrite/,
  "MDM domain create must not rely on broad manager/admin masterWrite",
);
assertNotContains(
  routes,
  /app\.patch\("\/api\/mdm\/:domain\/:id", \.\.\.masterWrite/,
  "MDM domain update must not rely on broad manager/admin masterWrite",
);

assertContains(registry, /requiredPermissions:\s*\["master-data:read", "supplier-bank:manage"\]/, "Critical supplier-bank permissions must come from registry");
assertContains(service, /MDM_MAKER_CANNOT_APPROVE/, "Maker cannot approve own change request through service/API path");
assertContains(service, /allowAdminOverride/, "Admin override must be explicit in change-request lifecycle");
assertContains(service, /MDM_CHANGE_ALREADY_APPLIED/, "Approved changes must be apply-once");

assertContains(ui, /mdm-change-request-detail/, "Master Data UI must show change-request detail");
assertContains(ui, /mdm-approve-change-request/, "Master Data UI must expose approve action");
assertContains(ui, /mdm-reject-change-request/, "Master Data UI must expose reject action");
assertContains(ui, /mdm-apply-change-request/, "Master Data UI must expose apply action");
assertContains(ui, /mdm-comment-box/, "Master Data UI must expose comments");
assertContains(ui, /mdm-before-after-diff/, "Master Data UI must show before/after diff");
assertContains(ui, /mdm-step-timeline/, "Master Data UI must show step timeline");
assertContains(ui, /mdm-failed-apply-reason/, "Master Data UI must show failed_to_apply reason");
assertContains(ui, /mdm-admin-override-warning/, "Master Data UI must clearly label admin override");
assertContains(ui, /unauthorizedReason/, "Master Data UI must show disabled reasons for unauthorized users");

assertContains(e2e, /AP_INVOICE_PO_LINK_REQUIRED/, "Button smoke must assert AP no-PO controlled validation code");
assertContains(
  e2e,
  /Link this invoice to a purchase order before matching or submitting for approval\./,
  "Button smoke must assert visible AP no-PO repair hint",
);

console.log(`MDM API authorization contracts passed (${protectedRouteContracts.length} guarded route contracts).`);
