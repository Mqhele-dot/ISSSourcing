import assert from "node:assert/strict";
import { navigationAccessCatalog, approvalWorkflowCatalog } from "../shared/authority-catalogs";
import { APP_NAV_SECTIONS, COMMAND_MENU_SECONDARY_GROUPS } from "../client/src/lib/routes/section-metadata";

const accessPaths = new Set(navigationAccessCatalog.flatMap((group) => group.items.map((item) => item.path)));
const presentedPaths = new Set([
  ...APP_NAV_SECTIONS.flatMap((group) => group.items.map((item) => item.path)),
  ...COMMAND_MENU_SECONDARY_GROUPS.flatMap((group) => group.items.map((item) => item.path)),
]);
const intentionallyDeveloperOnly = new Set(["/admin/sync-dashboard", "/admin/sync-test", "/admin/real-time-updates"]);
for (const path of presentedPaths) {
  if (intentionallyDeveloperOnly.has(path)) continue;
  assert.ok(accessPaths.has(path), `navigation presentation path is missing from the authoritative access catalog: ${path}`);
}
assert.equal(new Set(approvalWorkflowCatalog.map((item) => item.entityType)).size, approvalWorkflowCatalog.length);
assert.ok(approvalWorkflowCatalog.every((item) => item.label.trim() && typeof item.amountBased === "boolean"));
console.log(`Authority catalog coverage passed (${accessPaths.size} navigation paths, ${approvalWorkflowCatalog.length} workflows).`);
