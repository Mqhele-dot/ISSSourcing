import { readFileSync } from "node:fs";

const initDb = readFileSync("server/init-db.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const preflight = readFileSync("scripts/db-migration-preflight.mjs", "utf8");

const checks = [
  {
    name: "purchase order currency column is repaired during startup",
    ok: initDb.includes("ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD'"),
  },
  {
    name: "db:push runs migration preflight before drizzle",
    ok: String(packageJson.scripts["db:push"]).startsWith("node scripts/db-migration-preflight.mjs && drizzle-kit push"),
  },
  {
    name: "db:push:force runs migration preflight before drizzle force",
    ok: String(packageJson.scripts["db:push:force"]).startsWith(
      "node scripts/db-migration-preflight.mjs && drizzle-kit push --force",
    ),
  },
  {
    name: "preflight creates the user_role enum",
    ok: preflight.includes("CREATE TYPE ${enumName} AS ENUM") && preflight.includes("user_role"),
  },
  {
    name: "preflight converts users.role with USING cast",
    ok:
      preflight.includes('normalizeEnumColumn(client, "users", "role", "user_role", "viewer")') &&
      preflight.includes("USING lower(trim(${columnName}::text))::${enumName}"),
  },
  {
    name: "preflight covers permission enum columns",
    ok:
      preflight.includes('normalizeEnumColumn(client, "permissions", "resource", "resource", "system")') &&
      preflight.includes('normalizeEnumColumn(client, "custom_role_permissions", "permission_type", "permission_type", "read")'),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`ok ${check.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`Codespaces schema preflight checks failed: ${failed}/${checks.length}`);
  process.exit(1);
}

console.log(`Codespaces schema preflight checks passed: ${checks.length}/${checks.length}`);
