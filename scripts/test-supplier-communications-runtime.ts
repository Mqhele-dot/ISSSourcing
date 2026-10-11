import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import { config } from "dotenv";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";

config({ quiet: true });
if (!process.argv.includes("--local-disposable")) throw new Error("Use --local-disposable; this test never runs against application data.");
const configured = process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/postgres`
  : undefined);
assert.ok(configured, "Local PostgreSQL configuration is required.");
const url = new URL(configured);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only local PostgreSQL is allowed.");
const name = `iss_supplier_comms_test_${randomUUID().replaceAll("-", "")}`;
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
    CREATE TABLE users(id integer PRIMARY KEY);
    CREATE TABLE suppliers(id integer PRIMARY KEY, organization_id integer);
    CREATE TABLE sourcing_invitations(id integer PRIMARY KEY, organization_id integer, supplier_id integer, event_id integer, invited_at timestamp, status text, invited_by_user_id integer);
    CREATE TABLE supplier_quotes(id integer PRIMARY KEY, organization_id integer, supplier_id integer, event_id integer, created_at timestamp, status text, submitted_by_user_id integer);
    CREATE TABLE purchase_orders(id integer PRIMARY KEY, organization_id integer, supplier_id integer, order_number text, email_sent_date timestamp, created_at timestamp, created_by_user_id integer);
    CREATE TABLE supplier_communication_events(id serial PRIMARY KEY, organization_id integer, supplier_id integer, source_type text, source_id integer, channel text, status text, recipient text, error_summary text, actor_user_id integer, idempotency_key text, occurred_at timestamp DEFAULT now());
    CREATE UNIQUE INDEX supplier_communication_events_idempotency ON supplier_communication_events(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE po_supplier_confirmations(id integer PRIMARY KEY, organization_id integer, supplier_id integer, purchase_order_id integer, created_at timestamp, status text, actor_user_id integer);
    CREATE TABLE documents(id integer PRIMARY KEY, organization_id integer, entity_type text, entity_id integer, file_name text, uploaded_at timestamp, uploaded_by integer, archived_at timestamp);
    CREATE TABLE supplier_communication_notes(id serial PRIMARY KEY, organization_id integer, supplier_id integer, actor_user_id integer, occurred_at timestamp DEFAULT now(), channel text, summary text, document_id integer);
    CREATE TABLE audit_logs(id serial PRIMARY KEY, organization_id integer, user_id integer, action text, resource_type text, resource_id integer, details jsonb, reason text, previous_hash text, event_hash text, hash_version integer, request_id text, ip_address text, user_agent text, created_at timestamp);
    INSERT INTO organizations VALUES(1),(2);
    INSERT INTO users VALUES(1),(2);
    INSERT INTO suppliers VALUES(10,1),(20,2);
    INSERT INTO documents(id,organization_id,entity_type,entity_id,file_name,uploaded_at) VALUES
      (100,1,'supplier',10,'scope.pdf',now()),(200,2,'supplier',20,'foreign.pdf',now());
    INSERT INTO sourcing_invitations VALUES(1,1,10,30,now(),'INVITED',1);
    INSERT INTO supplier_communication_events(organization_id,supplier_id,source_type,source_id,channel,status,actor_user_id)
      VALUES(1,10,'sourcing_event',30,'email','failed',1);
  `);
  const { registerSupplierRoutes } = await import("../server/modules/suppliers/register-supplier-routes");
  const { runWithTenantContext } = await import("../server/organization-context");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const organizationId = Number(req.get("Organization") ?? 1);
    Object.assign(req, { user: { id: organizationId, role: "admin" } });
    runWithTenantContext({ organizationId, membershipId: organizationId, userId: organizationId, userRole: "admin", membershipRole: "admin", effectivePermissions: [], correlationId: "supplier-comms-test" }, next);
  });
  const allow = (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
  const checkPermission = (req: express.Request, res: express.Response, next: express.NextFunction) => req.get("Deny") === "1" ? res.status(403).json({ error: { code: "PERMISSION_DENIED" } }) : next();
  const auth = { ensureAuthenticated: allow, ensureTwoFactorAuthenticated: allow, ensureRole: () => allow, ensurePermission: () => checkPermission } as any;
  registerSupplierRoutes(app, auth);
  const { registerSourcingRoutes } = await import("../server/modules/sourcing/register-sourcing-routes");
  let deliveryCalls = 0;
  let rejectNext = false;
  registerSourcingRoutes(app, auth, {
    previewInvitationEmails: async (organizationId: number, eventId: number) => {
      const supplierId = organizationId === 1 ? 10 : 20;
      const portalPath = `/procurement/supplier-portal?event=${eventId}`;
      return { event: { id: eventId, eventNumber: `RFQ-${eventId}`, title: "Disposable test RFQ", status: "OPEN", deadline: new Date(Date.now() + (eventId === 33 ? -1 : 86400000)), reportingCurrencyCode: "ZAR" },
        portalPath, previews: [{ supplierId, supplierName: "Mock supplier", to: eventId === 34 ? null : "supplier@example.test", recipientState: "ready", subject: "RFQ invitation", text: `Open ${portalPath}`, html: `<a href="${portalPath}">Open</a>` }] } as any;
    },
    sendInvitationEmail: async (options) => {
      deliveryCalls++;
      assert.equal(options.to, "supplier@example.test");
      assert.match(options.text ?? "", /http:\/\/127\.0\.0\.1/);
      if (rejectNext) { rejectNext = false; return { success: false, error: new Error("mock provider rejected") }; }
      return { success: true, info: { messageId: `mock-${deliveryCalls}` } };
    },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const call = async (path: string, method = "GET", body?: unknown, organizationId = 1, headers: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Organization: String(organizationId), "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as any };
  };
  const initial = await call("/api/v2/suppliers/10/communications");
  assert.equal(initial.status, 200, JSON.stringify(initial.body));
  assert.ok(initial.body.data.items.some((row: { summary: string }) => row.summary.includes("RFQ invitation email — failed")));
  const foreignDocument = await call("/api/v2/suppliers/10/communications/notes", "POST", { channel: "phone", summary: "Discussed pricing", documentId: 200 });
  assert.equal(foreignDocument.status, 400, "Foreign supplier document must be denied.");
  const note = await call("/api/v2/suppliers/10/communications/notes", "POST", { channel: "phone", summary: "Discussed pricing", documentId: 100 });
  assert.equal(note.status, 201, JSON.stringify(note.body));
  const timeline = await call("/api/v2/suppliers/10/communications");
  assert.equal(timeline.body.data.items.find((row: { kind: string }) => row.kind === "contact_note")?.documentId, 100);
  assert.equal((await call("/api/v2/suppliers/10/communications", "GET", undefined, 2)).status, 404, "Other tenant cannot read supplier timeline.");
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM audit_logs WHERE organization_id=1 AND action='SUPPLIER_CONTACT_LOGGED'")).rows[0].n), 1);
  const invitationPath = (eventId: number) => `/api/sourcing/events/${eventId}/invitations/10/send`;
  const send = (eventId: number, key: string, organizationId = 1, headers: Record<string, string> = {}) =>
    call(invitationPath(eventId), "POST", {}, organizationId, { "Idempotency-Key": key, ...headers });
  delete process.env.EMAIL_HOST;
  delete process.env.EMAIL_USER;
  delete process.env.EMAIL_PASS;
  process.env.BASE_URL = `http://127.0.0.1:${port}`;
  assert.equal((await send(30, "runtime-unconfigured-30")).status, 503, "Unconfigured email must not claim delivery.");
  assert.equal(deliveryCalls, 0);
  process.env.EMAIL_HOST = "mock.provider.test";
  process.env.EMAIL_USER = "mock-user";
  process.env.EMAIL_PASS = "mock-secret";
  assert.equal((await send(30, "runtime-denied-30", 1, { Deny: "1" })).status, 403);
  assert.equal((await send(30, "runtime-foreign-30", 2)).status, 404);
  assert.equal((await send(33, "runtime-expired-33")).status, 409);
  assert.equal((await send(34, "runtime-missing-email-34")).status, 409);
  assert.equal(deliveryCalls, 0, "Denied and invalid invitations must not call the provider.");
  const accepted = await send(30, "runtime-accepted-30");
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.status, "sent");
  const replay = await send(30, "runtime-accepted-30");
  assert.equal(replay.body.data.duplicate, true);
  assert.equal((await send(30, "runtime-duplicate-30")).status, 409);
  rejectNext = true;
  assert.equal((await send(31, "runtime-rejected-31")).status, 502);
  const retry = await send(31, "runtime-retry-31");
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(deliveryCalls, 3, "One accepted, one rejected, and one retried provider call expected.");
  const attempts = await pool.query("SELECT source_id,status FROM supplier_communication_events WHERE organization_id=1 AND idempotency_key IS NOT NULL ORDER BY id");
  assert.deepEqual(attempts.rows.map((row) => row.status), ["sent", "failed", "sent"]);
  assert.equal((await call("/api/v2/suppliers/10/communications")).body.data.items.some((row: { summary: string }) => row.summary.includes("RFQ invitation email — failed")), true);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM audit_logs WHERE organization_id=1 AND action='RFQ_INVITATION_EMAIL_QUEUED'")).rows[0].n), 3);
  console.log("Supplier communication runtime passed: provider-mocked RFQ delivery, retries, denial, tenant isolation, timeline, and audit trail.");
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  if (created) {
    assert.match(name, /^iss_supplier_comms_test_[a-f0-9]{32}$/);
    await owner.query(`DROP DATABASE "${name}"`);
    console.log("Removed test-owned disposable supplier database; application data was not changed.");
  }
  await owner.end();
}
