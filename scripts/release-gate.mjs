import fs from "node:fs";
import { spawn } from "node:child_process";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const requiredScripts = [
  "check",
  "lint",
  "migrate:check",
  "test:contracts",
  "test:rbac",
  "test:procurement-flow",
  "test:ap-workflow",
  "test:ap-controls",
  "test:exports",
  "test:smoke",
  "test:e2e",
];

for (const scriptName of requiredScripts) {
  if (!packageJson.scripts?.[scriptName]) {
    console.error(`Missing required package.json script: ${scriptName}`);
    process.exit(1);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

for (const scriptName of requiredScripts) {
  console.log(`\n=== Running npm run ${scriptName} ===`);
  await run("npm", ["run", scriptName]);
}

console.log("\nRelease gate passed.");
