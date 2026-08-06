import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateFuelReconciliation, tankFillPercent } from "../shared/fuel-operations";

const balanced = calculateFuelReconciliation({
  openingMeterLitres: 10_000,
  closingMeterLitres: 10_750,
  reportedSalesLitres: 749.7,
});
assert.equal(balanced.measuredSalesLitres, 750);
assert.ok(Math.abs(balanced.varianceLitres - -0.3) < 0.00001);
assert.equal(balanced.status, "balanced");

const variance = calculateFuelReconciliation({
  openingMeterLitres: 2_000,
  closingMeterLitres: 2_100,
  reportedSalesLitres: 96,
});
assert.equal(variance.status, "variance");
assert.equal(variance.varianceLitres, -4);
assert.throws(() => calculateFuelReconciliation({ openingMeterLitres: 10, closingMeterLitres: 9, reportedSalesLitres: 1 }));
assert.equal(tankFillPercent(500, 1_000), 50);
assert.equal(tankFillPercent(1_500, 1_000), 100);
assert.equal(tankFillPercent(-10, 1_000), 0);

const routes = await readFile(new URL("../server/modules/gas/register-gas-routes.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../server/modules/gas/fuel-operations-service.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../client/src/pages/fuel-operations.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/20260806203000_fuel_operations.sql", import.meta.url), "utf8");

for (const route of ["workspace", "stations", "tanks", "pumps", "readings", "deliveries", "reconciliations", "prices", "inspections", "cylinders"]) {
  assert.match(routes, new RegExp(`/api/fuel/${route}`), `missing fuel route: ${route}`);
}
assert.match(routes, /ensurePermission\("inventory", "read"\)/);
assert.match(routes, /ensurePermission\("inventory", "update"\)/);
assert.match(service, /organizationId/);
assert.match(service, /DELIVERY_EXCEEDS_CAPACITY/);
assert.match(service, /INSUFFICIENT_TANK_STOCK/);
assert.match(service, /INVALID_SUPPLIER/);
assert.match(service, /status: "blocked"/);
assert.match(page, /Stations & stock/);
assert.match(page, /Pumps, sales & pricing/);
assert.match(page, /LPG cylinders/);
assert.match(page, /Safety/);
assert.match(migration, /fuel_tanks_level_capacity_chk/);
assert.match(migration, /fuel_shift_time_chk/);

console.log("Fuel Operations contracts passed.");
