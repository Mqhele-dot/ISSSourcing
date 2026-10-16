import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [route, page, warehousePage, cyclePage, socketRouter, socketHook, barcodePage, masterDataRoutes, vite, migration] = await Promise.all([
  readFile("server/modules/v2/register-inventory-v2-routes.ts", "utf8"),
  readFile("client/src/pages/inventory.tsx", "utf8"),
  readFile("client/src/pages/warehouse-operations.tsx", "utf8"),
  readFile("client/src/pages/cycle-counts.tsx", "utf8"),
  readFile("server/websocket-upgrade-router.ts", "utf8"),
  readFile("client/src/hooks/use-websocket.ts", "utf8"),
  readFile("client/src/pages/barcode-scanner-page.tsx", "utf8"),
  readFile("server/modules/master-data/register-master-data-routes.ts", "utf8"),
  readFile("server/vite.ts", "utf8"),
  readFile("migrations/20260802090000_inventory_tenant_pagination.sql", "utf8"),
]);

assert.match(route, /app\.get\("\/api\/v2\/inventory"/);
assert.match(route, /\[25, 50, 100\]/);
assert.match(route, /i\.organization_id::text = \$1::text/);
assert.match(route, /available <= low_stock_threshold/);
assert.match(route, /warehouse_inventory/);
assert.doesNotMatch(route, /inventory_positions/);
assert.match(page, /inventory-pagination/);
assert.match(page, /warehousePositionCount/);
assert.match(page, /unassignedQuantity/);
assert.match(warehousePage, /allocWh === "none"/);
assert.match(warehousePage, /batchWh === "none"/);
assert.match(warehousePage, /serialWh === "none"/);
assert.match(warehousePage, /api\/v2\/inventory-allocations\?page=/);
assert.match(warehousePage, /issueBatchId === "none"/);
assert.match(warehousePage, /issueSerialId === "none"/);
assert.match(masterDataRoutes, /app\.get\("\/api\/v2\/inventory-allocations"/);
assert.match(masterDataRoutes, /gt\(inventoryAllocations\.quantity, 0\)/);
assert.match(masterDataRoutes, /itemSku: inventoryItems\.sku/);
assert.match(cyclePage, /warehouseId === "none"/);
assert.match(socketRouter, /if \(!route\) return/);
assert.match(socketHook, /manualCloseRef/);
assert.match(socketHook, /connectRef\.current\(\)/);
assert.doesNotMatch(socketHook, /\[getWebSocketUrl, onConnectionStatus, onInventoryUpdate/);
assert.match(barcodePage, /React\.lazy/);
assert.match(barcodePage, /Loading code generator/);
assert.match(vite, /\/__vite_hmr/);
assert.match(migration, /HAVING COUNT\(DISTINCT organization_id\) = 1/);

console.log("Inventory reliability contracts passed.");
