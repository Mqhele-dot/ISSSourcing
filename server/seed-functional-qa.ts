/**
 * Deterministic QA seed: SKU-A–D, PO-FQA-* (+ lines), REQ-FQA-001, AP invoices INV-FQA-*.
 * Run after main seed: npm run seed:functional-qa
 * Idempotent: upserts headers, replaces FQA PO lines, upserts requisition.
 */
import {
  FQA_PO_001_HEADER_TOTAL,
  FQA_PO_001_LINES,
  FQA_REQUISITION_NUMBER,
  FQA_REQUISITION_STATUS,
} from "../shared/functional-qa-constants.ts";
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
      { num: "PO-FQA-001", status: "draft", total: FQA_PO_001_HEADER_TOTAL },
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

    const itemA = await pool.query<{ id: number }>(
      "SELECT id FROM inventory_items WHERE organization_id = $1 AND sku = 'SKU-A' LIMIT 1",
      [ORG_ID],
    );
    const itemId = itemA.rows[0]?.id;
    if (itemId) {
      await pool.query(
        `DELETE FROM purchase_order_items
         WHERE order_id IN (
           SELECT id FROM purchase_orders WHERE organization_id = $1 AND order_number LIKE 'PO-FQA%'
         )`,
        [ORG_ID],
      );

      const poRows = await pool.query<{ id: number; order_number: string }>(
        `SELECT id, order_number FROM purchase_orders WHERE organization_id = $1 AND order_number LIKE 'PO-FQA%' ORDER BY order_number`,
        [ORG_ID],
      );
      const byNum = new Map(poRows.rows.map((r) => [r.order_number, r.id]));

      const insLine = async (orderNumber: string, qty: number, unit: number, received: number) => {
        const oid = byNum.get(orderNumber);
        if (!oid) return;
        const total = qty * unit;
        await pool.query(
          `INSERT INTO purchase_order_items (order_id, item_id, quantity, unit_price, total_price, received_quantity)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [oid, itemId, qty, unit, total, received],
        );
      };

      for (const line of FQA_PO_001_LINES) {
        await insLine("PO-FQA-001", line.quantity, line.unitPrice, 0);
      }
      await insLine("PO-FQA-002", 15, 100, 0);
      await insLine("PO-FQA-002", 10, 100, 0);
      await insLine("PO-FQA-003", 5, 100, 5);
    }
  }

  const adminForReq = await ensureAdminUserId();
  const reqExisting = await pool.query<{ id: number }>(
    "SELECT id FROM purchase_requisitions WHERE organization_id = $1 AND requisition_number = $2",
    [ORG_ID, FQA_REQUISITION_NUMBER],
  );
  if (reqExisting.rows[0]?.id) {
    await pool.query(
      `UPDATE purchase_requisitions SET
         status = $1, requestor_id = $2, notes = $3, updated_at = now()
       WHERE id = $4`,
      [FQA_REQUISITION_STATUS, adminForReq, "Functional QA seed", reqExisting.rows[0].id],
    );
  } else {
    await pool.query(
      `INSERT INTO purchase_requisitions (
         organization_id, requisition_number, requestor_id, status, total_amount, notes, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
      [ORG_ID, FQA_REQUISITION_NUMBER, adminForReq, FQA_REQUISITION_STATUS, 0, "Functional QA seed"],
    );
  }

  const adminId = await ensureAdminUserId();
  const due = new Date();
  due.setDate(due.getDate() + 30);
  for (const inv of [
    { num: "INV-FQA-001", total: 1000, due: 1000 as number | null },
    { num: "INV-FQA-002", total: 500, due: 250 as number | null },
    { num: "INV-FQA-003", total: 300, due: null as number | null },
  ]) {
    const existing = await pool.query<{ id: number }>(
      "SELECT id FROM invoices WHERE organization_id = $1 AND invoice_number = $2",
      [ORG_ID, inv.num],
    );
    if (existing.rows[0]?.id) {
      await pool.query(
        `UPDATE invoices SET
           supplier_id = COALESCE($1, supplier_id),
           status = 'APPROVED',
           issue_date = now(),
           due_date = $2,
           subtotal = $3,
           total = $3,
           paid_amount = 0,
           due_amount = $4,
           updated_at = now()
         WHERE id = $5`,
        [supplierId ?? null, due, inv.total, inv.due, existing.rows[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO invoices (
           organization_id, invoice_number, supplier_id, status, issue_date, due_date,
           subtotal, total, paid_amount, due_amount, created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, 'APPROVED', now(), $4, $5, $5, 0, $6, $7, now(), now())`,
        [ORG_ID, inv.num, supplierId ?? null, due, inv.total, inv.due, adminId],
      );
    }
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
