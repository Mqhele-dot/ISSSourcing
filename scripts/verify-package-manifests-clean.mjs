#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const paths = ["package.json", "package-lock.json", ".npmrc"];
const result = spawnSync("git", ["diff", "--exit-code", "--", ...paths], {
  encoding: "utf8",
  stdio: "pipe",
});

if (result.status === 0) {
  console.log("Package manifests are unchanged after install.");
  process.exit(0);
}

if (result.error) {
  console.error(`Could not verify package manifest drift: ${result.error.message}`);
  process.exit(1);
}

console.error("Package manifest drift detected after install. Commit or revert the generated changes.");
if (result.stdout) process.stderr.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
