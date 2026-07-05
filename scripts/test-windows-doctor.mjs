import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const doctorPath = path.join(repoRoot, "scripts", "windows-doctor.ps1");
const doctorSource = fs.readFileSync(doctorPath, "utf8");

const failures = [];

if (!doctorSource.includes("tsc.cmd")) {
  failures.push("windows-doctor.ps1 must verify the TypeScript command shim, not just the node_modules directory.");
}

if (!doctorSource.includes("vite.cmd")) {
  failures.push("windows-doctor.ps1 must verify the Vite command shim so build blockers are caught early.");
}

if (!doctorSource.includes("node_modules present and command shims look complete")) {
  failures.push("windows-doctor.ps1 must report a healthy install only when required command shims are present.");
}

if (!doctorSource.includes("node_modules is missing required command shims")) {
  failures.push("windows-doctor.ps1 must warn when the install is partial or placeholder-only.");
}

if (failures.length > 0) {
  console.error("Windows doctor regression check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Windows doctor regression check passed.");
