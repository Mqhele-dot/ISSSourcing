import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,mkdtemp,rm,readdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import "dotenv/config";
import {assertDisposableDatabaseUrl} from "../server/config/database-safety";
import {compactFullDetailMigrations} from "./release-migrations.mjs";
import {claimCompactLease,heartbeatCompactLease,cancelCompactJob,expireCompactLeases,withCompactPublicationFence} from "../server/modules/exports/compact-export-leases";
import {captureCompactSpool} from "../server/modules/exports/compact-capture-spool";
import {runLeasedCompactWorker} from "../server/modules/exports/compact-leased-worker";
import {initializeCompactAuditFixture} from './runtime-fixtures/compact-audit-fixture';
import {verifyAuditChainWithClient} from '../server/services/audit-chain-client';
if(!process.argv.includes("--local-disposable"))throw new Error("Use --local-disposable; no application database is a mutation target.");
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);
assert.ok(configured,"Local PostgreSQL configuration is required.");
const url=new URL(configured);assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));url.pathname="/postgres";
const name=`iss_export_test_${randomUUID().replaceAll("-","")}`;const owner=new pg.Client({connectionString:url.toString()});let created=false;let db:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),"iss-lease-worker-test-"));
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);
  url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString()});assert.equal((await db.query("SELECT current_database() name")).rows[0].name,name);
  await initializeCompactAuditFixture(db,name);
  await db.query(`CREATE TABLE export_jobs(id serial PRIMARY KEY,organization_id integer NOT NULL,created_by integer NOT NULL,dataset text NOT NULL DEFAULT 'synthetic',filters jsonb NOT NULL DEFAULT '{}',format text NOT NULL DEFAULT 'excel',status text NOT NULL DEFAULT 'queued',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz,completed_at timestamptz,started_at timestamptz,attempts integer NOT NULL DEFAULT 0,last_error text);
    INSERT INTO export_jobs(organization_id,created_by) VALUES(1,1),(1,1),(2,2),(2,2)`);
  for(const migration of compactFullDetailMigrations){const sql=await readFile(new URL(`../migrations/${migration}`,import.meta.url),"utf8");await db.query(sql);await db.query(sql);}
  await db.query("UPDATE export_jobs SET profile='compact_excel'");
  const [a,b]=await Promise.all([claimCompactLease(db,{organizationId:1,serverId:"server-a"}),claimCompactLease(db,{organizationId:1,serverId:"server-b"})]);
  const first=a??b;assert.ok(first);assert.equal(Number(Boolean(a))+Number(Boolean(b)),1);
  const server=(await db.query("SELECT server_id FROM compact_export_attempts WHERE id=$1",[first.id])).rows[0].server_id;
  assert.equal(await claimCompactLease(db,{organizationId:2,serverId:server}),null);
  const other=await claimCompactLease(db,{organizationId:2,serverId:"server-c"});assert.ok(other);
  const heartbeat={organizationId:1,attemptId:first.id,leaseToken:first.lease_token,stage:"writing" as const};
  assert.equal(await heartbeatCompactLease(db,heartbeat),true);
  assert.equal(await heartbeatCompactLease(db,{...heartbeat,organizationId:2}),false);
  assert.equal(await heartbeatCompactLease(db,{...heartbeat,leaseToken:randomUUID()}),false);
  assert.equal(await heartbeatCompactLease(db,{...heartbeat,stage:"capturing"}),false);
  assert.equal(await cancelCompactJob(db,{organizationId:2,actorId:1,jobId:first.job_id}),false);
  assert.equal(await cancelCompactJob(db,{organizationId:1,actorId:99,jobId:first.job_id}),false);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0,'Denied cancellation creates no audit event');
  // Audit is part of the cancellation transaction, not best-effort logging.
  await db.query(`CREATE FUNCTION reject_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='COMPACT_EXPORT_CANCELLED' THEN RAISE EXCEPTION 'Injected cancellation audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_cancel_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_cancel_audit()`);
  await assert.rejects(cancelCompactJob(db,{organizationId:1,actorId:1,jobId:first.job_id}),/Injected cancellation audit failure/);
  assert.equal((await db.query('SELECT status FROM export_jobs WHERE id=$1',[first.job_id])).rows[0].status,'running');
  assert.equal((await db.query('SELECT stage,finished_at FROM compact_export_attempts WHERE id=$1',[first.id])).rows[0].finished_at,null);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0);
  await db.query('DROP TRIGGER reject_cancel_audit ON audit_logs; DROP FUNCTION reject_cancel_audit()');
  const cancellations=await Promise.all([cancelCompactJob(db,{organizationId:1,actorId:1,jobId:first.job_id}),cancelCompactJob(db,{organizationId:1,actorId:1,jobId:first.job_id})]);
  assert.deepEqual(cancellations.sort(),[false,true]);
  const cancellationAudit=(await db.query('SELECT user_id,organization_id,action,resource_type,resource_id,details FROM audit_logs WHERE resource_id=$1',[first.job_id])).rows;
  assert.deepEqual(cancellationAudit,[{user_id:1,organization_id:1,action:'COMPACT_EXPORT_CANCELLED',resource_type:'export_job',resource_id:first.job_id,details:{before:null,after:null,systemActor:null,outcome:'cancelled',publication:'none'}}]);
  assert.equal(await cancelCompactJob(db,{organizationId:1,actorId:1,jobId:first.job_id}),false);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs WHERE resource_id=$1',[first.job_id])).rows[0].n,1);
  assert.equal(await heartbeatCompactLease(db,heartbeat),false);
  const next=await claimCompactLease(db,{organizationId:1,serverId:server});assert.ok(next);
  await db.query("UPDATE compact_export_attempts SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[next.id]);
  assert.equal(await heartbeatCompactLease(db,{...heartbeat,attemptId:next.id,leaseToken:next.lease_token}),false);
  assert.equal(await expireCompactLeases(db),1);assert.equal(await expireCompactLeases(db),0);
  assert.equal((await db.query("SELECT stage FROM compact_export_attempts WHERE id=$1",[next.id])).rows[0].stage,"interrupted");
  assert.match((await db.query("SELECT last_error FROM export_jobs WHERE id=$1",[next.job_id])).rows[0].last_error,/INTERRUPTED/);
  // Connection restart does not erase cancelled/interrupted evidence.
  await db.end();db=new pg.Pool({connectionString:url.toString()});
  assert.equal((await db.query("SELECT count(*)::int n FROM compact_export_attempts WHERE finished_at IS NOT NULL")).rows[0].n,2);
  // Atomic rollback if the parent job transition fails.
  await cancelCompactJob(db,{organizationId:2,actorId:2,jobId:other.job_id});
  await db.query(`CREATE FUNCTION reject_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='running' THEN RAISE EXCEPTION 'Injected transition failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_claim BEFORE UPDATE ON export_jobs FOR EACH ROW EXECUTE FUNCTION reject_claim()`);
  await assert.rejects(claimCompactLease(db,{organizationId:2,serverId:"server-d"}),/Injected/);
  assert.equal((await db.query("SELECT count(*)::int n FROM compact_export_attempts WHERE finished_at IS NULL")).rows[0].n,0);
  await db.query("DROP TRIGGER reject_claim ON export_jobs; DROP FUNCTION reject_claim()");
  await db.query("ALTER TABLE export_jobs ADD COLUMN file_path text, ADD COLUMN file_size bigint, ADD COLUMN mime_type text");
  await db.query("INSERT INTO export_jobs(organization_id,created_by,profile) VALUES(1,1,'compact_excel'),(1,1,'compact_excel')");
  const scope={organizationId:1,actorId:1,observationReference:"test-lease-capture",dataset:"synthetic",schemaVersion:"v1",columns:["id"],normalizedFilters:{}};
  const capture=await captureCompactSpool({...scope,root,rows:(async function*(){for(let i=0;i<1000;i++)yield {id:String(i).padStart(8,"0")};})()});
  const running=await claimCompactLease(db,{organizationId:1,serverId:"integration"});assert.ok(running);
  const identity={organizationId:1,attemptId:running.id,leaseToken:running.lease_token};
  const request={captureDirectory:capture.directory,outputRoot:root,jobId:running.job_id,scope,columns:[{key:"id",label:"ID",kind:"identifier" as const}]};
  const beforeMismatch=(await readdir(root)).sort();
  for(const mismatch of [{scope:{...scope,dataset:'wrong'}},{scope:{...scope,normalizedFilters:{q:'wrong'}}},{jobId:running.job_id+100}])await assert.rejects(runLeasedCompactWorker(db,identity,{...request,...mismatch}),/does not match/);
  assert.deepEqual((await readdir(root)).sort(),beforeMismatch,'Mismatched job settings must not start a child or create output');
  const output=await runLeasedCompactWorker(db,identity,request);assert.equal(output.processedRows,1000);
  assert.equal(output.validationState,'independently_validated');assert.equal(output.validation.verifiedRows,1000);
  const bound={jobId:running.job_id,actorId:scope.actorId,dataset:scope.dataset,filters:scope.normalizedFilters};
  const jobSettings=(await db.query('SELECT dataset,filters,created_by,profile,status,format FROM export_jobs WHERE id=$1',[running.job_id])).rows[0];
  for(const [field,value]of [['dataset','wrong'],['filters',{q:'different'}],['created_by',99],['profile','standard'],['status','failed'],['format','csv']] as const){
    const beforeLease=(await db.query('SELECT lease_until,heartbeat_at FROM compact_export_attempts WHERE id=$1',[running.id])).rows[0];
    await db.query(`UPDATE export_jobs SET ${field}=$2 WHERE id=$1`,[running.job_id,value]);
    assert.equal(await heartbeatCompactLease(db,{...identity,stage:'validating',binding:bound}),false,`${field} changes must fence lease renewal`);
    assert.deepEqual((await db.query('SELECT lease_until,heartbeat_at FROM compact_export_attempts WHERE id=$1',[running.id])).rows[0],beforeLease,'Rejected renewal cannot extend the lease');
    await db.query(`UPDATE export_jobs SET ${field}=$2 WHERE id=$1`,[running.job_id,jobSettings[field]]);
  }
  assert.equal(await heartbeatCompactLease(db,{...identity,stage:'validating',binding:bound}),true);
  assert.equal((await db.query("SELECT stage FROM compact_export_attempts WHERE id=$1",[running.id])).rows[0].stage,"validating");
  assert.equal((await db.query("SELECT status FROM export_jobs WHERE id=$1",[running.job_id])).rows[0].status,"running","Validated output must still pass access and publication fences before becoming downloadable");
  // Publication callback failure rolls back all metadata and keeps the lease.
  await assert.rejects(withCompactPublicationFence(db,identity,async client=>{await client.query("UPDATE export_jobs SET file_path='rollback-test' WHERE id=$1",[running.job_id]);throw new Error("Injected publication failure");}),/Injected/);
  assert.equal((await db.query("SELECT file_path FROM export_jobs WHERE id=$1",[running.job_id])).rows[0].file_path,null);
  await cancelCompactJob(db,{organizationId:1,actorId:1,jobId:running.job_id});
  let publicationInvoked=false;
  await assert.rejects(withCompactPublicationFence(db,identity,async()=>{publicationInvoked=true;}),/lease/);assert.equal(publicationInvoked,false);
  const cancelled=await claimCompactLease(db,{organizationId:1,serverId:"integration"});assert.ok(cancelled);
  const before=(await readdir(root)).sort();let cancellation:Promise<boolean>|undefined;
  await assert.rejects(runLeasedCompactWorker(db,{organizationId:1,attemptId:cancelled.id,leaseToken:cancelled.lease_token},{...request,jobId:cancelled.job_id},{onStarted:()=>{cancellation=cancelCompactJob(db!,{organizationId:1,actorId:1,jobId:cancelled.job_id});}}),/cancelled|lost/);
  assert.equal(await cancellation,true);assert.deepEqual((await readdir(root)).sort(),before);
  assert.equal((await db.query("SELECT stage FROM compact_export_attempts WHERE id=$1",[cancelled.id])).rows[0].stage,"cancelled");
  await db.query("INSERT INTO export_jobs(organization_id,created_by,profile) VALUES(1,1,'compact_excel')");
  const changed=await claimCompactLease(db,{organizationId:1,serverId:'integration'});assert.ok(changed);
  let mutation:Promise<unknown>|undefined;
  await assert.rejects(runLeasedCompactWorker(db,{organizationId:1,attemptId:changed.id,leaseToken:changed.lease_token},{...request,jobId:changed.job_id},{onStarted:()=>{mutation=db!.query('UPDATE export_jobs SET filters=$2::jsonb WHERE id=$1',[changed.job_id,JSON.stringify({q:'changed after claim'})]);}}),/cancelled|lost/);await mutation;
  assert.equal((await db.query('SELECT status FROM export_jobs WHERE id=$1',[changed.job_id])).rows[0].status,'failed');
  const auditor=await db.connect();try{assert.equal((await verifyAuditChainWithClient(auditor,1)).valid,true);assert.equal((await verifyAuditChainWithClient(auditor,2)).valid,true);}finally{auditor.release();}
  console.log(JSON.stringify({status:"passed",testDatabase:name,checks:["migration idempotency","concurrent claim deduplication","organization/server limits","lease-token fencing","job/dataset/filter/format binding","mismatched settings create no output","post-claim setting changes stop generation","stage monotonicity","scoped cancellation","concurrent cancellation audit deduplication","audit failure rolls back job and attempt","secret-free canonical cancellation evidence","audit hash chains","expiry recovery","restart persistence","atomic rollback"],limitations:"Internal scheduling services only; no automatic production job enablement or publication."}));
}finally{
  await db?.end();if(created){await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});
}
