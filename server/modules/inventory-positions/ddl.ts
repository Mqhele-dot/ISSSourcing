import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../../db";

const MIGRATION_FILES = [
  "20260915120000_cycle_count_integrity.sql",
  "20260915160000_warehouse_position_foundation.sql",
  "20260916090000_item_safety_holds.sql",
  "20260917190000_receipt_inspection_rules.sql",
  "20260917200000_inspection_entry_guards.sql",
] as const;

/**
 * Development and disposable-test bootstrap companion for Release 1.
 * Hosted production remains migrations-only; this runs the same checked-in,
 * idempotent SQL so fresh local, Codespaces, and CI schemas match upgrades.
 */
export async function initializeInventoryPositionFoundation(): Promise<void> {
  for (const migrationFile of MIGRATION_FILES) {
    const migrationPath = path.resolve(process.cwd(), "migrations", migrationFile);
    await pool.query(await readFile(migrationPath, "utf8"));
  }
}
