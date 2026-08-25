import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../server/db";
import { FIXTURE_PREDICATES } from "../server/diagnostics/fixture-definition-catalog";

type TargetDefinition = { table: string; reason: string; predicate: string };
type ForeignKeyEdge = { parentTable: string; childTable: string; childColumn: string };

const targets: TargetDefinition[] = [
  {
    table: "users",
    reason: "interrupted subscription runtime starter-user fixtures",
    predicate: FIXTURE_PREDICATES.users,
  },
  { table: "supplier_contracts", reason: "RBAC test contracts", predicate: "title = 'RBAC test contract'" },
  { table: "approval_policies", reason: "AP workflow/control policies", predicate: FIXTURE_PREDICATES.approvalPolicies },
  {
    table: "sourcing_events",
    reason: "runtime and browser sourcing events",
    predicate: FIXTURE_PREDICATES.sourcingEvents,
  },
  {
    table: "purchase_requisitions",
    reason: "runtime workflow requisitions",
    predicate: `(${FIXTURE_PREDICATES.requisitions}) OR notes ILIKE '%workflow proof%' OR notes ILIKE 'AP workflow smoke test%' OR justification ILIKE 'Runtime dependency proof%'`,
  },
  {
    table: "purchase_orders",
    reason: "purchase orders converted from runtime workflow requisitions",
    predicate: `(${FIXTURE_PREDICATES.purchaseOrders}) OR requisition_id IN (SELECT id FROM purchase_requisitions WHERE (${FIXTURE_PREDICATES.requisitions}) OR notes ILIKE '%workflow proof%' OR notes ILIKE 'AP workflow smoke test%' OR justification ILIKE 'Runtime dependency proof%')`,
  },
  {
    table: "invoices",
    reason: "AP runtime and browser invoices",
    predicate: FIXTURE_PREDICATES.invoices,
  },
  {
    table: "ap_payment_batches",
    reason: "payment batches containing only AP runtime fixture invoices",
    predicate: `EXISTS (
        SELECT 1 FROM ap_payment_batch_items item
        JOIN invoices invoice ON invoice.id = item.invoice_id
        WHERE item.batch_id = ap_payment_batches.id
          AND invoice.invoice_number ~ '^(AP-INV-|AP-CTRL-|AP-DUP-|INV-MATCH-ap-|INV-UI-MATCH-uie2e-ap-)'
      ) AND NOT EXISTS (
        SELECT 1 FROM ap_payment_batch_items item
        JOIN invoices invoice ON invoice.id = item.invoice_id
        WHERE item.batch_id = ap_payment_batches.id
          AND invoice.invoice_number !~ '^(AP-INV-|AP-CTRL-|AP-DUP-|INV-MATCH-ap-|INV-UI-MATCH-uie2e-ap-)'
      )`,
  },
  {
    table: "ap_payment_batch_items",
    reason: "payment batch lines for AP runtime fixture invoices",
    predicate: `invoice_id IN (
        SELECT id FROM invoices
        WHERE invoice_number ~ '^(AP-INV-|AP-CTRL-|AP-DUP-|INV-MATCH-ap-|INV-UI-MATCH-uie2e-ap-)'
      )`,
  },
  { table: "inventory_items", reason: "dependency/workflow items", predicate: FIXTURE_PREDICATES.inventoryItems },
  { table: "suppliers", reason: "dependency/workflow suppliers", predicate: FIXTURE_PREDICATES.suppliers },
  { table: "departments", reason: "dependency/workflow departments", predicate: "name ~ '^(Dependency|Workflow|Runtime|Propagation|Sourcing) Department '" },
  // `warehouses` intentionally uses `name`; this table has no `code` column.
  { table: "warehouses", reason: "workflow warehouses", predicate: FIXTURE_PREDICATES.warehouses },
  { table: "units_of_measure", reason: "dependency/workflow UOMs", predicate: FIXTURE_PREDICATES.unitsOfMeasure },
  { table: "tax_codes", reason: "dependency/workflow tax codes", predicate: FIXTURE_PREDICATES.taxCodes },
  { table: "mdm_cost_centres", reason: "dependency/workflow cost centres", predicate: FIXTURE_PREDICATES.costCentres },
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
    reason: "duplicate notifications (newest copy retained) and AP fixture notifications",
    predicate: `(id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (
            PARTITION BY organization_id, user_id, type, title, COALESCE(body, ''), COALESCE(entity_type, ''), COALESCE(entity_id, 0)
            ORDER BY created_at DESC, id DESC
          ) AS duplicate_number
          FROM notifications
        ) duplicates WHERE duplicate_number > 1
      )
      OR (
        type IN ('ap_invoice_approved', 'ap_invoice_pending_approval')
        AND entity_type = 'invoice'
        AND (
          entity_id IN (
            SELECT id FROM invoices
            WHERE invoice_number ~ '^(AP-INV-|AP-CTRL-|AP-DUP-|INV-MATCH-ap-|INV-UI-MATCH-uie2e-ap-)'
          )
          OR NOT EXISTS (
            SELECT 1 FROM invoices
            WHERE invoices.id = notifications.entity_id
              AND invoices.organization_id = notifications.organization_id
          )
        )
      ))`,
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

async function tableHasColumn(table: string, column: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2) AS exists`,
    [table, column],
  );
  return result.rows[0]?.exists === true;
}

async function targetIds(definition: TargetDefinition, tenantId: number): Promise<number[]> {
  if (!(await tableExists(definition.table))) return [];
  let tenantPredicate = "TRUE";
  if (await tableHasColumn(definition.table, "organization_id")) {
    tenantPredicate = "organization_id = $1";
  } else if (definition.table === "users") {
    tenantPredicate = "EXISTS (SELECT 1 FROM organization_members fixture_member WHERE fixture_member.user_id = users.id AND fixture_member.organization_id = $1)";
  } else if (definition.table === "ap_payment_batch_items") {
    tenantPredicate = "EXISTS (SELECT 1 FROM invoices fixture_invoice WHERE fixture_invoice.id = ap_payment_batch_items.invoice_id AND fixture_invoice.organization_id = $1)";
  } else if (definition.table === "mdm_change_request_steps" || definition.table === "mdm_change_request_comments") {
    tenantPredicate = `EXISTS (SELECT 1 FROM mdm_change_requests fixture_request WHERE fixture_request.id = ${quoteIdentifier(definition.table)}.change_request_id AND fixture_request.organization_id = $1)`;
  }
  const result = await pool.query(
    `SELECT id FROM ${quoteIdentifier(definition.table)} WHERE (${definition.predicate}) AND (${tenantPredicate}) ORDER BY id`,
    tenantPredicate === "TRUE" ? [] : [tenantId],
  );
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
  const requestedTenantId = Number(argument("tenant-id"));
  let tenantId = Number.isInteger(requestedTenantId) && requestedTenantId > 0 ? requestedTenantId : 0;
  if (!tenantId) {
    const organizations = await pool.query<{ id: number }>("SELECT id FROM organizations WHERE active IS DISTINCT FROM FALSE ORDER BY id LIMIT 2");
    if (organizations.rows.length !== 1) {
      throw new Error("Fixture audit is tenant-scoped. Supply --tenant-id=<organization id> when more than one organization exists.");
    }
    tenantId = Number(organizations.rows[0].id);
  }

  for (const definition of targets) {
    const ids = await targetIds(definition, tenantId);
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
    tenantId,
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
