import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm,readdir,readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import "dotenv/config";
import {assertDisposableDatabaseUrl} from "../server/config/database-safety";
import {captureOperationalCompact} from "../server/modules/exports/capture-operational-compact";
import {createCompactSupplierReader} from "../server/modules/exports/compact-supplier-reader";
import {readCompactSpool} from "../server/modules/exports/compact-capture-spool";
if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; no business database is a mutation target.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false;let database:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-supplier-capture-test-'));
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());database=new pg.Pool({connectionString:url.toString()});assert.equal((await database.query('SELECT current_database() name')).rows[0].name,name);
  await database.query(`CREATE TABLE suppliers(id integer PRIMARY KEY,organization_id integer NOT NULL,name text,email text,phone text,default_currency_code text,status text,created_at timestamp,bank_account_number text);
    INSERT INTO suppliers SELECT i,1,'Supplier '||i,CASE WHEN i%2=0 THEN NULL ELSE '' END,'000123',NULL,CASE WHEN i%2=0 THEN 'INACTIVE' ELSE 'Active' END,'2020-01-01','secret-excluded' FROM generate_series(1,5000) i;
    INSERT INTO suppliers VALUES(6001,2,'Foreign supplier','hidden','999','USD','Active','2020-01-01','foreign-secret')`);
  const input={dataset:'suppliers',organizationId:1,actorId:1,root,filters:{},authorize:async()=>{}};
  const captured=await captureOperationalCompact(database,input);assert.equal(captured.manifest.rowCount,5000);
  const bytes=await readFile(path.join(captured.directory,'rows.jsonl'),'utf8');assert.equal(bytes.includes('secret-excluded'),false);assert.equal(bytes.includes('Foreign supplier'),false);
  let count=0;for await(const row of (await readCompactSpool(captured.directory,captured.scope)).rows){assert.equal(row.name,`Supplier ${++count}`);assert.equal(row.phone,'000123');assert.equal(row.defaultCurrencyCode,null);}
  assert.equal(count,5000);
  await assert.rejects(captureOperationalCompact(database,{...input,filters:{from:'2020-01-01T00:00:00Z'}}),/verified UTC/);
  const filtered=await captureOperationalCompact(database,{...input,utcTimestampEvidence:'test-fixture-created-at-utc',columns:['name','status'],filters:{status:'aCtIvE',from:'2020-01-01T00:00:00Z',to:'2021-01-01T00:00:00.000Z'}});assert.equal(filtered.manifest.rowCount,2500);
  await assert.rejects(captureOperationalCompact(database,{...input,columns:['bankAccountNumber']}),/registered/);
  for(const filters of [{unknown:'ignored?'},{from:'2020-01-01'},{from:'2020-02-30T00:00:00Z'},{supplierId:'1 OR 1=1'}])await assert.rejects(captureOperationalCompact(database,{...input,utcTimestampEvidence:'test-fixture-created-at-utc',filters}));
  await assert.rejects(captureOperationalCompact(database,{...input,dataset:'not_registered'}),/does not have/);
  // Count and later keyset pages share the same observation despite live changes.
  const client=await database.connect();try{
    await assert.rejects(createCompactSupplierReader(client,{organizationId:1,filters:{},authorize:async()=>{}}),/read-only/);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
    const reader=await createCompactSupplierReader(client,{organizationId:1,filters:{},authorize:async()=>{}});
    await database.query("UPDATE suppliers SET name='Changed outside observation' WHERE id=2500; INSERT INTO suppliers VALUES(5001,1,'New after observation',NULL,NULL,NULL,'Active','2020-01-01',NULL)");
    let observed=0;for await(const row of reader.rows){observed++;if(observed===2500)assert.equal(row.name,'Supplier 2500');}assert.equal(observed,5000);await client.query('ROLLBACK');
  }finally{client.release();}
  const later=await captureOperationalCompact(database,input);assert.equal(later.manifest.rowCount,5001);
  const other=await captureOperationalCompact(database,{...input,organizationId:2,actorId:2});assert.equal(other.manifest.rowCount,1);
  const before=(await readdir(root)).sort();let authorizationCalls=0;
  await assert.rejects(captureOperationalCompact(database,{...input,authorize:async()=>{if(++authorizationCalls===3)throw new Error('Access revoked during capture');}}),/Access revoked/);assert.deepEqual((await readdir(root)).sort(),before);
  const state=(await database.query('SHOW transaction_read_only')).rows[0].transaction_read_only;assert.equal(state,'off','Pooled source transaction must be closed before compression');
  assert.equal((await database.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0].n,0);
  console.log(JSON.stringify({status:'passed',testDatabase:name,sourceRows:count,checks:['tenant isolation','registered columns only','no bank-field leakage','literal values and leading zeros','case-insensitive status filters','explicit UTC dates','invalid filter refusal','repeatable-read concurrent update/insert protection','fresh observation sees changes','revocation cleanup','observation released before compression'],limitations:'Supplier adapter only; API access wiring and other operational adapters remain gated.'}));
}finally{await database?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});}
