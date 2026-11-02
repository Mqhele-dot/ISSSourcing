import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  url.pathname = `/${name}`;
  assertDisposableDatabaseUrl(url.toString());
  await owner.query(`CREATE DATABASE "${name}"`);
  created = true;
  console.log(`Created test-owned notification database ${name}.`);
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
  const { emitNotificationToRoles,notificationEmailOptedIn } = await import("../server/services/notification-emitter");
  assert.equal(notificationEmailOptedIn("diagnostic_transition"),false);
  assert.equal(notificationEmailOptedIn("diagnostic_transition",{emailEnabled:true}),true);
  assert.equal(notificationEmailOptedIn("diagnostic_daily_summary",{emailEnabled:true}),false);
  assert.equal(notificationEmailOptedIn("diagnostic_daily_summary",{emailEnabled:false,dailyDigestEnabled:true}),false);
  assert.equal(notificationEmailOptedIn("diagnostic_daily_summary",{emailEnabled:true,dailyDigestEnabled:true}),true);
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
  const diagnosticPayload = {type:"diagnostic_transition",title:"Diagnostic retry proof",body:"Open Diagnostics",
    deliveryKey:"diagnostic-intent:runtime-proof",targetPath:"/admin/system-diagnostics"};
  const diagnosticContext = {organizationId:1,membershipId:1,userId:1,userRole:"admin",membershipRole:"admin",
    effectivePermissions:[],correlationId:"diagnostic-retry-proof"};
  await Promise.all(Array.from({length:5},()=>runWithTenantContext(diagnosticContext,
    ()=>emitNotificationToRoles(["admin"],diagnosticPayload))));
  assert.equal(Number((await pool.query("SELECT count(*) n FROM notifications WHERE title='Diagnostic retry proof'")).rows[0].n),1);
  await runWithTenantContext(diagnosticContext,()=>emitNotificationToRoles(["admin"],diagnosticPayload));
  assert.equal(Number((await pool.query("SELECT occurrence_count n FROM notifications WHERE title='Diagnostic retry proof'")).rows[0].n),1);
  await pool.query("UPDATE organization_members SET active=false WHERE organization_id=1 AND user_id=1");
  await runWithTenantContext(diagnosticContext,()=>emitNotificationToRoles(["admin"],{...diagnosticPayload,deliveryKey:"diagnostic-intent:revoked",title:"Revoked diagnostic"}));
  assert.equal(Number((await pool.query("SELECT count(*) n FROM notifications WHERE title='Revoked diagnostic'")).rows[0].n),0);
  await pool.query("ALTER TABLE organizations ADD COLUMN active boolean NOT NULL DEFAULT true");
  for (const file of ["20261018090000_durable_diagnostic_findings.sql","20261018100000_diagnostic_schedules.sql","20261018110000_diagnostic_delivery_and_ingestion.sql"]) {
    await pool.query(await readFile(new URL(`../migrations/${file}`,import.meta.url),"utf8"));
  }
  await pool.query("UPDATE organizations SET timezone='Africa/Johannesburg' WHERE id=1; UPDATE organizations SET timezone='America/New_York' WHERE id=2");
  const { generateDiagnosticDailySummaries, deliverDiagnosticNotificationIntents,readDiagnosticDailySummaries } = await import("../server/diagnostics/diagnostic-delivery");
  const observation = new Date("2026-10-22T06:01:00Z");
  await Promise.all([generateDiagnosticDailySummaries(observation),generateDiagnosticDailySummaries(observation)]);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM diagnostic_daily_summaries WHERE organization_id=1")).rows[0].n),1);
  const summaryView=await readDiagnosticDailySummaries(1,1,25);
  assert.equal(summaryView.items[0].localDate,"2026-10-22","Summary calendar dates must not serialize as UTC timestamps");
  assert.equal(summaryView.items[0].timezone,"Africa/Johannesburg");
  assert.ok(summaryView.items[0].generatedAt,"Summary must expose its immutable cutoff");
  assert.equal(Number((await pool.query("SELECT count(*) n FROM diagnostic_daily_summaries WHERE organization_id=2")).rows[0].n),0,"Before local 08:00 does not generate");
  await generateDiagnosticDailySummaries(new Date("2026-10-22T15:00:00Z"));
  assert.equal(Number((await pool.query("SELECT count(*) n FROM diagnostic_daily_summaries WHERE organization_id=2")).rows[0].n),1,"Current-date catch-up generates once");
  assert.equal(Number((await pool.query("SELECT count(*) n FROM diagnostic_notification_intents WHERE transition='daily_summary'")).rows[0].n),2);
  await pool.query("UPDATE organization_members SET active=true WHERE organization_id=1 AND user_id=1");
  await Promise.all([deliverDiagnosticNotificationIntents(),deliverDiagnosticNotificationIntents()]);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM notifications WHERE type='diagnostic_daily_summary'")).rows[0].n),2);
  await pool.query("UPDATE diagnostic_notification_intents SET delivered_at=NULL");
  await deliverDiagnosticNotificationIntents();
  assert.equal(Number((await pool.query("SELECT count(*) n FROM notifications WHERE type='diagnostic_daily_summary'")).rows[0].n),2,"Replay after delivery/ack gap must not duplicate recipient notifications");
  await pool.query("CREATE TABLE permissions(id serial PRIMARY KEY,role text,resource text,permission_type text)");
  await pool.query("UPDATE organization_members SET application_role='viewer' WHERE organization_id=1 AND user_id=1");
  assert.equal((await call("/api/notifications")).body.data.items.some((item:{type:string})=>item.type==='diagnostic_daily_summary'),false,"Demoted administrators cannot view technical diagnostic alerts");
  const {diagnosticDeliveryHealthSql,evaluateDiagnosticDeliveryHealth}=await import("../server/diagnostics/delivery-health");
  const {persistDiagnosticChecks}=await import("../server/diagnostics/persistent-findings");
  const deliveryHealth=async(org:number)=>evaluateDiagnosticDeliveryHealth((await pool!.query(diagnosticDeliveryHealthSql,[org])).rows);
  assert.equal((await deliveryHealth(9000)).status,"not_exercised","No recipient delivery evidence must not be reported as healthy");
  assert.equal(evaluateDiagnosticDeliveryHealth([{observed:"1",queued:"1",failed:"0",overdue:"0",delivered:"0"}]).status,"not_exercised");
  assert.equal(evaluateDiagnosticDeliveryHealth([{observed:"1",queued:"1",failed:"0",overdue:"1",delivered:"0"}]).status,"degraded");
  assert.equal(evaluateDiagnosticDeliveryHealth([{observed:"1",queued:"0",failed:"0",overdue:"0",delivered:"0"}]).status,"not_exercised","Processing a queue with no eligible recipients is not proof of inbox delivery");
  await pool.query("UPDATE organization_members SET application_role='admin' WHERE organization_id=1 AND user_id=1");
  const proof=(await pool.query(`INSERT INTO diagnostic_notification_intents(organization_id,finding_key,transition,transition_key,payload)
    VALUES(1,'test:delivery-proof','opened',$1,$2::jsonb) RETURNING id`,[randomUUID(),JSON.stringify({title:"Isolated delivery failure",message:"Test-owned retry proof",targetRoute:"/admin/system-diagnostics"})])).rows[0];
  await pool.query(`CREATE FUNCTION reject_test_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.title='Isolated delivery failure' THEN RAISE EXCEPTION 'Injected inbox insertion failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_delivery BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION reject_test_delivery()`);
  await deliverDiagnosticNotificationIntents();
  const deliveryFinding=async()=>(await pool!.query(`SELECT lifecycle,consecutive_passes FROM diagnostic_persistent_findings
    WHERE organization_id=1 AND finding_key='notifications:DIAGNOSTIC_DELIVERY:diagnostic-delivery'`)).rows[0];
  assert.equal((await deliveryFinding()).lifecycle,"open","A failed background delivery must create durable finding evidence immediately");
  assert.equal((await deliveryHealth(1)).status,"failed");
  assert.equal((await deliveryHealth(2)).status,"working","Another tenant's queue must not be degraded by this failure");
  await pool.query("DROP TRIGGER reject_test_delivery ON notifications; DROP FUNCTION reject_test_delivery()");
  await Promise.all([deliverDiagnosticNotificationIntents(),deliverDiagnosticNotificationIntents()]);
  assert.ok((await pool.query("SELECT delivered_at FROM diagnostic_notification_intents WHERE id=$1",[proof.id])).rows[0].delivered_at);
  assert.equal((await pool.query("SELECT count(*)::int n FROM notifications WHERE organization_id=1 AND user_id=1 AND title='Isolated delivery failure'")).rows[0].n,1);
  const observeDelivery=async(scheduled:boolean)=>{
    const client=await pool!.connect();
    try{await client.query("BEGIN");
      const check=evaluateDiagnosticDeliveryHealth((await client.query(diagnosticDeliveryHealthSql,[1])).rows);
      assert.equal(check.status,"working");await persistDiagnosticChecks(client,1,randomUUID(),[check],1,scheduled);await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  };
  await observeDelivery(false);assert.equal((await deliveryFinding()).consecutive_passes,0);
  await observeDelivery(true);assert.equal((await deliveryFinding()).lifecycle,"open");
  await observeDelivery(true);assert.equal((await deliveryFinding()).lifecycle,"resolved");
  await pool.query("UPDATE organization_members SET application_role='viewer' WHERE organization_id=1 AND user_id=1");
  console.log("Delivery worker health passed: actual insertion failure, immediate durable capture, tenant isolation, retry deduplication and two scheduled queue checks.");
  // A failed summary transaction must leave independent failure evidence, not a
  // fabricated summary or an apparently successful daily notification.
  await pool.query(`CREATE FUNCTION reject_test_summary() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.organization_id=1 AND NEW.local_date IN ('2026-10-23'::date,'2026-10-24'::date) THEN RAISE EXCEPTION 'Injected summary write failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_summary BEFORE INSERT ON diagnostic_daily_summaries FOR EACH ROW EXECUTE FUNCTION reject_test_summary()`);
  await pool.query(`CREATE FUNCTION reject_test_capture() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected diagnostic persistence failure'; END $$;
    CREATE TRIGGER reject_test_capture BEFORE INSERT ON diagnostic_check_runs FOR EACH ROW EXECUTE FUNCTION reject_test_capture()`);
  await generateDiagnosticDailySummaries(new Date("2026-10-23T06:01:00Z"));
  const {captureGapFinding}=await import("../server/diagnostics/durable-events");
  assert.ok(captureGapFinding(1),"A failure to persist failure evidence must retain an in-memory capture gap");
  await pool.query("DROP TRIGGER reject_test_capture ON diagnostic_check_runs; DROP FUNCTION reject_test_capture()");
  const {runDiagnosticMonitoringCycle}=await import("../server/diagnostics/monitoring-worker");
  await runDiagnosticMonitoringCycle({database:pool,collect:async()=>[]});
  assert.equal(captureGapFinding(1),null,"A successful monitoring cycle surfaces the gap without requiring another error");
  assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_persistent_findings WHERE organization_id=1 AND finding_key='backend:DIAGNOSTIC_CAPTURE_GAP:diagnostic-capture'")).rows[0].n,1);
  const failedObservation=new Date("2026-10-24T06:01:00Z");
  await generateDiagnosticDailySummaries(failedObservation);
  assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_daily_summaries WHERE organization_id=1 AND local_date='2026-10-24'")).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_check_runs WHERE organization_id=1 AND outcome='failed' AND error_code='DIAGNOSTIC_SUMMARY_GENERATION_FAILED'")).rows[0].n,1);
  const summaryFailure=async()=>(await pool!.query(`SELECT lifecycle,consecutive_passes FROM diagnostic_persistent_findings
    WHERE organization_id=1 AND finding_key='notifications:DAILY_SUMMARY_GENERATION:1'`)).rows[0];
  assert.equal((await summaryFailure()).lifecycle,"open");
  await pool.query("DROP TRIGGER reject_test_summary ON diagnostic_daily_summaries; DROP FUNCTION reject_test_summary()");
  await generateDiagnosticDailySummaries(failedObservation);
  assert.equal((await summaryFailure()).consecutive_passes,0,"Manual retry can save a summary, but cannot accelerate transient recovery");
  const frozenSummary=(await pool.query("SELECT * FROM diagnostic_daily_summaries WHERE organization_id=1 AND local_date='2026-10-24'")).rows[0];
  await generateDiagnosticDailySummaries(failedObservation,{scheduled:true});
  assert.equal((await summaryFailure()).lifecycle,"open");
  await generateDiagnosticDailySummaries(failedObservation,{scheduled:true});
  assert.equal((await summaryFailure()).lifecycle,"resolved");
  assert.deepEqual((await pool.query("SELECT * FROM diagnostic_daily_summaries WHERE organization_id=1 AND local_date='2026-10-24'")).rows[0],frozenSummary);
  await pool.query("UPDATE organizations SET timezone='Invalid/Zone' WHERE id=1");
  const timezoneObservation=new Date("2026-10-25T06:01:00Z");
  await generateDiagnosticDailySummaries(timezoneObservation);
  assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_daily_summaries WHERE organization_id=1 AND local_date='2026-10-25'")).rows[0].n,0,"Invalid configured zones must not silently use Johannesburg");
  assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_check_runs WHERE error_code='DIAGNOSTIC_TIMEZONE_INVALID'")).rows[0].n,1);
  await pool.query("UPDATE organizations SET timezone=NULL WHERE id=1");
  await generateDiagnosticDailySummaries(timezoneObservation);
  assert.equal((await pool.query("SELECT timezone FROM diagnostic_daily_summaries WHERE organization_id=1 AND local_date='2026-10-25'")).rows[0].timezone,"Africa/Johannesburg","Unset zone uses the agreed fallback");
  assert.equal((await summaryFailure()).lifecycle,"resolved","A successful actual generation proves a corrected deterministic configuration");
  // Local 08:00 moves relative to UTC at both DST boundaries.
  for(const [date,before,at] of [["2026-03-08","2026-03-08T11:59:00Z","2026-03-08T12:00:00Z"],
    ["2026-11-01","2026-11-01T12:59:00Z","2026-11-01T13:00:00Z"]]){
    await generateDiagnosticDailySummaries(new Date(before));
    assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_daily_summaries WHERE organization_id=2 AND local_date=$1",[date])).rows[0].n,0);
    await generateDiagnosticDailySummaries(new Date(at));
    assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_daily_summaries WHERE organization_id=2 AND local_date=$1",[date])).rows[0].n,1);
  }
  await pool.query("INSERT INTO organizations(id,timezone,active) SELECT n,'Africa/Johannesburg',true FROM generate_series(3,503) n");
  await generateDiagnosticDailySummaries(new Date("2026-10-26T06:01:00Z"));
  const tailSummary=(await pool.query("SELECT new_count,outstanding_count FROM diagnostic_daily_summaries WHERE organization_id=503 AND local_date='2026-10-26'")).rows[0];
  assert.deepEqual(tailSummary,{new_count:0,outstanding_count:0},"Stable batches include organizations beyond 500 and retain zero-issue summaries");
  // Exercise the real worker registration with a controllable timer, not real
  // half-hour sleeps. Injected callbacks cannot send messages or mutate stock.
  const {startActionInboxWorker}=await import("../server/services/action-inbox-worker");
  const timerServer=(await import("node:http")).createServer();
  const timers:Array<{task:()=>void;ms:number;cancelled:boolean;unreferenced:boolean}>=[];
  let actionRuns=0,reliabilityRuns=0;
  startActionInboxWorker(timerServer,{
    runActions:async()=>{actionRuns++;},runReliability:async()=>{reliabilityRuns++;},
    schedule:(task,ms)=>{const timer={task,ms,cancelled:false,unreferenced:false};timers.push(timer);
      return {cancel:()=>{timer.cancelled=true;},unref:()=>{timer.unreferenced=true;}};},
  });
  assert.equal(actionRuns,1,"Registration runs the existing inbox cycle immediately");
  for(let minute=1;minute<=30;minute++){
    for(const timer of timers)if(!timer.cancelled && minute*60_000%timer.ms===0)timer.task();
    await Promise.resolve();
  }
  assert.equal(reliabilityRuns,30,"Reliability checks run each minute, independently of the slower reminder sweep");
  assert.equal(actionRuns,2,"Reminder cadence remains thirty minutes");
  assert.ok(timers.every(timer=>timer.unreferenced));
  timerServer.emit("close");
  assert.ok(timers.every(timer=>timer.cancelled),"Server shutdown cancels both registered timers");
  const {retainDiagnosticEvidence}=await import("../server/diagnostics/evidence-retention");
  await assert.rejects(()=>retainDiagnosticEvidence(0));await assert.rejects(()=>retainDiagnosticEvidence(1001));
  const oldRun=randomUUID();
  await pool.query(`INSERT INTO diagnostic_check_runs(id,organization_id,completed_at) VALUES($1,1,now()-interval '100 days')`,[oldRun]);
  await pool.query(`INSERT INTO diagnostic_observations(organization_id,run_id,finding_key,evidence,lifecycle,observed_at)
    SELECT 1,$1,'retention-old-'||n,'{}'::jsonb,'open',now()-interval '100 days' FROM generate_series(1,5005) n`,[oldRun]);
  await pool.query(`INSERT INTO diagnostic_client_events(organization_id,user_id,client_event_id,event_type,route,received_at)
    SELECT 1,1,gen_random_uuid(),'browser_error','/test-owned-retention',now()-interval '100 days' FROM generate_series(1,1200)`);
  await pool.query(`INSERT INTO diagnostic_persistent_findings(organization_id,finding_key,lifecycle,last_checked_at,evidence)
    VALUES(1,'retention-open','open',now()-interval '400 days','{}'),(1,'retention-resolved','resolved',now()-interval '400 days','{}');
    INSERT INTO diagnostic_daily_summaries(organization_id,local_date,timezone,generated_at,monitoring_fresh,payload)
    VALUES(1,'2024-01-01','Africa/Johannesburg',now()-interval '400 days',false,'{}');
    INSERT INTO diagnostic_notification_intents(organization_id,finding_key,transition,transition_key,payload,delivered_at)
    VALUES(1,'retention-old','opened','retention-old','{}',now()-interval '400 days');
    CREATE TABLE audit_logs(id integer PRIMARY KEY,details jsonb);
    INSERT INTO audit_logs VALUES(1,'{"preserve":"business history"}')`);
  const businessFingerprint=async()=>JSON.stringify((await pool!.query(`SELECT
    (SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY id)) FROM audit_logs t) AS audit,
    (SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY id)) FROM inventory_items t) AS inventory,
    (SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY id)) FROM invoices t) AS invoices`)).rows[0]);
  const preserved=await businessFingerprint();
  const retentionOwner=await pool.connect();
  try{
    await retentionOwner.query("BEGIN");await retentionOwner.query("SELECT pg_advisory_xact_lock(74220,1)");
    assert.equal((await retainDiagnosticEvidence()).claimed,false,"Concurrent cleanup must not overlap another owner");
  }finally{await retentionOwner.query("ROLLBACK");retentionOwner.release();}
  const firstBatch=await retainDiagnosticEvidence();
  assert.equal(firstBatch.deleted.diagnostic_observations,1000);
  assert.equal(firstBatch.deleted.diagnostic_check_runs,0,"Referenced runs survive until their observations are gone");
  for(let batch=0;batch<5;batch++){
    const result=await retainDiagnosticEvidence();
    assert.ok(Object.values(result.deleted).every(count=>count<=1000));
  }
  assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_observations WHERE run_id=$1",[oldRun])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_check_runs WHERE id=$1",[oldRun])).rows[0].n,0);
  assert.equal((await pool.query("SELECT lifecycle FROM diagnostic_persistent_findings WHERE organization_id=1 AND finding_key='retention-open'")).rows[0].lifecycle,"open");
  assert.equal((await pool.query("SELECT count(*)::int n FROM diagnostic_persistent_findings WHERE finding_key='retention-resolved'")).rows[0].n,0);
  assert.equal(await businessFingerprint(),preserved,"Diagnostic retention must never change business audit, invoice or inventory evidence");
  console.log("Diagnostic retention passed: 5,005 observations, bounded batches, concurrent ownership, reference safety, unresolved preservation and unchanged business evidence.");
  console.log("Daily-summary edge cases passed: durable failures, rollback, capture-gap surfacing, manual/scheduled recovery, invalid/unset zones, DST, 503 organizations, zero issues and actual worker timer registration.");
  console.log("Notification runtime passed: concurrent retries, revoked membership, summary concurrency, timezone and catch-up.");
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (pool) await pool.end();
  if (created) {
    assert.match(name, /^iss_notification_test_[a-f0-9]{32}$/);
    await owner.query(`DROP DATABASE "${name}"`);
    console.log(`Removed exact test-owned database ${name}; application data was not changed.`);
  }
  await owner.end();
}
