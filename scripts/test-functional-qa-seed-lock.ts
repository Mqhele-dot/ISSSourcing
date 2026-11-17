import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { pool } from "../server/db";
import {
  FQA_AP_INVOICES,
  FQA_PO_NUMBERS,
  FQA_REQUISITION_NUMBER,
} from "../shared/functional-qa-constants";

const ORG_ID = 1;

function runSeed(label: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "server/seed-functional-qa.ts"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

  return once(child, "exit").then(([code, signal]) => ({
    label,
    code,
    signal,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  }));
}

async function main() {
  const results = await Promise.all([runSeed("seed-a"), runSeed("seed-b")]);
  for (const result of results) {
    assert.equal(
      result.code,
      0,
      `${result.label} failed with code=${result.code} signal=${result.signal ?? "none"}\n${result.stdout}\n${result.stderr}`,
    );
  }

  const requisitionCount = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM purchase_requisitions WHERE organization_id = $1 AND requisition_number = $2",
    [ORG_ID, FQA_REQUISITION_NUMBER],
  );
  assert.equal(requisitionCount.rows[0]?.count, "1", "expected exactly one FQA requisition");

  const poCount = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM purchase_orders WHERE organization_id = $1 AND order_number = ANY($2::text[])",
    [ORG_ID, FQA_PO_NUMBERS],
  );
  assert.equal(poCount.rows[0]?.count, String(FQA_PO_NUMBERS.length), "expected FQA purchase orders to remain unique");

  const poLineCount = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.order_id
      WHERE po.organization_id = $1
        AND po.order_number = ANY($2::text[])`,
    [ORG_ID, FQA_PO_NUMBERS],
  );
  assert.equal(poLineCount.rows[0]?.count, "4", "expected FQA purchase order line set to remain stable");

  const invoiceCount = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM invoices WHERE organization_id = $1 AND invoice_number = ANY($2::text[])",
    [ORG_ID, Object.keys(FQA_AP_INVOICES)],
  );
  assert.equal(invoiceCount.rows[0]?.count, String(Object.keys(FQA_AP_INVOICES).length), "expected FQA invoices to remain unique");

  console.log("test-functional-qa-seed-lock: passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
