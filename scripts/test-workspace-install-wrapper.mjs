import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, "package.json");
const wrapperPath = path.join(repoRoot, "scripts", "npm-ci-workspace.mjs");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const wrapperSource = fs.readFileSync(wrapperPath, "utf8");
const failures = [];

if (packageJson.scripts?.["ci:workspace"] !== "node scripts/npm-ci-workspace.mjs") {
  failures.push('package.json must expose "ci:workspace" as the workspace-safe dependency install entrypoint.');
}

if (!wrapperSource.includes('if (process.platform === "win32")')) {
  failures.push("npm-ci-workspace.mjs must branch on Windows so the install repair path is automatic there.");
}

if (!wrapperSource.includes('repair-windows-install.ps1')) {
  failures.push("npm-ci-workspace.mjs must route Windows installs through scripts/repair-windows-install.ps1.");
}

if (!wrapperSource.includes('"ci"')) {
  failures.push("npm-ci-workspace.mjs must still run npm ci as the underlying dependency restore command.");
}

if (!wrapperSource.includes('--no-audit') || !wrapperSource.includes('--no-fund')) {
  failures.push("npm-ci-workspace.mjs must keep install noise low with --no-audit and --no-fund.");
}

if (failures.length > 0) {
  console.error("Workspace install wrapper regression check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Workspace install wrapper regression check passed.");
