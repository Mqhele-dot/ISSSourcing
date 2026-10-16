import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const isWindows = process.platform === "win32";

const requiredShellScripts = [
  "scripts/codespaces-up.sh",
  "scripts/doctor.sh",
  "scripts/test-runtime.sh",
];

const requiredNodeScripts = ["scripts/validate-readme.mjs"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const relativePath of requiredShellScripts) {
  const absolutePath = path.resolve(rootDir, relativePath);
  try {
    accessSync(absolutePath, constants.R_OK);
  } catch {
    fail(`Missing required script: ${absolutePath}`);
  }
  if (!isWindows) {
    const mode = statSync(absolutePath).mode;
    if ((mode & 0o111) === 0) {
      fail(`Script is not executable: ${absolutePath}`);
    }
  }
}

for (const relativePath of requiredNodeScripts) {
  const absolutePath = path.resolve(rootDir, relativePath);
  try {
    accessSync(absolutePath, constants.R_OK);
  } catch {
    fail(`Missing required script: ${absolutePath}`);
  }
}

console.log("Required scripts exist and executable checks passed");

const validateReadme = spawnSync(process.execPath, [path.resolve(rootDir, "scripts/validate-readme.mjs")], {
  cwd: rootDir,
  stdio: "inherit",
});

if (validateReadme.status !== 0) {
  process.exit(validateReadme.status ?? 1);
}

console.log("Doctor checks passed");
