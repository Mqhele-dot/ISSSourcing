import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const schema = read("shared/schema.ts");
const migration = read("migrations/20260715120000_procurement_manual_lines_and_policy_versions.sql");
const requisitionUi = read("client/src/pages/requisitions/requisition-lines-editor.tsx");
const reports = read("server/services/procurement-line-report-service.ts");
const exportRoutes = read("server/modules/exports/register-export-center-routes.ts");
const exportClient = read("client/src/lib/export-job-download.ts");
const policyRoutes = read("server/modules/master-data/register-master-data-routes.ts");
const policyUi = read("client/src/pages/approval-policies.tsx");
const diagnosticsRoutes = read("server/routes.ts");
const diagnosticsUi = read("client/src/pages/system-diagnostics-page.tsx");
const diagnosticsService = read("server/diagnostics/diagnostic-findings-service.ts");
const apService = read("server/modules/accounts-payable/service.ts");

const checks = [
  ["procurement line types exist", schema.includes('"CATALOG", "NON_STOCK", "SERVICE"')],
  ["requisition and PO item references can be nullable", /purchaseRequisitionItems[\s\S]*itemId: integer\("item_id"\),/.test(schema) && /purchaseOrderItems[\s\S]*itemId: integer\("item_id"\),/.test(schema)],
  ["manual lines require descriptions and reasons at database boundary", migration.includes("purchase_requisition_items_manual_line_check") && migration.includes("purchase_order_items_manual_line_check")],
  ["migration backfill does not use target-table references in a FROM join", !migration.includes("LEFT JOIN inventory_items ON inventory_items.id = pri.item_id") && !migration.includes("LEFT JOIN inventory_items ON inventory_items.id = poi.item_id")],
  ["requisition editor supports all three line types", requisitionUi.includes('"CATALOG", "NON_STOCK", "SERVICE"') && requisitionUi.includes("manualEntryReason")],
  ["manual fulfilment evidence is explicit", requisitionUi.includes("Service confirmation required") && requisitionUi.includes("Goods receipt required")],
  ["line report preserves documents without lines", reports.includes("LEFT JOIN purchase_order_items") && reports.includes("LEFT JOIN purchase_requisition_items") && reports.includes("DOCUMENT_HAS_NO_LINES")],
  ["line report repeats document and line columns", reports.includes('AS "documentNumber"') && reports.includes('AS "lineNumber"') && reports.includes('AS "lineTotal"')],
  ["fresh export tokens are issued through authenticated action", exportRoutes.includes('/api/export-jobs/:id/download-token') && exportClient.includes("downloadExportJob")],
  ["policy edits use optimistic concurrency", policyRoutes.includes("APPROVAL_POLICY_STALE") && policyRoutes.includes("expectedVersion") && policyUi.includes("approval-policy-edit-sheet")],
  ["policy overlap-only filter exists", policyRoutes.includes("overlapOnly") && policyUi.includes("Overlaps only")],
  ["diagnostics exposes summary, findings, and probes", diagnosticsRoutes.includes('/api/diagnostics/summary') && diagnosticsRoutes.includes('/api/diagnostics/findings') && diagnosticsRoutes.includes('/api/diagnostics/probes/run')],
  ["diagnostics tabs render route-specific workspaces", diagnosticsUi.includes("DiagnosticsWorkspacePanel") && diagnosticsUi.includes("diagnosticsWorkspaceFromUrl")],
  ["diagnostics observes export, fixture, notification, and policy failures", ["EXPORT_JOB_FAILURES", "TEST_FIXTURE_POLLUTION", "NOTIFICATION_BACKLOG", "APPROVAL_POLICY_OVERLAP"].every((code) => diagnosticsService.includes(code))],
  ["AP matching can link manual invoice lines to PO lines", schema.includes("purchaseOrderItemId") && apService.includes("invItem.purchaseOrderItemId")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`ok ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}
assert.equal(failed, 0, `${failed} report/manual-line/policy/diagnostics contract(s) failed`);
console.log(`Reports/manual-lines/policy/diagnostics checks passed: ${checks.length}/${checks.length}`);
