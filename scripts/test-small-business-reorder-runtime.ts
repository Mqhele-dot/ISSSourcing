import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import { config } from "dotenv";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";

config({ quiet: true });
if (!process.argv.includes("--local-disposable")) throw new Error("This test requires a disposable local database.");
const configured = process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/postgres`
  : undefined);
assert.ok(configured, "DATABASE_URL is required.");
const url = new URL(configured);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only local PostgreSQL is allowed.");
const name = `iss_reorder_test_${randomUUID().replaceAll("-", "")}`;
url.pathname = "/postgres";
const owner = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
let created = false;
let server: ReturnType<express.Express["listen"]> | undefined;
let pool: pg.Pool | undefined;
try {
  await owner.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  assertDisposableDatabaseUrl(url.toString());
  process.env.TEST_DATABASE_URL = url.toString();
  process.env.DATABASE_URL = url.toString();
  const database = await import("../server/db");
  pool = database.pool;
  await pool.query(`
    CREATE TABLE organizations(id integer PRIMARY KEY);
    CREATE TABLE users(id integer PRIMARY KEY, warehouse_id integer);
    CREATE TABLE organization_members(id serial PRIMARY KEY, organization_id integer, user_id integer, active boolean, status text);
    CREATE TABLE inventory_items(id integer PRIMARY KEY, organization_id integer, sku text, name text, created_at timestamp, cost numeric, price numeric, safety_hold boolean, lead_time integer, reorder_point integer, low_stock_threshold integer, status text);
    CREATE TABLE warehouse_inventory(id serial PRIMARY KEY, organization_id integer, item_id integer, quantity integer);
    CREATE TABLE inventory_allocations(id serial PRIMARY KEY, organization_id integer, item_id integer, quantity integer, status text);
    CREATE TABLE stock_movements(id serial PRIMARY KEY, organization_id integer, item_id integer, quantity integer, type text, timestamp timestamp, reference_type text);
    CREATE TABLE purchase_orders(id integer PRIMARY KEY, organization_id integer, status text, approval_status text);
    CREATE TABLE purchase_order_items(id integer PRIMARY KEY, order_id integer, item_id integer, line_type text, quantity integer, received_quantity integer);
    CREATE TABLE reorder_requests(id serial PRIMARY KEY, organization_id integer, request_number text, item_id integer, quantity integer, requestor_id integer, status text, notes text, request_date timestamp);
    CREATE TABLE audit_logs(id serial PRIMARY KEY, organization_id integer, user_id integer, action text, resource_type text, resource_id integer, details jsonb, reason text, previous_hash text, event_hash text, hash_version integer, request_id text, ip_address text, user_agent text, created_at timestamp);
    INSERT INTO organizations VALUES(1),(2);
    INSERT INTO users VALUES(1,NULL);
    INSERT INTO organization_members(organization_id,user_id,active,status) VALUES(1,1,true,'active');
    INSERT INTO inventory_items VALUES(10,1,'TEST-10','Test item',now()-interval '90 days',10,12,false,0,10,10,'active'),(20,2,'FOREIGN','Foreign item',now()-interval '90 days',10,12,false,0,10,10,'active');
    INSERT INTO warehouse_inventory(organization_id,item_id,quantity) VALUES(1,10,2);
    CREATE TABLE warehouses(id integer PRIMARY KEY, organization_id integer, location text);
    INSERT INTO warehouses VALUES(1,1,'Test warehouse'),(2,2,'Foreign warehouse');
    ALTER TABLE inventory_items ADD COLUMN quantity numeric DEFAULT 0,ADD COLUMN category_id integer,
      ADD COLUMN supplier_id integer,ADD COLUMN expiry_date date,ADD COLUMN default_location text,
      ADD COLUMN location text,ADD COLUMN updated_at timestamp DEFAULT now();
    ALTER TABLE warehouse_inventory ADD COLUMN warehouse_id integer DEFAULT 1,ADD COLUMN location text,
      ADD COLUMN updated_at timestamp DEFAULT now();
    ALTER TABLE inventory_allocations ADD COLUMN warehouse_id integer;
    UPDATE inventory_items SET quantity=2 WHERE id=10;
  `);
  const { registerPlanningRoutes } = await import("../server/modules/reorder/register-planning-routes");
  const { runWithTenantContext } = await import("../server/organization-context");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { user: { id: 1 } });
    runWithTenantContext({ organizationId: 1, membershipId: 1, userId: 1, userRole: "admin", membershipRole: "admin", effectivePermissions: [], correlationId: "reorder-test" }, next);
  });
  registerPlanningRoutes(app, { ensureAuthenticated: (_req, _res, next) => next(), ensurePermission: () => (_req, _res, next) => next() });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const post = async (itemId: number, lookbackDays = 90) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v2/inventory/reorder-suggestions/${itemId}/request`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lookbackDays }),
    });
    return { status: response.status, body: await response.json() as { data?: { quantity: number } } };
  };
  const first = await post(10);
  assert.equal(first.status, 201);
  assert.equal(first.body.data?.quantity, 8);
  assert.equal((await post(10)).status, 409, "Repeat must not create another pending request.");
  assert.equal((await post(20)).status, 409, "A foreign-tenant item cannot be requested.");
  assert.equal(Number((await pool.query("SELECT count(*) n FROM reorder_requests WHERE organization_id=1")).rows[0].n), 1);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM audit_logs WHERE action='REORDER_REQUEST_FROM_SUGGESTION'")).rows[0].n), 1);
  await pool.query("ALTER TABLE warehouse_inventory ALTER COLUMN quantity TYPE numeric");
  await pool.query("ALTER TABLE inventory_allocations ALTER COLUMN quantity TYPE numeric");
  await pool.query(`INSERT INTO inventory_items(id,organization_id,sku,name,created_at,lead_time,reorder_point,low_stock_threshold,status,safety_hold)
    VALUES(30,1,'DECIMAL','Decimal evidence',now()-interval '90 days',0,99,1,'active',false);
    INSERT INTO warehouse_inventory(organization_id,item_id,quantity) VALUES(1,30,0.3);
    INSERT INTO inventory_allocations(organization_id,item_id,quantity,status) VALUES(1,30,0.1,'reserved')`);
  const list = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v2/inventory/reorder-suggestions?pageSize=25`);
    assert.equal(response.status,200);
    return (await response.json()).data;
  };
  const decimal = (await list()).items.find((item: {id:number})=>item.id===30);
  assert.equal(Number(decimal.availableNow),0.2);
  assert.equal(Number(decimal.targetQuantity),1,"Explicit low-stock threshold overrides reorder point");
  assert.equal((await post(30)).body.data?.quantity,1);
  await pool.query(`INSERT INTO inventory_items(id,organization_id,sku,name,created_at,lead_time,reorder_point,low_stock_threshold,status,safety_hold)
    SELECT n,1,'VOLUME-'||n,'Volume item',now()-interval '90 days',0,1,1,'active',false FROM generate_series(100,5100) n`);
  const volume = await list();
  assert.equal(volume.total,5003,"Authoritative totals include more than 5,000 eligible items");
  assert.equal(volume.items.length,25,"Rendering payload remains bounded");
  await pool.query(`INSERT INTO inventory_items(id,organization_id,sku,name,created_at,quantity,lead_time,reorder_point,low_stock_threshold,status,safety_hold)
    VALUES(40,1,'HELD','Held evidence',now()-interval '120 days',10,0,20,20,'active',true),
      (50,1,'LEGACY','Unassigned evidence',now()-interval '120 days',4.2,0,10,10,'active',false),
      (60,1,'NEGATIVE','Negative evidence',now()-interval '120 days',-1,0,1,1,'active',false),
      (70,1,'INACTIVE','Inactive evidence',now()-interval '120 days',0,0,20,20,'inactive',false);
    INSERT INTO warehouse_inventory(organization_id,item_id,quantity) VALUES(1,40,10),(1,60,-1);
    INSERT INTO inventory_allocations(organization_id,item_id,quantity,status) VALUES(1,40,2,'reserved'),(1,50,0.2,'reserved');`);
  const {INVENTORY_BASE_SQL,operationalStockBaseSql}=await import('../server/modules/inventory/operational-stock-query');
  const canonical=await pool.query(`${INVENTORY_BASE_SQL} SELECT id,available::text AS available FROM base WHERE id IN (30,40,50,60)`,[1]);
  const suggestions=await list();
  for(const id of [30,50,60]) {
    const row=suggestions.items.find((item:{id:number})=>item.id===id);
    assert.equal(row.availableNow,canonical.rows.find(item=>item.id===id)?.available,`Planning must match canonical operational availability for ${id}`);
  }
  assert.ok(!suggestions.items.some((item:{id:number})=>[40,70].includes(item.id)),"Held and inactive items cannot become reorder suggestions");
  const legacy=suggestions.items.find((item:{id:number})=>item.id===50);
  assert.equal(legacy.unassignedQuantity,'4.2',"Unassigned stock is disclosed, not assigned to an invented warehouse");
  assert.equal(legacy.availableNow,'4.0');
  assert.equal((await post(50,45)).body.data?.quantity,6,"Every supported lookback can convert using the same stock basis");
  assert.equal((await post(40)).status,409,"Safety holds prevent suggestion conversion");
  assert.equal((await post(60,29)).status,400,"Invalid lookback periods remain blocked");
  const slowResponse=await fetch(`http://127.0.0.1:${port}/api/v2/inventory/slow-moving?pageSize=25`);
  assert.equal(slowResponse.status,200);
  const held=(await slowResponse.json()).data.items.find((item:{id:number})=>item.id===40);
  assert.equal(held.availableNow,'0',"Slow-moving stock must not describe held quantities as available");
  const warehouse=await pool.query(`${operationalStockBaseSql(2)} SELECT incomplete_reservation_evidence FROM base WHERE id=50`,[1,1]);
  assert.equal(warehouse.rows[0].incomplete_reservation_evidence,true,"Warehouse scope must disclose unattributed reservations");
  console.log("Reorder runtime passed: shared stock/hold/fractional/legacy parity, 5,000+ totals, supported lookbacks, duplicate guard, tenant isolation and audit evidence.");
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  if (created) {
    assert.match(name, /^iss_reorder_test_[a-f0-9]{32}$/);
    await owner.query(`DROP DATABASE "${name}"`);
  }
  await owner.end();
}
