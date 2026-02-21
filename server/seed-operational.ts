/**
 * Seeds operational workflow tables so Purchase Orders, Shipments, Exceptions,
 * Integrations, and Control Tower have visible demo data.
 * Run after main seed (or demo:reset). Safe to run multiple times; only inserts when empty.
 *
 * Usage: npx tsx server/seed-operational.ts
 */
import { pool } from "./db";
import { initializeOperationalData } from "./operations-core";

async function count(table: string): Promise<number> {
  const r = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(r.rows[0]?.count ?? "0");
}

export async function seedOperationalIfEmpty(): Promise<{
  purchaseOrders: number;
  shipments: number;
  exceptions: number;
  integrationRuns: number;
  activity: number;
}> {
  await initializeOperationalData();

  const poCount = await count("purchase_orders");
  const shipmentCount = await count("shipments");
  const exceptionCount = await count("operational_exceptions");
  const runsCount = await count("integration_runs");
  const activityCount = await count("ops_activity");

  if (poCount === 0) {
    const [supplier] = (await pool.query<{ id: number }>("SELECT id FROM suppliers ORDER BY id LIMIT 1")).rows;
    const items = (await pool.query<{ id: number; sku: string; price: number }>(
      "SELECT id, sku, price FROM inventory_items ORDER BY id LIMIT 5",
    )).rows;
    if (supplier && items.length >= 2) {
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const orderNumber = `PO-DEMO-${now}-${i + 1}`;
        const status = i === 0 ? "approved" : i === 1 ? "sent" : "received";
        const total = items.slice(0, 2).reduce((sum, it) => sum + (Number(it.price) || 10) * 5, 0);
        const poInsert = await pool.query<{ id: number }>(
          `INSERT INTO purchase_orders (order_number, supplier_id, status, order_date, total_amount, created_at, updated_at)
           VALUES ($1, $2, $3, now(), $4, now(), now())
           RETURNING id`,
          [orderNumber, supplier.id, status, total],
        );
        const orderId = poInsert.rows[0]?.id;
        if (orderId) {
          for (const it of items.slice(0, 2)) {
            const qty = 5;
            const unitPrice = Number(it.price) || 10;
            await pool.query(
              `INSERT INTO purchase_order_items (order_id, item_id, quantity, unit_price, total_price, received_quantity)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [orderId, it.id, qty, unitPrice, qty * unitPrice, status === "received" ? qty : 0],
            );
          }
        }
      }
    }
  }

  if ((await count("shipments")) === 0) {
    const pos = (await pool.query<{ order_number: string }>("SELECT order_number FROM purchase_orders ORDER BY id LIMIT 3")).rows;
    for (const row of pos) {
      await pool.query(
        `INSERT INTO shipments (po_number, carrier, status, eta, created_at, updated_at)
         VALUES ($1, 'Demo Carrier', 'in_transit', now() + interval '2 days', now(), now())`,
        [row.order_number],
      );
    }
  }

  if (exceptionCount === 0) {
    await pool.query(
      `INSERT INTO operational_exceptions (type, severity, status, title, description, related_refs, sla_hours)
       VALUES
         ('shortage', 'medium', 'open', 'Low stock alert', 'Demo open exception', '{"po":"PO-DEMO-1"}'::jsonb, 24),
         ('mismatch', 'low', 'resolved', 'Receive quantity mismatch', 'Demo resolved', '{}'::jsonb, 48)`,
    );
  }

  if (runsCount === 0) {
    await pool.query(
      `INSERT INTO integration_runs (connector, status, started_at, finished_at, message)
       VALUES
         ('erp', 'success', now() - interval '1 hour', now(), 'Sync completed'),
         ('wms', 'success', now() - interval '2 hours', now() - interval '1 hour', 'OK')`,
    );
  }

  if (activityCount === 0) {
    const actions = [
      { event_type: "created", title: "Purchase order created", details: "PO-DEMO" },
      { event_type: "received", title: "Shipment received", details: "Partial receive" },
      { event_type: "exception_created", title: "Exception created", details: "Shortage" },
      { event_type: "created", title: "PO approved", details: "Approval" },
      { event_type: "status_change", title: "Shipment in transit", details: "Carrier" },
      { event_type: "resolved", title: "Exception resolved", details: "Mismatch" },
      { event_type: "created", title: "Integration run", details: "ERP sync" },
      { event_type: "received", title: "Stock receipt", details: "Warehouse" },
      { event_type: "exception_created", title: "Low stock", details: "Alert" },
      { event_type: "status_change", title: "PO sent", details: "Supplier" },
    ];
    for (const a of actions) {
      await pool.query(
        `INSERT INTO ops_activity (created_at, actor, entity_type, entity_id, action, summary_json)
         VALUES (now(), 'system', 'demo', '1', $1, $2::jsonb)`,
        [a.event_type, JSON.stringify({ title: a.title, details: a.details })],
      );
    }
  }

  return {
    purchaseOrders: await count("purchase_orders"),
    shipments: await count("shipments"),
    exceptions: await count("operational_exceptions"),
    integrationRuns: await count("integration_runs"),
    activity: await count("ops_activity"),
  };
}

async function run() {
  try {
    const summary = await seedOperationalIfEmpty();
    console.log("Operational seed complete:", summary);
  } catch (err) {
    console.error("Operational seed failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
