#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertContains(file, pattern, label) {
  const text = read(file);
  if (!pattern.test(text)) {
    throw new Error(`${label} missing in ${file}`);
  }
}

assertContains("server/lib/security-release-status.ts", /loadSecurityReleaseStatus/, "security release status loader");
assertContains("server/routes.ts", /api\/diagnostics\/security-release-status/, "dedicated security diagnostics endpoint");
assertContains("server/routes.ts", /securityReleaseStatus: loadSecurityReleaseStatus\(\)/, "security release status snapshot wiring");
assertContains("client/src/pages/system-diagnostics-page.tsx", /Security and release status/, "diagnostics UI security status section");
assertContains("scripts/write-security-release-status.mjs", /security-release-status\.json/, "status writer artifact output");
assertContains(".github/workflows/ci.yml", /security-release-status:/, "CI security release status job");

console.log("Security release status contract checks passed.");
