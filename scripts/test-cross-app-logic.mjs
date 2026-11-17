import assert from "node:assert/strict";
import { buildAudit } from "./logic-audit-lib.mjs";

const audit = buildAudit();
assert.equal(
  audit.releaseStatus,
  audit.summary.critical > 0 || audit.summary.high > 0 ? "BLOCKED" : "PASS",
  "release status must track unresolved critical/high findings",
);
assert(audit.uiRoutes.length > 20, "visible route inventory is unexpectedly small");
assert(audit.summary.serverRoutes > 300, "server route inventory is unexpectedly small");
assert(audit.summary.schemaTables > 60, "database table inventory is unexpectedly small");
for (const capability of ["supplier.update", "supplier_bank.change", "requisition.approve", "requisition.convert_to_po", "purchase_order.dispatch", "goods_receipt.receive", "invoice.match", "payment.release", "report.export", "settings.update"]) {
  assert(audit.capabilityMap.some((entry) => entry.capability === capability), `missing normalized capability ${capability}`);
}
const settingsGet = audit.capabilityMap.flatMap((entry) => entry.entryPoints).find((route) => route.method === "GET" && route.route === "/api/settings");
assert(settingsGet, "settings GET route was not discovered");
assert(settingsGet.middleware.some((middleware) => middleware.includes("ensureAuthenticated")), "settings GET must require authentication");
assert(audit.findings.some((finding) => finding.id === "LOGIC-003"), "state-changing GET contradiction is not documented");
const reportRoutes = audit.capabilityMap.flatMap((entry) => entry.entryPoints).filter((route) => ["/api/reports/preview", "/api/export-center/custom-export"].includes(route.route));
assert.equal(reportRoutes.length, 2);
assert(reportRoutes.every((route) => route.file.includes("register-export-center-routes")), "preview/export no longer share the canonical module");
for (const endpoint of ["/api/user/profile", "/api/user/security-preferences", "/api/change-password"]) {
  assert.equal(audit.unmatchedClientConnections.some((connection) => connection.endpoint === endpoint), false, `${endpoint} must match an authenticated backend route`);
}
assert.equal(audit.unmatchedClientConnections.some((connection) => connection.endpoint === "/api/admin/security-policy"), false, "removed security-policy placeholder must not remain connected");
assert.equal(audit.unmatchedClientConnections.some((connection) => connection.endpoint === "/api/settings/billing"), false, "removed billing placeholder must not remain connected");
console.log("Cross-app logic contracts passed: capability coverage, documented mutations, shared report/export path, and visible disconnected controls.");
