import assert from "node:assert/strict";
import { erpCapabilityCatalog, erpCapabilitySummary, resolveCapabilityAvailability } from "../shared/erp-capability-catalog";

assert.equal(erpCapabilitySummary.rawTotal, 180, "Preserve original checklist entries");
assert.equal(erpCapabilitySummary.total, 172, "Preserve the existing eight alias merges; the old 173 claim was stale");
assert.equal(erpCapabilityCatalog.reduce((total, item) => total + item.aliases.length, 0), 8);
for (const id of ["inventory.stock-counts", "inventory.multi-bin-stock", "inventory.stock-valuation", "warehouse.put-away", "procurement.purchase-returns"]) {
  const capability = erpCapabilityCatalog.find(item => item.id === id);
  assert.equal(capability?.status, "partial", id);
  assert.equal(capability?.verifiedAt, null, "Source audit must not fabricate runtime verification");
  assert.ok(capability?.evidence.includes("docs/audits/warehouse-logistics-completion-2026-09-15.md"));
}
assert.ok(erpCapabilityCatalog.find(item => item.id === "inventory.stock-counts")?.aliases.includes("warehouse.stock-counts"));
for (const id of ["inventory.lot-batch-tracking", "inventory.serial-number-tracking"]) {
  assert.notEqual(erpCapabilityCatalog.find(item => item.id === id)?.status, "missing");
}
const original = erpCapabilityCatalog.find(item => item.id === "procurement.purchase-returns")!;
const verified = {...original, verifiedAt: "2026-09-01T12:00:00.000Z"};
const disabled = resolveCapabilityAvailability([original, verified], () => false);
assert.equal(disabled[0].status, "disabled");
assert.equal(disabled[0].verifiedAt, null);
assert.equal(disabled[1].verifiedAt, verified.verifiedAt);
assert.equal(original.status, "partial", "Availability resolution must not mutate the catalog");
assert.equal(resolveCapabilityAvailability([original], () => true)[0].status, "partial");
console.log("Warehouse capability audit checks passed.");
