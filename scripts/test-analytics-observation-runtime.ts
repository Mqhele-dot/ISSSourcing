import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
import pg from "pg";
import "dotenv/config";
import {assertMatchedDisposableDatabaseUrls} from "../server/config/database-safety";
import {analyticsResources} from "../shared/analytics-source-access";
import type {AnalyticsSourceTiming} from "../server/modules/reports/analytics-insights-service";

if(!process.argv.includes("--local-disposable"))throw new Error("Use --local-disposable; business targets are forbidden.");
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD
  ?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);
assert.ok(configured);const url=new URL(configured);assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));url.pathname="/postgres";
const name=`iss_analytics_test_${randomUUID().replaceAll("-","")}`;
const owner=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});let created=false,database:Pool|undefined;
try {
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;
  console.log(`Created exact synthetic Analytics database ${name}.`);
  url.pathname=`/${name}`;process.env.DATABASE_URL=url.toString();process.env.TEST_DATABASE_URL=url.toString();process.env.NODE_ENV="test";
  assert.equal(assertMatchedDisposableDatabaseUrls(process.env.DATABASE_URL,process.env.TEST_DATABASE_URL),name);
  database=(await import("../server/db")).pool;
  const sourceSql=new Map<string,{text:string;values:unknown[]}>();
  database.on("connect",client=>{
    const original=client.query.bind(client);
    client.query=((...args:any[])=>{
      const text=typeof args[0]==="string"?args[0]:args[0]?.text;
      if(typeof text==="string"&&/^\s*(SELECT|WITH)\b/i.test(text)&&Array.isArray(args[1])) {
        const source=text.includes("FROM suppliers supplier")?"supplier_risk":text.includes("shipment.tracking_number")?"logistics":null;
        if(source)sourceSql.set(source,{text,values:args[1]});
      }
      return (original as (...values:any[])=>any)(...args);
    }) as typeof client.query;
  });
  assert.equal((await database.query("SELECT current_database() AS name")).rows[0].name,name);
  await database.query(`
    CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int,name text,legal_name text,supplier_code text,status text,risk_rating text,risk_status text);
    CREATE TABLE warehouses(id int PRIMARY KEY,organization_id int,name text,location text);
    CREATE TABLE categories(id int PRIMARY KEY,organization_id int,name text);
    CREATE TABLE departments(id int PRIMARY KEY,organization_id int,name text,code text,active boolean);
    CREATE TABLE users(id int PRIMARY KEY,username text,full_name text);
    CREATE TABLE organization_members(organization_id int,user_id int,active boolean);
    CREATE TABLE purchase_orders(id int PRIMARY KEY,organization_id int,supplier_id int,order_number text,status text,order_date timestamp,expected_delivery_date timestamp,updated_at timestamp,created_at timestamp,created_by_user_id int,department_id int);
    CREATE TABLE purchase_requisitions(id int PRIMARY KEY,organization_id int,supplier_id int,status text,created_at timestamp,requestor_id int,department_id int);
    CREATE TABLE inventory_items(id int PRIMARY KEY,organization_id int,sku text,name text,category_id int,supplier_id int,quantity numeric,price numeric,cost numeric,expiry_date timestamp,low_stock_threshold numeric,reorder_point numeric,status text,default_location text,location text,updated_at timestamp,safety_hold boolean);
    CREATE TABLE warehouse_inventory(organization_id int,item_id int,warehouse_id int,quantity numeric,location text,updated_at timestamp);
    CREATE TABLE inventory_allocations(organization_id int,item_id int,warehouse_id int,quantity numeric,status text);
    CREATE TABLE stock_movements(id int PRIMARY KEY,organization_id int,item_id int,type text,timestamp timestamp);
    CREATE TABLE shipments(id int PRIMARY KEY,organization_id int,purchase_order_id int,po_number text,carrier text,tracking_number text,status text,eta timestamp,created_at timestamp,updated_at timestamp);
    CREATE TABLE invoices(id int PRIMARY KEY,organization_id int,supplier_id int,invoice_number text,status text,issue_date timestamp,due_date timestamp,due_amount numeric,total numeric,paid_amount numeric,purchase_order_id int,created_by int,created_at timestamp,updated_at timestamp);
    CREATE TABLE operational_exceptions(id int PRIMARY KEY,organization_id int,type text,severity text,status text,title text,assignee text,sla_hours int,related_refs jsonb,created_at timestamp,updated_at timestamp);
    INSERT INTO suppliers SELECT g,1,'Synthetic supplier '||g,null,'S-'||g,'active','high',null FROM generate_series(1,5000) g;
    INSERT INTO suppliers VALUES(9001,2,'FOREIGN-PRIVATE',null,'FOREIGN','active','high',null);
    INSERT INTO warehouses VALUES(1,1,'Synthetic warehouse','A'),(2,2,'FOREIGN-WAREHOUSE','B');
    INSERT INTO categories VALUES(1,1,'Synthetic category');INSERT INTO departments VALUES(1,1,'Synthetic department','D',true);
    INSERT INTO users VALUES(1,'synthetic','Synthetic actor');INSERT INTO organization_members VALUES(1,1,true);
    INSERT INTO purchase_orders SELECT g,1,g,'AN-'||g,'SENT','2026-10-15','2026-10-16','2026-10-15','2026-10-15',1,1 FROM generate_series(1,5000) g;
    INSERT INTO purchase_requisitions SELECT g,1,g,'APPROVED','2026-10-15',1,1 FROM generate_series(1,5000) g;
    INSERT INTO inventory_items SELECT g,1,'SKU-'||g,'Synthetic item '||g,1,g,1.25,2,1,null,2,3,'active',null,null,'2026-10-15',false FROM generate_series(1,5000) g;
    INSERT INTO warehouse_inventory SELECT 1,g,1,1.25,'A','2026-10-15' FROM generate_series(1,5000) g;
    INSERT INTO inventory_allocations SELECT 1,g,1,0.25,'reserved' FROM generate_series(1,5000) g;
    INSERT INTO stock_movements SELECT g,1,g,'RECEIPT','2026-10-15' FROM generate_series(1,5000) g;
    INSERT INTO shipments SELECT g,1,CASE WHEN g%2=0 THEN g ELSE null END,'AN-'||g,'Synthetic carrier','T-'||g,'in_transit','2026-10-16','2026-10-15','2026-10-15' FROM generate_series(1,5000) g;
    INSERT INTO invoices SELECT g,1,g,'INV-'||g,'APPROVED','2026-10-15','2026-10-16',1,1,0,g,1,'2026-10-15','2026-10-15' FROM generate_series(1,5000) g;
    INSERT INTO operational_exceptions SELECT g,1,'procurement','high','open','Synthetic issue '||g,null,24,'{}','2026-10-15','2026-10-15' FROM generate_series(1,5000) g;
    ANALYZE;`);
  const {buildAnalyticsInsights}=await import("../server/modules/reports/analytics-insights-service");
  const access=Object.fromEntries(analyticsResources.map(key=>[key,true]));
  const filters={dateFrom:"2026-10-01T00:00:00.000Z",dateTo:"2026-11-30T23:59:59.999Z"};
  const timings:AnalyticsSourceTiming[]=[];
  const result=await buildAnalyticsInsights(1,"procurement",filters,access,timing=>timings.push(timing));
  console.log(JSON.stringify({phase:"5000-source-observation",queryMs:result.meta.queryMs,timings:timings.map(t=>({...t,poolWaitMs:Math.round(t.poolWaitMs),executionMs:Math.round(t.executionMs),transactionMs:Math.round(t.transactionMs),totalMs:Math.round(t.totalMs)})),failed:result.meta.partialFailures.map(f=>f.area)}));
  for(const [source,query] of sourceSql) {
    const client=await database.connect();
    try {
      await client.query("BEGIN READ ONLY");await client.query("SET LOCAL statement_timeout='10s'");
      const plan=(await client.query(`EXPLAIN (${process.argv.includes("--explain-analyze")?"ANALYZE, BUFFERS, ":""}FORMAT JSON) ${query.text}`,query.values)).rows[0]["QUERY PLAN"][0];
      const nodes:unknown[]=[];
      const visit=(node:any)=>{if(nodes.length>=50)return;nodes.push({type:node["Node Type"],relation:node["Relation Name"],subplan:node["Subplan Name"],rows:node["Plan Rows"],actualRows:node["Actual Rows"],loops:node["Actual Loops"],cost:node["Total Cost"]});for(const child of node.Plans??[])visit(child);};visit(plan.Plan);
      console.log(JSON.stringify({phase:"query-plan",source,executionMs:plan["Execution Time"],nodes}));await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  assert.deepEqual(result.meta.partialFailures,[],"Every authorized source must execute, not silently degrade.");
  assert.equal(result.kpis.openPurchaseOrders.value,5000);
  assert.equal(result.kpis.supplierRisk.value,5000,"The top-100 attention list is not an authoritative supplier-risk total.");
  assert.equal(result.kpis.lateShipments.value,5000);
  assert.equal(result.kpis.openExceptions.value,5000);
  const trend=result.charts.operationsTrend as Array<{date:string;purchaseOrders?:number}>;
  assert.ok(trend.every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)),`Trend dates must be ISO calendar dates, not truncated Date.toString(): ${trend[0]?.date}`);
  assert.equal(trend.find(row=>row.date==="2026-10-15")?.purchaseOrders,5000);
  assert.equal(result.kpis.procurementSpend.value,"Unavailable");assert.equal(result.kpis.apExposure.value,"Unavailable");
  assert.equal(result.tables.lowStockItems.rows.length,25);assert.equal(result.tables.highRiskSuppliers.rows.length,25);
  assert.ok(result.tables.lowStockItems.rows.every(row=>row.available==="1.00"||row.available==="1"));
  assert.ok(!JSON.stringify(result).includes("FOREIGN-PRIVATE"));
  assert.ok(timings.length<=16);assert.ok(timings.every(t=>t.totalMs>=0&&t.rows>=0));
  for(const source of ["logistics","supplier_risk"])assert.ok(timings.find(t=>t.source===source)!.executionMs<5000,`${source} must stay within the original five-second focused performance budget.`);

  // Ambiguous legacy references stay unlinked; a canonical foreign ID may not fall back to matching text.
  await database.query(`INSERT INTO purchase_orders VALUES(9001,2,9001,'AN-1','SENT','2026-10-15','2026-10-16','2026-10-15','2026-10-15',1,1);
    INSERT INTO shipments VALUES(9001,1,9001,'AN-2','Synthetic unresolved carrier','X','in_transit','2026-10-16','2026-10-15','2026-10-15');
    UPDATE shipments SET po_number='TEXT-DOES-NOT-OVERRIDE-ID' WHERE id=5000;
    UPDATE suppliers SET risk_rating=null,risk_status=null WHERE id=5000;
    INSERT INTO inventory_allocations VALUES(1,1,null,0.125,'reserved');`);
  const hash=async()=>(await database!.query(`SELECT
    (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM suppliers s) AS suppliers,
    (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM purchase_orders p) AS orders,
    (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM shipments s) AS shipments,
    (SELECT md5(jsonb_agg(to_jsonb(i) ORDER BY id)::text) FROM inventory_items i) AS inventory,
    (SELECT md5(jsonb_agg(to_jsonb(i) ORDER BY id)::text) FROM invoices i) AS invoices`)).rows[0];
  const before=await hash();
  const ambiguous=await buildAnalyticsInsights(1,"procurement",{...filters,supplierId:1},access);
  assert.equal(ambiguous.kpis.lateShipments.value,0,"A globally ambiguous legacy number cannot invent a supplier link.");
  const canonical=await buildAnalyticsInsights(1,"procurement",{...filters,supplierId:5000},access);
  assert.equal(canonical.kpis.lateShipments.value,1);assert.equal(canonical.kpis.supplierRisk.details?.unratedSuppliers,1);
  const crossTenant=await buildAnalyticsInsights(1,"procurement",{...filters,supplierId:2},access);
  assert.equal(crossTenant.kpis.lateShipments.value,1,"A foreign canonical PO cannot fall back to another owned PO number.");
  assert.ok(!JSON.stringify(crossTenant).includes("FOREIGN-PRIVATE"));
  const incomplete=await buildAnalyticsInsights(1,"inventory",{warehouseId:1},access);
  assert.equal(incomplete.kpis.inventoryHealth.value,"Unavailable");assert.match(incomplete.tables.lowStockItems.emptyDescription!,/reservations lack location evidence/);
  const deniedTimings:AnalyticsSourceTiming[]=[];
  const denied=await buildAnalyticsInsights(1,"procurement",filters,{},t=>deniedTimings.push(t));
  assert.ok(deniedTimings.every(t=>t.state==="denied"&&t.rows===0));assert.equal(denied.kpis.supplierRisk.value,"Unavailable");
  assert.ok(!JSON.stringify(denied).includes("Synthetic supplier"));
  await database.query("ALTER TABLE invoices RENAME COLUMN invoice_number TO unavailable_fixture_column");
  try {
    const failed=await buildAnalyticsInsights(1,"procurement",filters,access);
    assert.ok(failed.meta.partialFailures.some(f=>f.area==="finance"));assert.equal(failed.kpis.openPurchaseOrders.value,5000);
    assert.deepEqual(failed.charts.invoiceStatus,[]);assert.ok(!JSON.stringify(failed).includes("does not exist"));
  }finally{await database.query("ALTER TABLE invoices RENAME COLUMN unavailable_fixture_column TO invoice_number");}
  const concurrent=await Promise.all([buildAnalyticsInsights(1,"procurement",filters,access),buildAnalyticsInsights(1,"procurement",filters,access)]);
  for(const observation of concurrent){assert.equal(observation.kpis.supplierRisk.value,5000);assert.equal(observation.kpis.supplierRisk.details?.lateShipments,4999);assert.equal(observation.kpis.supplierRisk.details?.unratedSuppliers,1);assert.deepEqual(observation.meta.partialFailures,[]);assert.equal(observation.tables.highRiskSuppliers.rows.length,25);}
  assert.deepEqual(await hash(),before,"Read-only observations, failures and concurrent probes cannot mutate business rows.");
  console.log(`PASS Analytics observation: 5000 records per source, complete counts, bounded rows, source permissions and currency-safe output. Database: ${name}`);
} finally {
  if(database)await database.end();
  if(created){await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact Analytics database ${name}.`);}
  await owner.end();
}
