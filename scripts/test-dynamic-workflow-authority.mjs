import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, inventoryIssues, rbac, mdm, runtime, ap, fuel, logistics] = await Promise.all([
  read("migrations/20260812120000_dynamic_workflow_authority.sql"),
  read("server/modules/inventory-issues/register-inventory-issue-routes.ts"),
  read("server/modules/rbac/register-rbac-routes.ts"),
  read("server/modules/master-data/register-master-data-routes.ts"),
  read("server/routes.ts"),
  read("server/modules/accounts-payable/register-ap-routes.ts"),
  read("server/modules/gas/register-gas-routes.ts"),
  read("client/src/pages/logistics.tsx"),
]);

assert.match(runtime, /\/api\/runtime-capabilities/);
assert.match(rbac, /\/api\/rbac\/roles\/catalog/);
assert.match(rbac, /\/api\/rbac\/users\/:id\/effective-access/);
assert.match(mdm, /\/api\/mdm\/defaults\/requisition-context/);
assert.match(mdm, /\/api\/mdm\/defaults\/po-context/);
assert.match(mdm, /default-drift/);
assert.match(mdm, /refresh-defaults/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_issues/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS fuel_products/);
assert.match(migration, /currencies_org_code_uidx/);
assert.match(inventoryIssues, /INSUFFICIENT_STOCK/);
assert.match(inventoryIssues, /FOR UPDATE/);
assert.match(inventoryIssues, /'ISSUE'/);
assert.match(inventoryIssues, /'inventory_issue'/);
assert.match(inventoryIssues, /delivery-note\.pdf/);
assert.match(logistics, /OutboundIssuePanel/);
assert.doesNotMatch(logistics, /Outbound dispatch excluded from v1/);
assert.match(ap, /voucher\.pdf/);
assert.match(ap, /remittance\.pdf/);
assert.match(fuel, /\/api\/fuel\/products/);

console.log("Dynamic workflow authority contracts passed.");
