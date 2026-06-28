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
assertIncludes(memoryStorage, "unitOfMeasureId: reqItem.unitOfMeasureId ?? null", "memory conversion carries line UOM");
assertIncludes(memoryStorage, "taxCodeId: reqItem.taxCodeId", "memory conversion carries line tax code");

assertIncludes(mdmControlCentre, "class MdmDependencyError", "MDM dependency error exists");
assertIncludes(mdmControlCentre, "domain === \"uom-conversions\"", "MDM checks UOM conversion deactivation dependencies");
assertIncludes(mdmControlCentre, "domain === \"gl-mappings\"", "MDM checks GL mapping deactivation dependencies");
assertIncludes(mdmControlCentre, "open requisition lines", "MDM dependency response names open requisition lines");
assertIncludes(mdmRoutes, "MDM_RECORD_IN_USE", "MDM route returns dependency-blocked errors");

assertIncludes(auditGenerator, "routeEvidenceText", "audit generator aggregates child route evidence");
assertIncludes(auditGenerator, "client/src/pages/requisitions/use-requisition-form.ts", "audit uses requisition hook evidence");
assertIncludes(auditGenerator, "client/src/pages/requisitions/requisition-lines-editor.tsx", "audit uses requisition line editor evidence");

console.log("\nRequisition line Master Data propagation proof passed.");
