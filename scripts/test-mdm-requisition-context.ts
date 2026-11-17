import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pool } from "../server/db.ts";
import { getRequisitionContext } from "../server/modules/master-data/mdm-control-centre.ts";
import { exitTest } from "./test-exit.ts";

async function main() {
  const source = readFileSync("server/modules/master-data/mdm-control-centre.ts", "utf8");
  assert.match(
    source,
    /mic\.id::text\s*=\s*NULLIF\(TRIM\(ii\.category_id::text\),\s*''\)/,
    "getRequisitionContext must join item categories through text-safe comparison to avoid integer=text crashes",
  );
  assert.doesNotMatch(
    source,
    /mic\.id\s*=\s*ii\.category_id/,
    "getRequisitionContext must not use the old unsafe integer=text category join",
  );

  const categoryColumn = await pool.query<{ data_type: string }>(
    `
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'inventory_items' AND column_name = 'category_id'
      LIMIT 1
    `,
  );
  const dataType = categoryColumn.rows[0]?.data_type ?? "unknown";

  const context = await getRequisitionContext(1);
  assert.equal(context.defaultCurrencyCode, "ZAR");
  assert.ok(Array.isArray(context.items), "requisition context must include items array");
  assert.ok(Array.isArray(context.suppliers), "requisition context must include suppliers array");
  assert.ok(Array.isArray(context.currencies), "requisition context must include currencies array");

  if (dataType.includes("character") || dataType === "text") {
    assert.match(
      source,
      /NULLIF\(TRIM\(ii\.category_id::text\),\s*''\)/,
      "blank text category_id values must be ignored safely",
    );
  }

  console.log("MDM requisition context regression passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    exitTest();
  });
