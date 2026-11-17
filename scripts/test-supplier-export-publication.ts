import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import "dotenv/config";
import {assertDisposableDatabaseUrl} from "../server/config/database-safety";
import {publishSupplierExport,readSupplierPublications,matchesSupplierPublication} from "../server/modules/exports/supplier-export-publication";
import {openVerifiedExportArtifact} from "../server/modules/exports/paired-export-artifacts";
import {SUPPLIER_DISCLOSURE_POLICY} from "../shared/supplier-public-profile";
import {supplierExportMigrations} from "./release-migrations.mjs";

if(!process.argv.includes("--local-disposable"))throw new Error("Use --local-disposable; no business database may be tested.");
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD
  ?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);
assert.ok(configured,"Local PostgreSQL is required.");const url=new URL(configured);
assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));url.pathname="/postgres";
const name=`iss_export_test_${randomUUID().replaceAll("-","")}`;
const owner=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
let database:pg.Pool|undefined,created=false;
const root=await mkdtemp(path.join(os.tmpdir(),"iss-supplier-publication-"));
try{
  await owner.connect();url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());
  await owner.query(`CREATE DATABASE "${name}"`);created=true;
  database=new pg.Pool({connectionString:url.toString()});assert.equal((await database.query("SELECT current_database() AS name")).rows[0].name,name);
  await database.query(`CREATE TABLE organizations(id int PRIMARY KEY,active boolean);INSERT INTO organizations VALUES(1,true),(2,true);
    CREATE TABLE users(id int PRIMARY KEY,active boolean,warehouse_id int);INSERT INTO users VALUES(1,true,null);
    CREATE TABLE organization_members(id int PRIMARY KEY,organization_id int,user_id int,active boolean,status text,application_role text);
    INSERT INTO organization_members VALUES(1,1,1,true,'active','admin');
    CREATE TABLE export_jobs(id serial PRIMARY KEY,organization_id int NOT NULL,created_by int,dataset text,status text,filters jsonb DEFAULT '{}',
      file_name text,file_path text,file_size bigint,mime_type text,row_count int,download_token text,download_token_expires_at timestamptz,
      retention_expires_at timestamptz,completed_at timestamptz,updated_at timestamptz,last_error text);
    INSERT INTO export_jobs(organization_id,created_by,dataset,status) SELECT 1,1,'suppliers','running' FROM generate_series(1,5000);
    CREATE TABLE audit_logs(id serial PRIMARY KEY,organization_id int,user_id int,action text,resource_type text,resource_id int,details jsonb,reason text,
      previous_hash text,event_hash text,hash_version int,request_id text,ip_address text,user_agent text,created_at timestamptz);`);
  assert.equal((await readSupplierPublications(database,1,[1])).size,0,"Missing schema cannot certify old files.");
  for(const file of supplierExportMigrations){const sql=await readFile(`migrations/${file}`,"utf8");await database.query(sql);await database.query(sql);}
  assert.equal((await database.query("SELECT count(*) FROM supplier_export_publications")).rows[0].count,"0","Migration never certifies legacy files.");
  await mkdir(path.join(root,"org-1"));
  const bytes=Buffer.from("Synthetic safe profile export; no banking.");
  const input=async(id:number)=>{const filePath=path.join(root,`org-1/job-${id}-supplier.csv`);await writeFile(filePath,bytes);
    return {root,organizationId:1,id,filePath,fileName:"supplier.csv",mimeType:"text/csv",fileSize:bytes.length,rowCount:1,
      policyVersion:SUPPLIER_DISCLOSURE_POLICY,downloadToken:"synthetic-token",tokenExpiry:new Date(Date.now()+60000),retentionExpiry:new Date(Date.now()+3600000)};};
  const first=await input(1);
  await assert.rejects(()=>publishSupplierExport(database!,{...first,policyVersion:null}),/disclosure policy/);
  await Promise.all([publishSupplierExport(database,first),publishSupplierExport(database,first)]);
  assert.equal((await database.query("SELECT count(*) FROM supplier_export_publications WHERE organization_id=1 AND job_id=1")).rows[0].count,"1");
  assert.equal((await database.query("SELECT count(*) FROM audit_logs WHERE organization_id=1 AND resource_id=1")).rows[0].count,"1");
  const proof=(await readSupplierPublications(database,1,[1])).get(1)!;
  assert.ok(matchesSupplierPublication({dataset:"suppliers",...first},proof));
  assert.equal((await readSupplierPublications(database,2,[1])).size,0);
  await assert.rejects(()=>database!.query("UPDATE supplier_export_publications SET policy_version=policy_version WHERE job_id=1"),/immutable/);
  await assert.rejects(()=>database!.query("DELETE FROM supplier_export_publications WHERE job_id=1"),/immutable/);
  const stream=await openVerifiedExportArtifact(root,1,proof);const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));assert.deepEqual(Buffer.concat(chunks),bytes);
  await writeFile(first.filePath,Buffer.alloc(bytes.length,65));
  await assert.rejects(()=>openVerifiedExportArtifact(root,1,proof),/saved evidence/);
  await assert.rejects(()=>publishSupplierExport(database!,first),/cannot be replaced/);
  const second=await input(2);
  await database.query("ALTER TABLE audit_logs ADD CONSTRAINT injected_audit_failure CHECK(action<>'SUPPLIER_EXPORT_PUBLISHED') NOT VALID");
  await assert.rejects(()=>publishSupplierExport(database!,second));
  assert.equal((await database.query("SELECT status FROM export_jobs WHERE id=2 AND organization_id=1")).rows[0].status,"running");
  assert.equal((await readSupplierPublications(database,1,[2])).size,0,"Audit failure rolls back proof and success.");
  await database.query("ALTER TABLE audit_logs DROP CONSTRAINT injected_audit_failure");
  await database.query("UPDATE organization_members SET active=false WHERE organization_id=1 AND user_id=1");
  await assert.rejects(()=>publishSupplierExport(database!,second),/organization access/);
  await database.query("UPDATE organization_members SET active=true WHERE organization_id=1 AND user_id=1");
  await publishSupplierExport(database,second);
  await assert.rejects(()=>readSupplierPublications(database!,1,Array.from({length:101},(_,i)=>i+1)),/bounded/);
  assert.equal((await database.query("SELECT count(*) FROM export_jobs")).rows[0].count,"5000");
  console.log(`PASS supplier export publication: migration/idempotency, concurrent replay, immutable proof, audit rollback, denied membership, tenant isolation, tamper refusal and bounded lookup over 5000 jobs. Database: ${name}`);
}finally{
  if(database)await database.end();
  if(created){await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact disposable database ${name}.`);}
  await owner.end();await rm(root,{recursive:true,force:true});
}
