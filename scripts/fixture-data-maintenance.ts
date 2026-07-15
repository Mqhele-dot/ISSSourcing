import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../server/db";

type TargetDefinition = { table: string; reason: string; predicate: string };
type ForeignKeyEdge = { parentTable: string; childTable: string; childColumn: string };

const targets: TargetDefinition[] = [
  { table: "supplier_contracts", reason: "RBAC test contracts", predicate: "title = 'RBAC test contract'" },
  { table: "approval_policies", reason: "AP workflow/control policies", predicate: "name ~ '^(AP Workflow|AP Test|AP Invalid)'" },
  {
    table: "sourcing_events",
    reason: "runtime and browser sourcing events",
    predicate: "title ~ '^(Runtime RFQ|E2E Controlled RFQ) '",
  },
  {
    table: "purchase_requisitions",
    reason: "runtime workflow requisitions",
    predicate: "requisition_number LIKE 'REQ-WF-%' OR notes ILIKE '%workflow proof%' OR notes ILIKE 'AP workflow smoke test%' OR justification ILIKE 'Runtime dependency proof%'",
  },
  {
    table: "purchase_orders",
    reason: "purchase orders converted from runtime workflow requisitions",
    predicate: "requisition_id IN (SELECT id FROM purchase_requisitions WHERE requisition_number LIKE 'REQ-WF-%' OR notes ILIKE '%workflow proof%' OR notes ILIKE 'AP workflow smoke test%' OR justification ILIKE 'Runtime dependency proof%')",
  },
  { table: "invoices", reason: "AP runtime invoices", predicate: "invoice_number ~ '^(AP-INV-|AP-CTRL-|AP-DUP-)'" },
  { table: "inventory_items", reason: "dependency/workflow items", predicate: "name ~ '^(Dependency|Workflow|Runtime|Propagation|Sourcing) Item ' OR sku ~ '^(DEP-ITEM-|WF-|RT-|PROP-|SOURCING-)'" },
  { table: "suppliers", reason: "dependency/workflow suppliers", predicate: "name ~ '^(Dependency|Workflow|Runtime|Propagation|Sourcing) Supplier '" },
  { table: "departments", reason: "dependency/workflow departments", predicate: "name ~ '^(Dependency|Workflow|Runtime|Propagation|Sourcing) Department '" },
  { table: "warehouses", reason: "workflow warehouses", predicate: "name ~ '^(Workflow|Runtime|Propagation|Sourcing) Warehouse '" },
  { table: "units_of_measure", reason: "dependency/workflow UOMs", predicate: "code ~ '^(DEP-(EA|BOX)-|EA-(ap|apx|rcv|over)-)'" },
  { table: "tax_codes", reason: "dependency/workflow tax codes", predicate: "code ~ '^(DEP-VAT-|VAT-(ap|apx|rcv|over)-)'" },
  { table: "mdm_cost_centres", reason: "dependency/workflow cost centres", predicate: "code ~ '^(DEP-CC|CC-(ap|apx|rcv|over)-)'" },
  {
    table: "mdm_change_requests",
    reason: "runtime MDM stewardship proofs",
    predicate: "domain = 'unknown-domain' OR reason ~ '^Runtime (high-risk|apply|failed apply) proof$'",
  },
  {
    table: "mdm_change_request_steps",
    reason: "steps for runtime MDM stewardship proofs",
    predicate: `change_request_id IN (
      SELECT id FROM mdm_change_requests
      WHERE domain = 'unknown-domain' OR reason ~ '^Runtime (high-risk|apply|failed apply) proof$'
    )`,
  },
  {
    table: "mdm_change_request_comments",
    reason: "comments for runtime MDM stewardship proofs",
    predicate: `change_request_id IN (
      SELECT id FROM mdm_change_requests
      WHERE domain = 'unknown-domain' OR reason ~ '^Runtime (high-risk|apply|failed apply) proof$'
    )`,
  },
  {
    table: "notifications",
    reason: "duplicate notifications (newest copy retained)",
    predicate: `id IN (
      SELECT id FROM (
        SELECT id, row_number() OVER (
          PARTITION BY organization_id, user_id, type, title, COALESCE(body, ''), COALESCE(entity_type, ''), COALESCE(entity_id, 0)
          ORDER BY created_at DESC, id DESC
        ) AS duplicate_number
        FROM notifications
      ) duplicates WHERE duplicate_number > 1
    )`,
  },
];

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function tableExists(table: string): Promise<boolean> {
  const result = await pool.query("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${table}`]);
  return result.rows[0]?.exists === true;
}

async function targetIds(definition: TargetDefinition): Promise<number[]> {
  if (!(await tableExists(definition.table))) return [];
  const result = await pool.query(`SELECT id FROM ${quoteIdentifier(definition.table)} WHERE ${definition.predicate} ORDER BY id`);
  return result.rows.map((row) => Number(row.id)).filter(Number.isFinite);
}

async function foreignKeyEdges(): Promise<ForeignKeyEdge[]> {
  const result = await pool.query(`
    SELECT parent.relname AS "parentTable", child.relname AS "childTable", child_column.attname AS "childColumn"
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = child.relnamespace AND namespace_row.nspname = 'public'
    JOIN pg_attribute child_column ON child_column.attrelid = child.oid AND child_column.attnum = constraint_row.conkey[1]
    JOIN pg_attribute parent_column ON parent_column.attrelid = parent.oid AND parent_column.attnum = constraint_row.confkey[1]
    WHERE constraint_row.contype = 'f'
      AND array_length(constraint_row.conkey, 1) = 1
      AND parent_column.attname = 'id'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = child.relname AND column_name = 'id'
      )
  `);
  return result.rows as ForeignKeyEdge[];
}

async function expandDependencies(selected: Map<string, Set<number>>, edges: ForeignKeyEdge[]): Promise<void> {
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const parentIds = selected.get(edge.parentTable);
      if (!parentIds?.size) continue;
      const result = await pool.query(
        `SELECT id FROM ${quoteIdentifier(edge.childTable)} WHERE ${quoteIdentifier(edge.childColumn)} = ANY($1::int[])`,
        [[...parentIds]],
      );
      const childIds = selected.get(edge.childTable) ?? new Set<number>();
      const before = childIds.size;
      for (const row of result.rows) childIds.add(Number(row.id));
      if (childIds.size > before) {
        selected.set(edge.childTable, childIds);
        changed = true;
      }
    }
  }
}

function deletionOrder(selected: Map<string, Set<number>>, edges: ForeignKeyEdge[]): string[] {
  const remaining = new Set([...selected.entries()].filter(([, ids]) => ids.size).map(([table]) => table));
  const ordered: string[] = [];
  while (remaining.size) {
    const leaves = [...remaining].filter(
      (parent) => !edges.some((edge) => edge.parentTable === parent && remaining.has(edge.childTable) && edge.childTable !== parent),
    );
    if (!leaves.length) throw new Error(`Fixture purge found a foreign-key cycle: ${[...remaining].join(", ")}`);
    for (const table of leaves) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const backupFile = argument("backup-file");
  const outputFile = path.resolve(argument("output") ?? path.join("tmp", `fixture-data-${Date.now()}.json`));
  const selected = new Map<string, Set<number>>();
  const reasons: Record<string, string[]> = {};

  for (const definition of targets) {
    const ids = await targetIds(definition);
    if (!ids.length) continue;
    selected.set(definition.table, new Set(ids));
    reasons[definition.table] = [...(reasons[definition.table] ?? []), definition.reason];
  }
  const directCounts = Object.fromEntries([...selected].map(([table, ids]) => [table, ids.size]));
  const edges = await foreignKeyEdges();
  await expandDependencies(selected, edges);
  const expandedCounts = Object.fromEntries([...selected].map(([table, ids]) => [table, ids.size]));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "audit",
    directCounts,
    expandedCounts,
    reasons,
    totalRows: Object.values(expandedCounts).reduce((sum, count) => sum + Number(count), 0),
    applied: false,
  };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  if (!apply) {
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, reportFile: outputFile }, null, 2));
    return;
  }
  if (!backupFile || !fs.existsSync(path.resolve(backupFile)) || fs.statSync(path.resolve(backupFile)).size === 0) {
    throw new Error("Fixture purge requires --backup-file=<existing non-empty pg_dump file>.");
  }
  if (argument("confirm") !== "targeted-test-fixtures") {
    throw new Error("Fixture purge requires --confirm=targeted-test-fixtures.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(48155101)");
    for (const table of deletionOrder(selected, edges)) {
      const ids = [...(selected.get(table) ?? [])];
      if (ids.length) await client.query(`DELETE FROM ${quoteIdentifier(table)} WHERE id = ANY($1::int[])`, [ids]);
    }
    await client.query("COMMIT");
    report.applied = true;
    fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, reportFile: outputFile }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`Fixture purge rolled back without deleting data: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => undefined));
