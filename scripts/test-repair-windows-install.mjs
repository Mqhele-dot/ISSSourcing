import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts", "repair-windows-install.ps1");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

const failures = [];

if (!scriptSource.includes("$env:electron_config_cache = $localElectronCache")) {
  failures.push("repair-windows-install.ps1 must export electron_config_cache for Electron's installer.");
}

if (scriptSource.includes("$env:npm_config_electron_cache = $localElectronCache")) {
  failures.push("repair-windows-install.ps1 still exports npm_config_electron_cache, which Electron ignores.");
}

if (!scriptSource.includes("$env:ELECTRON_CACHE = $localElectronCache")) {
  failures.push("repair-windows-install.ps1 must continue exporting ELECTRON_CACHE for compatibility.");
}

if (!scriptSource.includes("$env:ELECTRON_BUILDER_CACHE = $localElectronBuilderCache")) {
  failures.push("repair-windows-install.ps1 must continue exporting ELECTRON_BUILDER_CACHE for electron-builder.");
}

if (failures.length > 0) {
  console.error("Windows install repair regression check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Windows install repair regression check passed.");
