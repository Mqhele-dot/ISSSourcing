import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import 'dotenv/config';
import {assertDisposableDatabaseUrl} from '../server/config/database-safety';
import {compactFullDetailMigrations,compactPublicationMigrations,compactWorkspaceMigrations,compactCaptureMigrations} from './release-migrations.mjs';
import {initializeCompactAuditFixture} from './runtime-fixtures/compact-audit-fixture';
import {readExpiredExportFiles,type ExpiredExportFile} from '../server/modules/exports/expired-export-files';
import {createExportRetentionTask} from '../server/modules/exports/export-retention-task';
import {removeExportFile} from '../server/modules/exports/export-file-store';
import {cleanupCompactWorkspace} from '../server/modules/exports/compact-workspaces';
import {runCompactMaintenanceCycle} from '../server/modules/exports/compact-maintenance-worker';
import {verifyAuditChainWithClient} from '../server/services/audit-chain-client';
import type * as Pipeline from '../server/modules/exports/compact-operational-controller';

if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; business databases are never mutation targets.');
const implementation:typeof Pipeline=process.env.COMPACT_BUILT_CONTROLLER?await import(pathToFileURL(process.env.COMPACT_BUILT_CONTROLLER).href):await import('../server/modules/exports/compact-operational-controller');
assert.equal(typeof implementation.expireObservedExportFile,'function','Rebuild the packaged retention entry; no source fallback is permitted.');
const {executeCompactOperationalJob,expireObservedExportFile}=implementation;
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false,db:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-retained-chain-')),privateRoot=path.join(root,'private');await mkdir(privateRoot);
const input={root:privateRoot,storageId:'retained-chain',organizationId:1,serverId:'retained-chain',columns:['name'],policy:{temporaryBytes:4*1024**2,organizationTemporaryBytes:16*1024**2,totalTemporaryBytes:32*1024**2,organizationRetainedBytes:10_000_000,totalRetainedBytes:20_000_000,retentionDays:7,tokenTtlMinutes:30}};
async function job(id:number){return(await db!.query('SELECT * FROM export_jobs WHERE id=$1',[id])).rows[0];}
async function evidence(id:number){return(await readExpiredExportFiles(db!)).find(row=>row.id===id)!;}
async function retainedBytes(){return(await db!.query('SELECT coalesce(sum(p.file_size),0)::text n FROM compact_export_publications p JOIN export_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id WHERE j.file_path IS NOT NULL')).rows[0].n;}
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString(),max:5,connectionTimeoutMillis:5000});assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await initializeCompactAuditFixture(db,name);
  await db.query(`CREATE TABLE organizations(id int PRIMARY KEY,active boolean);INSERT INTO organizations VALUES(1,true),(2,true);
    CREATE TABLE users(id int PRIMARY KEY,active boolean,warehouse_id int,preferences jsonb);INSERT INTO users VALUES(1,true,NULL,'{}');
    CREATE TABLE organization_members(id serial PRIMARY KEY,organization_id int,user_id int,application_role text,active boolean,status text);INSERT INTO organization_members(organization_id,user_id,application_role,active,status) VALUES(1,1,'admin',true,'active');
    CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int,name text,email text,phone text,default_currency_code text,status text,created_at timestamp);INSERT INTO suppliers SELECT i,1,'Supplier '||i,NULL,NULL,'ZAR','active','2020-01-01' FROM generate_series(1,5000)i;
    CREATE TABLE export_jobs(id serial PRIMARY KEY,organization_id int NOT NULL,created_by int NOT NULL,dataset text NOT NULL,filters jsonb NOT NULL DEFAULT '{}',format text NOT NULL DEFAULT 'excel',status text NOT NULL DEFAULT 'queued',retry_of_job_id int,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz,completed_at timestamptz,started_at timestamptz,attempts int NOT NULL DEFAULT 0,last_error text,file_name text,file_path text,file_size bigint,mime_type text,row_count int,download_token text,download_token_expires_at timestamptz,retention_expires_at timestamptz)`);
  for(const migration of [...compactFullDetailMigrations,...compactPublicationMigrations,...compactWorkspaceMigrations,...compactCaptureMigrations]){const sql=await readFile(new URL(`../migrations/${migration}`,import.meta.url),'utf8');await db.query(sql);await db.query(sql);}
  const keep=path.join(root,'unrelated-tenant.txt');await writeFile(keep,'preserve unrelated evidence');
  const id=Number((await db.query("INSERT INTO export_jobs(organization_id,created_by,dataset,profile) VALUES(1,1,'suppliers','compact_excel') RETURNING id")).rows[0].id);
  const completed=await executeCompactOperationalJob(db,input);assert.equal(completed.status,'succeeded');if(completed.status!=='succeeded')throw new Error('Expected publication');
  const saved=await job(id),originalProof=(await db.query('SELECT * FROM compact_export_publications WHERE job_id=$1',[id])).rows[0],originalCapture=(await db.query('SELECT * FROM compact_export_captures WHERE job_id=$1',[id])).rows[0];
  assert.equal(saved.row_count,5000);await access(path.resolve(saved.file_path));
  const future:ExpiredExportFile={id,organizationId:1,primaryFilePath:saved.file_path,filePaths:[saved.file_path]};
  assert.equal((await expireObservedExportFile(db,future)).status,'skipped');await access(path.resolve(saved.file_path));
  await db.query("UPDATE compact_export_attempts SET finished_at=clock_timestamp()-interval '36 minutes' WHERE job_id=$1",[id]);
  assert.equal((await cleanupCompactWorkspace(db,{...input,workspaceId:completed.workspaceId})).status,'not_eligible');
  // One bounded discovery uses two queries, not a query per expired record.
  await db.query(`INSERT INTO export_jobs(organization_id,created_by,dataset,profile,status,file_path,retention_expires_at) SELECT 1,1,'retention-volume','standard','succeeded','unused-test-file-'||i,'2020-01-01' FROM generate_series(1,5000)i`);
  let discoveryQueries=0;const tracked={query:async(sql:string,values?:unknown[])=>{discoveryQueries++;return db!.query(sql,values);}} as Pick<pg.Pool,'query'>;
  const bounded=await readExpiredExportFiles(tracked);assert.equal(discoveryQueries,2);assert.equal(bounded.length,100);assert.ok(bounded.every((row,index)=>index===0||row.id>bounded[index-1].id));
  assert.equal((await db.query("SELECT count(*)::int n FROM export_jobs WHERE dataset='retention-volume'")).rows[0].n,5000);
  await db.query("UPDATE export_jobs SET retention_expires_at=clock_timestamp()+interval '1 year' WHERE dataset='retention-volume'");
  const legacy=path.join(root,'legacy.csv');await writeFile(legacy,'synthetic legacy export');
  const legacyId=Number((await db.query("INSERT INTO export_jobs(organization_id,created_by,dataset,profile,status,file_path,retention_expires_at) VALUES(1,1,'legacy','standard','succeeded',$1,clock_timestamp()-interval '1 second') RETURNING id",[legacy])).rows[0].id);
  assert.equal((await expireObservedExportFile(db,await evidence(legacyId))).status,'expired');await assert.rejects(access(legacy),/ENOENT/);
  await db.query('CREATE TABLE export_artifacts(job_id int,organization_id int,file_path text)');
  await db.query('INSERT INTO export_artifacts VALUES($1,2,$2)',[id,keep]);
  await db.query("UPDATE export_jobs SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
  const observed=await evidence(id);assert.deepEqual(observed.filePaths,[saved.file_path]);
  const marker=path.join(privateRoot,'org-1',`workspace-${completed.workspaceId}`,'.compact-workspace.json'),markerBytes=await readFile(marker);await writeFile(marker,'{}');
  await assert.rejects(expireObservedExportFile(db,observed),/ownership marker/);await access(path.resolve(saved.file_path));await writeFile(marker,markerBytes);
  const originalCwd=process.cwd();try{process.chdir(root);await assert.rejects(expireObservedExportFile(db,observed),/owned workspace/);}finally{process.chdir(originalCwd);}await access(path.resolve(saved.file_path));
  const unverified=path.join(root,'unverified.xlsx');await writeFile(unverified,'unverified fixture, not a real workbook');
  const unverifiedId=Number((await db.query("INSERT INTO export_jobs(organization_id,created_by,dataset,profile,status,file_path,retention_expires_at) VALUES(1,1,'unverified','compact_excel','succeeded',$1,clock_timestamp()-interval '1 second') RETURNING id",[unverified])).rows[0].id);
  await assert.rejects(expireObservedExportFile(db,await evidence(unverifiedId)),/publication evidence/);await access(unverified);
  await db.query("UPDATE export_jobs SET retention_expires_at=clock_timestamp()+interval '1 year' WHERE id=$1",[unverifiedId]);
  await db.query('UPDATE export_jobs SET file_size=file_size+1 WHERE id=$1',[id]);await assert.rejects(expireObservedExportFile(db,observed),/publication evidence/);await access(path.resolve(saved.file_path));await db.query('UPDATE export_jobs SET file_size=$2 WHERE id=$1',[id,saved.file_size]);
  assert.equal((await expireObservedExportFile(db,{...observed,organizationId:2})).status,'skipped');
  await assert.rejects(expireObservedExportFile(db,{...observed,filePaths:[...observed.filePaths,keep]}),/files changed/);await access(keep);await access(path.resolve(saved.file_path));
  const locker=await db.connect();try{await locker.query('BEGIN');await locker.query('SELECT id FROM export_jobs WHERE id=$1 FOR UPDATE',[id]);assert.equal((await expireObservedExportFile(db,observed)).status,'skipped');}finally{await locker.query('ROLLBACK');locker.release();}
  await assert.rejects(expireObservedExportFile(db,observed,()=>{throw Object.assign(new Error('Synthetic file lock'),{code:'EACCES'});}),/file lock/);
  assert.equal((await job(id)).file_path,saved.file_path);assert.equal(await retainedBytes(),String(saved.file_size));await access(path.resolve(saved.file_path));
  await db.query(`CREATE FUNCTION reject_expiry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='COMPACT_EXPORT_FILE_EXPIRED' THEN RAISE EXCEPTION 'Synthetic expiry audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_expiry_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_expiry_audit()`);
  await assert.rejects(expireObservedExportFile(db,observed),/expiry audit failure/);await assert.rejects(access(path.resolve(saved.file_path)),/ENOENT/);
  assert.equal((await job(id)).file_path,saved.file_path);assert.equal((await job(id)).download_token,saved.download_token);assert.equal(await retainedBytes(),String(saved.file_size));
  assert.equal((await cleanupCompactWorkspace(db,{...input,workspaceId:completed.workspaceId})).status,'not_eligible');
  await db.query('DROP TRIGGER reject_expiry_audit ON audit_logs;DROP FUNCTION reject_expiry_audit()');
  const race=await Promise.all([expireObservedExportFile(db,observed),expireObservedExportFile(db,observed)]);assert.equal(race.filter(r=>r.status==='expired').length,1);
  assert.equal((await job(id)).file_path,null);assert.equal((await job(id)).download_token,null);assert.equal(await retainedBytes(),'0');assert.equal((await expireObservedExportFile(db,observed)).status,'skipped');
  assert.deepEqual((await db.query('SELECT * FROM compact_export_publications WHERE job_id=$1',[id])).rows[0],originalProof);assert.deepEqual((await db.query('SELECT * FROM compact_export_captures WHERE job_id=$1',[id])).rows[0],originalCapture);
  await db.query(`CREATE FUNCTION reject_workspace_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='COMPACT_WORKSPACE_REMOVED' THEN RAISE EXCEPTION 'Synthetic workspace audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_workspace_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_workspace_audit()`);
  assert.equal((await cleanupCompactWorkspace(db,{...input,workspaceId:completed.workspaceId})).status,'blocked');
  assert.equal((await db.query("SELECT sum(reserved_bytes)::text n FROM compact_export_workspaces WHERE state<>'removed'")).rows[0].n,String(input.policy.temporaryBytes));
  await db.query('DROP TRIGGER reject_workspace_audit ON audit_logs;DROP FUNCTION reject_workspace_audit()');
  await Promise.all([runCompactMaintenanceCycle(db,input),runCompactMaintenanceCycle(db,input)]);
  assert.equal((await db.query("SELECT coalesce(sum(reserved_bytes),0)::text n FROM compact_export_workspaces WHERE state<>'removed'")).rows[0].n,'0');
  // Standard/paired compatibility and an old observation of a retried job.
  const old=path.join(root,'old.csv'),fresh=path.join(root,'fresh.csv'),detail=path.join(root,'details.gz');for(const f of [old,fresh,detail])await writeFile(f,'synthetic export');
  const standardId=Number((await db.query("INSERT INTO export_jobs(organization_id,created_by,dataset,profile,status,file_path,retention_expires_at) VALUES(1,1,'standard','standard','succeeded',$1,clock_timestamp()-interval '1 second') RETURNING id",[old])).rows[0].id);
  const stale=await evidence(standardId);await db.query("UPDATE export_jobs SET file_path=$2,retention_expires_at=clock_timestamp()+interval '1 day' WHERE id=$1",[standardId,fresh]);
  assert.equal((await expireObservedExportFile(db,stale)).status,'skipped');await access(old);await access(fresh);assert.equal((await job(standardId)).file_path,fresh);
  await db.query('INSERT INTO export_artifacts VALUES($1,1,$2)',[standardId,detail]);await db.query("UPDATE export_jobs SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[standardId]);
  const paired=await evidence(standardId);assert.deepEqual(new Set(paired.filePaths),new Set([fresh,detail]));
  let inside:()=>void=()=>undefined,resume:()=>void=()=>undefined;const entered=new Promise<void>(r=>{inside=r;}),gate=new Promise<void>(r=>{resume=r;});
  const expiring=expireObservedExportFile(db,paired,async file=>{inside();await gate;removeExportFile(file);});await entered;
  const writer=await db.connect();try{await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");await assert.rejects(writer.query('UPDATE export_jobs SET file_path=$2 WHERE id=$1',[standardId,keep]),/lock timeout/);}finally{await writer.query('ROLLBACK');writer.release();resume();}
  assert.equal((await expiring).status,'expired');await assert.rejects(access(fresh),/ENOENT/);await assert.rejects(access(detail),/ENOENT/);await access(old);
  const failures:number[]=[];const task=createExportRetentionTask({list:()=>readExpiredExportFiles(db!),expire:job=>expireObservedExportFile(db!,job),onFailure:jobId=>{failures.push(jobId);}});await task();assert.deepEqual(failures,[]);
  const actions=(await db.query('SELECT action,details FROM audit_logs WHERE resource_id=$1 ORDER BY id',[id])).rows;
  assert.deepEqual(actions.map(e=>e.action),['COMPACT_CAPTURE_RECORDED','COMPACT_WORKBOOK_PUBLISHED','COMPACT_EXPORT_FILE_EXPIRED','COMPACT_WORKSPACE_REMOVED']);assert.doesNotMatch(JSON.stringify(actions),/downloadToken|leaseToken|file_path|Supplier 1/);
  const audit=await db.connect();try{assert.equal((await verifyAuditChainWithClient(audit,1)).valid,true);assert.equal((await verifyAuditChainWithClient(audit,2)).checked,0);}finally{audit.release();}
  assert.equal((await db.query('SELECT count(*)::int n FROM suppliers')).rows[0].n,5000);assert.equal(await readFile(keep,'utf8'),'preserve unrelated evidence');
  console.log(JSON.stringify({status:'passed',mode:process.env.COMPACT_BUILT_CONTROLLER?'built-runtime':'source',testDatabase:name,sourceRows:5000,expiredVolumeRows:5000,discoveryQueries,discoveryLimit:100,checks:['published file pinned before expiry','tenant and file-set denial','workspace marker and changed-cwd denial','missing/mismatched publication refuses deletion','row-lock skip','file lock retains quota','audit rollback after unlink retains metadata/quota','concurrent expiry and replay emit one event','publication/capture evidence immutable after expiry','workspace audit rollback retains reservation','concurrent maintenance releases exact workspace quota','stale retry observation does not touch fresh files','legacy/paired compatibility','concurrent metadata writer blocked during removal','canonical audit chain','unrelated files preserved'],limitations:'Private lifecycle only. Public Compact remains disabled; financial orchestration, CR/CRLF, large Excel benchmarks and full release sign-off remain pending.'}));
}finally{await db?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});console.log('Removed exact test-owned retained-lifecycle root.');}
