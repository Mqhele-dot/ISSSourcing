import { readFileSync } from "node:fs";

const ui = readFileSync("client/src/pages/master-data.tsx", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(ui, 'title="Master Data Governance"', "master-data title");
assertIncludes(ui, "Governance controls", "control-centre entry point");
assertIncludes(ui, "master-data-governance-dashboard", "governance dashboard");
assertIncludes(ui, "master-data-change-requests", "change request queue");
assertIncludes(ui, "master-data-standard-record-fields", "standard record model");
assertIncludes(ui, "mdm-where-used-panel", "where-used response");
assertIncludes(ui, "usePermissions", "permission-aware UI hook");
assertIncludes(ui, 'hasPermission("master_data", "update")', "permission-based update gate");
assertIncludes(ui, "canSubmitChangeRequest", "steward/manager change request state");
assertIncludes(ui, "canApproveChangeRequest", "approver state");
assertIncludes(ui, "canAdminOverride", "admin override state");
assertIncludes(ui, "mdm-change-request-detail", "pending change request detail");
assertIncludes(ui, "mdm-change-request-approve-button", "approve button");
assertIncludes(ui, "mdm-change-request-reject-button", "reject button");
assertIncludes(ui, "mdm-apply-change-request", "apply button");
assertIncludes(ui, "mdm-comment-box", "comment box");
assertIncludes(ui, "mdm-before-after-diff", "before/after diff");
assertIncludes(ui, "mdm-step-timeline", "step timeline");
assertIncludes(ui, "mdm-failed-apply-reason", "failed_to_apply display");
assertIncludes(ui, "mdm-admin-override-warning", "admin override warning");
assertIncludes(ui, "unauthorizedReason", "disabled reasons for unauthorized users");
if (ui.includes('String(user?.role ?? "").toLowerCase() === "admin"')) {
  throw new Error("Master Data UI must not use hardcoded admin-only role checks");
}
assertIncludes(ui, 'requestJson<MdmDomainRegistryEntry[]>("GET", "/api/mdm/domain-registry")', "domain registry query");
assertIncludes(ui, 'requestJson<MdmChangeRequest[]>("GET", "/api/mdm/change-requests")', "change request query");
assertIncludes(ui, "require approval", "approval banner language");
assertIncludes(ui, "Data quality workbench", "data quality panel");

console.log("MDM UI contracts passed.");
