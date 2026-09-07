import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [settingsRoute, reportingAuthority, mdmContext, v2Routes, approvalUi, approvalRoutes, requisitionLines] = await Promise.all([
  read("server/routes.ts"),
  read("server/lib/org-reporting-money.ts"),
  read("server/modules/master-data/mdm-control-centre.ts"),
  read("server/modules/v2/register-v2-routes.ts"),
  read("client/src/pages/approval-policies.tsx"),
  read("server/modules/rbac/register-rbac-routes.ts"),
  read("client/src/pages/requisitions/requisition-lines-editor.tsx"),
]);

assert.match(settingsRoute, /update\(organizations\)[\s\S]*defaultCurrencyCode:\s*validatedData\.currencyCode/);
assert.match(settingsRoute, /update\(appSettings\)[\s\S]*organizationId/);
assert.match(reportingAuthority, /appSettings\.currencyCode/);
assert.match(mdmContext, /getCanonicalReportingCurrencyCode\(organizationId\)/);
assert.match(v2Routes, /reportingCurrencyCode:\s*fx\.reportingCurrencyCode/);
assert.match(v2Routes, /reportingTotal:/);
assert.match(v2Routes, /missingFxCount/);
assert.match(approvalUi, /invalid governed-workflow catalog/);
assert.match(approvalUi, /Select governed workflow/);
assert.doesNotMatch(
  approvalRoutes.match(/app\.get\(\s*"\/api\/approval-workflows\/catalog"[\s\S]*?\);/)?.[0] ?? "",
  /ensurePermission\("users"/,
);
assert.match(requisitionLines, /lg:grid-cols-2 xl:grid-cols/);

console.log("Settings and procurement integration contracts passed.");
