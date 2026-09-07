import { readFileSync } from "node:fs";

const engine = readFileSync("server/modules/master-data/mdm-data-quality-engine.ts", "utf8");
const control = readFileSync("server/modules/master-data/mdm-control-centre.ts", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

for (const code of [
  "DUPLICATE_SUPPLIER_NAME",
  "DUPLICATE_SUPPLIER_TAX_NUMBER",
  "SUPPLIER_DEFAULTS_MISSING",
  "SUPPLIER_COMPLIANCE_EXPIRED",
  "CONTRACT_NEAR_EXPIRY",
  "ITEM_CATALOGUE_GAP",
  "INVALID_UOM_CONVERSION",
  "INACTIVE_SUPPLIER_ON_OPEN_PO",
  "INACTIVE_COST_CENTRE_ON_OPEN_REQUISITION",
  "TAX_CODE_EFFECTIVE_DATE_MISSING",
  "WAREHOUSE_COST_CENTRE_MISSING",
]) {
  assertIncludes(engine, code, "data-quality check catalog");
}

assertIncludes(control, "DUPLICATE_SUPPLIER_NAME", "runtime duplicate supplier scan");
assertIncludes(control, "SUPPLIER_COMPLIANCE_EXPIRED", "runtime expired compliance scan");
assertIncludes(control, "INVALID_UOM_CONVERSION", "runtime invalid UOM conversion scan");
assertIncludes(control, "affectedEntityType", "data-quality issue affected entity");
assertIncludes(control, "recommendedAction", "data-quality recommended action");
assertIncludes(control, "persistMdmDataQualityIssue", "concurrency-safe issue persistence");
assertIncludes(control, "isPostgresUniqueViolation", "concurrent scan retry guard");
if (control.includes("ON CONFLICT (organization_id, issue_code")) {
  throw new Error("Data-quality persistence must not rely on PostgreSQL functional-index conflict inference.");
}

console.log("MDM data-quality contracts passed.");
