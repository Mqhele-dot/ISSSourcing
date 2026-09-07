#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const operationsCore = readFileSync(
  new URL("../server/modules/operations/operations-core.ts", import.meta.url),
  "utf8",
);

assert.match(
  operationsCore,
  /export async function getOperationalControlTowerOverview\(\) \{\s*const orgId = getActiveOrganizationId\(\);/,
  "control tower overview should scope KPI queries to the active organization",
);
assert.match(
  operationsCore,
  /FROM shipments s[\s\S]*INNER JOIN purchase_orders po[\s\S]*po\.organization_id = \$1[\s\S]*lower\(s\.status\) <> 'delivered'/,
  "late shipment KPI should scope shipments through organization purchase orders",
);
assert.match(
  operationsCore,
  /FROM inventory_items i[\s\S]*p\.organization_id = i\.organization_id[\s\S]*WHERE i\.organization_id = \$1/,
  "low-stock KPI should scope both inventory items and inventory positions to the active organization",
);
assert.match(
  operationsCore,
  /purchase_requisitions WHERE organization_id = \$1 AND status IN \('PENDING','DRAFT'\)/,
  "pending requisition KPI should be organization-scoped",
);
assert.match(
  operationsCore,
  /SELECT count\(\*\)::int AS count\s+FROM invoices WHERE organization_id = \$1 AND status = 'OVERDUE'/,
  "overdue invoice KPI should be organization-scoped",
);
assert.match(
  operationsCore,
  /export async function runOperationalDemoWalkthrough\(actor: string\) \{\s*const orgId = getActiveOrganizationId\(\);/,
  "demo walkthrough should use the active organization",
);
assert.match(
  operationsCore,
  /FROM suppliers[\s\S]*WHERE organization_id = \$1/,
  "demo walkthrough supplier lookup should be organization-scoped",
);
assert.match(
  operationsCore,
  /FROM inventory_items[\s\S]*WHERE organization_id = \$1[\s\S]*AND sku = \$2/,
  "demo walkthrough item lookup should be organization-scoped",
);
assert.match(
  operationsCore,
  /VALUES \(\$1, \$2, \$3, 'sent', now\(\), \$4, now\(\), now\(\)\)/,
  "demo walkthrough PO inserts should use the active organization id instead of a hardcoded tenant",
);

console.log("test-operations-org-guards: all checks passed.");
