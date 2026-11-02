import "dotenv/config";
import pg from "pg";
import { randomUUID,createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile,stat } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { releaseMigrations } from "./release-migrations.mjs";

if(!process.argv.includes("--apply-approved"))throw new Error("Explicit approved application flag required.");
const configured=process.env.DATABASE_URL || (process.env.PGUSER && process.env.PGDATABASE
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD??"")}@${process.env.PGHOST??"localhost"}:${process.env.PGPORT??5432}/${process.env.PGDATABASE}` : null);
if(!configured)throw new Error("DATABASE_URL required.");
const source=new URL(configured);
if(!["localhost","127.0.0.1"].includes(source.hostname)||source.pathname!=="/iss_sourcing")throw new Error("Only approved local iss_sourcing is permitted.");
const backupDirectory=process.argv[process.argv.indexOf("--backup-directory")+1];
if(!backupDirectory||!path.isAbsolute(backupDirectory))throw new Error("Approved absolute backup directory required.");
await stat(backupDirectory);
const probe=net.createServer();
await new Promise((resolve,reject)=>probe.once("error",()=>reject(new Error("Port 5000 is occupied; stop workspace workers before migration."))).listen(5000,"127.0.0.1",resolve));
await new Promise(resolve=>probe.close(resolve));
const bin="C:/Program Files/PostgreSQL/18/bin";
const commandEnv={...process.env,PGHOST:source.hostname,PGPORT:source.port||"5432",PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password),PGSSLMODE:"disable"};
function run(executable,args,env=commandEnv){const result=spawnSync(executable,args,{env,stdio:["ignore","pipe","pipe"],encoding:"utf8"});if(result.status!==0)throw new Error(`${path.basename(executable)} failed; application stopped before further migrations. ${result.stderr?.replaceAll(decodeURIComponent(source.password),"***")}`);}
const sourceClient=new pg.Client({connectionString:configured});
const adminUrl=new URL(configured);adminUrl.pathname="/postgres";
const admin=new pg.Client({connectionString:adminUrl.toString()});
const clone=`iss_${randomUUID().replaceAll("-","")}_restore_rehearsal`;
const cloneUrl=new URL(configured);cloneUrl.pathname=`/${clone}`;
let created=false;
async function snapshot(client){
  const tables=(await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id'
    AND table_name=ANY($1::text[]) ORDER BY table_name`,[["organization_members","suppliers","supplier_portal_mappings","inventory_items","warehouse_inventory","purchase_requisitions","purchase_orders","purchase_order_items","ap_receipts","invoices","audit_logs"]])).rows;
  const values={};
  for(const {table_name} of tables)values[table_name]=(await client.query(`SELECT organization_id,count(*)::text AS count FROM "${table_name}" GROUP BY organization_id ORDER BY organization_id NULLS FIRST`)).rows;
  return JSON.stringify(values);
}
try{
  await sourceClient.connect();await admin.connect();
  const before=await snapshot(sourceClient);
  const version=(await sourceClient.query("SELECT version() AS version")).rows[0].version;
  const dump=path.join(backupDirectory,`iss_sourcing-${new Date().toISOString().replaceAll(/[:.]/g,"-")}.dump`);
  run(path.join(bin,"pg_dump.exe"),["--format=custom","--no-owner","--no-privileges","--file",dump,"--dbname","iss_sourcing"]);
  const checksum=createHash("sha256").update(await readFile(dump)).digest("hex");
  console.log(JSON.stringify({backup:dump,size:(await stat(dump)).size,sha256:checksum,database:"iss_sourcing",version}));
  await admin.query(`CREATE DATABASE "${clone}"`);created=true;
  run(path.join(bin,"pg_restore.exe"),["--no-owner","--no-privileges","--exit-on-error","--dbname",clone,dump]);
  const restored=new pg.Client({connectionString:cloneUrl.toString()});await restored.connect();
  try{
    if(await snapshot(restored)!==before)throw new Error("Restored business/tenant counts differ.");
    for(let pass=0;pass<2;pass++)for(const file of releaseMigrations)run(process.execPath,["scripts/apply-sql-migration.mjs",file],{...commandEnv,DATABASE_URL:cloneUrl.toString()});
    if(await snapshot(restored)!==before)throw new Error("Rehearsed migrations changed business/tenant counts.");
  }finally{await restored.end();}
  console.log("Fresh backup restored; both migration passes preserved business/tenant counts.");
  for(const file of releaseMigrations){run(process.execPath,["scripts/apply-sql-migration.mjs",file],{...commandEnv,DATABASE_URL:configured});console.log(`Approved local migration applied: ${file}`);}
  if(await snapshot(sourceClient)!==before)throw new Error("Post-migration business/tenant counts differ; investigate before startup.");
  console.log("Approved local migrations complete; business counts and tenant ownership counts unchanged. Backup retained.");
}finally{
  if(created)await admin.query(`DROP DATABASE "${clone}" WITH (FORCE)`);
  await sourceClient.end().catch(()=>undefined);await admin.end().catch(()=>undefined);
}
