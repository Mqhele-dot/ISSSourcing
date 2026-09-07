import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../../db";

const MIGRATION_FILE = "20260830143000_procurement_completion.sql";

/**
 * Development bootstrap companion for the production migration. Production
 * remains migrations-only; local bootstrap executes the exact same SQL after
 * the canonical AP receipt tables are available.
 */
export async function initializeProcurementCompletionData(): Promise<void> {
  const migrationPath = path.resolve(process.cwd(), "migrations", MIGRATION_FILE);
  const sql = await readFile(migrationPath, "utf8");
  await pool.query(sql);
}
