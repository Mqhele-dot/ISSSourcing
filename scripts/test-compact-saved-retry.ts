import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import ExcelJS from 'exceljs';
import {EventEmitter} from 'node:events';
import type {Server} from 'node:http';
import 'dotenv/config';
import {assertDisposableDatabaseUrl} from '../server/config/database-safety';
import {compactFullDetailMigrations,compactPublicationMigrations,compactWorkspaceMigrations,compactCaptureMigrations,compactRetryMigrations} from './release-migrations.mjs';
import {initializeCompactAuditFixture} from './runtime-fixtures/compact-audit-fixture';
import {executeCompactOperationalJob,CompactPipelineFailure} from '../server/modules/exports/compact-operational-controller';
import {queueCompactSavedRetry} from '../server/modules/exports/compact-saved-retry';
import {cancelCompactJob,claimCompactLease} from '../server/modules/exports/compact-export-leases';
import {cleanupCompactWorkspace,listCompactCleanupCandidates} from '../server/modules/exports/compact-workspaces';
import {runCompactMaintenanceCycle,startCompactMaintenanceWorker,startConfiguredCompactMaintenanceWorker} from '../server/modules/exports/compact-maintenance-worker';
import {verifyAuditChainWithClient} from '../server/services/audit-chain-client';

if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; no business database is a mutation target.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false,db:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-saved-retry-'));
const input={root,storageId:'saved-retry-test',organizationId:1,serverId:'retry-server',columns:['name'],policy:{temporaryBytes:4*1024**2,organizationTemporaryBytes:128*1024**2,totalTemporaryBytes:256*1024**2,organizationRetainedBytes:10_000_000,totalRetainedBytes:50_000_000,retentionDays:7,tokenTtlMinutes:30}};
let maintenance:ReturnType<typeof startCompactMaintenanceWorker>|undefined;
async function enqueue(){return Number((await db!.query("INSERT INTO export_jobs(organization_id,created_by,dataset,filters,profile) VALUES(1,1,'suppliers','{}','compact_excel') RETURNING id")).rows[0].id);}
async function job(id:number){return(await db!.query('SELECT * FROM export_jobs WHERE id=$1',[id])).rows[0];}
async function savedCapture(id:number){return(await db!.query('SELECT * FROM compact_export_captures WHERE job_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1',[id])).rows[0];}
const command=(jobId:number,commandId=randomUUID())=>({organizationId:1,actorId:1,jobId,commandId});
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);
  url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString(),max:4,connectionTimeoutMillis:5000});assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await initializeCompactAuditFixture(db,name);
  await db.query(`CREATE TABLE organizations(id int PRIMARY KEY,active boolean);INSERT INTO organizations VALUES(1,true),(2,true);
    CREATE TABLE users(id int PRIMARY KEY,active boolean,warehouse_id int,preferences jsonb);INSERT INTO users VALUES(1,true,NULL,'{}');
    CREATE TABLE organization_members(id serial PRIMARY KEY,organization_id int,user_id int,application_role text,active boolean,status text);INSERT INTO organization_members(organization_id,user_id,application_role,active,status) VALUES(1,1,'admin',true,'active');
    CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int,name text,email text,phone text,default_currency_code text,status text,created_at timestamp);
    INSERT INTO suppliers SELECT i,1,'Supplier '||i,NULL,NULL,'ZAR','active','2020-01-01' FROM generate_series(1,5000)i;
    CREATE TABLE export_jobs(id serial PRIMARY KEY,organization_id int NOT NULL,created_by int NOT NULL,dataset text NOT NULL,filters jsonb NOT NULL,format text NOT NULL DEFAULT 'excel',status text NOT NULL DEFAULT 'queued',retry_of_job_id int,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz,completed_at timestamptz,started_at timestamptz,attempts int NOT NULL DEFAULT 0,last_error text,file_name text,file_path text,file_size bigint,mime_type text,row_count int,download_token text,download_token_expires_at timestamptz,retention_expires_at timestamptz)`);
  for(const migration of [...compactFullDetailMigrations,...compactPublicationMigrations,...compactWorkspaceMigrations,...compactCaptureMigrations,...compactRetryMigrations]){const sql=await readFile(new URL(`../migrations/${migration}`,import.meta.url),'utf8');await db.query(sql);await db.query(sql);}
  await writeFile(path.join(root,'unrelated.txt'),'preserve');
  const original=await enqueue();
  await assert.rejects(executeCompactOperationalJob(db,input,{onProgress:event=>{if(event.stage==='captured')throw new Error('Injected failure after complete source capture');}}),CompactPipelineFailure);
  const source=await savedCapture(original);assert.equal(Number(source.source_rows),5000);assert.equal((await job(original)).status,'failed');
  await db.query("UPDATE compact_export_attempts SET finished_at=clock_timestamp()-interval '36 minutes' WHERE job_id=$1",[original]);
  const beforeAuditFailure=command(original);
  await db.query(`CREATE FUNCTION reject_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='COMPACT_EXPORT_RETRY_QUEUED' THEN RAISE EXCEPTION 'Injected retry audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_retry_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_retry_audit()`);
  await assert.rejects(queueCompactSavedRetry(db,beforeAuditFailure),/Injected retry audit failure/);assert.equal((await job(original)).status,'failed');
  await db.query('DROP TRIGGER reject_retry_audit ON audit_logs; DROP FUNCTION reject_retry_audit()');
  await assert.rejects(queueCompactSavedRetry(db,{...command(original),organizationId:2}),/not available/);
  await assert.rejects(queueCompactSavedRetry(db,{...command(original),actorId:99}),/not available/);
  await db.query('UPDATE organization_members SET active=false');await assert.rejects(queueCompactSavedRetry(db,command(original)),/active organization access/);await db.query('UPDATE organization_members SET active=true');
  await db.query('UPDATE export_jobs SET filters=$2::jsonb WHERE id=$1',[original,JSON.stringify({q:'changed'})]);await assert.rejects(queueCompactSavedRetry(db,command(original)),/No retained verified capture/);await db.query("UPDATE export_jobs SET filters='{}' WHERE id=$1",[original]);
  const firstCommand=command(original),queued=await Promise.all([queueCompactSavedRetry(db,firstCommand),queueCompactSavedRetry(db,firstCommand)]);
  assert.deepEqual(queued.map(value=>value.replayed).sort(),[false,true]);assert.ok(queued.every(value=>value.jobId===original&&value.captureId===source.id));
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE request_id=$1 AND action='COMPACT_EXPORT_RETRY_QUEUED'",[firstCommand.commandId])).rows[0].n,1);
  assert.equal((await cleanupCompactWorkspace(db,{...input,workspaceId:source.workspace_id})).status,'not_eligible','Queued retry pins its old capture');
  assert.equal((await listCompactCleanupCandidates(db,input)).length,0);
  await db.end();db=new pg.Pool({connectionString:url.toString(),max:4,connectionTimeoutMillis:5000});assert.equal((await queueCompactSavedRetry(db,firstCommand)).replayed,true);
  // Any operational SELECT against suppliers now fails. A saved-source retry
  // must still complete its copy; this is stronger than checking result labels.
  await db.query('ALTER TABLE suppliers RENAME TO suppliers_not_available_to_export');
  await assert.rejects(executeCompactOperationalJob(db,input,{onProgress:async event=>{
    if(event.stage==='captured'){
      const copied=await savedCapture(original);assert.notEqual(copied.id,source.id);assert.equal(copied.capture_sha256,source.capture_sha256);assert.deepEqual(copied.scope,source.scope);
      assert.equal((await cleanupCompactWorkspace(db!,{...input,workspaceId:source.workspace_id})).status,'not_eligible');
      assert.equal(await cancelCompactJob(db!,command(original)),true);
    }
  }}),CompactPipelineFailure);
  assert.equal((await cleanupCompactWorkspace(db,{...input,workspaceId:source.workspace_id})).status,'not_eligible','Cancellation cannot release an older capture while a new worker may still be stopping');
  const secondCommand=command(original);await queueCompactSavedRetry(db,secondCommand);
  await assert.rejects(executeCompactOperationalJob(db,{...input,columns:['email']}),CompactPipelineFailure);assert.equal((await job(original)).file_path,null);
  const thirdCommand=command(original);await queueCompactSavedRetry(db,thirdCommand);
  const completed=await executeCompactOperationalJob(db,input);assert.equal(completed.status,'succeeded');if(completed.status!=='succeeded')throw new Error('Expected saved retry completion');assert.equal(completed.rows,5000);
  const finished=await job(original);assert.equal(finished.attempts,4);assert.equal((await savedCapture(original)).capture_sha256,source.capture_sha256);
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.resolve(finished.file_path));const value=book.getWorksheet('Data 1')!.getCell('A2').value;
  assert.deepEqual(value,{richText:[{text:'Supplier 1'}]});
  const terminal=await job(original);assert.equal((await queueCompactSavedRetry(db,firstCommand)).replayed,true);assert.deepEqual(await job(original),terminal,'Old network retry must not reopen a completed workbook');
  await assert.rejects(queueCompactSavedRetry(db,command(original)),/Only an unpublished failed/);
  await db.query('ALTER TABLE suppliers_not_available_to_export RENAME TO suppliers');
  const absent=await enqueue();await db.query("UPDATE export_jobs SET status='failed' WHERE id=$1",[absent]);await assert.rejects(queueCompactSavedRetry(db,command(absent)),/No retained verified capture/);
  await assert.rejects(queueCompactSavedRetry(db,{...firstCommand,jobId:absent}),/belongs to another request/);
  const tampered=await enqueue();await assert.rejects(executeCompactOperationalJob(db,input,{onProgress:event=>{if(event.stage==='captured')throw new Error('Injected stop');}}),CompactPipelineFailure);
  const corrupt=await savedCapture(tampered);await writeFile(path.join(root,'org-1',`workspace-${corrupt.workspace_id}`,'captures',corrupt.capture_directory,'rows.jsonl'),'{}\n');
  await queueCompactSavedRetry(db,command(tampered));await db.query('ALTER TABLE suppliers RENAME TO suppliers_not_available_to_export');
  await assert.rejects(executeCompactOperationalJob(db,input),CompactPipelineFailure);assert.equal((await job(tampered)).file_path,null,'Tamper must never cause a fresh-source fallback');
  await db.query('ALTER TABLE suppliers_not_available_to_export RENAME TO suppliers');
  // Cleanup audit failures retain the durable reservation, even if the files
  // were already removed. An automatic retry finishes the same exact workspace.
  await db.query("UPDATE compact_export_attempts SET finished_at=clock_timestamp()-interval '36 minutes' WHERE finished_at IS NOT NULL");
  await db.query(`CREATE FUNCTION reject_cleanup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='COMPACT_WORKSPACE_REMOVED' THEN RAISE EXCEPTION 'Injected cleanup audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_cleanup_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_cleanup_audit()`);
  const blocked=await cleanupCompactWorkspace(db,{...input,workspaceId:corrupt.workspace_id});assert.equal(blocked.status,'blocked');assert.equal((await db.query('SELECT state FROM compact_export_workspaces WHERE id=$1',[corrupt.workspace_id])).rows[0].state,'cleanup_blocked');
  await db.query('DROP TRIGGER reject_cleanup_audit ON audit_logs; DROP FUNCTION reject_cleanup_audit()');
  const cycles=await Promise.all([runCompactMaintenanceCycle(db,input),runCompactMaintenanceCycle(db,input)]);assert.ok(cycles.reduce((n,result)=>n+result.removed,0)>=1);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='COMPACT_WORKSPACE_REMOVED' AND details->>'workspaceId'=$1",[corrupt.workspace_id])).rows[0].n,1);
  await assert.rejects(queueCompactSavedRetry(db,command(tampered)),/No retained verified capture/);
  const expiredId=await enqueue(),expired=await claimCompactLease(db,{organizationId:1,serverId:'expired-server'});assert.ok(expired);assert.equal(expired.job_id,expiredId);await db.query("UPDATE compact_export_attempts SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.id]);
  let successes=0,failures=0;let resolveTicks:()=>void=()=>undefined;
  const ticks=new Promise<void>(resolve=>{resolveTicks=resolve;});
  maintenance=startCompactMaintenanceWorker(db,input,{intervalMs:1000,onFailure:()=>{failures++;},onResult:()=>{if(++successes===2)resolveTicks();}});
  const timeout=setTimeout(()=>resolveTicks(),6000);await ticks;clearTimeout(timeout);await maintenance.stop();maintenance=undefined;assert.ok(successes>=2);assert.equal(failures,0);
  assert.equal((await job(expiredId)).status,'failed');assert.equal((await db.query('SELECT stage FROM compact_export_attempts WHERE id=$1',[expired.id])).rows[0].stage,'interrupted');
  const server=new EventEmitter() as Server,neverQuery={query:async()=>{throw new Error('Disabled maintenance must not query a database');}} as unknown as pg.Pool;
  assert.equal(await startConfiguredCompactMaintenanceWorker(neverQuery,server,{}, {onFailure:()=>{throw new Error('Not expected');}}),undefined);
  assert.equal(await startConfiguredCompactMaintenanceWorker(neverQuery,server,{ENABLE_COMPACT_EXPORT_MAINTENANCE:'1',NODE_ENV:'test'}, {onFailure:()=>{throw new Error('Not expected');}}),undefined);
  const configured={ENABLE_COMPACT_EXPORT_MAINTENANCE:'1',ENABLE_TEST_COMPACT_MAINTENANCE:'1',NODE_ENV:'test',COMPACT_PRIVATE_STORAGE_ROOT:root,COMPACT_PRIVATE_STORAGE_ID:input.storageId};
  await assert.rejects(startConfiguredCompactMaintenanceWorker(db,server,{...configured,COMPACT_PRIVATE_STORAGE_ROOT:'relative'}, {onFailure:()=>{}}),/absolute private root/);
  await db.query('ALTER INDEX compact_retry_command_uidx RENAME TO compact_retry_command_not_ready');
  await assert.rejects(startConfiguredCompactMaintenanceWorker(db,server,configured,{onFailure:()=>{}}),/approved Compact lifecycle migrations/);
  await db.query('ALTER INDEX compact_retry_command_not_ready RENAME TO compact_retry_command_uidx');
  let configuredCycles=0;maintenance=await startConfiguredCompactMaintenanceWorker(db,server,configured,{onFailure:()=>{failures++;},onResult:()=>{configuredCycles++;}});
  assert.ok(maintenance);server.emit('close');await maintenance.stop();maintenance=undefined;assert.equal(configuredCycles,1);assert.equal(failures,0);
  const closingServer=new EventEmitter() as Server;
  const closingDatabase={query:async()=>{closingServer.emit('close');return {rows:[{ready:true}]};}} as unknown as pg.Pool;
  assert.equal(await startConfiguredCompactMaintenanceWorker(closingDatabase,closingServer,configured,{onFailure:()=>{throw new Error('Closed server must not start a worker');}}),undefined);
  await access(path.resolve(finished.file_path));assert.equal(await readFile(path.join(root,'unrelated.txt'),'utf8'),'preserve');
  const auditor=await db.connect();try{assert.equal((await verifyAuditChainWithClient(auditor,1)).valid,true);assert.equal((await verifyAuditChainWithClient(auditor,2)).checked,0);}finally{auditor.release();}
  const events=await db.query("SELECT action,details FROM audit_logs WHERE action IN ('COMPACT_EXPORT_RETRY_QUEUED','COMPACT_WORKSPACE_REMOVED')");assert.doesNotMatch(JSON.stringify(events.rows),/leaseToken|downloadToken|file_path|Supplier 1|postgresql:/);
  console.log(JSON.stringify({status:'passed',testDatabase:name,sourceRows:5000,generationAttempts:finished.attempts,checks:['same-job append-only attempts','retry audit rollback','concurrent command idempotency','restart replay','tenant/owner/revoked membership denial','changed filters/columns denial','source table absent during retry proves no live reads','captured bytes/scope unchanged','queued/running and recently cancelled retries pin old capture','tamper never falls back','successful publication from saved capture','old command cannot reopen success','cleaned capture refuses retry','cleanup audit failure preserves reservation','concurrent cleanup emits one audit event','real maintenance timer and lease expiry','bootstrap default-off without database queries','explicit isolated-test worker opt-in','missing schema/configuration refuses startup','server close drains work and prevents late startup','published and unrelated files retained','canonical audit hash chain'],limits:'Public Compact API/UI remain disabled. Housekeeping bootstrap requires explicit configuration and approved migrations; this test does not enable it in the local application.'}));
}finally{
  await maintenance?.stop();await db?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});console.log('Removed exact test-owned saved-retry root.');
}
