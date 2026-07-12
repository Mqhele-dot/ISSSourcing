import { readFileSync } from "node:fs";

const ui = readFileSync("client/src/pages/master-data.tsx", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(ui, "Master Data & Control Centre", "control-centre title");
assertIncludes(ui, "master-data-governance-dashboard", "governance dashboard");
assertIncludes(ui, "master-data-change-requests", "change request queue");
assertIncludes(ui, "master-data-standard-record-fields", "standard record model");
assertIncludes(ui, "master-data-where-used-response", "where-used response");
assertIncludes(ui, 'requestJson<MdmDomainRegistryEntry[]>("GET", "/api/mdm/domain-registry")', "domain registry query");
assertIncludes(ui, 'requestJson<MdmChangeRequest[]>("GET", "/api/mdm/change-requests")', "change request query");
assertIncludes(ui, "require approval", "approval banner language");
assertIncludes(ui, "Data quality workbench", "data quality panel");

console.log("MDM UI contracts passed.");
