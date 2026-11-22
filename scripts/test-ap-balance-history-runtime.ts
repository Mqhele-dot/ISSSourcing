import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import "dotenv/config";
import {assertDisposableDatabaseUrl} from "../server/config/database-safety";

if(!process.argv.includes("--local-disposable")) throw new Error("Use --local-disposable; business databases are never test targets.");
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);
assert.ok(configured,"Local PostgreSQL configuration is required");
const url=new URL(configured);assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));url.pathname="/postgres";
const owner=new pg.Client({connectionString:url.toString()});
const name=`iss_ap_history_test_${randomUUID().replaceAll("-","")}`;
let created=false;let database:pg.Pool|undefined;
try {
  await owner.connect();url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());
  await owner.query(`CREATE DATABASE "${name}"`);created=true;
  process.env.DATABASE_URL=url.toString();process.env.TEST_DATABASE_URL=url.toString();process.env.NODE_ENV="test";
  const {pool}=await import("../server/db");database=pool;
  await pool.query(`CREATE TABLE organizations(id int PRIMARY KEY,timezone text DEFAULT 'Africa/Johannesburg');INSERT INTO organizations(id) VALUES(1),(2);
    CREATE TABLE users(id int PRIMARY KEY);INSERT INTO users VALUES(1),(2);
    CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int);INSERT INTO suppliers VALUES(1,1),(2,2);
    CREATE TABLE invoices(id serial PRIMARY KEY,organization_id int,supplier_id int,invoice_number text,currency_code text,total numeric,paid_amount numeric,due_amount numeric,status text,issue_date timestamptz,due_date timestamptz,updated_at timestamptz DEFAULT now());
    INSERT INTO invoices(organization_id,supplier_id,invoice_number,currency_code,total,paid_amount,due_amount,status,issue_date,due_date) VALUES
      (1,1,'LEGACY-1','ZAR',100,20,80,'APPROVED',now()-interval '30 days',now()),
      (1,1,'LEGACY-2','ZAR',100,0,100,'DISPUTED',now()-interval '30 days',now()),
      (2,2,'OTHER-TENANT','ZAR',100,0,100,'APPROVED',now(),now());
    CREATE TABLE approval_history(id serial,organization_id int,entity_type text,entity_id int,level int,action text,performed_by int,comment text,previous_status text,new_status text);
    CREATE TABLE audit_logs(id serial PRIMARY KEY,organization_id int,user_id int,action text,resource_type text,resource_id int,details jsonb,reason text,previous_hash text,event_hash text,hash_version int,request_id text,ip_address text,user_agent text,created_at timestamptz);`);
  await pool.query(await readFile("migrations/20261013090000_financial_reporting_evidence.sql","utf8"));
  const migration=await readFile("migrations/20261025090000_ap_balance_history.sql","utf8");
  const rehearsal=await pool.connect();
  try {await rehearsal.query("BEGIN");await rehearsal.query(migration);await rehearsal.query("ROLLBACK");}
  finally {rehearsal.release();}
  assert.equal((await pool.query("SELECT to_regclass('public.ap_balance_events') AS table_name")).rows[0].table_name,null,"Migration DDL must roll back cleanly");
  await pool.query(migration);await pool.query(migration);
  await pool.query(await readFile("migrations/20261017090000_reporting_fx_publication.sql","utf8"));
  await pool.query(`CREATE TABLE app_settings(organization_id int,currency_code text);INSERT INTO app_settings VALUES(1,'ZAR');
    CREATE TABLE currencies(id int,organization_id int,code text,decimal_places int,active boolean);INSERT INTO currencies VALUES(1,1,'ZAR',2,true);`);
  assert.equal((await pool.query("SELECT count(*)::int n FROM ap_balance_events")).rows[0].n,0,"Migration must not synthesize opening evidence");
  const {prepareApBaseline:prepare,transitionApBaseline:transition}=await import("../server/modules/reports/ap-balance-baseline-service");
  const author={organizationId:1,actorUserId:1,actorRole:"admin"},reviewer={organizationId:1,actorUserId:2,actorRole:"admin"};
  const approve:Parameters<typeof transition>[2]=async()=>({level:1,isFinal:true,progress:{state:"pending",requiredLevels:[1],completedLevels:[],completedApproverIds:[],nextPolicy:null}});
  await assert.rejects(prepare({...author,invoiceIds:[3],reason:"Foreign tenant attempt"}),/not available/);
  const baseline=await prepare({...author,invoiceIds:[1],reason:"Finance reviewed opening balance"});
  await transition({...author,id:Number(baseline.id),action:"submit"});
  await assert.rejects(transition({...author,id:Number(baseline.id),action:"approve"},pool,approve),/different authorized/);
  await assert.rejects(transition({...reviewer,organizationId:2,id:Number(baseline.id),action:"approve"},pool,approve),/not available/);
  await pool.query(`CREATE FUNCTION fail_baseline_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='AP_BASELINE_APPLIED' THEN RAISE EXCEPTION 'Injected baseline audit failure'; END IF;RETURN NEW;END $$;
    CREATE TRIGGER fail_baseline_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_baseline_audit();`);
  await assert.rejects(transition({...reviewer,id:Number(baseline.id),action:"approve"},pool,approve),/Injected baseline audit failure/);
  assert.equal((await pool.query("SELECT status FROM ap_balance_baselines WHERE id=$1",[baseline.id])).rows[0].status,"SUBMITTED");
  assert.equal((await pool.query("SELECT count(*)::int n FROM ap_balance_events")).rows[0].n,0,"Audit failure must roll back opening events and approval history");
  assert.equal((await pool.query("SELECT count(*)::int n FROM approval_history")).rows[0].n,0);
  await pool.query("DROP TRIGGER fail_baseline_audit ON audit_logs");
  await Promise.all(Array.from({length:3},()=>transition({...reviewer,id:Number(baseline.id),action:"approve"},pool,approve)));
  const opening=(await pool.query("SELECT * FROM ap_balance_events")).rows[0];
  assert.equal((await pool.query("SELECT count(*)::int n FROM ap_balance_events")).rows[0].n,1);
  assert.equal(opening.snapshot.remainingBalance,"80");assert.equal(opening.actor_user_id,2);
  assert.equal(opening.actor_provenance,"independently_approved_baseline");
  const {readApHistoricalContributions,apObservationScope,apAgingBucket,apCalendarDay}=await import("../server/modules/reports/ap-historical-balances");
  assert.equal(apCalendarDay('2026-02-30','Africa/Johannesburg'),null,'Impossible calendar dates must become unknown rather than fail SQL aging');
  assert.equal(apCalendarDay('2024-02-29','Africa/Johannesburg'),'2024-02-29');
  assert.equal(apCalendarDay('2026-10-24T23:30:00Z','Africa/Johannesburg'),'2026-10-25','Zoned dates use the organization calendar');
  const agingBoundaryCases=[
    [0,'due_7'],[7,'due_7'],[8,'due_30'],[30,'due_30'],[31,'not_due'],
    [-1,'od_1_30'],[-30,'od_1_30'],[-31,'od_31_60'],[-60,'od_31_60'],[-61,'od_60p'],
  ] as const;
  for(const [days,expected]of agingBoundaryCases){
    const due=new Date(Date.parse('2026-10-25T00:00:00Z')+days*86400000).toISOString().slice(0,10);
    assert.equal(apAgingBucket(due,'2026-10-25'),expected,`Aging boundary ${days} calendar days`);
  }
  console.log('Ten AP aging boundary scenarios passed: due today, 7/8/30/31 days ahead and 1/30/31/60/61 days overdue.');
  const reader=await pool.connect();
  try {
    const scope=await apObservationScope(reader,1);
    await reader.query('BEGIN');
    try{
      for(const invalid of ['2026-02-30','2026/10/25','2999-01-01','2026-10-25T00:00:00Z','0000-00-00',''])
        await assert.rejects(apObservationScope(reader,1,invalid),/valid as-of date/);
      await assert.rejects(apObservationScope(reader,999),/organization is not available/);
      await reader.query("UPDATE organizations SET timezone='Invalid/Test_Zone' WHERE id=1");
      await assert.rejects(apObservationScope(reader,1,'2026-01-01'),/valid organization timezone/);
      await reader.query("UPDATE organizations SET timezone='America/New_York' WHERE id=1");
      const spring=await apObservationScope(reader,1,'2026-03-08');
      assert.equal(new Date(spring.cutoff).toISOString(),'2026-03-09T04:00:00.000Z','Spring transition ends after a 23-hour local day');
      const autumn=await apObservationScope(reader,1,'2025-11-02');
      assert.equal(new Date(autumn.cutoff).toISOString(),'2025-11-03T05:00:00.000Z','Autumn transition ends after a 25-hour local day');
    }finally{await reader.query('ROLLBACK');}
    console.log('Ten AP observation checks passed: six invalid dates, absent organization, invalid timezone and both daylight-saving boundaries.');
    const today=await readApHistoricalContributions(reader,1,"ap_outstanding",{supplierId:1});
    assert.equal(today.find(r=>r.sourceId==='1')?.amount,"80");
    const yesterday=new Date(Date.parse(scope.asOf)-86400000).toISOString().slice(0,10);
    const past=await readApHistoricalContributions(reader,1,"ap_outstanding",{asOf:yesterday,supplierId:1});
    assert.equal(past.find(r=>r.sourceId==='1')?.exclusion,"missing_balance_history");
    assert.equal(past.find(r=>r.sourceId==='1')?.amount,null,"Never substitute today's balance before coverage");
    await assert.rejects(apObservationScope(reader,1,'2999-01-01'),/no later than today/);
    assert.equal(apAgingBucket(null,scope.asOf),"unknown_due_date");
    const {generateFinancialMeasure}=await import("../server/modules/reports/financial-measure-service");
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const summary=await generateFinancialMeasure(reader,{organizationId:1,actorUserId:1,measure:"ap_outstanding",filters:{supplierId:1}});
    await reader.query("COMMIT");
    assert.equal(summary.amount,"80.00");assert.equal(summary.state,"partial");
    assert.equal(summary.normalizedFilters.asOf,scope.asOf);
    const {buildFrozenFinancialCsv}=await import("../server/modules/reports/frozen-financial-export");
    const csv=await buildFrozenFinancialCsv(reader,1,summary.id,"ap_outstanding");
    assert.ok(csv?.buffer.toString().includes('"balanceEventId"'));
  }finally{reader.release();}
  const stale=await prepare({...author,invoiceIds:[2],reason:"Review before a source change"});
  await transition({...author,id:Number(stale.id),action:"submit"});
  await pool.query("UPDATE invoices SET due_date=due_date+interval '1 day' WHERE id=2");
  await assert.rejects(transition({...reviewer,id:Number(stale.id),action:"approve"},pool,approve),/changed after this preview/);
  const observed=(await pool.query("SELECT actor_user_id,actor_provenance FROM ap_balance_events WHERE invoice_id=2")).rows[0];
  assert.equal(observed.actor_user_id,null);assert.match(observed.actor_provenance,/unverified/);
  const c=await pool.connect();
  try {
    await c.query("BEGIN");await c.query("SELECT set_config('app.ap_reporting_actor','2',true)");
    await c.query("UPDATE invoices SET due_amount=60,paid_amount=40 WHERE id=1");
    await c.query("ROLLBACK");
  }finally{c.release();}
  assert.equal((await pool.query("SELECT count(*)::int n FROM ap_balance_events WHERE invoice_id=1")).rows[0].n,1,"Rolled-back mutations cannot leave history behind");
  await assert.rejects(pool.query("UPDATE ap_balance_events SET snapshot='{}'"),/immutable/);
  await assert.rejects(pool.query("DELETE FROM ap_balance_baselines WHERE id=$1",[baseline.id]),/immutable/);
  await assert.rejects(pool.query("UPDATE invoices SET organization_id=2 WHERE id=1"),/ownership/);
  const volumeClient=await pool.connect();
  try{await volumeClient.query('BEGIN');await volumeClient.query("SELECT set_config('app.ap_reporting_actor','1',true)");
  await volumeClient.query(`INSERT INTO invoices(organization_id,supplier_id,invoice_number,currency_code,total,paid_amount,due_amount,status,issue_date,due_date)
    SELECT 1,1,'VOLUME-'||n,'ZAR',0.10,0,0.10,'APPROVED',now(),now() FROM generate_series(1,5000) n`);
  await volumeClient.query('COMMIT');}catch(error){await volumeClient.query('ROLLBACK');throw error;}finally{volumeClient.release();}
  const reportClient=await pool.connect();
  try{
    const {buildApAgingReport,apAgingQuery}=await import('../server/modules/reports/ap-aging-report');
    await reportClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const started=performance.now(),report=await buildApAgingReport(reportClient,1,1,apAgingQuery.parse({pageSize:100}));
    assert.equal(report.measures.find(row=>row.measure==='ap_outstanding')!.amount,'580.00');
    assert.equal(report.items.length,100);assert.equal(report.total,5002);
    const frozen=await buildApAgingReport(reportClient,1,1,apAgingQuery.parse({runId:report.runId,disputedRunId:report.disputedRunId,unapprovedRunId:report.unapprovedRunId,page:2,pageSize:100}));
    assert.deepEqual(frozen.buckets,report.buckets);assert.equal(frozen.items.length,100);assert.notEqual(frozen.items[0].invoiceId,report.items[0].invoiceId);
    const runCount=(await reportClient.query('SELECT count(*)::int n FROM financial_reporting_runs')).rows[0].n;
    for(const invalid of [{page:0},{pageSize:26},{status:'APPROVED'},{asOf:'not-a-date'},{disputedRunId:report.disputedRunId}])
      assert.equal(apAgingQuery.safeParse(invalid).success,false,`Reject unsupported report input ${JSON.stringify(invalid)}`);
    await assert.rejects(buildApAgingReport(reportClient,2,2,apAgingQuery.parse({runId:report.runId})),/not available in your organization/);
    await assert.rejects(buildApAgingReport(reportClient,1,1,apAgingQuery.parse({runId:report.runId,disputedRunId:report.runId})),/not available in your organization/);
    await assert.rejects(buildApAgingReport(reportClient,1,1,apAgingQuery.parse({runId:report.disputedRunId})),/not available in your organization/);
    await assert.rejects(buildApAgingReport(reportClient,1,1,apAgingQuery.parse({runId:report.runId,supplierId:999})),/do not match the saved/);
    await assert.rejects(buildApAgingReport(reportClient,1,1,apAgingQuery.parse({runId:report.runId,asOf:'2020-01-01'})),/do not match the saved/);
    assert.equal((await reportClient.query('SELECT count(*)::int n FROM financial_reporting_runs')).rows[0].n,runCount,'Denied frozen-report enquiries must not create observations');
    console.log('Ten AP report-scope checks passed: page/size/filter/date validation, missing parent run, tenant denial, duplicate runs, wrong measures and frozen supplier/date mismatches.');
    console.log(`AP aging exact 5,000-invoice aggregate/frozen pagination parity passed in ${Math.round(performance.now()-started)}ms.`);
    await reportClient.query('COMMIT');
  }catch(error){await reportClient.query('ROLLBACK');throw error;}finally{reportClient.release();}
  assert.equal((await pool.query("SELECT count(*)::int n FROM ap_balance_events WHERE event_kind='CREATED'")).rows[0].n,5000);
  // Ten governed-correction checks over test-owned evidence only.
  const {prepareApCorrection}=await import('../server/modules/reports/ap-balance-baseline-service');
  await pool.query(`CREATE TABLE documents(id int PRIMARY KEY,organization_id int,entity_id int,entity_type text,archived_at timestamptz,checksum text);
    INSERT INTO documents VALUES(1,1,1,'invoice',NULL,'verified-test-document'),(2,2,3,'invoice',NULL,'other-tenant-document')`);
  const correctionInput={...author,invoiceId:1,targetEventId:String(opening.id),patch:{dueDate:'2026-12-01'},documentIds:[1],reason:'Reviewed historical due-date evidence'};
  await assert.rejects(prepareApCorrection({...correctionInput,documentIds:[]}),/Provide a reason/);
  await assert.rejects(prepareApCorrection({...correctionInput,patch:{supplierId:'2'}}),/supported correction fields/);
  await assert.rejects(prepareApCorrection({...correctionInput,documentIds:[2]}),/integrity-verified documents/);
  await assert.rejects(prepareApCorrection({...correctionInput,patch:{remainingBalance:'999'}}),/does not match/);
  await assert.rejects(prepareApCorrection({...correctionInput,organizationId:2}),/in your organization/);
  const changedDocument=await prepareApCorrection(correctionInput);
  await transition({...author,id:Number(changedDocument.id),action:'submit'});
  await assert.rejects(transition({...author,id:Number(changedDocument.id),action:'approve'},pool,approve),/different authorized/);
  await pool.query("UPDATE documents SET checksum='reviewed-new-test-document' WHERE id=1");
  await assert.rejects(transition({...reviewer,id:Number(changedDocument.id),action:'approve'},pool,approve),/documents changed/);
  const correction=await prepareApCorrection(correctionInput);
  await transition({...author,id:Number(correction.id),action:'submit'});
  const originalInvoice=(await pool.query('SELECT md5(to_jsonb(i)::text) revision FROM invoices i WHERE id=1')).rows[0].revision;
  const frozenEvidence=(await pool.query("SELECT id,evidence_hash FROM financial_reporting_runs WHERE organization_id=1 ORDER BY generated_at,id LIMIT 1")).rows[0];
  await pool.query(`CREATE FUNCTION fail_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='AP_CORRECTION_APPLIED' THEN RAISE EXCEPTION 'Injected correction audit failure'; END IF;RETURN NEW;END $$;
    CREATE TRIGGER fail_correction_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_correction_audit();`);
  await assert.rejects(transition({...reviewer,id:Number(correction.id),action:'approve'},pool,approve),/Injected correction audit failure/);
  assert.equal((await pool.query("SELECT count(*)::int n FROM ap_balance_events WHERE event_kind='CORRECTION'")).rows[0].n,0);
  await pool.query('DROP TRIGGER fail_correction_audit ON audit_logs');
  await Promise.all(Array.from({length:3},()=>transition({...reviewer,id:Number(correction.id),action:'approve'},pool,approve)));
  assert.equal((await pool.query("SELECT count(*)::int n FROM ap_balance_events WHERE event_kind='CORRECTION'")).rows[0].n,1);
  assert.equal((await pool.query('SELECT md5(to_jsonb(i)::text) revision FROM invoices i WHERE id=1')).rows[0].revision,originalInvoice);
  assert.equal((await pool.query('SELECT evidence_hash FROM financial_reporting_runs WHERE id=$1',[frozenEvidence.id])).rows[0].evidence_hash,frozenEvidence.evidence_hash);
  console.log('Ten governed correction checks passed: missing documents, forbidden fields, foreign documents, invalid balances, tenant denial, self-approval denial, changed evidence, audit rollback, concurrent retry and immutable source/frozen evidence.');
  const appliedCorrection=(await pool.query("SELECT * FROM ap_balance_events WHERE event_kind='CORRECTION'")).rows[0];
  assert.equal(String(appliedCorrection.target_event_id),String(opening.id));
  assert.equal(String(appliedCorrection.correction_request_id),String(correction.id));
  assert.equal(appliedCorrection.actor_user_id,reviewer.actorUserId);
  assert.equal(appliedCorrection.actor_provenance,'independently_approved_correction');
  assert.equal(new Date(appliedCorrection.effective_at).toISOString(),new Date(opening.effective_at).toISOString());
  assert.ok(new Date(appliedCorrection.recorded_at).getTime()>=new Date(opening.recorded_at).getTime());
  await assert.rejects(transition({...reviewer,id:Number(changedDocument.id),action:'approve'},pool,approve),/already been corrected/);
  await assert.rejects(pool.query("UPDATE ap_balance_events SET snapshot=snapshot WHERE id=$1",[appliedCorrection.id]),/immutable/);
  const correctedReader=await pool.connect();
  try{
    await correctedReader.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await correctedReader.query("SET LOCAL statement_timeout='15s'");
    const {apHistoricalEvidenceQuery}=await import('../server/modules/reports/ap-historical-balances');
    const correctionScope=await apObservationScope(correctedReader,1);
    const queryPlan=await correctedReader.query('EXPLAIN '+apHistoricalEvidenceQuery,[1,correctionScope.cutoff,correctionScope.observed,1,true]);
    assert.ok(queryPlan.rows.length,'The correction query must have an inspectable plan');
    const correctionTimings:number[]=[];let stableSources:string|null=null;
    for(let attempt=0;attempt<10;attempt++){
      const began=performance.now();
      const evidence=await readApHistoricalContributions(correctedReader,1,'ap_outstanding',{supplierId:1});
      correctionTimings.push(Math.round(performance.now()-began));
      const fingerprint=JSON.stringify(evidence.map(row=>[row.sourceId,row.balanceEventId,row.amount,row.exclusion]));
      if(stableSources!==null)assert.equal(fingerprint,stableSources,'Repeated correction evidence reads must be deterministic');
      stableSources=fingerprint;
      assert.equal(evidence.find(row=>row.sourceId==='1')?.exclusion,'unreconciled_balance');
    }
    console.log(`Ten corrected-history repeatability/performance checks passed under a 15-second statement timeout. Read durations (ms): ${correctionTimings.join(', ')}; explain-plan steps: ${queryPlan.rows.length}.`);
    const currentEvidence=await readApHistoricalContributions(correctedReader,1,'ap_outstanding',{supplierId:1});
    assert.equal(currentEvidence.find(row=>row.sourceId==='1')?.exclusion,'unreconciled_balance','Current source/history disagreements must not become approved totals');
    const {generateFinancialMeasure}=await import('../server/modules/reports/financial-measure-service');
    const fresh=await generateFinancialMeasure(correctedReader,{organizationId:1,actorUserId:1,measure:'ap_outstanding',filters:{supplierId:1}});
    assert.equal(fresh.amount,'500.00');assert.equal(fresh.state,'partial');
    await correctedReader.query('COMMIT');
  }catch(error){await correctedReader.query('ROLLBACK');throw error;}finally{correctedReader.release();}
  console.log('Ten correction-propagation checks passed: target/request links, independent actor/provenance, effective/publication timing, competing approval denial, immutability, reconciliation exclusion and fresh partial-total parity.');
  const countBefore=(await pool.query("SELECT count(*)::int n FROM ap_balance_events")).rows[0].n;
  await pool.query(migration);
  assert.equal((await pool.query("SELECT count(*)::int n FROM ap_balance_events")).rows[0].n,countBefore);
  console.log("AP history foundation passed: additive migration, no legacy reconstruction, independent baseline approval, atomic audit rollback, concurrent replay, stale review, actor provenance, immutable history and 5,000 invoice observations.");
}finally{
  await database?.end();
  if(created){assert.match(name,/^iss_ap_history_test_[a-f0-9]{32}$/);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}
  await owner.end();
}
