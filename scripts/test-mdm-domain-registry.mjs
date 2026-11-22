import { readFileSync } from "node:fs";

const text = readFileSync("server/modules/master-data/mdm-domain-registry.ts", "utf8");
const docs = readFileSync("docs/mdm-domain-registry.md", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const domains = [
  "suppliers",
  "supplier-contacts",
  "supplier-banks",
  "supplier-compliance-documents",
  "contracts",
  "items",
  "item-categories",
  "units-of-measure",
  "uom-conversions",
  "warehouses",
  "bins-locations",
  "departments",
  "cost-centres",
  "gl-accounts",
  "tax-codes",
  "currencies",
  "fx-rates",
  "payment-terms",
  "incoterms",
  "carriers",
  "approval-rules",
  "document-sequences",
  "legal-entities",
];

for (const domain of domains) {
  assert(text.includes(`key: "${domain}"`), `MDM registry missing ${domain}`);
}

for (const field of [
  "ownerRole",
  "stewardRole",
  "riskLevel",
  "requiredPermissions",
  "requiredFields",
  "uniqueKeys",
  "highRiskFields",
  "approvalRequiredFields",
  "whereUsedChecks",
  "importExportSupport",
  "auditRequired",
]) {
  assert(text.includes(field), `MDM registry missing field ${field}`);
}

assert(text.includes("MDM_STANDARD_RECORD_FIELDS"), "standard record field model missing");
assert(docs.includes("supplier-banks"), "MDM registry documentation missing supplier-banks");
assert(docs.includes("maker-checker"), "MDM registry documentation missing maker-checker controls");

console.log("MDM domain registry contracts passed.");
