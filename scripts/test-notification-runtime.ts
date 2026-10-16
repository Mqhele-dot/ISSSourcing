import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import { config } from "dotenv";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";

config({ quiet: true });
if (!process.argv.includes("--local-disposable")) throw new Error("Use --local-disposable; this test never runs against the application database.");
const configured = process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/postgres`
  : undefined);
assert.ok(configured, "DATABASE_URL is required to create a local disposable test database.");
const url = new URL(configured);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only local PostgreSQL is allowed.");
const name = `iss_notification_test_${randomUUID().replaceAll("-", "")}`;
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
  process.env.DISABLE_NOTIFICATION_EMAIL = "true";
  process.env.DISABLE_NOTIFICATION_SMS = "true";
  const database = await import("../server/db");
  pool = database.pool;
  await pool.query(`
    CREATE TABLE organizations(id integer PRIMARY KEY, timezone text);
    CREATE TABLE users(id integer PRIMARY KEY, email text, phone text);
    CREATE TABLE organization_members(id serial PRIMARY KEY, organization_id integer, user_id integer, application_role text, active boolean, status text);
    CREATE TABLE notification_preferences(id serial PRIMARY KEY, user_id integer UNIQUE, email_enabled boolean DEFAULT true, sms_enabled boolean DEFAULT false, in_app_enabled boolean DEFAULT true, low_stock boolean DEFAULT true, approval_request boolean DEFAULT true, contract_expiry boolean DEFAULT true, shipment_delay boolean DEFAULT true, daily_digest_enabled boolean DEFAULT false, reminder_enabled boolean DEFAULT true, updated_at timestamp DEFAULT now());
    CREATE TABLE notifications(id serial PRIMARY KEY, organization_id integer, user_id integer, type text, title text, body text, entity_type text, entity_id integer, target_path text, finding_code text, due_at timestamp, priority text DEFAULT 'normal', occurrence_count integer DEFAULT 1, last_occurred_at timestamp DEFAULT now(), read_at timestamp, archived_at timestamp, created_at timestamp DEFAULT now());
    CREATE TABLE purchase_requisitions(id integer PRIMARY KEY, organization_id integer, status text);
    CREATE TABLE purchase_orders(id integer PRIMARY KEY, organization_id integer, approval_status text);
    CREATE TABLE invoices(id integer PRIMARY KEY, organization_id integer, status text);
    CREATE TABLE inventory_items(id integer PRIMARY KEY, organization_id integer, name text, quantity integer, low_stock_threshold integer);
    CREATE TABLE warehouses(id integer PRIMARY KEY, organization_id integer, name text);
    CREATE TABLE inventory_putaway_tasks(id integer PRIMARY KEY, organization_id integer, item_id integer, warehouse_id integer, assigned_user_id integer, task_number text, quantity numeric, priority text, due_at timestamp, updated_at timestamp DEFAULT now(), status text);
    CREATE TABLE supplier_contracts(id integer PRIMARY KEY, organization_id integer, status text, end_date timestamp);
    CREATE TABLE suppliers(id integer PRIMARY KEY, organization_id integer, insurance_expiry timestamp);
    CREATE TABLE notification_delivery_keys(organization_id integer, user_id integer, delivery_key text, claimed_at timestamp NOT NULL DEFAULT now(), completed_at timestamp, PRIMARY KEY(organization_id,user_id,delivery_key));
    INSERT INTO organizations VALUES(1),(2);
    INSERT INTO users(id,email) VALUES(1,'admin-one@example.test'),(2,'viewer-one@example.test'),(3,'admin-two@example.test');
    INSERT INTO organization_members(organization_id,user_id,application_role,active,status) VALUES(1,1,'admin',true,'active'),(1,2,'viewer',true,'active'),(2,3,'admin',true,'active');
    INSERT INTO notifications(organization_id,user_id,type,title,read_at)
      SELECT 1,1,'test','Notice ' || n,CASE WHEN n <= 9 THEN NULL ELSE now() END FROM generate_series(1,12) n;
    INSERT INTO notifications(organization_id,user_id,type,title) VALUES(2,3,'test','Foreign notice');
  `);
  const { registerNotificationRoutes } = await import("../server/modules/notifications/register-notification-routes");
  const { emitNotificationToRoles } = await import("../server/services/notification-emitter");
  const { runWithTenantContext } = await import("../server/organization-context");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = Number(req.get("Actor") ?? 1);
    const organizationId = actor === 3 ? 2 : 1;
    Object.assign(req, { user: { id: actor } });
    runWithTenantContext({ organizationId, membershipId: actor, userId: actor, userRole: actor === 2 ? "viewer" : "admin", membershipRole: actor === 2 ? "viewer" : "admin", effectivePermissions: [], correlationId: "notification-test" }, next);
  });
  registerNotificationRoutes(app, { ensureAuthenticated: (_req, _res, next) => next(), ensureRole: () => (_req, _res, next) => next() } as any);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const call = async (path: string, method = "GET", actor = 1) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Actor: String(actor) } });
    return { status: response.status, body: await response.json() as any };
  };
  const initial = await call("/api/notifications?page=1&pageSize=8");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.data.items.length, 8);
  assert.equal(initial.body.data.total, 12);
  assert.equal(initial.body.data.unreadCount, 9);
  const id = initial.body.data.items[0].id;
  assert.equal((await call(`/api/notifications/${id}/archive`, "POST", 3)).status, 404);
  assert.equal((await call(`/api/notifications/${id}/archive`, "POST")).status, 200);
  assert.equal((await call("/api/notifications?page=1&pageSize=8")).body.data.total, 11);
  assert.equal((await call("/api/notifications/mark-all-read", "POST")).status, 200);
  const read = (await call("/api/notifications?page=1&pageSize=8")).body.data;
  assert.equal(read.unreadCount, 0);
  assert.equal(read.total, 11);
  assert.equal((await call("/api/notifications/archive-read", "POST")).status, 200);
  const empty = (await call("/api/notifications?page=1&pageSize=8")).body.data;
  assert.equal(empty.total, 0);
  assert.equal(empty.unreadCount, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM notifications WHERE organization_id=1 AND user_id=1")).rows[0].n, 12, "Archiving must preserve history.");
  const emitAlert = (body: string) => runWithTenantContext({ organizationId: 1, membershipId: 1, userId: 1, userRole: "admin", membershipRole: "admin", effectivePermissions: [], correlationId: "notification-test" },
    () => emitNotificationToRoles(["admin"], { type: "test", title: "Tenant-only alert", body }));
  await emitAlert("Condition unchanged");
  assert.equal((await pool.query("SELECT count(*)::int n FROM notifications WHERE title='Tenant-only alert' AND organization_id=1 AND user_id=1")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM notifications WHERE title='Tenant-only alert' AND (organization_id=2 OR user_id=2)")).rows[0].n, 0);
  const alertId = (await call("/api/notifications")).body.data.items[0].id;
  assert.equal((await call(`/api/notifications/${alertId}/read`, "POST")).status, 200);
  await emitAlert("Condition unchanged");
  assert.equal((await call("/api/notifications")).body.data.unreadCount, 0, "Identical events must not reopen read alerts.");
  assert.equal((await call(`/api/notifications/${alertId}/archive`, "POST")).status, 200);
  await emitAlert("Condition unchanged");
  assert.equal((await call("/api/notifications")).body.data.total, 0, "Identical events must not resurrect cleared alerts.");
  await emitAlert("Condition changed");
  assert.equal((await call("/api/notifications")).body.data.unreadCount, 1, "Materially changed evidence should create a new alert.");
  await pool.query(`INSERT INTO purchase_requisitions(id,organization_id,status) VALUES(41,1,'PENDING_APPROVAL');
    INSERT INTO notifications(organization_id,user_id,type,title,entity_type,entity_id,due_at,priority)
      VALUES(1,1,'approval_request','Approve requisition','requisition',41,now()+interval '1 day','high');`);
  let inbox = (await call("/api/v2/action-inbox?state=active")).body.data;
  assert.equal(inbox.items.some((item: { entityId: number }) => item.entityId === 41), true, "Pending requisition must appear as an active action.");
  const actionId = inbox.items.find((item: { entityId: number }) => item.entityId === 41).id;
  assert.equal((await call(`/api/notifications/${String(actionId).split(":")[1]}/archive`, "POST")).status, 200);
  inbox = (await call("/api/v2/action-inbox?state=active")).body.data;
  assert.equal(inbox.items.some((item: { entityId: number }) => item.entityId === 41), true, "Clearing the alert must not complete the underlying approval.");
  await pool.query("UPDATE purchase_requisitions SET status='APPROVED' WHERE id=41");
  inbox = (await call("/api/v2/action-inbox?state=active")).body.data;
  assert.equal(inbox.items.some((item: { entityId: number }) => item.entityId === 41), false, "Approved work must leave the active inbox.");
  const history = (await call("/api/v2/action-inbox?state=history")).body.data;
  assert.equal(history.items.some((item: { entityId: number; state: string }) => item.entityId === 41 && item.state === "completed"), true);
  await pool.query(`INSERT INTO inventory_items(id,organization_id,name,quantity) VALUES(7,1,'Test item',20);
    INSERT INTO warehouses(id,organization_id,name) VALUES(8,1,'Test warehouse');
    INSERT INTO inventory_putaway_tasks(id,organization_id,item_id,warehouse_id,assigned_user_id,task_number,quantity,priority,status)
      VALUES(9,1,7,8,1,'PA-TEST-9',3,'HIGH','ASSIGNED'),(10,1,7,8,2,'PA-TEST-10',2,'NORMAL','ASSIGNED');`);
  inbox = (await call("/api/v2/action-inbox?state=active")).body.data;
  assert.equal(inbox.items.some((item: { id: string }) => item.id === "putaway:9"), true, "Assigned work must appear without any notification.");
  assert.equal(inbox.items.some((item: { id: string }) => item.id === "putaway:10"), false, "Another user's assigned work must remain private.");
  await pool.query("UPDATE inventory_putaway_tasks SET status='COMPLETED' WHERE id=9");
  inbox = (await call("/api/v2/action-inbox?state=active")).body.data;
  assert.equal(inbox.items.some((item: { id: string }) => item.id === "putaway:9"), false, "Completing the source task must close the inbox action.");
  await pool.query(`INSERT INTO purchase_requisitions(id,organization_id,status) VALUES(42,1,'PENDING_APPROVAL');
    INSERT INTO notifications(organization_id,user_id,type,title,entity_type,entity_id,due_at,priority)
      VALUES(1,1,'approval_request','Review requisition due tomorrow','requisition',42,now()+interval '12 hours','high');`);
  const { runActionInboxDeliveryCycle } = await import("../server/services/action-inbox-worker");
  const before = Number((await pool.query("SELECT count(*) n FROM notifications WHERE type='due_reminder' AND organization_id=1")).rows[0].n);
  await runActionInboxDeliveryCycle();
  await runActionInboxDeliveryCycle();
  const after = Number((await pool.query("SELECT count(*) n FROM notifications WHERE type='due_reminder' AND organization_id=1")).rows[0].n);
  assert.equal(after - before, 1, "Due reminders must be deduplicated across worker retries.");
  assert.equal(Number((await pool.query("SELECT count(*) n FROM notification_delivery_keys WHERE completed_at IS NOT NULL")).rows[0].n), 1);
  await pool.query(`INSERT INTO inventory_putaway_tasks(id,organization_id,item_id,warehouse_id,assigned_user_id,task_number,quantity,priority,due_at,status)
    VALUES(11,1,7,8,1,'PA-DUE-11',1,'HIGH',now()+interval '12 hours','ASSIGNED')`);
  await runActionInboxDeliveryCycle();
  await runActionInboxDeliveryCycle();
  assert.equal(Number((await pool.query("SELECT count(*) n FROM notifications WHERE type='putaway_reminder' AND organization_id=1 AND user_id=1")).rows[0].n), 1,
    "Assigned put-away reminders must deduplicate.");
  await pool.query("UPDATE inventory_putaway_tasks SET status='COMPLETED' WHERE id=11");
  assert.equal((await call("/api/v2/action-inbox?state=active")).body.data.items.some((item: { id: string }) => item.id === "putaway:11"), false);
  console.log("Notification runtime passed: full unread count, archive history, repeat suppression, changed-event alerting, tenant isolation, role targeting and action-state propagation.");
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  if (created) {
    assert.match(name, /^iss_notification_test_[a-f0-9]{32}$/);
    await owner.query(`DROP DATABASE "${name}"`);
    console.log("Removed the test-owned disposable database; application data was not changed.");
  }
  await owner.end();
}
