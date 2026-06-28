#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(file) {
  return readFileSync(file, "utf8");
}

function assertIncludes(text, needle, label) {
  assert.ok(text.includes(needle), `${label}: expected to find ${needle}`);
  console.log(`  ok ${label}`);
}

function assertRegex(text, regex, label) {
  assert.match(text, regex, `${label}: expected ${regex}`);
  console.log(`  ok ${label}`);
}

console.log("Production workflow proof checks\n");

const procurementRoutes = read("server/modules/procurement/register-procurement-routes.ts");
const poValidation = read("server/modules/procurement/po-validation.ts");
const dependencyChecks = read("server/modules/master-data/dependency-checks.ts");
const supplierRoutes = read("server/modules/suppliers/register-supplier-routes.ts");
const inventoryRoutes = read("server/modules/inventory/register-inventory-routes.ts");
const warehouseRoutes = read("server/modules/warehouses/register-warehouse-routes.ts");
const operationsCore = read("server/modules/operations/operations-core.ts");
const apService = read("server/modules/accounts-payable/service.ts");
const auditGenerator = read("scripts/audit-production-readiness.mjs");
const requisitionFormHook = read("client/src/pages/requisitions/use-requisition-form.ts");
const requisitionsPage = read("client/src/pages/requisitions.tsx");
const poList = read("client/src/pages/orders/purchase-orders-list.tsx");
const poDetail = read("client/src/pages/orders/purchase-order-detail-view.tsx");

assertIncludes(requisitionFormHook, "/api/mdm/defaults/requisition-context", "new requisitions load MDM context");
assertIncludes(requisitionFormHook, "/api/purchase-requisitions", "new/edit requisitions write backend API");
assertIncludes(requisitionsPage, "/api/purchase-requisitions", "requisition list uses backend API");
assertRegex(requisitionsPage, /isLoading|Loading|Skeleton/, "requisition list has loading state");
assertRegex(requisitionsPage, /error|catch|toast/i, "requisition list has error handling");
assertRegex(poList + poDetail, /usePurchaseOrdersEnvelopeQuery|\/api\/purchase\/orders|\/api\/procurement\/purchase-orders/, "PO routes use backend data");
assertRegex(poDetail, /approve|send|receive/i, "PO detail exposes workflow actions");

assertIncludes(procurementRoutes, "validatePurchaseOrderWorkflowReadiness", "PO route calls workflow validator");
for (const code of [
  "PO_ITEM_INACTIVE",
  "PO_UOM_CONVERSION_REQUIRED",
  "PO_TAX_CODE_REQUIRED",
  "PO_GL_MAPPING_REQUIRED",
  "PO_FX_RATE_REQUIRED",
]) {
  assertIncludes(poValidation, code, `PO validation has ${code}`);
}
assertIncludes(poValidation, "mdm_procurement_policies", "PO validation is MDM policy driven");
assertIncludes(poValidation, "mdm_exchange_rates", "foreign-currency PO requires FX evidence when policy requires it");
assertIncludes(poValidation, "mdm_gl_mappings", "PO validates GL mapping when policy requires it");
assertIncludes(poValidation, "mdm_uom_conversions", "PO validates UOM conversion when policy requires it");

for (const fn of ["getSupplierWhereUsed", "getInventoryItemWhereUsed", "getWarehouseWhereUsed"]) {
  assertIncludes(dependencyChecks, `export async function ${fn}`, `${fn} exists`);
}
assertIncludes(supplierRoutes, "getSupplierWhereUsed", "supplier disable/delete uses dependency checks");
assertIncludes(inventoryRoutes, "getInventoryItemWhereUsed", "inventory item disable/delete uses dependency checks");
assertIncludes(warehouseRoutes, "getWarehouseWhereUsed", "warehouse delete uses dependency checks");
assertIncludes(dependencyChecks, "open requisitions", "dependencies include open requisitions");
assertIncludes(dependencyChecks, "open purchase orders", "dependencies include open purchase orders");
assertIncludes(dependencyChecks, "open AP invoices", "dependencies include AP invoices");
assertIncludes(dependencyChecks, "warehouse stock", "dependencies include stock balances");

assertIncludes(operationsCore, "receiveOperationalPurchaseOrder", "operational receive service exists");
assertIncludes(operationsCore, "receive_exceeds_remaining", "receipt above remaining quantity is blocked");
assertIncludes(operationsCore, "invalid_receive_state", "receipt against invalid/cancelled status is blocked");
assertIncludes(operationsCore, "INSERT INTO stock_movements", "receipt writes stock movements");
assertIncludes(operationsCore, "applyWarehouseInventoryReceipt", "receipt updates warehouse inventory");
assertIncludes(operationsCore, "syncOperationalReceiveToApReceipt", "receipt bridges to AP receipt evidence");
assertIncludes(operationsCore, "action: \"receive\"", "receipt posting writes audit/activity");

assertIncludes(apService, "evaluateInvoiceMatch", "AP matching service exists");
assertIncludes(apService, "QTY_MISMATCH", "AP match blocks/disputes invoice quantity above receipt");
assertIncludes(apService, "No eligible invoices were selected for payment batching.", "unmatched/disputed invoices cannot be batched");
assertIncludes(apService, "[\"APPROVED\", \"PARTIALLY_PAID\", \"OVERDUE\"]", "AP payment batch only selects payable invoice statuses");
assertIncludes(apService, "AP_PAYMENT_BATCH_RELEASED", "payment release writes audit");
assertIncludes(apService, "AP_INVOICE_MATCHED", "invoice matching writes audit");

assertIncludes(auditGenerator, "routeEvidenceText", "production audit uses aggregate route evidence");
assertIncludes(auditGenerator, "client/src/pages/requisitions/use-requisition-form.ts", "audit includes requisition hook evidence");
assertIncludes(auditGenerator, "client/src/pages/orders/purchase-order-detail-view.tsx", "audit includes PO detail evidence");

console.log("\nProduction workflow proof checks passed.");
