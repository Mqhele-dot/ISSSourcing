import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function assertIncludes(text: string, needle: string, label: string): void {
  assert.ok(text.includes(needle), `${label}: expected ${needle}`);
  console.log(`  ok ${label}`);
}

function assertRegex(text: string, regex: RegExp, label: string): void {
  assert.match(text, regex, `${label}: expected ${regex}`);
  console.log(`  ok ${label}`);
}

console.log("Requisition line Master Data propagation proof\n");
console.log("Static guard: verifies required source paths exist. Runtime behavior is covered by test:requisition-line-mdm-flow.\n");

const schema = read("shared/schema.ts");
const initDb = read("server/init-db.ts");
const procurementRoutes = read("server/modules/procurement/register-procurement-routes.ts");
const databaseStorage = read("server/database-storage.ts");
const memoryStorage = read("server/storage.ts");
const requisitionHook = read("client/src/pages/requisitions/use-requisition-form.ts");
const requisitionPage = read("client/src/pages/requisition-form.tsx");
const lineEditor = read("client/src/pages/requisitions/requisition-lines-editor.tsx");
const mdmControlCentre = read("server/modules/master-data/mdm-control-centre.ts");
const mdmRoutes = read("server/modules/master-data/register-master-data-routes.ts");
const auditGenerator = read("scripts/audit-production-readiness.mjs");

for (const column of ["unitOfMeasureId", "taxCodeId", "costCentreId", "glAccountCode"]) {
  assertIncludes(schema, column, `purchase_requisition_items schema carries ${column}`);
  assertIncludes(initDb, column.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`), `database repair adds ${column}`);
  assertIncludes(requisitionHook, column, `requisition form payload preserves ${column}`);
  assertIncludes(procurementRoutes, column, `procurement API accepts ${column}`);
}
assertIncludes(schema, "costCentreId: integer(\"cost_centre_id\").references(() => mdmCostCentres.id)", "PO line schema persists cost centre");
assertIncludes(schema, "glAccountCode: text(\"gl_account_code\")", "PO line schema persists GL account");
assertIncludes(initDb, "purchase_order_items ADD COLUMN IF NOT EXISTS cost_centre_id", "database repair adds PO cost centre");
assertIncludes(initDb, "purchase_order_items ADD COLUMN IF NOT EXISTS gl_account_code", "database repair adds PO GL account");

assertIncludes(lineEditor, "Purchase UOM", "line editor exposes purchase UOM");
assertIncludes(lineEditor, "Tax code", "line editor exposes tax code");
assertIncludes(lineEditor, "Cost centre", "line editor exposes cost centre");
assertIncludes(lineEditor, "GL mapping missing", "line editor warns on missing GL mapping");
assertIncludes(requisitionPage, "unitsOfMeasure={f.unitsOfMeasure}", "requisition page passes UOM choices to line editor");
assertIncludes(requisitionPage, "taxCodes={f.taxCodes}", "requisition page passes tax choices to line editor");
assertIncludes(requisitionPage, "costCentres={f.costCentres}", "requisition page passes cost-centre choices to line editor");

assertIncludes(procurementRoutes, "validateRequisitionLineMasterDataPolicy", "API enforces requisition line MDM policy");
assertIncludes(procurementRoutes, "REQUISITION_LINE_UOM_REQUIRED", "API blocks missing UOM when policy requires it");
assertIncludes(procurementRoutes, "REQUISITION_LINE_TAX_CODE_REQUIRED", "API blocks missing tax code when policy requires it");
assertIncludes(procurementRoutes, "REQUISITION_LINE_MDM_VALIDATION_FAILED", "API returns structured line MDM validation error");

assertRegex(
  databaseStorage,
  /unitOfMeasureId:\s*item\.unitOfMeasureId\s*\?\?\s*invRow\?\.unitOfMeasureId/,
  "database conversion prefers requisition line UOM before inventory fallback",
);
assertRegex(
  databaseStorage,
  /taxCodeId:\s*item\.taxCodeId\s*\?\?/,
  "database conversion carries requisition line tax code",
);
assertRegex(
  databaseStorage,
  /costCentreId:\s*item\.costCentreId\s*\?\?\s*null/,
  "database conversion carries requisition line cost centre",
);
assertRegex(
  databaseStorage,
  /glAccountCode:\s*item\.glAccountCode\s*\?\?\s*null/,
  "database conversion carries requisition line GL account",
);
assertIncludes(memoryStorage, "unitOfMeasureId: reqItem.unitOfMeasureId ?? null", "memory conversion carries line UOM");
assertIncludes(memoryStorage, "taxCodeId: reqItem.taxCodeId", "memory conversion carries line tax code");
assertIncludes(memoryStorage, "costCentreId: reqItem.costCentreId ?? null", "memory conversion carries line cost centre");
assertIncludes(memoryStorage, "glAccountCode: reqItem.glAccountCode ?? null", "memory conversion carries line GL account");

assertIncludes(mdmControlCentre, "class MdmDependencyError", "MDM dependency error exists");
assertIncludes(mdmControlCentre, "domain === \"uom-conversions\"", "MDM checks UOM conversion deactivation dependencies");
assertIncludes(mdmControlCentre, "domain === \"gl-mappings\"", "MDM checks GL mapping deactivation dependencies");
assertIncludes(mdmControlCentre, "open requisition lines", "MDM dependency response names open requisition lines");
assertIncludes(mdmRoutes, "MDM_RECORD_IN_USE", "MDM route returns dependency-blocked errors");

assertIncludes(auditGenerator, "routeEvidenceText", "audit generator aggregates child route evidence");
assertIncludes(auditGenerator, "client/src/pages/requisitions/use-requisition-form.ts", "audit uses requisition hook evidence");
assertIncludes(auditGenerator, "client/src/pages/requisitions/requisition-lines-editor.tsx", "audit uses requisition line editor evidence");

console.log("\nRequisition line Master Data propagation proof passed.");
