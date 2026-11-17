import assert from "node:assert/strict";
import {
  EXCEPTION_STATUS_TRANSITIONS,
  validateExceptionStatusTransition,
} from "../server/modules/operations/exception-status-policy.ts";

function main() {
  assert.deepEqual(EXCEPTION_STATUS_TRANSITIONS.open, ["in_progress", "resolved", "closed"]);

  assert.throws(
    () =>
      validateExceptionStatusTransition({
        currentStatus: "open",
        toStatus: "resolved",
        note: "",
      }),
    /comment_required/,
    "resolved transitions should require a note",
  );

  assert.throws(
    () =>
      validateExceptionStatusTransition({
        currentStatus: "resolved",
        toStatus: "closed",
        note: "   ",
      }),
    /comment_required/,
    "closed transitions should require a note",
  );

  const validated = validateExceptionStatusTransition({
    currentStatus: "in_progress",
    toStatus: "resolved",
    note: "Confirmed supplier ETA and receiving plan.",
  });
  assert.equal(validated.currentStatus, "in_progress");
  assert.equal(validated.toStatus, "resolved");
  assert.equal(validated.note, "Confirmed supplier ETA and receiving plan.");
  assert.deepEqual(validated.allowedTargets, ["resolved", "closed", "open"]);

  const reopen = validateExceptionStatusTransition({
    currentStatus: "resolved",
    toStatus: "open",
  });
  assert.equal(reopen.note, "", "reopen should not require a note");

  console.log("test-exception-status-policy: all checks passed.");
}

main();
