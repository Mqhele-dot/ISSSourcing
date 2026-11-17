import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';
import {assertDisposableDatabaseUrl} from '../server/config/database-safety';
import {queryRolePermission,queryUserCustomRoleId,queryCustomRolePermission} from '../server/services/permission-query-service';
import {assertExportActorAccess,assertCompactExportActorWithClient} from '../server/modules/exports/export-actor-access';
import {captureOperationalCompact} from '../server/modules/exports/capture-operational-compact';
import {claimCompactLease} from '../server/modules/exports/compact-export-leases';
import {runLeasedCompactWorker} from '../server/modules/exports/compact-leased-worker';
import {publishAuthorizedCompactWorkbook} from '../server/modules/exports/compact-publication';
import {compactFullDetailMigrations,compactPublicationMigrations} from './release-migrations.mjs';
import {initializeCompactAuditFixture} from './runtime-fixtures/compact-audit-fixture';

if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; business databases are never mutation targets.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false,db:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-authorized-compact-'));
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString()});assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await initializeCompactAuditFixture(db,name);
  await db.query(`CREATE TABLE organizations(id integer PRIMARY KEY,active boolean NOT NULL);INSERT INTO organizations VALUES(1,true),(2,true),(3,false);
    CREATE TABLE users(id integer PRIMARY KEY,role text,active boolean NOT NULL,warehouse_id integer,preferences jsonb);
    INSERT INTO users VALUES(1,'admin',true,NULL,'{}'),(2,'custom',true,NULL,'{"customRoleId":1}'),(3,'manager',true,NULL,'{}'),(4,'admin',false,NULL,'{}'),(5,'custom',true,NULL,'{"customRoleId":2}'),(6,'custom',true,10,'{"customRoleId":1}'),(7,'admin',true,20,'{}'),(8,'admin',true,NULL,'{}'),(9,'viewer',true,NULL,'{}');
    CREATE TABLE organization_members(id serial PRIMARY KEY,organization_id integer,user_id integer,application_role text,role text,active boolean,status text);
    INSERT INTO organization_members(organization_id,user_id,application_role,role,active,status) VALUES(1,1,'viewer','owner',true,'active'),(1,2,'custom','member',true,'active'),(1,3,'manager','member',true,'active'),(1,4,'admin','owner',true,'active'),(1,5,'custom','member',true,'active'),(1,6,'custom','member',true,'active'),(1,7,'admin','owner',true,'active'),(3,8,'admin','owner',true,'active'),(1,9,'admin','owner',true,'active');
    CREATE TABLE permissions(id serial PRIMARY KEY,role text,resource text,permission_type text);
    INSERT INTO permissions(role,resource,permission_type) VALUES('manager','reports','read'),('manager','reports','export'),('manager','purchases','read');
    CREATE TABLE custom_roles(id integer PRIMARY KEY,organization_id integer,is_active boolean);INSERT INTO custom_roles VALUES(1,1,true),(2,2,true);
    CREATE TABLE custom_role_permissions(id serial PRIMARY KEY,role_id integer,resource text,permission_type text);
    INSERT INTO custom_role_permissions(role_id,resource,permission_type) SELECT role_id,resource,action FROM unnest(ARRAY[1,2]) role_id CROSS JOIN (VALUES('reports','read'),('reports','export'),('inventory','read'),('reorder_requests','read'),('purchases','read'),('suppliers','read'),('finance','read'),('invoices','read'),('activity_logs','read')) grant_list(resource,action);
    CREATE TABLE warehouses(id integer PRIMARY KEY,organization_id integer);INSERT INTO warehouses VALUES(10,1),(20,2);
    INSERT INTO permissions(role,resource,permission_type) SELECT 'viewer','inventory','read' FROM generate_series(1,5000)`);
  const input={organizationId:1,userId:2,dataset:'inventory',filters:{}};
  assert.equal(await queryRolePermission(db,'manager','purchases','read'),true);assert.equal(await queryRolePermission(db,'manager','inventory','read'),false);
  assert.equal(await queryRolePermission(db,'ADMIN','anything','anything'),true,'Preserve the canonical admin permission bypass; membership/source checks still apply');
  for(const [role,resource,action]of [['unknown','inventory','read'],['viewer','__proto__','read'],['viewer','inventory','unknown']])assert.equal(await queryRolePermission(db,role,resource,action),false);
  assert.equal(await queryUserCustomRoleId(db,1,2),1);assert.equal(await queryUserCustomRoleId(db,1,5),null);assert.equal(await queryCustomRolePermission(db,1,2,'reports','export'),false);
  assert.equal((await assertExportActorAccess(db,input)).role,'custom');assert.equal((await assertExportActorAccess(db,{...input,userId:3,dataset:'purchase_orders'})).role,'manager');
  await assert.rejects(assertExportActorAccess(db,{...input,userId:1}),/source records/,'A global admin user or owner membership must not bypass a tenant viewer role');
  assert.equal((await assertExportActorAccess(db,{...input,userId:9})).role,'admin','Tenant application role is authoritative, not the global user role');
  for(const change of [{organizationId:0},{organizationId:2},{organizationId:3,userId:8},{userId:4},{userId:5},{dataset:'__proto__'},{dataset:'unknown'},{userId:3},{dataset:'financial_measure',filters:{measure:'unknown'}}])await assert.rejects(assertExportActorAccess(db,{...input,...change}));
  await assertExportActorAccess(db,{...input,dataset:'financial_measure',filters:{measure:'ap_outstanding'}});await assert.rejects(assertExportActorAccess(db,{...input,userId:3,dataset:'financial_measure',filters:{measure:'ap_outstanding'}}));
  await db.query('UPDATE custom_roles SET is_active=false WHERE id=1');await assert.rejects(assertExportActorAccess(db,input));await db.query('UPDATE custom_roles SET is_active=true WHERE id=1');
  await db.query("UPDATE organization_members SET status='revoked' WHERE user_id=2");await assert.rejects(assertExportActorAccess(db,input),/active organization/);await db.query("UPDATE organization_members SET status='active' WHERE user_id=2");
  await db.query('UPDATE organizations SET active=false WHERE id=1');await assert.rejects(assertExportActorAccess(db,input),/active organization/);await db.query('UPDATE organizations SET active=true WHERE id=1');
  for(const value of [null,0,-1,1.5,'bad','999999999999999999999']){await db.query('UPDATE users SET preferences=$1::jsonb WHERE id=2',[JSON.stringify({customRoleId:value})]);assert.equal(await queryUserCustomRoleId(db,1,2),null);}await db.query('UPDATE users SET preferences=$1::jsonb WHERE id=2',[JSON.stringify({customRoleId:1})]);
  const client=await db.connect();try{
    for(const dataset of ['inventory','purchase_orders','purchase_requisitions','shipments','po_delivery_comparison','activity_logs'])await assert.rejects(assertCompactExportActorWithClient(client,{...input,userId:6,dataset}),/assigned-warehouse/);
    for(const dataset of ['suppliers','invoices'])await assertCompactExportActorWithClient(client,{...input,userId:6,dataset});
    const filters={};await assert.rejects(assertCompactExportActorWithClient(client,{...input,userId:6,dataset:'reorder_requests',filters}),/Select your assigned warehouse/);assert.deepEqual(filters,{});
    await assertCompactExportActorWithClient(client,{...input,userId:6,dataset:'reorder_requests',filters:{warehouseId:'10'}});
    await assert.rejects(assertCompactExportActorWithClient(client,{...input,userId:6,dataset:'reorder_requests',filters:{warehouseId:20}}),/Select your assigned warehouse/);
    await assert.rejects(assertCompactExportActorWithClient(client,{...input,userId:7}),/unavailable in this organization/);
    await assert.rejects(assertCompactExportActorWithClient(client,{...input,dataset:'financial_measure',filters:{runId:randomUUID(),measure:'ap_outstanding'}}),/verified record-access/);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await assertCompactExportActorWithClient(client,input);await client.query('ROLLBACK');
    await client.query('BEGIN');await assertCompactExportActorWithClient(client,{...input,userId:6,dataset:'reorder_requests',filters:{warehouseId:10}},true);
    // Permission/membership/warehouse revocation cannot race a publication
    // after its transaction-aware authorization point.
    const writer=await db.connect();try{
      await writer.query("SET lock_timeout='100ms'");
      for(const sql of ["DELETE FROM custom_role_permissions WHERE role_id=1 AND resource='reports' AND permission_type='export'",'UPDATE custom_roles SET is_active=false WHERE id=1','UPDATE organization_members SET active=false WHERE user_id=6','UPDATE users SET warehouse_id=20 WHERE id=6','DELETE FROM warehouses WHERE id=10'])await assert.rejects(writer.query(sql),error=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code==='55P03'));
    }finally{writer.release();}
    await client.query('COMMIT');
    await db.query("DELETE FROM custom_role_permissions WHERE role_id=1 AND resource='reports' AND permission_type='export'");await assert.rejects(assertCompactExportActorWithClient(client,input),/source records/);
  }finally{await client.query('ROLLBACK').catch(()=>undefined);client.release();}
  // Connected production services, not the earlier publication access stub.
  await db.query(`INSERT INTO custom_role_permissions(role_id,resource,permission_type) VALUES(1,'reports','export');
    ALTER TABLE warehouses ADD COLUMN name text;UPDATE warehouses SET name='Warehouse '||id;
    INSERT INTO warehouses VALUES(11,1,'Other own warehouse');
    CREATE TABLE inventory_items(id int PRIMARY KEY,organization_id int,name text);INSERT INTO inventory_items VALUES(1,1,'Own item'),(2,2,'FOREIGN_ITEM_SECRET');
    CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int,name text);INSERT INTO suppliers VALUES(1,1,'Own supplier'),(2,2,'FOREIGN_SUPPLIER_SECRET');
    CREATE TABLE reorder_requests(id int PRIMARY KEY,organization_id int,request_number text,item_id int,quantity numeric(20,6),supplier_id int,warehouse_id int,status text,request_date timestamp,created_at timestamp);
    INSERT INTO reorder_requests SELECT i,1,'REQUEST-'||i,1,i::numeric/10,1,10,'APPROVED','2020-01-01','2020-01-01' FROM generate_series(1,5000)i;
    INSERT INTO reorder_requests SELECT i,1,'OUT_OF_SCOPE_SECRET',1,999,1,11,'APPROVED','2020-01-01','2020-01-01' FROM generate_series(5001,5500)i;
    INSERT INTO reorder_requests VALUES(6000,2,'FOREIGN_REQUEST_SECRET',2,999,2,10,'APPROVED','2020-01-01','2020-01-01');
    CREATE TABLE export_jobs(id serial PRIMARY KEY,organization_id integer NOT NULL,created_by integer NOT NULL,dataset text NOT NULL,filters jsonb NOT NULL,format text NOT NULL DEFAULT 'excel',status text NOT NULL DEFAULT 'queued',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz,completed_at timestamptz,started_at timestamptz,attempts integer NOT NULL DEFAULT 0,last_error text,file_name text,file_path text,file_size bigint,mime_type text,row_count integer,download_token text,download_token_expires_at timestamptz,retention_expires_at timestamptz)`);
  for(const migration of [...compactFullDetailMigrations,...compactPublicationMigrations])await db.query(await readFile(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));
  const orgRoot=path.join(root,'org-1');await mkdir(orgRoot);
  const authorized={organizationId:1,userId:6,dataset:'reorder_requests',filters:{warehouseId:10}};
  const authorize=async()=>{const client=await db!.connect();try{await assertCompactExportActorWithClient(client,authorized);}finally{client.release();}};
  const capture=await captureOperationalCompact(db,{root:orgRoot,organizationId:1,actorId:6,dataset:authorized.dataset,filters:authorized.filters,authorize});assert.equal(capture.manifest.rowCount,5000);
  const spool=await readFile(path.join(capture.directory,'rows.jsonl'),'utf8');assert.doesNotMatch(spool,/FOREIGN_|OUT_OF_SCOPE_SECRET/);assert.match(spool,/0\.100000/);
  const jobId=Number((await db.query("INSERT INTO export_jobs(organization_id,created_by,dataset,filters,profile) VALUES(1,6,'reorder_requests',$1::jsonb,'compact_excel') RETURNING id",[JSON.stringify(capture.scope.normalizedFilters)])).rows[0].id);
  const claim=await claimCompactLease(db,{organizationId:1,serverId:'authorized-chain'});assert.ok(claim);assert.equal(claim.job_id,jobId);
  const lease={organizationId:1,attemptId:claim.id,leaseToken:claim.lease_token},request={captureDirectory:capture.directory,outputRoot:orgRoot,jobId,scope:capture.scope,columns:capture.columns},result=await runLeasedCompactWorker(db,lease,request);
  const publication={root,lease,request,result,policy:{organizationRetainedBytes:10_000_000,totalRetainedBytes:50_000_000,retentionDays:7,tokenTtlMinutes:30}};
  await db.query("DELETE FROM custom_role_permissions WHERE role_id=1 AND resource='reorder_requests' AND permission_type='read'");await assert.rejects(publishAuthorizedCompactWorkbook(db,publication),/source records/);
  await db.query("INSERT INTO custom_role_permissions(role_id,resource,permission_type) VALUES(1,'reorder_requests','read');UPDATE users SET warehouse_id=11 WHERE id=6");await assert.rejects(publishAuthorizedCompactWorkbook(db,publication),/Select your assigned warehouse/);
  assert.equal((await db.query('SELECT count(*)::int n FROM compact_export_publications')).rows[0].n,0);assert.equal((await db.query('SELECT status FROM export_jobs WHERE id=$1',[jobId])).rows[0].status,'running');
  await db.query('UPDATE users SET warehouse_id=10 WHERE id=6');await publishAuthorizedCompactWorkbook(db,publication);
  assert.equal((await db.query('SELECT row_count FROM export_jobs WHERE id=$1',[jobId])).rows[0].row_count,5000);assert.equal((await db.query('SELECT source_row_count::text n FROM compact_export_publications WHERE job_id=$1',[jobId])).rows[0].n,'5000');
  await publishAuthorizedCompactWorkbook(db,publication);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='COMPACT_WORKBOOK_PUBLISHED' AND resource_id=$1",[jobId])).rows[0].n,1,'Authorized publication replay must not duplicate governed audit');
  console.log(JSON.stringify({status:'passed',testDatabase:name,backgroundGrantRows:5000,authorizedCaptureRows:5000,excludedOtherWarehouseRows:500,actualWorkbookBytes:result.actualBytes,checks:['canonical role/custom-role predicates','no tenant or global-user-role inference','active membership/user/organization','cross-tenant and inactive custom roles','malformed role references','current grants and revocation','financial source permissions','warehouse assignment ownership','explicit reorder warehouse filter','unattributable operational scope refuses','no warehouse bypass for admin','read-only capture authorization','same-client publication locks block five revocation races','real scoped reader -> isolated validation -> canonical publication','post-capture permission and warehouse changes block publication without writes','current-access replay'],limitations:'Public orchestration, capture retention/cleanup and UI remain disabled/pending. Frozen financial record-level access and unsupported location attribution remain separately gated.'}));
}finally{await db?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});console.log('Removed exact test-owned authorized-publication root.');}
