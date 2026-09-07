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
assertIncludes(mobileReceive, "fetchPurchaseOrdersPageEnvelope", "/m/receive");
assertIncludes(mobileReceive, 'statuses: ["approved", "sent", "partially_received"]', "/m/receive");
assertIncludes(mobileReceive, "usePurchaseOrderOperationalDetailQuery", "/m/receive/:po");
assertIncludes(mobileReceive, "useReceivePurchaseOrderMutation", "/m/receive/:po");
assertIncludes(mobileReceive, "validateReceiveLines", "/m/receive/:po");
assertIncludes(mobileReceive, "warehouse_staff", "/m/receive/:po");
assertIncludes(mobileReceive, "data-testid=\"mobile-receive-post-button\"", "/m/receive/:po");
assertNotIncludes(mobileReceive, "seed operational demo data", "/m/receive");
assertNotIncludes(mobileReceive, "fallback={fallback}", "/m/receive");

const mobileTasks = read("client/src/pages/mobile-hub-tasks.tsx");
assertIncludes(mobileTasks, "requestJson<MobileCountsResponse>(\"GET\", \"/api/mobile/counts/assigned\")", "/m/tasks");
assertIncludes(mobileTasks, "fetchInventoryPage({ low: true", "/m/tasks");
assertIncludes(mobileTasks, "fetchPurchaseOrdersPageEnvelope", "/m/tasks");
assertIncludes(mobileTasks, 'statuses: ["approved", "sent", "partially_received"]', "/m/tasks");
assertIncludes(mobileTasks, "requestJson<ApprovalQueueResponse>(\"GET\", \"/api/ap/approval-queue\")", "/m/tasks");
assertIncludes(mobileTasks, "data-testid={`mobile-task-card-${key}`}", "/m/tasks");
assertIncludes(mobileTasks, "mobile-tasks-partial-error", "/m/tasks");

const mobileApprovals = read("client/src/pages/mobile-approvals.tsx");
assertIncludes(mobileApprovals, "requestJson<unknown>(\"GET\", \"/api/purchase-requisitions\")", "/m/approvals");
assertIncludes(mobileApprovals, "fetchPurchaseOrdersEnvelope({ status: \"open\" })", "/m/approvals");
assertIncludes(mobileApprovals, "requestJson<ApprovalQueueResponse>(\"GET\", \"/api/ap/approval-queue\")", "/m/approvals");
assertIncludes(mobileApprovals, "requestJson<unknown>(\"GET\", \"/api/approval-policies\")", "/m/approvals");
assertIncludes(mobileApprovals, "data-testid={`mobile-approval-card-${key}`}", "/m/approvals");
assertIncludes(mobileApprovals, "mobile-approvals-partial-error", "/m/approvals");

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

const procurementApE2e = read("e2e/procurement-to-ap-ui-workflow.spec.ts");
assertIncludes(procurementApE2e, "/m/receive/", "receive -> inventory -> AP E2E");
assertIncludes(procurementApE2e, "inventory-row-", "receive -> inventory -> AP E2E");
assertIncludes(procurementApE2e, "PAYMENT BLOCKED", "receive -> inventory -> AP E2E");
assertIncludes(procurementApE2e, "PAYMENT READY", "receive -> inventory -> AP E2E");

const permissionsE2e = read("e2e/role-permission-core-workflow.spec.ts");
assertIncludes(permissionsE2e, "PO_RECEIVE_FORBIDDEN", "permission E2E");
assertIncludes(permissionsE2e, "/ap/payment-batches/1/release", "permission E2E");
assertIncludes(permissionsE2e, "/admin/user-roles", "permission E2E");

const audit = read("scripts/audit-production-readiness.mjs");
assertIncludes(audit, "Workflow-backed", "production audit");
assertIncludes(audit, "E2E-proven", "production audit");
assertIncludes(audit, "core route lacks Playwright/browser workflow evidence", "production audit");

console.log("Core screen workflow contracts passed.");
