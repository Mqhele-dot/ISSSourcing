import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import pg from "pg";
import "dotenv/config";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";
import { buildDatedReportingEvidence } from "../server/lib/dated-reporting-evidence";
import { freezeFinancialReportingRun, readFinancialReportingEvidence } from "../server/modules/reports/financial-reporting-run-store";
import { readApprovedReportingRates, readReportingEvidenceContext } from "../server/lib/reporting-evidence-context";
import { readFinancialSourceContributions } from "../server/modules/reports/financial-source-contributions";
import { generateFinancialMeasure } from "../server/modules/reports/financial-measure-service";
import { buildFrozenFinancialCsv,streamFrozenFinancialCsv } from "../server/modules/reports/frozen-financial-export";
import {createFrozenFinancialCompactReader} from "../server/modules/exports/compact-frozen-financial-reader";
import { captureReceiptValue, captureReceiptReversalValue } from "../server/modules/reports/receipt-value-capture";
import { reportingSchemaProbeSql, reportingSchemaRequirements } from "../server/diagnostics/reporting-schema";
import { persistDiagnosticChecks, diagnosticStorageReady, readPersistentFindings, readModuleHealth } from "../server/diagnostics/persistent-findings";
import type { DiagnosticFinding } from "../shared/diagnostics/findings";
import { claimDiagnosticSchedule, finishDiagnosticSchedule } from "../server/diagnostics/schedule-store";

if (!process.argv.includes("--local-disposable")) throw new Error("Use --local-disposable; application databases are never targets.");
const configured = process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/postgres` : null);
assert.ok(configured,"Local PostgreSQL configuration required");
const url = new URL(configured);
assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));
const name = `iss_reporting_test_${randomUUID().replaceAll("-","")}`;
url.pathname="/postgres";
const owner = new pg.Client({connectionString:url.toString()});
let created=false;
let pool: pg.Pool | undefined;
try {
  await owner.connect();
  url.pathname=`/${name}`;
  assertDisposableDatabaseUrl(url.toString());
  await owner.query(`CREATE DATABASE "${name}"`); created=true;
  pool=new pg.Pool({connectionString:url.toString()});
  const absentSchema = await pool.query(reportingSchemaProbeSql,[JSON.stringify(reportingSchemaRequirements)]);
  assert.ok(absentSchema.rows.every(row=>row.present===false),"Missing schema must be reported without throwing");
  await pool.query("CREATE TABLE organizations(id integer PRIMARY KEY); CREATE TABLE users(id integer PRIMARY KEY); INSERT INTO organizations VALUES(1),(2); INSERT INTO users VALUES(1);");
  const migration=await readFile(new URL("../migrations/20261013090000_financial_reporting_evidence.sql",import.meta.url),"utf8");
  await pool.query(migration);
  await pool.query(migration); // Safe additive reapplication.
  const reversalMigration=await readFile(new URL("../migrations/20261016090000_receipt_reversal_value_evidence.sql",import.meta.url),"utf8");
  await pool.query(reversalMigration);
  await pool.query(reversalMigration);
  await pool.query(await readFile(new URL("../migrations/20261017090000_reporting_fx_publication.sql",import.meta.url),"utf8"));
  const completeSchema = await pool.query(reportingSchemaProbeSql,[JSON.stringify(reportingSchemaRequirements)]);
  assert.ok(completeSchema.rows.every(row=>row.present===true),"All three migrations satisfy reporting prerequisites");
  await pool.query("ALTER TABLE reporting_fx_revisions DISABLE TRIGGER reporting_fx_immutable");
  assert.ok((await pool.query(reportingSchemaProbeSql,[JSON.stringify(reportingSchemaRequirements)])).rows.some(row=>row.name==='reporting_fx_revisions:immutability'&&!row.present));
  await pool.query("ALTER TABLE reporting_fx_revisions ENABLE TRIGGER reporting_fx_immutable");
  const client=await pool.connect();
  try {
    await client.query(await readFile(new URL("../migrations/20261018090000_durable_diagnostic_findings.sql",import.meta.url),"utf8"));
    assert.equal(await diagnosticStorageReady(client),true);
    await client.query("ALTER TABLE organizations ADD COLUMN active boolean NOT NULL DEFAULT true");
    await client.query(await readFile(new URL("../migrations/20261018100000_diagnostic_schedules.sql",import.meta.url),"utf8"));
    await client.query(await readFile(new URL("../migrations/20261018110000_diagnostic_delivery_and_ingestion.sql",import.meta.url),"utf8"));
    await client.query("INSERT INTO diagnostic_schedules(organization_id,tier) VALUES(1,'critical')");
    const crashed=spawnSync(process.execPath,["scripts/diagnostic-lease-crash-child.mjs"],{
      env:{...process.env,DATABASE_URL:url.toString(),TEST_DATABASE_URL:url.toString()},encoding:"utf8",timeout:15_000});
    assert.equal(crashed.status,0,crashed.stderr);
    assert.equal(await claimDiagnosticSchedule(client),null,"A terminated process leaves its durable lease until expiry");
    await client.query("UPDATE diagnostic_schedules SET lease_until=now()-interval '1 second'");
    const claimed=await claimDiagnosticSchedule(client);
    assert.ok(claimed);
    assert.equal(await claimDiagnosticSchedule(client),null,"Leased work cannot be claimed twice");
    await client.query("UPDATE diagnostic_schedules SET lease_until=now()-interval '1 second'");
    const recovered=await claimDiagnosticSchedule(client);
    assert.ok(recovered);
    assert.equal((await finishDiagnosticSchedule(client,claimed,true)).rowCount,0,"Expired worker cannot finish replacement work");
    assert.equal((await finishDiagnosticSchedule(client,recovered,true)).rowCount,1);
    assert.equal(await claimDiagnosticSchedule(client),null,"Completed checks respect the next due time");
    const failedCheck: DiagnosticFinding = { id:"test",category:"backend",code:"REPORTING",title:"Reporting",
      message:"Unavailable",status:"failed",severity:"error",occurrences:1,firstSeen:new Date().toISOString(),
      lastSeen:new Date().toISOString(),evidenceState:"current" };
    const observe = async (runId: string, status: DiagnosticFinding["status"]) => {
      await client.query("BEGIN");
      try { await persistDiagnosticChecks(client,1,runId,[{...failedCheck,status}],2,true); await client.query("COMMIT"); }
      catch(error) { await client.query("ROLLBACK"); throw error; }
    };
    const runId=randomUUID();
    await observe(runId,"failed"); await observe(runId,"failed");
    assert.equal((await client.query("SELECT occurrences FROM diagnostic_persistent_findings WHERE organization_id=1")).rows[0].occurrences,1);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM diagnostic_notification_intents WHERE organization_id=1 AND transition='opened'")).rows[0].n,1,"Opening a finding creates one durable transition intent");
    await client.query("BEGIN");
    await persistDiagnosticChecks(client,1,randomUUID(),[{...failedCheck,status:"working"}],2,false);
    await client.query("COMMIT");
    assert.equal((await client.query("SELECT consecutive_passes FROM diagnostic_persistent_findings WHERE organization_id=1")).rows[0].consecutive_passes,0,"Manual checks cannot advance transient recovery");
    await observe(randomUUID(),"working");
    assert.equal((await client.query("SELECT lifecycle FROM diagnostic_persistent_findings WHERE organization_id=1")).rows[0].lifecycle,"open");
    assert.equal((await readPersistentFindings(client,1)).items[0].status,"failed","Unresolved failures retain their failure evidence");
    await observe(randomUUID(),"working");
    assert.equal((await client.query("SELECT lifecycle FROM diagnostic_persistent_findings WHERE organization_id=1")).rows[0].lifecycle,"resolved");
    assert.equal((await client.query("SELECT count(*)::int AS n FROM diagnostic_notification_intents WHERE organization_id=1 AND transition='recovered'")).rows[0].n,1,"Verified recovery creates a durable intent");
    await observe(randomUUID(),"failed");
    assert.equal((await client.query("SELECT lifecycle FROM diagnostic_persistent_findings WHERE organization_id=1")).rows[0].lifecycle,"open");
    assert.equal((await client.query("SELECT count(*)::int AS n FROM diagnostic_persistent_findings WHERE organization_id=2")).rows[0].n,0);
    const persistedHistory = await readPersistentFindings(client,1);
    assert.equal(persistedHistory.total,1);
    assert.equal(persistedHistory.items[0].lifecycle,"open");
    assert.equal((await readPersistentFindings(client,2)).total,0);
    await assert.rejects(()=>readPersistentFindings(client,1,1,1000),/Invalid diagnostics page/);
    await client.query("BEGIN");
    await persistDiagnosticChecks(client,1,randomUUID(),[{...failedCheck,code:'ROLLED_BACK'}]);
    await client.query("ROLLBACK");
    assert.equal((await readPersistentFindings(client,1)).total,1);
    await client.query(`
      CREATE TABLE purchase_orders(id int,organization_id int,updated_at timestamp,order_date timestamp,total_amount real,currency_code text,approval_status text,status text,supplier_id int);
      CREATE TABLE purchase_order_items(id int,order_id int,quantity numeric,received_quantity numeric,unit_price real);
      INSERT INTO purchase_orders VALUES
        (1,1,'2026-10-01','2026-10-01',100,'ZAR','APPROVED','SENT',1),
        (2,2,'2026-10-01','2026-10-01',999,'ZAR','APPROVED','SENT',2),
        (3,1,'2026-10-01','2026-10-01',300,'ZAR','DRAFT','DRAFT',1);
      INSERT INTO purchase_order_items VALUES(1,1,10,4,10);
      CREATE TABLE invoices(id int,organization_id int,updated_at timestamp,issue_date timestamp,total real,currency_code text,status text,supplier_id int);
      CREATE TABLE payments(id int,invoice_id int,updated_at timestamp,payment_date timestamp,amount real);
      INSERT INTO invoices VALUES(1,1,'2026-10-01','2026-10-01',100,'ZAR','APPROVED',1),(2,2,'2026-10-01','2026-10-01',999,'ZAR','APPROVED',2);
      INSERT INTO payments VALUES(1,1,'2026-10-02','2026-10-02',25),(2,2,'2026-10-02','2026-10-02',999);
      CREATE TABLE ap_receipts(id int,organization_id int,received_date timestamp,status text,supplier_id int);
      CREATE TABLE ap_receipt_items(id int,receipt_id int,updated_at timestamp,accepted_quantity numeric);
      CREATE TABLE goods_receipt_reversals(id int,organization_id int,receipt_id int,created_at timestamp);
      INSERT INTO ap_receipts VALUES(1,1,'2026-10-01','POSTED',1),(2,1,'2026-10-01','POSTED',1);
      INSERT INTO ap_receipt_items VALUES(1,1,'2026-10-01',4),(2,2,'2026-10-01',1);
      INSERT INTO receipt_value_evidence(organization_id,receipt_item_id,quantity,unit_price,currency_code,source_price_reference,posted_at,actor_user_id)
        VALUES(1,1,4,10,'ZAR','po-line-1','2026-10-01',1);
      INSERT INTO goods_receipt_reversals VALUES(1,1,1,'2026-10-02');
    `);
    assert.equal((await readFinancialSourceContributions(client,1,'ordered',{})).length,1);
    assert.equal((await readFinancialSourceContributions(client,1,'open_commitment',{}))[0].amount,'60');
    assert.equal((await readFinancialSourceContributions(client,1,'invoiced',{}))[0].amount,'100');
    assert.equal((await readFinancialSourceContributions(client,1,'recorded_payments',{}))[0].amount,'25');
    assert.equal((await readFinancialSourceContributions(client,1,'ordered',{supplierId:2})).length,0);
    assert.equal((await readFinancialSourceContributions(client,1,'ordered',{from:'2026-10-02'})).length,0);
    await client.query(`ALTER TABLE ap_receipts ADD COLUMN purchase_order_id integer;
      ALTER TABLE ap_receipt_items ADD COLUMN purchase_order_item_id integer;
      ALTER TABLE purchase_orders ADD COLUMN revision_number integer DEFAULT 1;`);
    await client.query('BEGIN');
    await client.query(`INSERT INTO ap_receipts(id,organization_id,received_date,status,supplier_id,purchase_order_id)
      VALUES(3,1,'2026-10-03','POSTED',1,1);
      INSERT INTO ap_receipt_items(id,receipt_id,updated_at,accepted_quantity,purchase_order_item_id)
      VALUES(3,3,'2026-10-03',2,1);`);
    await captureReceiptValue(client,1,3,1);
    await captureReceiptValue(client,1,3,1);
    await client.query('UPDATE purchase_order_items SET unit_price=99 WHERE id=1');
    const captured=await client.query('SELECT quantity::text,unit_price::text,source_price_reference FROM receipt_value_evidence WHERE receipt_item_id=3');
    assert.equal(captured.rowCount,1);
    assert.equal(captured.rows[0].unit_price,'10');
    assert.equal(captured.rows[0].quantity,'2');
    assert.equal(captured.rows[0].source_price_reference,'purchase_order:1:revision:1:line:1');
    await client.query('ROLLBACK');
    assert.equal((await client.query('SELECT id FROM receipt_value_evidence WHERE receipt_item_id=3')).rowCount,0);
    await captureReceiptReversalValue(client,1,1,1);
    await captureReceiptReversalValue(client,1,1,1);
    await captureReceiptReversalValue(client,2,1,1);
    assert.equal((await client.query('SELECT count(*)::int count FROM receipt_value_reversal_evidence')).rows[0].count,1);
    await assert.rejects(client.query('UPDATE receipt_value_reversal_evidence SET quantity=-999'),/immutable/);
    await assert.rejects(client.query('DELETE FROM receipt_value_reversal_evidence'),/immutable/);
    await client.query("UPDATE ap_receipts SET status='CANCELLED' WHERE id=1");
    const receipts=await readFinancialSourceContributions(client,1,'received',{});
    assert.equal(receipts.length,3);
    assert.equal(receipts.find(row=>row.sourceType==='receipt_reversal')?.amount,'-40');
    assert.equal(receipts.find(row=>row.sourceId==='2')?.exclusion,'missing_price_evidence');
    assert.equal((await readFinancialSourceContributions(client,2,'received',{})).length,0);
    await client.query(`CREATE TABLE app_settings(organization_id integer,currency_code text);
      CREATE TABLE currencies(id integer,organization_id integer,code text,decimal_places integer,active boolean);
      INSERT INTO app_settings VALUES(1,'ZAR');
      INSERT INTO currencies VALUES(1,1,'ZAR',2,true);`);
    assert.deepEqual(await readReportingEvidenceContext(client,1),{currencyCode:"ZAR",decimalPlaces:2});
    assert.equal(await readReportingEvidenceContext(client,2),null);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const generated=await generateFinancialMeasure(client,{organizationId:1,actorUserId:1,measure:'ordered',filters:{}});
    const sameObservation=await generateFinancialMeasure(client,{organizationId:1,actorUserId:1,measure:'received',filters:{}});
    assert.equal(sameObservation.generatedAt,generated.generatedAt,"Dashboard measures share the transaction observation timestamp");
    assert.notEqual(sameObservation.id,generated.id,"Each measure retains independently addressable frozen evidence");
    await client.query("COMMIT");
    assert.equal(generated.amount,'100.00');
    assert.equal(generated.state,'complete');
    assert.equal((await readFinancialReportingEvidence(client,1,generated.id,1,25))?.items[0].reportingAmount,'100.00');
    const frozenCsv=await buildFrozenFinancialCsv(client,1,generated.id,"ordered");
    assert.ok(frozenCsv?.buffer.toString().includes('"100.00"'));
    assert.equal(await buildFrozenFinancialCsv(client,2,generated.id,"ordered"),null,"Exports cannot read another tenant's frozen run");
    assert.equal(await buildFrozenFinancialCsv(client,1,generated.id,"received"),null,"Measure references must match");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const received=await generateFinancialMeasure(client,{organizationId:1,actorUserId:1,measure:'received',filters:{}});
    await client.query("COMMIT");
    assert.equal(received.amount,'0.00'); // Original four units and their linked reversal net to zero.
    assert.equal(received.state,'partial'); // A separate historical receipt has no immutable price.
    assert.equal(received.excludedCount,1);
    await client.query(`INSERT INTO reporting_fx_revisions
      (organization_id,source_rate_id,version,from_currency_code,to_currency_code,rate,effective_at,approved_at,approved_by,approval_reference,applied_at)
      VALUES(1,1,1,'USD','ZAR',18,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,'approval-1','2026-01-01T00:00:00Z'),
        (1,1,2,'USD','ZAR',19,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',1,'approval-2','2026-02-01T00:00:00Z');`);
    const rates=await readApprovedReportingRates(client,1,"ZAR",["USD"]);
    assert.deepEqual((await buildFrozenFinancialCsv(client,1,generated.id,"ordered"))?.buffer,frozenCsv?.buffer,"FX publication cannot change a frozen export");
    assert.equal(rates.length,2);
    assert.equal(rates.find(rate=>rate.version===1)?.supersededAt,"2026-02-01T00:00:00.000Z");
    assert.deepEqual(await readApprovedReportingRates(client,2,"ZAR",["USD"]),[]);
    await assert.rejects(client.query("UPDATE reporting_fx_revisions SET rate=20"),/immutable/);
    const result=buildDatedReportingEvidence({organizationId:1,currencyCode:"ZAR",decimalPlaces:2,generatedAt:"2026-10-13T00:00:00Z",rates:[],
      contributions:Array.from({length:5000},(_,id)=>({sourceType:"purchase_order",sourceId:String(id),sourceRevision:"1",date:"2026-10-01T00:00:00Z",amount:"0.10",currencyCode:"ZAR"}))});
    assert.equal(result.amount,"500.00");
    await client.query("BEGIN");
    const saved=await freezeFinancialReportingRun(client,{organizationId:1,actorUserId:1,measure:"ordered",normalizedFilters:{},result});
    await client.query("COMMIT");
    const first=await readFinancialReportingEvidence(client,1,saved.id,1,25);
    const largeExport=await buildFrozenFinancialCsv(client,1,saved.id,"ordered");
    const streamed=await streamFrozenFinancialCsv(client,1,saved.id,"ordered");
    assert.equal(streamed?.rowCount,5000);
    const streamedParts:Buffer[]=[];
    for await(const chunk of streamed!.chunks)streamedParts.push(Buffer.from(chunk,"utf8"));
    assert.deepEqual(Buffer.concat(streamedParts),largeExport?.buffer,"Streaming preserves every frozen export byte across 5,000 rows");
    assert.equal(largeExport?.rowCount,5000,"Frozen exports include every contribution across bounded keyset batches");
    const compact=await createFrozenFinancialCompactReader(client,{organizationId:1,filters:{runId:saved.id,measure:"ordered"},authorize:async()=>{}});
    assert.equal(compact.expectedRows,5000);let compactCount=0;
    for await(const row of compact.rows){assert.equal(row.sourceId,String(compactCount++));assert.equal(row.originalAmount,"0.10");}
    assert.equal(compactCount,5000,"Compact reader preserves all immutable contributions through real database keyset pages");
    await assert.rejects(createFrozenFinancialCompactReader(client,{organizationId:2,filters:{runId:saved.id,measure:"ordered"},authorize:async()=>{}}),/not available/);
    assert.equal(largeExport?.buffer.toString().split("\r\n").length,5002);
    assert.equal(first?.total,5000); assert.equal(first?.items.length,25);
    assert.equal(first?.items[0].sourceId,"0");
    assert.equal((await readFinancialReportingEvidence(client,1,saved.id,2,25))?.items[0].sourceId,"25");
    assert.equal(await readFinancialReportingEvidence(client,2,saved.id,1,25),null);
    await assert.rejects(readFinancialReportingEvidence(client,1,saved.id,1,101));
    await assert.rejects(client.query("UPDATE financial_reporting_runs SET summary='{}' WHERE id=$1",[saved.id]),/immutable/);
    await assert.rejects(client.query("DELETE FROM financial_reporting_contributions WHERE run_id=$1",[saved.id]),/immutable/);
    await client.query("BEGIN");
    const rolledBack=await freezeFinancialReportingRun(client,{organizationId:1,actorUserId:1,measure:"ordered",normalizedFilters:{},result});
    await client.query("ROLLBACK");
    assert.equal(await readFinancialReportingEvidence(client,1,rolledBack.id,1,25),null);
    const { runDiagnosticMonitoringCycle } = await import("../server/diagnostics/monitoring-worker");
    await client.query("UPDATE diagnostic_schedules SET next_run_at=now()-interval '1 minute',lease_token=NULL,lease_until=NULL");
    await runDiagnosticMonitoringCycle({database:pool,collect:async()=>{throw new Error("Injected probe failure");}});
    assert.equal((await client.query("SELECT count(*)::int n FROM diagnostic_check_runs WHERE outcome='failed'")).rows[0].n,1);
    await client.query("UPDATE diagnostic_schedules SET next_run_at=now()-interval '1 minute',lease_token=NULL,lease_until=NULL");
    await runDiagnosticMonitoringCycle({database:pool,timeoutMs:10,collect:async()=>new Promise(()=>{})});
    assert.equal((await client.query("SELECT count(*)::int n FROM diagnostic_check_runs WHERE outcome='timed_out'")).rows[0].n,1);
    await client.query("UPDATE diagnostic_schedules SET next_run_at=now()-interval '1 minute',lease_token=NULL,lease_until=NULL");
    await runDiagnosticMonitoringCycle({database:pool,collect:async()=>[]});
    assert.ok((await client.query("SELECT count(*)::int n FROM diagnostic_schedules WHERE last_outcome='completed'")).rows[0].n>0);
    await client.query("DELETE FROM diagnostic_schedules WHERE organization_id=2");
    assert.equal((await readModuleHealth(client,2)).state,"unverified","No schedule is not healthy monitoring");
    await client.query(`INSERT INTO diagnostic_schedules(organization_id,tier,next_run_at)
      VALUES(2,'critical',now()+interval '1 day'),(2,'deep',now()+interval '1 day')`);
    assert.equal((await readModuleHealth(client,2)).state,"unverified","Future schedules do not prove execution");
    await client.query("UPDATE diagnostic_schedules SET last_completed_at=now(),last_outcome='completed' WHERE organization_id=2 AND tier='critical'");
    assert.equal((await readModuleHealth(client,2)).state,"unverified","Both tiers require evidence");
    await client.query("UPDATE diagnostic_schedules SET last_completed_at=now(),last_outcome='completed' WHERE organization_id=2");
    assert.equal((await readModuleHealth(client,2)).state,"healthy");
    await client.query("UPDATE diagnostic_schedules SET last_outcome='failed' WHERE organization_id=2 AND tier='critical'");
    assert.equal((await readModuleHealth(client,2)).state,"degraded","A failed cycle cannot look healthy until the next due date");
    await client.query("UPDATE diagnostic_schedules SET last_outcome='completed',next_run_at=now()-interval '6 minutes' WHERE organization_id=2");
    assert.equal((await readModuleHealth(client,2)).state,"stale");
    const schemaIncident={...failedCheck,code:"REPORTING_SCHEMA_PROBE_FAILED",resourceKey:"transient-schema"};
    const schemaSuccess={...schemaIncident,code:"REPORTING_SCHEMA",status:"working" as const};
    const observeSchema=async(check:DiagnosticFinding,scheduled:boolean)=>{
      await client.query("BEGIN");
      try{await persistDiagnosticChecks(client,2,randomUUID(),[check],1,scheduled);await client.query("COMMIT");}
      catch(error){await client.query("ROLLBACK");throw error;}
    };
    await observeSchema(schemaIncident,true);
    await observeSchema(schemaSuccess,false);
    const incident=async()=>(await client.query(`SELECT lifecycle,consecutive_passes,evidence FROM diagnostic_persistent_findings
      WHERE organization_id=2 AND finding_key='backend:REPORTING_SCHEMA:transient-schema'`)).rows[0];
    assert.equal((await incident()).lifecycle,"open");
    assert.equal((await incident()).consecutive_passes,0,"Manual checks cannot accelerate probe-failure recovery");
    await observeSchema(schemaSuccess,true);
    assert.equal((await incident()).lifecycle,"open");
    assert.equal((await incident()).evidence.code,"REPORTING_SCHEMA_PROBE_FAILED","Retain failed evidence after one scheduled success");
    await observeSchema(schemaSuccess,true);
    assert.equal((await incident()).lifecycle,"resolved");
    console.log("Monitoring health/recovery passed: unverified tiers, failed cycles, stale schedules and two scheduled probe successes.");
    console.log("Financial evidence and actual monitoring cycle passed: failure, timeout, recovery, 5,000 contributions, isolation and rollback.");
  } finally {client.release();}
} finally {
  await pool?.end();
  if(created){assert.match(name,/^iss_reporting_test_[a-f0-9]{32}$/);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}
  await owner.end();
}
