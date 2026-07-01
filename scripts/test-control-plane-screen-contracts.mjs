import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} is missing required source evidence: ${needle}`);
}

const settings = read("client/src/pages/settings.tsx");
const settingsHook = read("client/src/hooks/use-settings.ts");
assertIncludes(settings, "settings-control-plane", "/admin/settings");
assertIncludes(settings, "settings-control-plane-error", "/admin/settings");
assertIncludes(settings, "settings-control-denied", "/admin/settings");
assertIncludes(settings, "settings-control-save", "/admin/settings");
assertIncludes(settings, "useSettings()", "/admin/settings");
assertIncludes(settingsHook, 'queryKey: ["/api/settings"]', "/admin/settings");
assertIncludes(settingsHook, 'apiRequest("PUT", "/api/settings"', "/admin/settings");

const roles = read("client/src/components/user/role-manager.tsx");
assertIncludes(roles, "role-manager-card", "/admin/user-roles");
assertIncludes(roles, "role-manager-users-card", "/admin/user-roles");
assertIncludes(roles, "role-manager-assign-custom-access", "/admin/user-roles");
assertIncludes(roles, 'apiRequest("PUT", `/api/users/${userId}`', "/admin/user-roles");
assertIncludes(roles, 'queryKey: ["/api/users", "role-manager"]', "/admin/user-roles");

const approvalPolicies = read("client/src/pages/approval-policies.tsx");
assertIncludes(approvalPolicies, "approval-policies-page", "/finance/approval-policies");
assertIncludes(approvalPolicies, "approval-policies-denied", "/finance/approval-policies");
assertIncludes(approvalPolicies, "approval-policy-save", "/finance/approval-policies");
assertIncludes(approvalPolicies, 'requestJson<unknown>("GET", "/api/approval-policies")', "/finance/approval-policies");
assertIncludes(approvalPolicies, 'requestJson<ApprovalPolicy>("PATCH"', "/finance/approval-policies");

const masterData = read("client/src/pages/master-data.tsx");
assertIncludes(masterData, "Master Data & Control Centre", "/admin/master-data");
assertIncludes(masterData, "master-data-page", "/admin/master-data");
assertIncludes(masterData, "master-data-permission-denied", "/admin/master-data");
assertIncludes(masterData, "master-data-dependency-response", "/admin/master-data");
assertIncludes(masterData, "MASTER_DATA_PERMISSION_DENIED", "/admin/master-data");
assertIncludes(masterData, 'requestJson<MdmControlCentreHealth>("GET", "/api/mdm/control-centre/health")', "/admin/master-data");
assertIncludes(masterData, 'requestJson<MdmQualityIssue[]>("GET", "/api/mdm/data-quality/issues")', "/admin/master-data");
assertIncludes(masterData, 'requestJson("POST", "/api/mdm/data-quality/scan"', "/admin/master-data");
assertIncludes(masterData, "invalidateMasterDataDomainForEndpoint", "/admin/master-data");

const apWorkspace = read("client/src/pages/accounts-payable/accounts-payable-workspace.tsx");
assertIncludes(apWorkspace, "accounts-payable-page", "/finance/accounts-payable");
assertIncludes(apWorkspace, "partialWorkspaceDataError", "/finance/accounts-payable");
assertIncludes(apWorkspace, "canRunInvoiceApprovalActions", "/finance/accounts-payable");
assertIncludes(apWorkspace, "actorRole={user?.role}", "/finance/accounts-payable");

const apPayments = read("client/src/pages/accounts-payable/ap-payments-panel.tsx");
assertIncludes(apPayments, "ap-payment-role-denied", "/finance/accounts-payable/payments");
assertIncludes(apPayments, "ap-release-permission-blocked", "/finance/accounts-payable/payments");
assertIncludes(apPayments, "ap-self-approval-blocked", "/finance/accounts-payable/payments");
assertIncludes(apPayments, "Exception or pending-match invoices stay blocked", "/finance/accounts-payable/payments");
assertIncludes(apPayments, "canManagePaymentBatches", "/finance/accounts-payable/payments");

const controlPlaneE2e = read("e2e/control-plane-admin-workflow.spec.ts");
assertIncludes(controlPlaneE2e, "/admin/settings", "control-plane E2E");
assertIncludes(controlPlaneE2e, "/admin/user-roles", "control-plane E2E");
assertIncludes(controlPlaneE2e, "/finance/approval-policies", "control-plane E2E");

console.log("Control-plane and AP screen contracts passed.");
