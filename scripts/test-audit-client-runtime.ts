import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import 'dotenv/config';
import {assertDisposableDatabaseUrl} from '../server/config/database-safety';
import {initializeCompactAuditFixture} from './runtime-fixtures/compact-audit-fixture';
import {appendAuditEventWithClient,getAuditChainRowsWithClient,verifyAuditChainRows,verifyAuditChainWithClient} from '../server/services/audit-chain-client';

if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; no business database is a mutation target.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false,database:pg.Pool|undefined,applicationPool:pg.Pool|undefined;
try{
  const env:NodeJS.ProcessEnv={NODE_ENV:'test'};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  const imported=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"await import('./server/services/audit-chain-client.ts'); console.log('client-only audit import passed');"],{env,encoding:'utf8',timeout:30000});
  assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout.trim(),'client-only audit import passed','Client-only import must not initialize an app pool/bootstrap');
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());database=new pg.Pool({connectionString:url.toString(),max:8,connectionTimeoutMillis:5000});await initializeCompactAuditFixture(database,name);
  await assert.rejects(initializeCompactAuditFixture(database,'iss_sourcing'),/unrelated database/);
  // Synthetic legacy evidence stays unverified; never manufacture its hashes.
  await database.query(`INSERT INTO audit_logs(organization_id,action,resource_type,details,created_at) SELECT 1,'synthetic_legacy','test',jsonb_build_object('ordinal',i),timestamp '2000-01-01' FROM generate_series(1,5000)i`);
  process.env.DATABASE_URL=url.toString();process.env.TEST_DATABASE_URL=url.toString();process.env.NODE_ENV='test';
  const facade=await import('../server/services/audit-chain-service'),dbModule=await import('../server/db');applicationPool=dbModule.pool;
  assert.equal(facade.appendAuditEventWithClient,appendAuditEventWithClient);assert.equal(facade.verifyAuditChainRows,verifyAuditChainRows);assert.equal(applicationPool.totalCount,0);
  const client=await database.connect();try{
    await client.query('BEGIN');await appendAuditEventWithClient(client,{organizationId:1,actor:{userId:11},action:'direct',resourceType:'test',resourceId:1,details:{nested:{z:2,a:1},unicode:'Ω漢字😀',list:[3,1]},before:{state:'old'},after:{state:'new'},reason:'synthetic proof',requestId:'client-proof'});assert.equal(applicationPool.totalCount,0,'Provided-client writes must not fall back to the facade pool');await client.query('COMMIT');
    const before=(await getAuditChainRowsWithClient(client,1));await client.query('BEGIN');await appendAuditEventWithClient(client,{organizationId:1,actor:{systemActor:'test'},action:'rolled-back',resourceType:'test'});await client.query('ROLLBACK');assert.deepEqual(await getAuditChainRowsWithClient(client,1),before);
  }finally{client.release();}
  await facade.appendAuditEvent({organizationId:1,actor:{systemActor:'legacy-facade'},action:'facade',resourceType:'test',details:{preserved:true}});
  await Promise.all(Array.from({length:8},async(_,index)=>{const concurrent=await database!.connect();try{await concurrent.query('BEGIN');await appendAuditEventWithClient(concurrent,{organizationId:1,actor:{userId:index+20},action:'concurrent',resourceType:'test',resourceId:index});await concurrent.query('COMMIT');}catch(error){await concurrent.query('ROLLBACK');throw error;}finally{concurrent.release();}}));
  const auditor=await database.connect();try{
    await auditor.query('BEGIN');await appendAuditEventWithClient(auditor,{organizationId:2,actor:{userId:99},action:'foreign',resourceType:'test'});await auditor.query('COMMIT');
    for(const timezone of ['Africa/Johannesburg','Pacific/Auckland','America/New_York']){await auditor.query("SELECT set_config('TimeZone',$1,false)",[timezone]);const checked=await verifyAuditChainWithClient(auditor,1);assert.equal(checked.valid,true);assert.equal(checked.checked,10);}
    assert.equal((await verifyAuditChainWithClient(auditor,2)).checked,1);assert.equal((await verifyAuditChainWithClient(auditor,3)).checked,0);
    const rows=await getAuditChainRowsWithClient(auditor,1);assert.ok(rows.every(row=>row.organization_id===1));const tampered=structuredClone(rows);tampered[3].details={tampered:true};const broken=verifyAuditChainRows(1,tampered);assert.equal(broken.valid,false);assert.equal(broken.firstBrokenId,rows[3].id);
  }finally{auditor.release();}
  assert.equal((await facade.verifyAuditChain(1)).valid,true);
  assert.equal((await database.query('SELECT count(*)::int n FROM audit_logs WHERE event_hash IS NULL')).rows[0].n,5000);await assert.rejects(database.query("UPDATE audit_logs SET reason='forged' WHERE event_hash IS NOT NULL"),/APPEND_ONLY/);await assert.rejects(database.query('DELETE FROM audit_logs WHERE organization_id=2'),/APPEND_ONLY/);
  console.log(JSON.stringify({status:'passed',testDatabase:name,unverifiedLegacyRowsPreserved:5000,verifiedTenantEvents:10,checks:['client-only import has no app-pool side effects','exact fixture DB guard','same legacy facade API/function identity','all writes use provided client','rollback preserves chain head','legacy wrapper append/verify','eight concurrent same-tenant appends serialize','tenant filtering','three timezones','unchanged v1 hash verification','in-memory tamper detection','append-only storage','legacy rows remain unverified']}));
}finally{await applicationPool?.end();await database?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();}
