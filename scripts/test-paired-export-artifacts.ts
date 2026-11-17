import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile,mkdtemp,mkdir,writeFile,rm,open} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import "dotenv/config";
import {assertDisposableDatabaseUrl} from "../server/config/database-safety";
import {publishExportPair,type ExportArtifactInput} from "../server/modules/exports/paired-export-artifacts";
import {compactExportMigrations} from "./release-migrations.mjs";
import {readExpiredExportFiles} from "../server/modules/exports/expired-export-files";

if(!process.argv.includes("--local-disposable"))throw new Error("Use --local-disposable; application databases are never mutation targets.");
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD
  ?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);
assert.ok(configured,"Local PostgreSQL configuration is required.");
const url=new URL(configured);assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));
const name=`iss_export_test_${randomUUID().replaceAll("-","")}`;url.pathname="/postgres";
const owner=new pg.Client({connectionString:url.toString()});let created=false;
let database:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),"iss-export-pair-"));
try{
  await owner.connect();url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());
  await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);
  database=new pg.Pool({connectionString:url.toString()});
  assert.equal((await database.query("SELECT current_database() AS name")).rows[0].name,name);
  await database.query(`CREATE TABLE organizations(id integer PRIMARY KEY);
    INSERT INTO organizations VALUES(1),(2);
    CREATE TABLE export_jobs(id serial PRIMARY KEY,organization_id integer NOT NULL,status text NOT NULL,file_name text,file_path text,file_size bigint,mime_type text,row_count integer,
      download_token text,download_token_expires_at timestamptz,retention_expires_at timestamptz,completed_at timestamptz,updated_at timestamptz,last_error text);
    INSERT INTO export_jobs(organization_id,status) SELECT 1,'running' FROM generate_series(1,4)`);
  for(const migration of compactExportMigrations){
    const sql=await readFile(new URL(`../migrations/${migration}`,import.meta.url),"utf8");
    await database.query(sql);await database.query(sql);
  }
  await mkdir(path.join(root,"org-1"));
  const artifacts=async(jobId:number):Promise<ExportArtifactInput[]>=>{
    const files:ExportArtifactInput[]=[{kind:"summary",fileName:"summary.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",relativePath:`org-1/job-${jobId}-summary.xlsx`},
      {kind:"archive",fileName:"details.zip",mimeType:"application/zip",relativePath:`org-1/job-${jobId}-details.zip`}];
    // Storage fixtures only: no claim that these are valid Excel/ZIP documents.
    for(const file of files)await writeFile(path.join(root,file.relativePath),`Storage transaction fixture for ${jobId}/${file.kind}`);
    return files;
  };
  const first=await artifacts(1);
  const input={root,organizationId:1,jobId:1,snapshotReference:"verified-test-snapshot",sourceRowCount:365300,tokenTtlMinutes:30,retentionDays:7,artifacts:first};
  const a=await database.connect(),b=await database.connect();
  try{
    const results=await Promise.all([publishExportPair(database,input),publishExportPair(database,input)]);
    assert.equal(results.filter(result=>result.replayed).length,1);
    const saved=(await a.query("SELECT * FROM export_jobs WHERE id=1")).rows[0];
    assert.equal(saved.status,"succeeded");assert.equal(saved.file_name,"summary.xlsx");assert.equal(saved.row_count,365300);
    assert.equal((await a.query("SELECT count(*)::int n FROM export_artifacts WHERE job_id=1")).rows[0].n,2);
    const expectedHash=createHash("sha256").update(await readFile(path.join(root,first[0].relativePath))).digest("hex");
    assert.equal((await a.query("SELECT sha256 FROM export_artifacts WHERE job_id=1 AND kind='summary'")).rows[0].sha256,expectedHash);
    await publishExportPair(database,input);
    assert.deepEqual((await a.query("SELECT * FROM export_jobs WHERE id=1")).rows[0],saved,"Retry cannot replace files, tokens or expiry");
    await assert.rejects(publishExportPair(database,{...input,snapshotReference:"different-snapshot"}),/cannot be replaced/);
    await assert.rejects(publishExportPair(database,{...input,organizationId:2}),/owned job directory/);
    await mkdir(path.join(root,"org-2"));
    const foreign=first.map(file=>({...file,relativePath:file.relativePath.replace("org-1/","org-2/")}));
    for(const file of foreign)await writeFile(path.join(root,file.relativePath),"Tenant isolation storage fixture");
    await assert.rejects(publishExportPair(database,{...input,organizationId:2,artifacts:foreign}),/not available in this organization/);
    await assert.rejects(publishExportPair(database,{...input,artifacts:[first[0]]}),/summary and full-detail/);
    await assert.rejects(publishExportPair(database,{...input,artifacts:[{...first[0],relativePath:"../outside.xlsx"},first[1]]}),/owned job directory/);
    await assert.rejects(a.query("UPDATE export_artifacts SET sha256=repeat('a',64) WHERE job_id=1"),/immutable/);
    await a.query(`CREATE FUNCTION reject_archive() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='archive' THEN RAISE EXCEPTION 'Injected publication failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_archive BEFORE INSERT ON export_artifacts FOR EACH ROW EXECUTE FUNCTION reject_archive()`);
    const second=await artifacts(2);
    await assert.rejects(publishExportPair(database,{...input,jobId:2,artifacts:second}),/Injected publication/);
    assert.equal((await a.query("SELECT status FROM export_jobs WHERE id=2")).rows[0].status,"running");
    assert.equal((await a.query("SELECT count(*)::int n FROM export_artifacts WHERE job_id=2")).rows[0].n,0);
    await a.query("DROP TRIGGER reject_archive ON export_artifacts; DROP FUNCTION reject_archive()");
    await a.query(`CREATE FUNCTION reject_job_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=2 THEN RAISE EXCEPTION 'Injected final job failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_job_publication BEFORE UPDATE ON export_jobs FOR EACH ROW EXECUTE FUNCTION reject_job_publication()`);
    await assert.rejects(publishExportPair(database,{...input,jobId:2,artifacts:second}),/Injected final job failure/);
    assert.equal((await a.query("SELECT count(*)::int n FROM export_artifacts WHERE job_id=2")).rows[0].n,0,"Final job write failure rolls back both artifact records");
    await a.query("DROP TRIGGER reject_job_publication ON export_jobs; DROP FUNCTION reject_job_publication()");
    await publishExportPair(database,{...input,jobId:2,artifacts:second});
    const third=await artifacts(3),large=await open(path.join(root,third[0].relativePath),"r+");
    try{await large.truncate(100_000_000);}finally{await large.close();}
    await assert.rejects(publishExportPair(database,{...input,jobId:3,artifacts:third}),/smaller than 100 MB/);
    assert.equal((await a.query("SELECT status FROM export_jobs WHERE id=3")).rows[0].status,"running");
    const fourth=await artifacts(4),archive=await open(path.join(root,fourth[1].relativePath),"r+");
    try{await archive.truncate(100_000_001);}finally{await archive.close();}
    await publishExportPair(database,{...input,jobId:4,artifacts:fourth});
    assert.equal((await a.query("SELECT file_size::text size FROM export_artifacts WHERE job_id=4 AND kind='archive'")).rows[0].size,"100000001");
    await a.query("UPDATE export_jobs SET retention_expires_at=now()-interval '1 day' WHERE id=1");
    const expired=await readExpiredExportFiles(database);
    assert.equal(expired.length,1);assert.equal(expired[0].id,1);assert.equal(expired[0].filePaths.length,2,"Retention must cover summary and archive without duplicating the primary file");
    await a.query("ALTER TABLE export_artifacts RENAME TO export_artifacts_retention_test");
    try{const legacy=await readExpiredExportFiles(database);assert.equal(legacy.length,1);assert.equal(legacy[0].filePaths.length,1);}
    finally{await a.query("ALTER TABLE export_artifacts_retention_test RENAME TO export_artifacts");}
    await a.query("INSERT INTO export_jobs(organization_id,status,file_path,retention_expires_at) SELECT 1,'succeeded','test-only-expired-'||n,now()-interval '2 days' FROM generate_series(1,150) n");
    const batch=await readExpiredExportFiles(database);assert.equal(batch.length,100,"Retention batches remain bounded");
    assert.equal((await a.query("SELECT count(*)::int n FROM export_artifacts WHERE job_id=1")).rows[0].n,2,"Retention discovery preserves immutable publication evidence");
    console.log("Paired export storage passed: atomic publication/rollback, concurrent replay, snapshot immutability, tenant/path denial, exact summary limit and archive over 100 MB.");
  }finally{a.release();b.release();}
}finally{
  await database?.end();
  if(created){await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}
  await owner.end();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith("iss-export-pair-"));await rm(root,{recursive:true,force:true});
}
