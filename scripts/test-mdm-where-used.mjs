import { readFileSync } from "node:fs";

const service = readFileSync("server/modules/master-data/mdm-where-used-service.ts", "utf8");
const routes = readFileSync("server/modules/master-data/register-master-data-routes.ts", "utf8");
const ui = readFileSync("client/src/pages/master-data.tsx", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(routes, '"/api/mdm/:domain/:id/where-used"', "where-used API route");
assertIncludes(service, "MDM_DEPENDENCY_BLOCKED", "structured dependency block code");
for (const workflow of ["open requisitions", "open purchase orders", "open AP invoices", "warehouse stock"]) {
  assertIncludes(service, workflow, "where-used dependency query");
}
assertIncludes(ui, "master-data-where-used-response", "where-used UI response");
assertIncludes(ui, "Where-used", "where-used row action");

console.log("MDM where-used contracts passed.");
