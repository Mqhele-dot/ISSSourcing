#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path) {
  assert.ok(existsSync(path), `${path} must exist`);
  return readFileSync(path, "utf8");
}

function assertContains(path, pattern, message) {
  assert.match(read(path), pattern, message);
}

function assertNotContains(path, pattern, message) {
  assert.doesNotMatch(read(path), pattern, message);
}

const CORE_FILES = [
  "client/src/pages/reorder.tsx",
  "client/src/components/user/role-manager.tsx",
  "client/src/pages/orders/po-commercial-terms-card.tsx",
  "client/src/pages/orders/purchase-order-detail-view.tsx",
  "client/src/pages/control-tower/gas-ops-card.tsx",
  "client/src/pages/subscription.tsx",
  "client/src/pages/accounts-payable/ap-payments-panel.tsx",
  "client/src/pages/invoices.tsx",
  "client/src/pages/master-data.tsx",
  "client/src/app/route-loading-boundary.tsx",
];

for (const file of CORE_FILES) {
  assertNotContains(file, /href=["']#["']/, `${file} must not contain inert href="#" actions`);
  assertNotContains(file, /javascript:void\(0\)/i, `${file} must not contain javascript:void(0) actions`);
  assertNotContains(file, /onClick=\{[^}]*console\.(log|debug|warn|error)/s, `${file} must not have console-only click handlers`);
  assertNotContains(file, /TODO:\s*(wire|implement|button|action|handler)/i, `${file} must not leave action TODOs`);
}

const actionContracts = [
  {
    name: "reorder convert mutation has structured missing-item UX and invalidates dependent lists",
    file: "client/src/pages/reorder.tsx",
    must: [/REORDER_ITEM_MISSING/, /Open item/, /invalidateQueries\(\{ queryKey: \["\/api\/purchase-requisitions"\]/],
  },
  {
    name: "reorder convert endpoint returns structured missing linked item error",
    file: "server/modules/reorder/register-reorder-routes.ts",
    must: [/REORDER_ITEM_MISSING/, /reorderRequestId/, /itemId/],
  },
  {
    name: "custom-role permission delete is idempotent and UI refetches permissions",
    file: "server/modules/rbac/register-rbac-routes.ts",
    must: [/alreadyRemoved:\s*true/, /removed:\s*false/],
  },
  {
    name: "custom-role permission remove mutation has feedback and invalidation",
    file: "client/src/components/user/role-manager.tsx",
    must: [/apiRequest\("DELETE",\s*`\/api\/custom-roles\/\$\{roleId\}\/permissions\/\$\{permissionId\}`\)/, /invalidateQueries\(\{ queryKey: \["\/api\/custom-roles", variables\.roleId, "permissions"\]/, /Failed to remove permission/],
  },
  {
    name: "contracts route has route marker and chunk recovery guidance",
    file: "client/src/lib/diagnostics/route-diagnostics.ts",
    must: [/\/procurement\/contracts[\s\S]*contracts-page/],
  },
  {
    name: "route loading boundary offers cache-busted reload",
    file: "client/src/app/route-loading-boundary.tsx",
    must: [/reloadWithCacheBust/, /Reload fresh assets/],
  },
  {
    name: "PO commercial save surfaces contract-currency business validation with actions",
    file: "client/src/pages/orders/po-commercial-terms-card.tsx",
    must: [/SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED/, /po-use-contract-currency/, /po-clear-contract/, /Contract currency controls this purchase order/],
  },
  {
    name: "PO commercial save mutation has error state, toast, and domain invalidation",
    file: "client/src/pages/orders/purchase-order-detail-view.tsx",
    must: [/setCommercialSaveError/, /invalidatePurchaseOrderDomain/, /onUseContractCurrency=\{useSelectedContractCurrency\}/, /onClearContract=\{clearSelectedContract\}/],
  },
  {
    name: "business-rule 409 is not pushed as unresolved global action failure",
    file: "client/src/lib/queryClient.ts",
    must: [
      /CONTROLLED_BUSINESS_RULE_CODES/,
      /SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED/,
      /REORDER_ITEM_MISSING/,
      /PLAN_LIMIT_REACHED/,
      /FEATURE_NOT_INCLUDED/,
      /SUBSCRIPTION_INACTIVE/,
      /TRIAL_EXPIRED/,
      /controlledBusinessRule[\s\S]*return;/,
    ],
  },
  {
    name: "gas summary timeout has bounded wait and unavailable state",
    file: "client/src/pages/control-tower/gas-ops-card.tsx",
    must: [/GAS_SUMMARY_TIMEOUT_MS/, /gas-ops-unavailable/, /Retry gas summary/],
  },
  {
    name: "subscription lifecycle buttons expose permission-disabled UX",
    file: "client/src/pages/subscription.tsx",
    must: [/subscription-permission-denied/, /subscription-change-plan-\$\{plan\.tier\}/, /subscription-billing-portal/],
  },
  {
    name: "AP payment batch action blocks invalid invoices with explicit feedback",
    file: "client/src/pages/accounts-payable/ap-payments-panel.tsx",
    must: [/Create AP payment batch/, /Exception or pending-match invoices stay blocked/, /ap-create-batch-button/],
  },
];

let checked = 0;
for (const contract of actionContracts) {
  const source = read(contract.file);
  for (const pattern of contract.must) {
    assert.match(source, pattern, `${contract.name}: expected ${pattern} in ${contract.file}`);
    checked += 1;
  }
}

assertContains(
  "docs/button-action-inventory.md",
  /Core actions inventoried \| 43/,
  "button action inventory must summarize inventoried actions",
);
assertContains(
  "docs/button-action-inventory.md",
  /Actions with browser smoke coverage \| 13/,
  "button action inventory must summarize expanded browser action coverage",
);

console.log(`button/action contract checks passed (${actionContracts.length} contracts, ${checked} assertions)`);
