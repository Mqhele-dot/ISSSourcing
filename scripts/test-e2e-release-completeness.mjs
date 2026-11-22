import assert from "node:assert/strict";
import Reporter from "./e2e-release-completeness-reporter.mjs";

function result(statuses, expectedStatus="passed") {
  const reporter = new Reporter();
  reporter.onBegin({}, { allTests: () => statuses.map((results) => ({
    results: results.map((status) => ({ status })), expectedStatus,titlePath: () => ["fixture", "test"],
  })) });
  return reporter.onEnd();
}
assert.equal(result([["passed"]]), undefined);
assert.equal(result([["failed"]]), undefined, "Original failure remains Playwright's responsibility");
assert.deepEqual(result([["failed", "passed"]]), {status:"failed"}, "A successful retry does not prove stability");
assert.deepEqual(result([["skipped"]]), { status: "failed" });
assert.deepEqual(result([[]]), { status: "failed" });
assert.deepEqual(result([]), { status: "failed" });
assert.deepEqual(result([["passed"], ["skipped"]]), { status: "failed" });
assert.deepEqual(result([["timedOut","passed"]]),{status:"failed"});
assert.deepEqual(result([["interrupted","passed"]]),{status:"failed"});
assert.deepEqual(result([["failed"]],"failed"),{status:"failed"},"Expected-failure annotations are not verified functionality");
process.env.PLAYWRIGHT_EXPECTED_SPECS=JSON.stringify(["e2e/missing.spec.ts"]);
assert.deepEqual(result([["passed"]]),{status:"failed"},"Missing requested files must fail even when another file passed");
process.env.PLAYWRIGHT_EXPECTED_SPECS="invalid";
assert.deepEqual(result([["passed"]]),{status:"failed"});
delete process.env.PLAYWRIGHT_EXPECTED_SPECS;
console.log("Release completeness checks passed: skipped, unexecuted, empty, expected-failure and flaky gates fail closed.");
