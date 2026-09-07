import assert from "node:assert/strict";
import process from "node:process";
import { pool } from "../server/db.ts";
import { initializeRuntime } from "../server/bootstrap/runtime-init.ts";

async function main() {
  assert.ok(
    process.env.CI === "true" || process.env.ALLOW_COMMERCIAL_TEST_DB_INIT === "1",
    "Commercial test database initialization is restricted to CI or ALLOW_COMMERCIAL_TEST_DB_INIT=1.",
  );
  assert.notEqual(process.env.NODE_ENV, "production", "Refusing to initialize commercial test data in production mode.");
  await initializeRuntime();
  console.log("Commercial release test database initialized.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
