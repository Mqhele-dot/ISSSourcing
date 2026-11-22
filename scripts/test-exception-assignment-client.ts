import assert from "node:assert/strict";

import {
  hasExceptionAssigneeChanged,
  normalizeExceptionAssigneeInput,
  shouldSubmitExceptionQuickUpdate,
} from "../client/src/pages/exceptions-workflow";

assert.equal(normalizeExceptionAssigneeInput("  planner.team  "), "planner.team");
assert.equal(normalizeExceptionAssigneeInput("   "), null);
assert.equal(normalizeExceptionAssigneeInput(null), null);

assert.equal(hasExceptionAssigneeChanged("alice", "alice"), false);
assert.equal(hasExceptionAssigneeChanged("alice", "  alice  "), false);
assert.equal(hasExceptionAssigneeChanged("alice", ""), true);
assert.equal(hasExceptionAssigneeChanged(null, "bob"), true);

assert.equal(
  shouldSubmitExceptionQuickUpdate({
    currentStatus: "open",
    nextStatus: "open",
    currentAssignee: "alice",
    nextAssigneeInput: "  ",
    note: "",
    statusRequiresNote: false,
  }),
  true,
);

assert.equal(
  shouldSubmitExceptionQuickUpdate({
    currentStatus: "open",
    nextStatus: "resolved",
    currentAssignee: "alice",
    nextAssigneeInput: "alice",
    note: "",
    statusRequiresNote: true,
  }),
  false,
);

assert.equal(
  shouldSubmitExceptionQuickUpdate({
    currentStatus: "open",
    nextStatus: "resolved",
    currentAssignee: "alice",
    nextAssigneeInput: "alice",
    note: "Resolved with buyer confirmation",
    statusRequiresNote: true,
  }),
  true,
);

console.log("test-exception-assignment-client: all checks passed.");
