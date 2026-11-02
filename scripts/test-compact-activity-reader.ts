import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm,readdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import "dotenv/config";
import {assertDisposableDatabaseUrl} from "../server/config/database-safety";
import {captureOperationalCompact} from "../server/modules/exports/capture-operational-compact";
import {createCompactActivityReader} from "../server/modules/exports/compact-activity-reader";
import {readCompactSpool} from "../server/modules/exports/compact-capture-spool";
if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; business databases are never mutation targets.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false;let db:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-activity-capture-test-'));
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString()});assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await db.query(`CREATE TABLE users(id integer PRIMARY KEY,full_name text,username text,password text);
    INSERT INTO users VALUES(1,'Own member','own','PASSWORD_SECRET'),(2,'FOREIGN_SECRET','foreign','FOREIGN_PASSWORD'),(4,'','Historical member','OLD_PASSWORD');
    CREATE TABLE organization_members(user_id integer,organization_id integer,active boolean);
    INSERT INTO organization_members VALUES(1,1,true),(1,1,false),(1,2,true),(2,2,true),(4,1,false);
    CREATE TABLE activity_logs(id integer PRIMARY KEY,organization_id integer,action text,description text,user_id integer,timestamp timestamp);
    INSERT INTO activity_logs SELECT i,1,'Update','Activity '||i,1,'2020-01-01' FROM generate_series(1,5000)i;
    INSERT INTO activity_logs VALUES(5001,1,'UNKNOWN_LEGACY','Unresolved actor reference',2,'infinity'),(5002,1,'OLD_ACTION','Historical membership',4,'2020-01-01'),(6001,2,'FOREIGN_ACTION','FOREIGN_DESCRIPTION',2,'2020-01-01')`);
  const input={dataset:'activity_logs',organizationId:1,actorId:1,root,filters:{},authorize:async()=>{}};
  const capture=await captureOperationalCompact(db,input);assert.equal(capture.manifest.rowCount,5002);
  let count=0;for await(const row of (await readCompactSpool(capture.directory,capture.scope)).rows){
    count++;assert.equal(JSON.stringify(row).includes('FOREIGN'),false);assert.equal(JSON.stringify(row).includes('PASSWORD'),false);
    if(count<=5000){assert.equal(row.description,`Activity ${count}`);assert.equal(row.userName,'Own member');}
    else if(count===5001){assert.equal(row.userName,null);assert.equal(row.timestamp,'infinity');}else assert.equal(row.userName,'Historical member');
  }
  assert.equal(count,5002);assert.match(capture.manifest.sourceInformation!.evidenceBasis!,/not the append-only governed audit/);
  const filtered=await captureOperationalCompact(db,{...input,utcTimestampEvidence:'verified-test-fixture-utc',columns:['action','timestamp'],filters:{action:'uPdAtE',actorId:1,from:'2019-01-01T00:00:00Z',to:'2021-01-01T00:00:00Z'}});assert.equal(filtered.manifest.rowCount,5000);
  const noWildcards=await captureOperationalCompact(db,{...input,filters:{q:'%'}});assert.equal(noWildcards.manifest.rowCount,0);
  for(const filters of [{unknown:'ignored?'},{from:'2020-01-01T00:00:00Z'},{actorId:'1 OR 1=1'}])await assert.rejects(captureOperationalCompact(db,{...input,filters}));
  await assert.rejects(captureOperationalCompact(db,{...input,columns:['password']}),/registered/);
  const foreign=await captureOperationalCompact(db,{...input,organizationId:2,actorId:2});assert.equal(foreign.manifest.rowCount,1);
  const client=await db.connect();try{
    await assert.rejects(createCompactActivityReader(client,{organizationId:1,filters:{},authorize:async()=>{}}),/read-only/);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const reader=await createCompactActivityReader(client,{organizationId:1,filters:{},authorize:async()=>{}});
    await db.query("UPDATE users SET full_name='Updated outside observation' WHERE id=1; INSERT INTO activity_logs VALUES(5003,1,'NEW','New after observation',1,'2020-01-01')");
    let observed=0;for await(const row of reader.rows){observed++;if(observed<=5000)assert.equal(row.userName,'Own member');assert.notEqual(row.description,'New after observation');}assert.equal(observed,5002);await client.query('ROLLBACK');
  }finally{client.release();}
  const next=await captureOperationalCompact(db,input);assert.equal(next.manifest.rowCount,5003);
  const before=(await readdir(root)).sort();let auth=0;await assert.rejects(captureOperationalCompact(db,{...input,authorize:async()=>{if(++auth===3)throw new Error('Access revoked');}}),/Access revoked/);assert.deepEqual((await readdir(root)).sort(),before);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0].n,0);
  console.log(JSON.stringify({status:'passed',testDatabase:name,sourceRows:count,checks:['tenant isolation','same-tenant actor lookup','historical membership without access grant','duplicate membership does not multiply rows','foreign actor/password data not exposed','literal search and action filters','verified timezone prerequisite','registered columns only','source/name snapshot consistency','new snapshot sees changes','revocation cleanup','read-only observation released'],limitations:'Operational activity is not governed audit evidence; production permission wiring, UI and release gates remain pending.'}));
}finally{await db?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});}
