import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const hook = read("client/src/pages/requisitions/use-requisition-form.ts");
const header = read("client/src/pages/requisitions/requisition-header-fields.tsx");
const lines = read("client/src/pages/requisitions/requisition-lines-editor.tsx");
const mdm = read("server/modules/master-data/mdm-control-centre.ts");
const routes = read("server/modules/procurement/register-procurement-routes.ts");
const workflow = read("server/services/approval-workflow-service.ts");
const authorityCatalog = read("shared/authority-catalogs.ts");
const policies = read("client/src/pages/approval-policies.tsx");
const starter = read("server/modules/setup/register-setup-routes.ts");
const migration = read("migrations/20260815111500_governed_approval_workflows.sql");
const apPolicy = read("server/modules/accounts-payable/ap-approval-policy.ts");
const apService = read("server/modules/accounts-payable/service.ts");

for (const legacy of ["/api/inventory", "/api/departments", "/api/currencies", "/api/tax-codes", "/api/contracts", "/api/payment-terms", "/api/incoterms"]) {
  assert.ok(!hook.includes(`\"GET\", \"${legacy}\"`), `requisition form must not fetch legacy ${legacy}`);
}
assert.match(hook, /defaultRequiredDate/);
assert.match(hook, /rules\.requiresCostCentre/);
assert.match(hook, /rules\.requiresTaxCode/);
assert.match(hook, /rules\.requiresUom/);
assert.match(header, /Department\{requiresDepartment \? " \*"/);
assert.match(lines, /Purchase UOM \*/);
assert.match(mdm, /COALESCE\(ii\.unit_of_measure_id, default_uom\.id\)/);
assert.match(routes, /config\.requiresTaxCode/);
assert.match(routes, /config\.requiresCostCentre/);
assert.match(routes, /REQUISITION_LINE_COST_CENTRE_INVALID/);
assert.match(routes, /eq\(departments\.organizationId, getActiveOrganizationId\(\)\)/);
assert.match(routes, /eq\(currencies\.organizationId, getActiveOrganizationId\(\)\)/);
assert.match(routes, /authorizeApprovalStep/);
assert.match(workflow, /INDEPENDENT_APPROVER_REQUIRED/);
assert.match(workflow, /requiredLevels/);
assert.match(apPolicy, /authorizeApprovalStep/);
assert.match(apPolicy, /entityId: number/);
assert.match(apService, /if \(!workflowStep\.isFinal\)/);
assert.match(apService, /level: workflowStep\.level/);

for (const entity of ["requisition", "purchase_order", "sourcing_award", "supplier_onboarding", "contract", "inventory_transfer", "inventory_adjustment", "invoice", "payment_batch", "master_data_change"]) {
  assert.ok(authorityCatalog.includes(`entityType: \"${entity}\"`), `approval workflow catalog must govern ${entity}`);
  assert.ok(starter.includes(`\"${entity}\"`), `new organizations must receive starter approval coverage for ${entity}`);
  assert.ok(migration.includes(`'${entity}'`), `existing organizations must receive guarded approval coverage for ${entity}`);
}

assert.match(workflow, /@shared\/authority-catalogs/);
assert.match(policies, /\/api\/approval-workflows\/catalog/);

console.log("Requisition and governed approval workflow upgrade contracts passed.");
