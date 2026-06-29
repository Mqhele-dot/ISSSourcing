import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} is missing required source evidence: ${needle}`);
}

function assertNotIncludes(text, needle, label) {
  assert(!text.includes(needle), `${label} still contains unsafe fallback marker: ${needle}`);
}

const mobileReceive = read("client/src/pages/mobile-receive.tsx");
assertIncludes(mobileReceive, "fetchPurchaseOrdersEnvelope", "/m/receive");
assertIncludes(mobileReceive, "usePurchaseOrderOperationalDetailQuery", "/m/receive/:po");
assertIncludes(mobileReceive, "useReceivePurchaseOrderMutation", "/m/receive/:po");
assertIncludes(mobileReceive, "validateReceiveLines", "/m/receive/:po");
assertIncludes(mobileReceive, "warehouse_staff", "/m/receive/:po");
assertIncludes(mobileReceive, "data-testid=\"mobile-receive-post-button\"", "/m/receive/:po");
assertNotIncludes(mobileReceive, "seed operational demo data", "/m/receive");
assertNotIncludes(mobileReceive, "fallback={fallback}", "/m/receive");

const inventory = read("client/src/pages/inventory.tsx");
assertIncludes(inventory, "fetchInventory", "/inventory");
assertIncludes(inventory, "requestJson<Array<{ id: number; name: string }>>(\"GET\", \"/api/warehouses\")", "/inventory");
assertIncludes(inventory, "warehouseQuantity", "/inventory");
assertIncludes(inventory, "lastMovementAt", "/inventory");
assertIncludes(inventory, "inventory-create-item-dialog", "/inventory");
assertNotIncludes(inventory, "seed demo stock", "/inventory");

const invoices = read("client/src/pages/invoices.tsx");
assertIncludes(invoices, "latestMatchResult", "/finance/invoices");
assertIncludes(invoices, "PAYMENT BLOCKED", "/finance/invoices");
assertIncludes(invoices, "PAYMENT READY", "/finance/invoices");
assertIncludes(invoices, "Receipt evidence", "/finance/invoices");
assertIncludes(invoices, "runMatch.mutate", "/finance/invoices");

const apQueries = read("client/src/pages/accounts-payable/use-ap-workspace-queries.ts");
assertIncludes(apQueries, "latestMatchResult", "/finance/accounts-payable");
assertIncludes(apQueries, "matchStatus !== \"MATCHED\"", "/finance/accounts-payable");

const apPayments = read("client/src/pages/accounts-payable/ap-payments-panel.tsx");
assertIncludes(apPayments, "PO/GRN match", "/finance/accounts-payable/payments");
assertIncludes(apPayments, "PENDING MATCH", "/finance/accounts-payable/payments");
assertIncludes(apPayments, "pending-match invoices stay blocked", "/finance/accounts-payable/payments");

console.log("Core screen workflow contracts passed.");
