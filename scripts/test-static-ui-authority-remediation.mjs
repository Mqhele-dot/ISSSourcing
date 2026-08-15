import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const settings = read("client/src/hooks/use-settings.ts");
const catalogs = read("shared/authority-catalogs.ts");
const rbac = read("server/modules/rbac/register-rbac-routes.ts");
const inventory = read("server/modules/operations/operations-core.ts");
const operationalRoutes = read("server/operations-routes.ts");
const home = read("client/src/pages/home.tsx");
const seed = read("server/seed.ts");

assert.doesNotMatch(settings, /defaultSettings/u);
assert.match(settings, /settings:\s*settings\s*\?\?\s*null/u);
assert.match(catalogs, /navigationAccessCatalog/u);
assert.match(catalogs, /approvalWorkflowCatalog/u);
assert.match(rbac, /\/api\/rbac\/navigation-catalog/u);
assert.match(rbac, /\/api\/approval-workflows\/catalog/u);
assert.match(inventory, /FROM warehouse_inventory/u);
assert.match(inventory, /warehouseId:\s*number/u);
assert.doesNotMatch(inventory, /options\.add\(["']Main Warehouse/u);
assert.match(operationalRoutes, /isDemoWalkthroughEnabled/u);
assert.match(operationalRoutes, /ensureAdmin/u);
assert.match(home, /demoWalkthroughEnabled/u);
assert.doesNotMatch(home, /full database reset|Reset DB & run walkthrough/u);
assert.match(seed, /createHash\("sha256"\)/u);
assert.match(seed, /writeFile\(path\.join\(outputDir/u);

console.log("Static UI authority remediation contracts passed.");
