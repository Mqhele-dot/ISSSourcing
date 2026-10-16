import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import "dotenv/config";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";
import { buildDatedReportingEvidence } from "../server/lib/dated-reporting-evidence";
import { freezeFinancialReportingRun, readFinancialReportingEvidence } from "../server/modules/reports/financial-reporting-run-store";
import { readApprovedReportingRates, readReportingEvidenceContext } from "../server/lib/reporting-evidence-context";
import { readFinancialSourceContributions } from "../server/modules/reports/financial-source-contributions";
import { generateFinancialMeasure } from "../server/modules/reports/financial-measure-service";

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
  await pool.query("CREATE TABLE organizations(id integer PRIMARY KEY); CREATE TABLE users(id integer PRIMARY KEY); INSERT INTO organizations VALUES(1),(2); INSERT INTO users VALUES(1);");
  const migration=await readFile(new URL("../migrations/20261013090000_financial_reporting_evidence.sql",import.meta.url),"utf8");
  await pool.query(migration);
  await pool.query(migration); // Safe additive reapplication.
  const client=await pool.connect();
  try {
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
    await client.query("COMMIT");
    assert.equal(generated.amount,'100.00');
    assert.equal(generated.state,'complete');
    assert.equal((await readFinancialReportingEvidence(client,1,generated.id,1,25))?.items[0].reportingAmount,'100.00');
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const received=await generateFinancialMeasure(client,{organizationId:1,actorUserId:1,measure:'received',filters:{}});
    await client.query("COMMIT");
    assert.equal(received.amount,'0.00'); // Original four units and their linked reversal net to zero.
    assert.equal(received.state,'partial'); // A separate historical receipt has no immutable price.
    assert.equal(received.excludedCount,1);
    await client.query(`INSERT INTO reporting_fx_revisions
      (organization_id,source_rate_id,version,from_currency_code,to_currency_code,rate,effective_at,approved_at,approved_by,approval_reference)
      VALUES(1,1,1,'USD','ZAR',18,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,'approval-1'),
        (1,1,2,'USD','ZAR',19,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',1,'approval-2');`);
    const rates=await readApprovedReportingRates(client,1,"ZAR",["USD"]);
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
    console.log("Financial evidence store passed: 5,000 contributions, exact total, pagination, tenant isolation, immutable history, rollback.");
  } finally {client.release();}
} finally {
  await pool?.end();
  if(created){assert.match(name,/^iss_reporting_test_[a-f0-9]{32}$/);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}
  await owner.end();
}
