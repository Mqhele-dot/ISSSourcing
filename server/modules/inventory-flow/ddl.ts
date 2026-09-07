import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../../db";

const MIGRATION_FILE = "20260906143000_shipment_inventory_completion.sql";

export async function initializeShipmentInventoryCompletion(): Promise<void> {
  const migrationPath = path.resolve(process.cwd(), "migrations", MIGRATION_FILE);
  await pool.query(await readFile(migrationPath, "utf8"));
}
