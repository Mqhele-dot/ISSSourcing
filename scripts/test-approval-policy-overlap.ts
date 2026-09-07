import assert from "node:assert/strict";
import { approvalRangesOverlap } from "../server/modules/master-data/approval-policy-overlap";

const base = {
  entityType: "invoice",
  approvalLevel: 1,
  amountMin: 0,
  amountMax: 1_000,
  isActive: true,
};

assert.equal(
  approvalRangesOverlap(base, { ...base, amountMin: 500, amountMax: 2_000 }),
  true,
  "same-level intersecting bands must conflict",
);
assert.equal(
  approvalRangesOverlap(base, { ...base, approvalLevel: 2, amountMin: 0, amountMax: 1_000 }),
  false,
  "different approval levels form a valid chain",
);
assert.equal(
  approvalRangesOverlap(base, { ...base, entityType: "requisition", amountMin: 0, amountMax: 1_000 }),
  false,
  "different entity types do not conflict",
);
assert.equal(
  approvalRangesOverlap(base, { ...base, isActive: false, amountMin: 0, amountMax: 1_000 }),
  false,
  "inactive policies do not block active policies",
);

console.log("Approval policy overlap checks passed.");
