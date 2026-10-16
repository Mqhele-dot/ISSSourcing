import "dotenv/config";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD) {
    return `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT ?? "5432"}/${process.env.PGDATABASE}`;
  }
  return "postgresql://postgres:postgres@localhost:5432/inventory_dev";
}

const databaseUrl = resolveDatabaseUrl();

const requiredTables = [
  "organizations",
  "organization_members",
  "suppliers",
  "supplier_portal_mappings",
  "purchase_requisitions",
  "purchase_requisition_items",
  "sourcing_events",
  "sourcing_event_lines",
  "sourcing_evaluation_criteria",
  "sourcing_invitations",
  "supplier_quotes",
  "supplier_quote_lines",
  "sourcing_clarifications",
  "sourcing_evaluations",
  "sourcing_awards",
  "sourcing_award_lines",
  "workflow_idempotency",
  "purchase_orders",
  "purchase_order_items",
  "supplier_contracts",
  "audit_logs",
];

const requiredColumns = {
  sourcing_events: ["organization_id", "event_number", "status", "owner_user_id", "reporting_currency_code", "locked_fx_snapshot"],
  sourcing_event_lines: ["organization_id", "unit_of_measure_id", "tax_code_id", "cost_centre_id", "gl_account_code"],
  supplier_quotes: ["organization_id", "quote_number", "version", "exchange_rate_to_reporting", "reporting_total"],
  sourcing_awards: ["organization_id", "recommended_by_user_id", "approved_by_user_id", "converted_purchase_order_id"],
  workflow_idempotency: ["organization_id", "idempotency_key", "action", "resource_type"],
  audit_logs: ["organization_id", "previous_hash", "event_hash", "hash_version", "request_id", "reason"],
};

const requiredUniqueIndexes = [
  { table: "organization_members", columns: ["organization_id", "user_id"] },
  { table: "supplier_portal_mappings", columns: ["organization_id", "user_id"] },
  { table: "sourcing_events", columns: ["organization_id", "event_number"] },
  { table: "supplier_quotes", columns: ["organization_id", "quote_number"] },
  { table: "workflow_idempotency", columns: ["organization_id", "idempotency_key"] },
  { table: "audit_logs", columns: ["organization_id", "event_hash"] },
];

async function migrationFiles() {
  const files = [path.resolve("server/init-db.ts")];
  for (const name of await readdir(path.resolve("migrations"))) {
    if (name.endsWith(".sql")) files.push(path.resolve("migrations", name));
  }
  return files;
}

async function assertNoDestructiveMigrationStatements() {
  const destructive = /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE(?:\s+TABLE)?)\b/i;
  const allowMarker = /commercial-rehearsal:\s*allow-destructive/i;
  let constraintRelaxations = 0;
  const findings = [];
  for (const file of await migrationFiles()) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\bDROP\s+NOT\s+NULL\b/i.test(line)) constraintRelaxations += 1;
      if (destructive.test(line) && !allowMarker.test(line)) {
        findings.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(findings, [], `Unapproved destructive migration statement(s):\n${findings.join("\n")}`);
  console.log(`ok destructive DDL scan (constraint relaxations reported separately: ${constraintRelaxations})`);
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const tableRows = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    const presentTables = new Set(tableRows.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !presentTables.has(table));
    assert.deepEqual(missingTables, [], `Required commercial procurement tables missing: ${missingTables.join(", ")}`);
    console.log(`ok required commercial procurement tables (${requiredTables.length})`);

    for (const [table, columns] of Object.entries(requiredColumns)) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1 AND column_name = ANY($2::text[])`,
        [table, columns],
      );
      const present = new Set(result.rows.map((row) => row.column_name));
      const missing = columns.filter((column) => !present.has(column));
      assert.deepEqual(missing, [], `Required production schema columns missing on ${table}: ${missing.join(", ")}`);
    }
    console.log("ok required sourcing and audit-chain columns");

    const indexes = await pool.query(
      `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = current_schema()`,
    );
    for (const requirement of requiredUniqueIndexes) {
      const found = indexes.rows.some((row) => {
        const definition = String(row.indexdef).toLowerCase();
        return row.tablename === requirement.table
          && definition.includes("create unique index")
          && requirement.columns.every((column) => definition.includes(column));
      });
      assert.ok(found, `Required tenant uniqueness missing: ${requirement.table}(${requirement.columns.join(", ")})`);
    }
    console.log(`ok tenant-scoped unique indexes (${requiredUniqueIndexes.length})`);

    const trigger = await pool.query(
      `SELECT tgname, tgenabled
       FROM pg_trigger
       WHERE tgrelid = 'audit_logs'::regclass
         AND tgname = 'audit_logs_append_only_guard'
         AND NOT tgisinternal`,
    );
    assert.equal(trigger.rowCount, 1, "audit_logs append-only trigger is required");
    assert.notEqual(trigger.rows[0].tgenabled, "D", "audit_logs append-only trigger must be enabled");
    console.log("ok append-only audit trigger");

    const organizationsWithoutMembers = await pool.query(
      `SELECT o.id, o.name
       FROM organizations o
       WHERE o.active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM organization_members om
           WHERE om.organization_id = o.id
             AND om.active = TRUE
             AND LOWER(COALESCE(om.status, 'active')) = 'active'
         )`,
    );
    assert.equal(
      organizationsWithoutMembers.rowCount,
      0,
      `Active organization(s) without active membership: ${organizationsWithoutMembers.rows.map((row) => `${row.id}:${row.name}`).join(", ")}`,
    );
    console.log("ok active legacy organizations have active memberships");

    await assertNoDestructiveMigrationStatements();
    console.log("Commercial procurement migration rehearsal passed without changing the database.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
