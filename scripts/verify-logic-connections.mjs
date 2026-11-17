import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./logic-audit-lib.mjs";

const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "cross-app-logic-audit.json"), "utf8"));
const hasReleaseBlockingFindings = artifact.summary.critical > 0 || artifact.summary.high > 0;
assert.equal(
  artifact.releaseStatus,
  hasReleaseBlockingFindings ? "BLOCKED" : "PASS",
  "release status must be BLOCKED exactly while unresolved critical/high findings exist",
);
assert.equal(artifact.runtimeEvidence?.passed, true, "disposable-database cross-path runtime evidence is required");
assert.ok(Date.now() - Date.parse(artifact.runtimeEvidence.completedAt) < 24 * 60 * 60 * 1000, "cross-path runtime evidence must be less than 24 hours old");
for (const finding of artifact.findings) {
  for (const field of ["id", "severity", "capability", "entryPoints", "locations", "routes", "permissions", "services", "tables", "expectedRule", "actualBehavior", "rationale", "impact", "reproduction", "testEvidence", "canonicalPath", "disposition", "classification"]) {
    assert(finding[field] != null && finding[field] !== "", `${finding.id ?? "finding"} is missing ${field}`);
  }
}
for (const file of ["docs/audits/cross-app-logic-audit.md", "docs/audits/capability-map.md"]) {
  assert(fs.existsSync(path.join(ROOT, file)), `missing ${file}`);
}
console.log(
  `Logic connection verification passed. Release status is ${artifact.releaseStatus} with ${artifact.summary.critical} critical and ${artifact.summary.high} high findings.`,
);
