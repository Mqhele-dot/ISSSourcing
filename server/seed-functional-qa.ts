/**
 * Deterministic QA seed: SKU-A–D, PO-FQA-*, AP invoices INV-FQA-*.
 * Run after main seed: npx tsx server/seed-functional-qa.ts
 */
import { pool } from "./db";

const ORG_ID = 1;

async function ensureAdminUserId(): Promise<number> {
  const r = await pool.query<{ id: number }>("SELECT id FROM users ORDER BY id LIMIT 1");
  const id = r.rows[0]?.id;
  if (!id) throw new Error("seed-functional-qa: no users — run main seed first");
  return id;
}

async function upsertCategory(name: string): Promise<number> {
  const ins = await pool.query<{ id: number }>(
    `INSERT INTO categories (organization_id, name, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
    [ORG_ID, name, "Functional QA seed"],
  );
  if (ins.rows[0]?.id) return ins.rows[0].id;
  const sel = await pool.query<{ id: number }>(
    "SELECT id FROM categories WHERE organization_id = $1 AND name = $2",
    [ORG_ID, name],
  );
  return sel.rows[0]?.id ?? 0;
}

async function upsertWarehouseCity(name: string): Promise<void> {
  await pool.query(
    `INSERT INTO warehouses (organization_id, name, is_default, created_at, updated_at)
     VALUES ($1, $2, false, now(), now())
     ON CONFLICT (organization_id, name) DO NOTHING`,
    [ORG_ID, name],
  );
}

async function upsertItemWithPosition(payload: {
  sku: string;
  name: string;
  categoryId: number;
  defaultLocation: string;
  lowStockThreshold: number;
  onHand: number;
  allocated: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO inventory_items (
       organization_id, name, sku, category_id, quantity, price, cost,
       low_stock_threshold, default_location, location, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 10, 5, $6, $7, $7, 'active', now(), now())
     ON CONFLICT (organization_id, sku) DO UPDATE SET
       category_id = EXCLUDED.category_id,
       low_stock_threshold = EXCLUDED.low_stock_threshold,
       default_location = EXCLUDED.default_location,
       location = EXCLUDED.location,
       updated_at = now()`,
    [ORG_ID, payload.name, payload.sku, payload.categoryId, payload.onHand, payload.lowStockThreshold, payload.defaultLocation],
  );

  await pool.query(
    `INSERT INTO inventory_positions (sku, location, on_hand, allocated, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (sku, location) DO UPDATE SET
       on_hand = EXCLUDED.on_hand,
       allocated = EXCLUDED.allocated,
       updated_at = now()`,
    [payload.sku, payload.defaultLocation, payload.onHand, payload.allocated],
  );
}

export async function seedFunctionalQA(): Promise<void> {
  await ensureAdminUserId();
  const catElec = await upsertCategory("Electronics");
  const catCons = await upsertCategory("Consumables");
  await upsertWarehouseCity("Johannesburg");
  await upsertWarehouseCity("Cape Town");
  await upsertWarehouseCity("Durban");

  await upsertItemWithPosition({
    sku: "SKU-A",
    name: "QA Item A",
    categoryId: catElec,
    defaultLocation: "Johannesburg",
    lowStockThreshold: 5,
    onHand: 10,
    allocated: 3,
  });
  await upsertItemWithPosition({
    sku: "SKU-B",
    name: "QA Item B",
    categoryId: catElec,
    defaultLocation: "Cape Town",
    lowStockThreshold: 5,
    onHand: 4,
    allocated: 1,
  });
  await upsertItemWithPosition({
    sku: "SKU-C",
    name: "QA Item C",
    categoryId: catCons,
    defaultLocation: "Durban",
    lowStockThreshold: 5,
    onHand: 20,
    allocated: 0,
  });
  await upsertItemWithPosition({
    sku: "SKU-D",
    name: "QA Item D",
    categoryId: catCons,
    defaultLocation: "Johannesburg",
    lowStockThreshold: 1,
    onHand: 0,
    allocated: 2,
  });

  const sup = await pool.query<{ id: number }>("SELECT id FROM suppliers WHERE organization_id = $1 ORDER BY id LIMIT 1", [
    ORG_ID,
  ]);
  const supplierId = sup.rows[0]?.id;
  if (supplierId) {
    for (const row of [
      { num: "PO-FQA-001", status: "draft", total: 1000 },
      { num: "PO-FQA-002", status: "approved", total: 2500 },
      { num: "PO-FQA-003", status: "received", total: 500 },
    ] as const) {
      await pool.query(
        `INSERT INTO purchase_orders (organization_id, order_number, supplier_id, status, order_date, total_amount, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), $5, now(), now())
         ON CONFLICT (organization_id, order_number) DO UPDATE SET
           status = EXCLUDED.status,
           total_amount = EXCLUDED.total_amount,
           updated_at = now()`,
        [ORG_ID, row.num, supplierId, row.status, row.total],
      );
    }
  }

  const adminId = await ensureAdminUserId();
  const due = new Date();
  due.setDate(due.getDate() + 30);
  for (const inv of [
    { num: "INV-FQA-001", total: 1000, due: 1000 as number | null },
    { num: "INV-FQA-002", total: 500, due: 250 as number | null },
    { num: "INV-FQA-003", total: 300, due: null as number | null },
  ]) {
    await pool.query(
      `INSERT INTO invoices (
         organization_id, invoice_number, supplier_id, status, issue_date, due_date,
         subtotal, total, paid_amount, due_amount, created_by, created_at, updated_at
       ) VALUES ($1, $2, $3, 'APPROVED', now(), $4, $5, $5, 0, $6, $7, now(), now())
       ON CONFLICT (organization_id, invoice_number) DO UPDATE SET
         total = EXCLUDED.total,
         due_amount = EXCLUDED.due_amount,
         status = 'APPROVED',
         updated_at = now()`,
      [ORG_ID, inv.num, supplierId ?? null, due, inv.total, inv.due, adminId],
    );
  }
}

async function main() {
  await seedFunctionalQA();
  console.log("seed-functional-qa: completed");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
