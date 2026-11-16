import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { assertMatchedDisposableDatabaseUrls } from "../server/config/database-safety";

config({ quiet: true });
if (!process.argv.includes("--local-disposable")) throw new Error("Use --local-disposable; no business database may be tested.");
const configured = process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/postgres`
  : undefined);
assert.ok(configured, "A local PostgreSQL connection is required.");
const target = new URL(configured);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
target.pathname = "/postgres";
const owner = new pg.Pool({ connectionString: target.toString(), connectionTimeoutMillis: 5000 });
const name = `iss_supplier_360_test_${randomUUID().replaceAll("-", "")}`;
let created = false, database: pg.Pool | undefined, server: ReturnType<express.Express["listen"]> | undefined;
try {
  await owner.query(`CREATE DATABASE "${name}"`); created = true;
  target.pathname = `/${name}`;
  process.env.DATABASE_URL = target.toString(); process.env.TEST_DATABASE_URL = target.toString();
  assert.equal(assertMatchedDisposableDatabaseUrls(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL), name);
  database = (await import("../server/db")).pool;
  assert.equal((await database.query("SELECT current_database() AS name")).rows[0].name, name);
  await database.query(`CREATE TABLE organizations(id int PRIMARY KEY,active boolean);
    CREATE TABLE users(id int PRIMARY KEY,active boolean,warehouse_id int);
    CREATE TABLE organization_members(id int PRIMARY KEY,organization_id int,user_id int,active boolean,status text);
    CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int);
    CREATE TABLE purchase_orders(id int PRIMARY KEY,organization_id int,supplier_id int,order_number text,
      order_date timestamp,updated_at timestamp,expected_delivery_date timestamp,approval_status text,status text);
    CREATE TABLE ap_receipts(id int PRIMARY KEY,organization_id int,supplier_id int,purchase_order_id int,status text,received_date timestamp);
    CREATE TABLE ap_receipt_items(id int PRIMARY KEY,receipt_id int,accepted_quantity real);
    INSERT INTO organizations VALUES(1,true),(2,true);
    INSERT INTO users VALUES(1,true,null),(2,true,null),(3,true,9);
    INSERT INTO organization_members VALUES(1,1,1,true,'active'),(2,2,2,true,'active'),(3,1,3,true,'active');
    INSERT INTO suppliers VALUES(10,1),(20,2),(30,1),(40,1);
    INSERT INTO purchase_orders SELECT n,1,10,'PO-'||n,'2026-01-01','2026-01-02',
      CASE WHEN n%4=0 THEN null ELSE '2026-01-10'::timestamp END,' approved ',' sent '
      FROM generate_series(1,5000) n;
    INSERT INTO ap_receipts SELECT n,1,10,n,CASE WHEN n%4=3 THEN 'REVERSED' ELSE 'POSTED' END,
      CASE WHEN n%4=1 THEN '2026-01-09'::timestamp ELSE '2026-01-11'::timestamp END
      FROM generate_series(1,5000) n;
    INSERT INTO ap_receipt_items SELECT n,n,2 FROM generate_series(1,5000) n;
    INSERT INTO ap_receipt_items SELECT n+5000,n,3 FROM generate_series(1,5000) n;
    INSERT INTO purchase_orders VALUES
      (6001,2,20,'FOREIGN','2026-01-01','2026-01-02','2026-01-10','APPROVED','SENT'),
      (6002,1,10,'DRAFT','2026-01-01','2026-01-02','2026-01-10','DRAFT','DRAFT'),
      (6003,1,10,'CANCELLED','2026-01-01','2026-01-02','2026-01-10','APPROVED','CANCELLED'),
      (6004,1,10,'UNKNOWN','2026-01-01','2026-01-02','2026-01-10','APPROVED','CUSTOM_UNKNOWN'),
      (6005,1,10,'FUTURE','2999-01-01','2026-01-02','2999-01-10','APPROVED','SENT'),
      (6006,1,40,'NO-EVIDENCE','2026-01-01','2026-01-02',null,'APPROVED','SENT');
    INSERT INTO ap_receipts VALUES(6001,2,10,3,'POSTED','2026-01-01'),
      (6002,1,20,3,'POSTED','2026-01-01'),(6003,1,10,3,'POSTED','2999-01-01'),
      (6004,1,10,3,'POSTED','2026-01-01');
    INSERT INTO ap_receipt_items VALUES(11001,6001,5),(11002,6002,5),(11003,6003,5),(11004,6004,0);
    ALTER TABLE ap_receipts ADD COLUMN updated_at timestamp NOT NULL DEFAULT now();
    CREATE TABLE audit_logs(id serial PRIMARY KEY, organization_id int, user_id int, action text, resource_type text, resource_id int, details jsonb, reason text, previous_hash text, event_hash text, hash_version int, request_id text, ip_address text, user_agent text, created_at timestamp);`);
  const migration = await readFile("migrations/20261108090000_supplier_observations.sql", "utf8");
  await database.query(migration); await database.query(migration);
  const { runWithTenantContext } = await import("../server/organization-context");
  const { registerSupplierDeliveryScorecardRoutes } = await import("../server/modules/suppliers/register-delivery-scorecard-routes");
  const { readSupplierDeliveryScorecard, supplierDeliveryQuery } = await import("../server/modules/suppliers/delivery-scorecard");
  const probe = await database.connect();
  try {
    await probe.query("SET statement_timeout='5s'");
    await readSupplierDeliveryScorecard(probe, 1, 10, supplierDeliveryQuery.parse({}));
  }
  finally { probe.release(); }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const org = Number(req.get("Test-Organization") ?? 1), user = Number(req.get("Test-User") ?? org);
    runWithTenantContext({ organizationId: org, membershipId: user, userId: user, userRole: "admin", membershipRole: "admin", effectivePermissions: [], correlationId: "supplier-scorecard-runtime" }, next);
  });
  const pass: express.RequestHandler = (_req, _res, next) => next();
  registerSupplierDeliveryScorecardRoutes(app, {
    ensureAuthenticated: (req, res, next) => req.get("Test-Unauthenticated") ? res.sendStatus(401) : next(),
    ensurePermission: resource => (req, res, next) => req.get("Test-Deny") === resource ? res.sendStatus(403) : next(),
    ensureRole: () => pass, ensureTwoFactorAuthenticated: pass,
  });
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v2/suppliers`;
  const call = async (id = 10, query = "", headers: Record<string, string> = {}) => {
    const response = await fetch(`${root}/${id}/delivery-scorecard${query}`, { headers });
    return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
  };
  const initial = await call();
  assert.equal(initial.status, 200);
  const data = initial.body.data;
  assert.deepEqual([data.total, data.measured, data.onTime, data.late, data.missingPromise, data.missingReceipt], [5000, 2500, 1250, 1250, 1250, 1250]);
  assert.equal(data.onTimePercent, "50.0"); assert.equal(data.state, "partial");
  assert.equal(data.items.length, 25); assert.equal(data.items[0].purchaseOrderId, 5000);
  assert.equal(data.items[24].purchaseOrderId, 4976);
  assert.match(data.limitation, /not a historical snapshot/);
  assert.equal((await call(10, "?page=2")).body.data.items[0].purchaseOrderId, 4975);
  for (const pageSize of [25, 50, 100]) assert.equal((await call(10, `?pageSize=${pageSize}`)).body.data.items.length, pageSize);
  assert.equal((await call(10, "?page=999")).body.data.total, 5000);
  assert.deepEqual((await call(10, "?page=999")).body.data.items, []);
  assert.equal((await call(10, "?from=2026-01-02")).body.data.state, "empty");
  assert.equal((await call(10, "?from=2026-01-01&to=2026-01-01")).body.data.total, 5000);
  assert.equal((await call(30)).body.data.state, "empty");
  assert.equal((await call(40)).body.data.state, "insufficient_evidence");
  assert.equal((await call(40)).body.data.onTimePercent, null);
  for (const query of ["?from=0000-01-01", "?from=2026-02-30", "?from=2026-03-01&to=2026-02-01", "?pageSize=5000", "?page=0", "?asOf=2026-01-01", "?supplierId=20", "?from=2026-01-01&from=2026-01-02"]) assert.equal((await call(10, query)).status, 400, query);
  assert.equal((await call(2147483648)).status, 400);
  assert.equal((await call(10, "", { "Test-Unauthenticated": "1" })).status, 401);
  for (const resource of ["suppliers", "purchases", "inventory"]) assert.equal((await call(10, "", { "Test-Deny": resource })).status, 403);
  assert.equal((await call(20)).status, 404);
  assert.equal((await call(10, "", { "Test-Organization": "2" })).status, 404);
  assert.equal((await call(10, "", { "Test-User": "3" })).status, 403, "Assigned warehouse cannot read an organization-wide score.");
  await database.query("UPDATE organization_members SET active=false WHERE id=1");
  assert.equal((await call()).status, 403);
  await database.query("UPDATE organization_members SET active=true WHERE id=1");
  await database.query("UPDATE users SET active=false WHERE id=1"); assert.equal((await call()).status, 403);
  await database.query("UPDATE users SET active=true WHERE id=1");
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let queryCount = 0;
    const counted = { query: (...args: Parameters<typeof client.query>) => { queryCount++; return client.query(...args); } } as unknown as pg.PoolClient;
    const result = await readSupplierDeliveryScorecard(counted, 1, 10, supplierDeliveryQuery.parse({}));
    assert.equal(result.total, 5000); assert.equal(queryCount, 1, "One aggregation; no per-row query loop.");
    await client.query("COMMIT");
  } finally { client.release(); }
  await database.query("ALTER TABLE ap_receipts RENAME TO unavailable_receipts");
  const failed = await call(); assert.equal(failed.status, 503);
  assert.match(failed.body.error.requestId, /^[a-f0-9-]{36}$/);
  assert.ok(!JSON.stringify(failed.body).includes("unavailable_receipts"));
  await database.query("ALTER TABLE unavailable_receipts RENAME TO ap_receipts");
  assert.equal((await call()).status, 200, "Retry after repair succeeds.");
  const key = randomUUID(), observationRoot = `${root}/10/delivery-observations`;
  const save = (id: string, filters = {}) => fetch(observationRoot, { method: "POST", headers: { "Idempotency-Key": id, "Content-Type": "application/json" }, body: JSON.stringify(filters) });
  await database.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_capture CHECK(action <> 'SUPPLIER_DELIVERY_OBSERVATION_SAVED')");
  assert.equal((await save(key)).status, 503);
  assert.equal((await database.query("SELECT count(*) FROM supplier_delivery_observations")).rows[0].count, "0");
  await database.query("ALTER TABLE audit_logs DROP CONSTRAINT reject_capture");
  assert.equal((await save(key)).status, 201);
  assert.equal((await save(key)).status, 200);
  assert.equal((await save(key, { from: "2026-01-01" })).status, 409);
  const open = (headers = {}) => fetch(`${observationRoot}/${key}?pageSize=100`, { headers });
  const before = (await (await open()).json()).data;
  assert.equal(before.total, 5000); assert.equal(before.items.length, 100);
  assert.ok(before.items.some((row: { receiptId: number | null }) => row.receiptId !== null));
  await database.query("UPDATE purchase_orders SET expected_delivery_date='2026-01-01',updated_at=now() WHERE organization_id=1 AND supplier_id=10");
  assert.notEqual((await call()).body.data.onTime, before.onTime);
  assert.deepEqual((await (await open()).json()).data, before, "Saved results do not recalculate on source change.");
  await assert.rejects(() => database!.query("DELETE FROM supplier_delivery_observations"), /immutable/);
  assert.equal((await open({ "Test-Deny": "inventory" })).status, 403);
  assert.equal((await open({ "Test-Organization": "2" })).status, 404);
  assert.equal((await open({ "Test-User": "3" })).status, 403);
  await database.query("UPDATE organization_members SET active=false WHERE id=1");
  assert.equal((await open()).status, 403);
  await database.query("UPDATE organization_members SET active=true WHERE id=1; UPDATE purchase_orders SET supplier_id=30 WHERE id=1");
  assert.equal((await open()).status, 403, "A source outside the requested page still prevents reopening.");
  assert.equal((await database.query("SELECT count(*) FROM audit_logs WHERE action='SUPPLIER_DELIVERY_OBSERVATION_SAVED'")).rows[0].count, "1");
  assert.equal(Number((await database.query("SELECT count(*) FROM purchase_orders")).rows[0].count), 5006);
  console.log(`PASS Supplier 360 delivery: 5000 orders; immutable historical capture, source changes, revoked access, atomic rollback and replay; bounded live evidence and pagination. Database: ${name}`);
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  if (database) await database.end();
  if (created) { assert.match(name, /^iss_supplier_360_test_[a-f0-9]{32}$/); await owner.query(`DROP DATABASE "${name}"`); console.log(`Removed exact disposable database ${name}; business data unchanged.`); }
  await owner.end();
}
