import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../../db";

const MIGRATION_FILES = [
  "20260830143000_procurement_completion.sql",
  "20260907120000_blanket_agreements_completion.sql",
] as const;

/**
 * Development bootstrap companion for the production migration. Production
 * remains migrations-only; local bootstrap executes the exact same SQL after
 * the canonical AP receipt tables are available.
 */
export async function initializeProcurementCompletionData(): Promise<void> {
  for (const migrationFile of MIGRATION_FILES) {
    const migrationPath = path.resolve(process.cwd(), "migrations", migrationFile);
    const sql = await readFile(migrationPath, "utf8");
    await pool.query(sql);
  }
}
