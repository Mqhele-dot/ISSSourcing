import { pool } from "../db";

/** Lightweight row counts for operational health / demo summaries. */
export async function getOperationalExceptionSummary() {
  const result = await pool.query<{
    users: number;
    warehouses: number;
    suppliers: number;
    items: number;
    settings: number;
  }>(
    `
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM warehouses) AS warehouses,
      (SELECT count(*)::int FROM suppliers) AS suppliers,
      (SELECT count(*)::int FROM inventory_items) AS items,
      (SELECT count(*)::int FROM app_settings) AS settings
    `,
  );

  return result.rows[0];
}
