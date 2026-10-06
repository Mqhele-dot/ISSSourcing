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
  const post = async (itemId: number) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v2/inventory/reorder-suggestions/${itemId}/request`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lookbackDays: 90 }),
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
  console.log("Reorder suggestion runtime passed: recalculation, duplicate guard, tenant isolation and audit evidence.");
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  if (created) {
    assert.match(name, /^iss_reorder_test_[a-f0-9]{32}$/);
    await owner.query(`DROP DATABASE "${name}"`);
  }
  await owner.end();
}
