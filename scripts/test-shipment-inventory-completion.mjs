import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, routes, router, routeRegistry, nav, authority, schema, page, runtime, operations] = await Promise.all([
  read("migrations/20260906143000_shipment_inventory_completion.sql"),
  read("server/modules/inventory-flow/register-inventory-flow-routes.ts"),
  read("client/src/router.tsx"),
  read("client/src/lib/routes/app-routes.ts"),
  read("client/src/lib/routes/section-metadata.ts"),
  read("shared/authority-catalogs.ts"),
  read("shared/schema.ts"),
  read("client/src/pages/inventory-put-away.tsx"),
  read("server/bootstrap/runtime-init.ts"),
  read("server/modules/operations/operations-core.ts"),
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_putaway_tasks/);
assert.match(migration, /UNIQUE \(organization_id, receipt_item_id\)/);
assert.match(migration, /ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'PUT_AWAY'/);
assert.match(migration, /ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'RECEIPT_REVERSAL'/);
assert.match(migration, /ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'PURCHASE_RETURN'/);
for (const endpoint of [
  'app.get("/api/v2/inventory/put-away"',
  'app.get("/api/v2/inventory/put-away/:id"',
  'app.post("/api/v2/inventory/put-away/reconcile"',
  'app.post("/api/v2/inventory/put-away/:id/assign"',
  'app.post("/api/v2/inventory/put-away/:id/start"',
  'app.post("/api/v2/inventory/put-away/:id/complete"',
  'app.post("/api/v2/inventory/put-away/:id/exception"',
]) assert.ok(routes.includes(endpoint), `missing ${endpoint}`);
assert.match(routes, /t\.organization_id=\$1/);
assert.match(routes, /ON CONFLICT \(organization_id,receipt_item_id\) DO NOTHING/);
assert.match(routes, /UPDATE warehouse_inventory SET location=\$1,bin=\$1/);
assert.match(routes, /'PUT_AWAY'/);
assert.match(routes, /UPDATE operational_exceptions SET status='resolved'/);
assert.match(routeRegistry, /putAway: "\/inventory\/put-away"/);
assert.match(router, /ProductionInventoryPutAwayPage/);
assert.match(nav, /label: "Put-away"/);
assert.match(authority, /path: "\/inventory\/put-away"/);
assert.match(schema, /"PUT_AWAY"/);
assert.match(page, /data-testid="inventory-put-away-page"/);
assert.match(page, /Synchronize posted receipts/);
assert.match(runtime, /initializeShipmentInventoryCompletion/);
assert.match(operations, /original_eta = COALESCE\(original_eta/);
assert.match(operations, /eta_changed_count = eta_changed_count/);

console.log("Shipment and inventory completion contracts passed.");
