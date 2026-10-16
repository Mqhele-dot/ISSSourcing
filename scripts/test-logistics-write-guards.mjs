import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sharedFilters = readFileSync(new URL("../shared/logistics-shipment-filters.ts", import.meta.url), "utf8");
const operationsCore = readFileSync(new URL("../server/modules/operations/operations-core.ts", import.meta.url), "utf8");
const operationsRoutes = readFileSync(new URL("../server/operations-routes.ts", import.meta.url), "utf8");

assert.match(sharedFilters, /SHIPMENT_DIRECTION_VALUES = \["inbound", "outbound", "transfer", "return"\] as const/);
assert.match(sharedFilters, /SHIPMENT_SOURCE_TYPE_VALUES = \["purchase_order"\] as const/);
assert.match(sharedFilters, /direction: normalizeShipmentDirection\(/);
assert.match(sharedFilters, /sourceType: normalizeShipmentSourceType\(/);

assert.match(operationsCore, /if \(freightCost != null && freightCost < 0\) {\s*throw new Error\("shipment_freight_cost_invalid"\);/);
assert.match(operationsCore, /const normalizedDirection = normalizeShipmentDirection\(rawDirection\);/);
assert.match(operationsCore, /throw new Error\("shipment_direction_invalid"\);/);
assert.match(operationsCore, /const normalizedSourceType = normalizeShipmentSourceType\(rawSourceType\);/);
assert.match(operationsCore, /throw new Error\("shipment_source_type_invalid"\);/);

assert.match(operationsRoutes, /SHIPMENT_FREIGHT_COST_INVALID/);
assert.match(operationsRoutes, /SHIPMENT_DIRECTION_INVALID/);
assert.match(operationsRoutes, /SHIPMENT_SOURCE_TYPE_INVALID/);
assert.match(operationsRoutes, /assertValidShipmentDirectionInput/);
assert.match(operationsRoutes, /assertValidShipmentSourceTypeInput/);

console.log("test-logistics-write-guards: all checks passed.");
