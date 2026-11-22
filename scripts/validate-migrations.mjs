import fs from "node:fs";

const requiredFiles = [
  "server/modules/accounts-payable/ap-ddl.ts",
  "server/modules/exports/export-center-ddl.ts",
  "server/modules/exports/export-jobs.ts",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));

if (missing.length > 0) {
  console.error("Missing required migration/bootstrap files:\n%s", missing.join("\n"));
  process.exit(1);
}

console.log("Migration validation passed.");
