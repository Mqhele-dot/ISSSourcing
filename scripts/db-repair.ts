#!/usr/bin/env node
/**
 * Repair demo data without full re-seed (e.g. backfill null prices).
 * Run: npm run db:repair
 */
import { pool } from "../server/db";

async function main() {
  try {
    const r = await pool.query(
      `UPDATE inventory_items SET price = COALESCE(price, 0) WHERE price IS NULL`,
    );
    const updated = r.rowCount ?? 0;
    console.log(`Repaired ${updated} inventory item(s) with null price.`);
  } catch (err) {
    console.error("db:repair failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
