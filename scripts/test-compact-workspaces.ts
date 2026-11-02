import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,mkdir,rm,writeFile,readdir,lstat,symlink,unlink,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';
import {assertDisposableDatabaseUrl} from '../server/config/database-safety';
import {compactFullDetailMigrations,compactWorkspaceMigrations} from './release-migrations.mjs';
import {claimCompactLease,cancelCompactJob} from '../server/modules/exports/compact-export-leases';
import {registerCompactWorkspace,cleanupCompactWorkspace,listCompactCleanupCandidates} from '../server/modules/exports/compact-workspaces';
import {initializeCompactAuditFixture} from './runtime-fixtures/compact-audit-fixture';

if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; no application database is a mutation target.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);
assert.ok(configured,'Local PostgreSQL configuration is required.');
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false;let db:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-workspace-test-')),storage={root,storageId:'workspace-test'};
const outside=path.join(root,'not-a-workspace');await mkdir(outside);await writeFile(path.join(outside,'keep.txt'),'do not remove');
async function job(org:number){
  const row=(await db!.query("INSERT INTO export_jobs(organization_id,created_by,profile) VALUES($1,$1,'compact_excel') RETURNING id",[org])).rows[0];
  const lease=await claimCompactLease(db!,{organizationId:org,serverId:randomUUID()});assert.ok(lease);assert.equal(lease.job_id,row.id);
  return {...storage,lease:{organizationId:org,attemptId:lease.id,leaseToken:lease.lease_token},jobId:row.id,actorId:org,dataset:'synthetic',filters:{},reservedBytes:1024,organizationQuotaBytes:2048,totalQuotaBytes:3072};
}
async function stop(input:Awaited<ReturnType<typeof job>>,old=false){assert.equal(await cancelCompactJob(db!,{organizationId:input.actorId,actorId:input.actorId,jobId:input.jobId}),true);if(old)await db!.query("UPDATE compact_export_attempts SET finished_at=clock_timestamp()-interval '36 minutes' WHERE id=$1",[input.lease.attemptId]);}
function cleanup(workspace:{id:string;organizationId:number}){return cleanupCompactWorkspace(db!,{...storage,workspaceId:workspace.id,organizationId:workspace.organizationId});}
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);
  url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString()});assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await initializeCompactAuditFixture(db,name);
  await db.query(`CREATE TABLE export_jobs(id serial PRIMARY KEY,organization_id integer NOT NULL,created_by integer NOT NULL,dataset text NOT NULL DEFAULT 'synthetic',filters jsonb NOT NULL DEFAULT '{}',format text NOT NULL DEFAULT 'excel',status text NOT NULL DEFAULT 'queued',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz,completed_at timestamptz,started_at timestamptz,attempts integer NOT NULL DEFAULT 0,last_error text,file_path text)`);
  for(const migration of [...compactFullDetailMigrations,...compactWorkspaceMigrations]){const sql=await readFile(new URL(`../migrations/${migration}`,import.meta.url),'utf8');await db.query(sql);await db.query(sql);}
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_indexes WHERE indexname IN ('compact_workspace_quota_idx','compact_workspace_cleanup_idx')")).rows[0].n,2);
  const a=await job(1),before=await readdir(root);
  await assert.rejects(registerCompactWorkspace(db,{...a,actorId:2}),/active authorized/);assert.deepEqual(await readdir(root),before);
  const [wa,duplicate]=await Promise.all([registerCompactWorkspace(db,a),registerCompactWorkspace(db,a)]);assert.equal(wa.id,duplicate.id);assert.equal(wa.reservedBytes,'1024');assert.equal((await db.query('SELECT count(*)::int n FROM compact_export_workspaces')).rows[0].n,1);
  const guard=await db.connect();let waitingRegistration:Promise<unknown>|undefined;
  try{await guard.query('BEGIN');await guard.query('SELECT pg_advisory_xact_lock(1948871,291800)');let completed=false;waitingRegistration=registerCompactWorkspace(db,a).then(value=>{completed=true;return value;});await new Promise(resolve=>setTimeout(resolve,50));assert.equal(completed,false,'Workspace decisions must wait for the existing Compact lease/publication lock');await guard.query('COMMIT');await waitingRegistration;}finally{await guard.query('ROLLBACK').catch(()=>undefined);guard.release();}
  await writeFile(path.join(wa.captureRoot,'synthetic.jsonl'),'test capture');
  await assert.rejects(registerCompactWorkspace(db,{...a,reservedBytes:512}),/rebound/);
  const alias=await job(9),beforeAlias=await readdir(root);
  await assert.rejects(registerCompactWorkspace(db,{...alias,storageId:'quota-bypass-alias'}),/another storage identity/);
  assert.deepEqual(await readdir(root),beforeAlias,'A storage alias cannot create files or reset quota accounting');
  assert.equal((await db.query('SELECT count(*)::int n FROM compact_export_workspaces')).rows[0].n,1);await stop(alias,true);
  const rootLink=path.join(root,'linked-root');await symlink(outside,rootLink,process.platform==='win32'?'junction':'dir');
  await assert.rejects(registerCompactWorkspace(db,{...a,root:rootLink}),/real directory/);await unlink(rootLink);
  await assert.rejects(db.query('UPDATE compact_export_workspaces SET organization_id=9 WHERE id=$1',[wa.id]),/immutable/);
  await assert.rejects(db.query('DELETE FROM compact_export_workspaces WHERE id=$1',[wa.id]),/cannot be deleted/);
  assert.equal((await cleanup(wa)).status,'not_eligible','Active work cannot be removed');
  await stop(a);assert.equal((await cleanup(wa)).status,'not_eligible','A finished lease still needs the quiet interval');
  await db.query("UPDATE compact_export_attempts SET finished_at=clock_timestamp()-interval '36 minutes' WHERE id=$1",[a.lease.attemptId]);
  const b=await job(1),wb=await registerCompactWorkspace(db,b);await stop(b,true);
  const c=await job(2),wc=await registerCompactWorkspace(db,c);await stop(c,true);
  const orgFull=await job(1);await assert.rejects(registerCompactWorkspace(db,orgFull),/storage is full/);await stop(orgFull,true);
  const allFull=await job(3);await assert.rejects(registerCompactWorkspace(db,allFull),/storage is full/);await stop(allFull,true);
  // A distinct real root/identity cannot reset tenant or installation quotas.
  const secondRoot=path.join(root,'second-private-root');await mkdir(secondRoot);
  const crossTenant=await job(1),crossGlobal=await job(3),secondStorage={root:secondRoot,storageId:'second-workspace-test'};
  await assert.rejects(registerCompactWorkspace(db,{...crossTenant,...secondStorage,totalQuotaBytes:4096}),/storage is full/);
  await assert.rejects(registerCompactWorkspace(db,{...crossGlobal,...secondStorage}),/storage is full/);
  assert.deepEqual(await readdir(secondRoot),[],'Denied cross-root admission must not create files');
  await stop(crossTenant,true);await stop(crossGlobal,true);
  await assert.rejects(registerCompactWorkspace(db,{...await job(4),storageId:'workspace-test',root:outside}),/different private root/);
  assert.equal((await db.query('SELECT sum(reserved_bytes)::text n FROM compact_export_workspaces')).rows[0].n,'3072');
  // Reconnect after a process-like DB restart; identity and reservations persist.
  await db.end();db=new pg.Pool({connectionString:url.toString()});
  assert.equal((await listCompactCleanupCandidates(db,storage)).length,3);
  await assert.rejects(listCompactCleanupCandidates(db,{...storage,limit:5000}),/page size/);
  assert.equal((await cleanupCompactWorkspace(db,{...storage,workspaceId:wa.id,organizationId:2})).status,'not_eligible');
  assert.equal((await cleanupCompactWorkspace(db,{...storage,storageId:'other',workspaceId:wa.id,organizationId:1})).status,'not_eligible');
  assert.equal((await cleanupCompactWorkspace(db,{...storage,root:outside,workspaceId:wa.id,organizationId:1})).status,'not_eligible');
  const marker=path.join(wa.directory,'.compact-workspace.json'),original=await readFile(marker,'utf8');await writeFile(marker,'{}');
  assert.deepEqual(await cleanup(wa),{status:'blocked',code:'ownership_mismatch'});await access(path.join(wa.captureRoot,'synthetic.jsonl'));
  assert.equal((await db.query('SELECT sum(reserved_bytes)::text n FROM compact_export_workspaces WHERE state<>\'removed\'')).rows[0].n,'3072','Failed cleanup cannot release quota');
  await writeFile(marker,original);const results=await Promise.all([cleanup(wa),cleanup(wa)]);assert.ok(results.some(result=>result.status==='removed'));assert.equal((await cleanup(wa)).status,'removed');await assert.rejects(lstat(wa.directory),/ENOENT/);
  // Junction/symlink must not be followed, including when nested in a known path.
  const link=path.join(wb.outputRoot,'linked-folder');await symlink(outside,link,process.platform==='win32'?'junction':'dir');
  assert.deepEqual(await cleanup(wb),{status:'blocked',code:'ownership_mismatch'});assert.equal(await readFile(path.join(outside,'keep.txt'),'utf8'),'do not remove');await unlink(link);
  // Saved publication remains retained even after the worker's lease has ended.
  await db.query("UPDATE export_jobs SET status='succeeded',file_path=$2 WHERE id=$1",[b.jobId,path.join(wb.outputRoot,'published.xlsx')]);
  assert.equal((await cleanup(wb)).status,'not_eligible');await db.query('UPDATE export_jobs SET file_path=NULL WHERE id=$1',[b.jobId]);assert.equal((await cleanup(wb)).status,'removed');
  // Crash after deletion but before the final DB update: retry absent exact path.
  await rm(wc.directory,{recursive:true,force:false});
  await db.query("UPDATE compact_export_workspaces SET state='cleanup_claimed',cleanup_token=$2,cleanup_until=clock_timestamp()-interval '1 minute' WHERE id=$1",[wc.id,randomUUID()]);
  assert.equal((await cleanup(wc)).status,'removed');
  // Rollback before registration commit creates no files or quota reservations.
  await db.query(`CREATE FUNCTION reject_workspace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected registry failure'; END $$;CREATE TRIGGER reject_workspace BEFORE INSERT ON compact_export_workspaces FOR EACH ROW EXECUTE FUNCTION reject_workspace()`);
  const d=await job(5),beforeFailure=await readdir(root);await assert.rejects(registerCompactWorkspace(db,d),/Injected registry failure/);assert.deepEqual(await readdir(root),beforeFailure);
  await db.query('DROP TRIGGER reject_workspace ON compact_export_workspaces; DROP FUNCTION reject_workspace()');
  // Crash/failure after filesystem creation leaves a durable registered record.
  await db.query(`CREATE FUNCTION reject_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='ready' THEN RAISE EXCEPTION 'Injected ready failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_ready BEFORE UPDATE ON compact_export_workspaces FOR EACH ROW EXECUTE FUNCTION reject_ready()`);
  await assert.rejects(registerCompactWorkspace(db,d),/Injected ready failure/);const wd=(await db.query('SELECT id,organization_id,state FROM compact_export_workspaces WHERE job_id=$1',[d.jobId])).rows[0];assert.equal(wd.state,'registered');
  await db.query('DROP TRIGGER reject_ready ON compact_export_workspaces; DROP FUNCTION reject_ready()');await stop(d,true);
  assert.equal((await cleanup({id:wd.id,organizationId:wd.organization_id})).status,'removed');
  // Competing reservations cannot both consume the last aggregate capacity.
  const contenders=await Promise.all([job(6),job(7)]);
  const reservations=await Promise.allSettled(contenders.map(input=>registerCompactWorkspace(db!,{...input,organizationQuotaBytes:1024,totalQuotaBytes:1024})));
  assert.equal(reservations.filter(result=>result.status==='fulfilled').length,1);assert.equal(reservations.filter(result=>result.status==='rejected').length,1);
  await Promise.all(contenders.map(input=>stop(input,true)));
  for(const result of reservations)if(result.status==='fulfilled')assert.equal((await cleanup(result.value)).status,'removed');
  // Concurrent processes choosing different roots still compete for ONE final
  // installation reservation, and releasing the exact winner restores capacity.
  const crossContenders=await Promise.all([job(8),job(9)]);
  const crossInputs=crossContenders.map((input,index)=>({...input,...(index?secondStorage:storage),organizationQuotaBytes:1024,totalQuotaBytes:1024}));
  const crossResults=await Promise.allSettled(crossInputs.map(input=>registerCompactWorkspace(db!,input)));
  assert.equal(crossResults.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(crossResults.filter(result=>result.status==='rejected').length,1);
  assert.equal((await db.query("SELECT sum(reserved_bytes)::text n FROM compact_export_workspaces WHERE state<>'removed'")).rows[0].n,'1024');
  await Promise.all(crossContenders.map(input=>stop(input,true)));
  for(let index=0;index<crossResults.length;index++){
    const result=crossResults[index];if(result.status==='fulfilled')assert.equal((await cleanupCompactWorkspace(db,{...crossInputs[index],workspaceId:result.value.id,organizationId:result.value.organizationId})).status,'removed');
  }
  const afterRelease=await job(10),releasedWorkspace=await registerCompactWorkspace(db,{...afterRelease,...secondStorage,organizationQuotaBytes:1024,totalQuotaBytes:1024});
  await stop(afterRelease,true);assert.equal((await cleanupCompactWorkspace(db,{...secondStorage,workspaceId:releasedWorkspace.id,organizationId:releasedWorkspace.organizationId})).status,'removed');
  for(let index=0;index<10;index++){
    const racing=await job(20+index),outcomes=await Promise.allSettled([registerCompactWorkspace(db,racing),cancelCompactJob(db,{organizationId:racing.actorId,actorId:racing.actorId,jobId:racing.jobId})]);
    assert.equal(outcomes[1].status,'fulfilled');for(const outcome of outcomes)if(outcome.status==='rejected'){assert.notEqual((outcome.reason as {code?:string}).code,'40P01');assert.match(String(outcome.reason),/active authorized|stopped while/);}
    await db.query("UPDATE compact_export_attempts SET finished_at=clock_timestamp()-interval '36 minutes' WHERE id=$1",[racing.lease.attemptId]);
    const workspace=(await db.query('SELECT id,organization_id FROM compact_export_workspaces WHERE job_id=$1',[racing.jobId])).rows[0];if(workspace)assert.equal((await cleanup({id:workspace.id,organizationId:workspace.organization_id})).status,'removed');
  }
  assert.equal((await db.query("SELECT coalesce(sum(reserved_bytes),0)::text n FROM compact_export_workspaces WHERE state<>'removed'")).rows[0].n,'0');
  assert.equal(await readFile(path.join(outside,'keep.txt'),'utf8'),'do not remove');assert.ok((await readdir(root)).includes('not-a-workspace'));
  console.log(JSON.stringify({status:'passed',testDatabase:name,checks:['additive migration idempotency and indexes','immutable ownership/history','concurrent registration deduplication','tenant/job/storage binding','exact BigInt capacity reservation','organization and aggregate quota denial across roots','concurrent cross-root final-capacity reservation','cross-root capacity restored only after cleanup','restart persistence','35-minute quiet interval','active/published work protection','scoped bounded discovery','marker tamper refusal','linked root and nested link refusal','concurrent cleanup','expired cleanup claim recovery','deletion-before-DB retry','registry rollback without filesystem writes','ready failure remains durably discoverable','unrelated files retained'],limits:'Installation quotas include all registered roots in this database; disk admission is conservative, not an OS reservation or a quota for unrelated processes/databases. Public Compact UI, frozen-financial orchestration and full release verification remain pending.'}));
}finally{
  await db?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});console.log('Removed exact test-owned workspace root.');
}
