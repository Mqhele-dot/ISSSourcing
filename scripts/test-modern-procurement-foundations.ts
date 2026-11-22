import assert from "node:assert/strict";
import { supplierPerformanceEvidence } from "../shared/supplier-performance-evidence";
import { erpCapabilityCatalog, resolveCapabilityAvailability } from "../shared/erp-capability-catalog";

const empty = supplierPerformanceEvidence(0, 0, 0, 0);
assert.equal(empty.overallRating, null);
assert.equal(empty.priceComplianceRate, null);
assert.equal(empty.onTimeDeliveryRate, null);
assert.equal(empty.evidenceState, "insufficient_evidence");
assert.equal(supplierPerformanceEvidence(10, 8, 0, 0).overallRating, null);
const observed = supplierPerformanceEvidence(10, 8, 10, 1);
assert.equal(observed.onTimeDeliveryRate, 80);
assert.equal(observed.priceComplianceRate, 90);
assert.equal(observed.overallRating, 4.2);
const contracts = erpCapabilityCatalog.find(item => item.id === "procurement.purchase-contracts")!;
const [disabled] = resolveCapabilityAvailability([contracts], () => false);
assert.equal(disabled.status, "disabled");
assert.equal(disabled.implementationStatus, "partial");
assert.equal(disabled.enablement, "disabled");
assert.equal(disabled.verification, "unverified");
assert.equal(resolveCapabilityAvailability([contracts], () => true)[0].verification, "unverified");
for (const id of ["suppliers.supplier-communication-history", "inventory.slow-moving-stock-reports"]) {
  const item = erpCapabilityCatalog.find(item => item.id === id)!;
  assert.equal(item.status, "implemented");
  assert.ok(item.apis.length && item.routes.length && item.evidence.length);
  assert.equal(item.verifiedAt, null);
}
console.log("Modern procurement foundation checks passed.");
