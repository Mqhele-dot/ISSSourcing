import { pool } from "../server/db.ts";

type RequiredColumn = {
  table: string;
  column: string;
};

export const requisitionAndPoMdmColumns: RequiredColumn[] = [
  { table: "purchase_requisition_items", column: "unit_of_measure_id" },
  { table: "purchase_requisition_items", column: "tax_code_id" },
  { table: "purchase_requisition_items", column: "cost_centre_id" },
  { table: "purchase_requisition_items", column: "gl_account_code" },
  { table: "purchase_order_items", column: "unit_of_measure_id" },
  { table: "purchase_order_items", column: "tax_code_id" },
  { table: "purchase_order_items", column: "cost_centre_id" },
  { table: "purchase_order_items", column: "gl_account_code" },
];

export async function assertProductionSchemaColumns(columns: RequiredColumn[]): Promise<void> {
  for (const { table, column } of columns) {
    const result = await pool.query(
      `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = $2
        LIMIT 1
      `,
      [table, column],
    );

    if (result.rowCount === 0) {
      throw new Error(
        `Required production schema column missing: ${table}.${column}. Run db migration/init before release.`,
      );
    }
  }
}
