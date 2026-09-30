import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import { config } from "dotenv";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";

// Never run against the application database. --local-disposable creates a uniquely
// named, empty database using local connection credentials, then removes only it.
config({quiet:true});
let owner: pg.Pool | undefined;
let ownedName: string | undefined;
if(process.argv.includes("--local-disposable")) {
  const configured=process.env.DATABASE_URL || (process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD
    ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres` : undefined);
  assert.ok(configured,"Set DATABASE_URL or PGHOST/PGUSER/PGPASSWORD to create a local disposable test database.");
  const url=new URL(configured);
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname),"Local database host required");
  ownedName=`iss_cycle_test_${randomUUID().replaceAll("-","")}`;
  url.pathname="/postgres";owner=new pg.Pool({connectionString:url.toString(),connectionTimeoutMillis:5000});
  await owner.query(`CREATE DATABASE "${ownedName}"`);
  url.pathname=`/${ownedName}`;process.env.TEST_DATABASE_URL=url.toString();
}
assertDisposableDatabaseUrl(process.env.TEST_DATABASE_URL);
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const {pool}=await import("../server/db");
let server: ReturnType<express.Express["listen"]> | undefined;
try {
  // Minimal integration fixture, not a substitute for full migration rehearsal.
  assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='cycle_counts'")).rows[0].n,0,"Use an empty disposable database");
  await pool.query(`
    CREATE TABLE organizations(id integer PRIMARY KEY);
    CREATE TABLE users(id integer PRIMARY KEY,warehouse_id integer);
    CREATE TABLE organization_members(
      organization_id integer NOT NULL,
      user_id integer NOT NULL,
      active boolean NOT NULL DEFAULT true,
      status text NOT NULL DEFAULT 'active',
      PRIMARY KEY(organization_id,user_id)
    );
    CREATE TABLE warehouses(id integer PRIMARY KEY,organization_id integer,name text);
    CREATE TABLE inventory_items(id integer PRIMARY KEY,organization_id integer,sku text,name text,quantity integer,cost numeric,updated_at timestamp DEFAULT now());
    CREATE TABLE warehouse_inventory(id serial PRIMARY KEY,organization_id integer,warehouse_id integer,item_id integer,quantity integer,bin text,location text,updated_at timestamp DEFAULT now());
    CREATE TABLE cycle_counts(id serial PRIMARY KEY,organization_id integer,warehouse_id integer,status text,counted_by integer,count_date timestamp DEFAULT now(),updated_at timestamp DEFAULT now());
    CREATE TABLE stock_movements(id serial PRIMARY KEY,organization_id integer,item_id integer,warehouse_id integer,type text,quantity integer,reference_id integer,reference_type text,user_id integer,previous_quantity integer,new_quantity integer,unit_cost numeric,notes text);
    CREATE TABLE inventory_allocations(organization_id integer,warehouse_id integer,item_id integer,status text,quantity integer);
    CREATE TABLE ops_activity(organization_id integer,actor text,entity_type text,entity_id text,action text,summary_json jsonb);
    CREATE TABLE event_outbox(organization_id integer,aggregate_type text,aggregate_id text,event_type text,payload jsonb);
    CREATE TABLE audit_logs(id serial PRIMARY KEY,organization_id integer,user_id integer,action text,resource_type text,resource_id integer,details jsonb,reason text,previous_hash text,event_hash text,hash_version integer,request_id text,ip_address text,user_agent text,created_at timestamptz);
    INSERT INTO organizations VALUES(1),(2);
    INSERT INTO users VALUES(1,NULL),(2,NULL),(3,2),(4,NULL);
    INSERT INTO organization_members(organization_id,user_id) VALUES(1,1),(1,2),(2,3),(1,4);
    INSERT INTO warehouses VALUES(1,1,'Primary warehouse'),(2,2,'Foreign warehouse');
    INSERT INTO inventory_items VALUES(1,1,'COUNT-A','Counting item',100,5,now()),(2,2,'FOREIGN','Foreign item',20,5,now());
    INSERT INTO warehouse_inventory(organization_id,warehouse_id,item_id,quantity,bin) VALUES(1,1,1,100,'A'),(2,2,2,20,'B');
  `);
  const migration=await readFile("migrations/20260915120000_cycle_count_integrity.sql","utf8");
  await pool.query(migration);await pool.query(migration);
  const {registerCycleCountRoutes}=await import("../server/modules/cycle-counts/register-cycle-count-routes");
  const {runWithTenantContext}=await import("../server/organization-context");
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{
    const actor=Number(req.get("Actor")??1),org=actor===3?2:1;
    Object.assign(req,{user:{id:actor}});
    runWithTenantContext({organizationId:org,membershipId:actor,userId:actor,userRole:"admin",membershipRole:"admin",effectivePermissions:[],correlationId:"cycle-test"},next);
  });
  registerCycleCountRoutes(app,{ensureAuthenticated:(_req,_res,next)=>next(),ensurePermission:(_resource,action)=>(req,res,next)=>{if(req.get("Actor")==="4"&&action!=="read") {res.status(403).json({denied:true});return;}next();}});
  server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server!.once("listening",resolve));
  const port=(server.address() as {port:number}).port;
  const call=async(path:string,method="GET",body?:unknown,actor=1,key?:string)=>{
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{"Content-Type":"application/json",Actor:String(actor),...(key?{"Idempotency-Key":key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json() as any};
  };
  const base="/api/v2/inventory/cycle-counts";
  assert.equal((await call(base,"POST",{warehouseId:2})).status,403);
  assert.equal((await call(base,"POST",{warehouseId:1},4)).status,403);
  const id=(await call(base,"POST",{warehouseId:1})).body.data.id;
  assert.ok(id);
  assert.equal((await call(`${base}/${id}`,"GET",undefined,3)).status,404);
  assert.equal((await call(`${base}/${id}/start`,"POST",{})).status,200);
  let line=(await call(`${base}/${id}/lines`)).body.data.items[0];
  assert.equal("expectedQuantity" in line,false);assert.equal("variance" in line,false);
  assert.equal((await call(`${base}/${id}/review`)).status,403);
  assert.equal((await call(`${base}/${id}/lines/${line.id}`,"PUT",{countedQuantity:97,systemQuantity:100})).status,400);
  assert.equal((await call(`${base}/${id}/lines/${line.id}`,"PUT",{countedQuantity:97})).status,200);
  assert.equal((await call(`${base}/${id}/lines/${line.id}`,"PUT",{countedQuantity:98})).status,409);
  assert.equal((await call(`${base}/${id}/submit`,"POST",{})).body.data.status,"PENDING_APPROVAL");
  assert.equal((await call(`${base}/${id}/approve`,"POST",{})).status,403);
  // Quantity returns to its initial value, but revision must still invalidate it.
  await pool.query("UPDATE warehouse_inventory SET quantity=99 WHERE id=1; UPDATE warehouse_inventory SET quantity=100 WHERE id=1");
  assert.equal((await call(`${base}/${id}/approve`,"POST",{},2)).status,409);
  assert.equal((await call(`${base}/${id}`)).body.data.status,"RECOUNT_REQUIRED");
  await call(`${base}/${id}/start`,"POST",{});
  line=(await call(`${base}/${id}/lines`)).body.data.items[0];
  await call(`${base}/${id}/lines/${line.id}`,"PUT",{countedQuantity:97});
  await call(`${base}/${id}/submit`,"POST",{});
  assert.equal((await call(`${base}/${id}/review`,"GET",undefined,2)).body.data.items[0].variance,"-3");
  assert.equal((await call(`${base}/${id}/approve`,"POST",{},2)).status,200);
  await pool.query(`CREATE FUNCTION reject_count_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$; CREATE TRIGGER reject_count_test BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION reject_count_test()`);
  const key=randomUUID();
  assert.equal((await call(`${base}/${id}/post`,"POST",{},1,key)).status,500);
  assert.equal((await pool.query("SELECT quantity FROM warehouse_inventory WHERE id=1")).rows[0].quantity,100);
  assert.equal((await call(`${base}/${id}`)).body.data.status,"APPROVED");
  await pool.query("DROP TRIGGER reject_count_test ON stock_movements");
  assert.equal((await call(`${base}/${id}/post`,"POST",{},1,key)).status,200);
  assert.equal((await call(`${base}/${id}/post`,"POST",{},1,key)).body.data.replayed,true);
  assert.equal((await call(`${base}/${id}/post`,"POST",{},1,randomUUID())).status,409);
  assert.equal((await pool.query("SELECT quantity FROM warehouse_inventory WHERE id=1")).rows[0].quantity,97);
  assert.equal((await pool.query("SELECT quantity FROM inventory_items WHERE id=1")).rows[0].quantity,97);
  assert.equal((await pool.query("SELECT count(*)::int n FROM stock_movements")).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM cycle_count_attempts")).rows[0].n,2);
  assert.equal((await call(`/api/cycle-counts/${id}`,"PATCH",{status:"planned"})).status,409);
  assert.equal((await call("/api/cycle-count-lines")).status,409);
  assert.equal((await call(`${base}?pageSize=1000`)).status,400);
  // Zero-variance completion requires no independent stock approval or movement.
  const zero=(await call(base,"POST",{warehouseId:1})).body.data.id;
  await call(`${base}/${zero}/start`,"POST",{});
  const zeroLine=(await call(`${base}/${zero}/lines`)).body.data.items[0];
  await call(`${base}/${zero}/lines/${zeroLine.id}`,"PUT",{countedQuantity:97});
  assert.equal((await call(`${base}/${zero}/submit`,"POST",{})).body.data.status,"APPROVED");
  const zeroKey=randomUUID();
  const concurrent=await Promise.all([call(`${base}/${zero}/post`,"POST",{},1,zeroKey),call(`${base}/${zero}/post`,"POST",{},1,zeroKey)]);
  assert.ok(concurrent.some(result=>result.status===200));
  assert.ok(concurrent.every(result=>[200,409].includes(result.status)));
  assert.equal((await call(`${base}/${zero}/post`,"POST",{},1,zeroKey)).status,200);
  assert.equal((await pool.query("SELECT count(*)::int n FROM stock_movements")).rows[0].n,1);
  const legacy=await pool.query("INSERT INTO cycle_counts(organization_id,warehouse_id,status) VALUES(1,1,'completed') RETURNING id");
  assert.equal((await call(`${base}/${legacy.rows[0].id}/start`,"POST",{})).status,409);
  await pool.query("INSERT INTO cycle_counts(organization_id,warehouse_id,status) SELECT 1,1,'PLANNED' FROM generate_series(1,5000)");
  for(const pageSize of [25,50,100]) {
    const pageResult=(await call(`${base}?page=2&pageSize=${pageSize}`)).body.data;
    assert.equal(pageResult.items.length,pageSize);
    assert.equal(pageResult.total,5003);
  }
  console.log("Cycle count runtime checks passed: blind evidence, independence, tenant denial, stale revisions, rollback, stock propagation and replay.");
  if(process.argv.includes("--positions")) {
    const {testPositions}=await import("./test-position-runtime");
    await testPositions(app,pool,call);
  }
  if(process.argv.includes("--holds")) {
    const {testSafetyHolds}=await import("./test-safety-hold-runtime");
    await testSafetyHolds(app,pool,call);
    const {testStockCommands}=await import("./test-stock-command-runtime");
    await testStockCommands(pool);
    const {testGoodsReceipts}=await import("./test-goods-receipt-runtime");
    await testGoodsReceipts(pool);
    const {testInspectionRules}=await import("./test-inspection-rules-runtime");
    await testInspectionRules(app,pool,call);
    const {testItemRequests}=await import("./test-item-requests-runtime");
    await testItemRequests(app,pool,call);
    const {testAvailability}=await import("./test-availability-runtime");
    await testAvailability(app,pool,call);
  }
  if(process.argv.includes("--browser")) {
    const {serveWarehouseBrowserHarness}=await import("./warehouse-browser-harness");
    await serveWarehouseBrowserHarness(app,server!);
  }
} finally {
  if(server) await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
  await pool.end();
  if(owner&&ownedName) {
    assert.match(ownedName,/^iss_cycle_test_[a-f0-9]{32}$/);
    await owner.query(`DROP DATABASE "${ownedName}"`);
    await owner.end();
    console.log("Removed the test-owned disposable database; application data was not changed.");
  }
}
