import { assertDisposableE2eEnvironment } from "./e2e-database-guard.mjs";

// Schema only: no fixtures, workers or business writes. Run before migrations
// which reference the runtime-owned Export Center tables.
assertDisposableE2eEnvironment();
if (process.env.NODE_ENV !== "test") throw new Error("Export test schema initialization requires test mode.");
const expected = decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1));
const { pool } = await import("../server/db.ts");
try {
  const identity = await pool.query("SELECT current_database() AS name");
  if (identity.rows[0]?.name !== expected) throw new Error("Export schema database identity does not match the test target.");
  const { initializeExportCenterData } = await import("../server/modules/exports/export-center-ddl.ts");
  await initializeExportCenterData();
  console.log("Test-owned Export Center schema prerequisites initialized without fixtures.");
} finally {
  await pool.end();
}
