import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';
import {assertDisposableDatabaseUrl} from '../server/config/database-safety';
import {captureOperationalCompact} from '../server/modules/exports/capture-operational-compact';
import {createCompactLogisticsReader} from '../server/modules/exports/compact-logistics-reader';
import {readCompactSpool,CompactCaptureQuotaError} from '../server/modules/exports/compact-capture-spool';
if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; business databases are never mutation targets.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let db:pg.Pool|undefined,created=false;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-logistics-capture-test-'));
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString()});assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await db.query(`CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int,name text);INSERT INTO suppliers VALUES(1,1,'Own supplier'),(2,2,'FOREIGN_SUPPLIER_SECRET');
    CREATE TABLE purchase_orders(id int PRIMARY KEY,organization_id int,order_number text,supplier_id int,status text,created_at timestamp);
    INSERT INTO purchase_orders SELECT i,1,'PO-'||lpad(i::text,7,'0'),1,'SENT','2020-01-01' FROM generate_series(1,5001)i;
    INSERT INTO purchase_orders VALUES(5002,1,'MISSING_SUPPLIER',2,'UNKNOWN_LEGACY','2020-01-01'),(5003,1,'AMBIGUOUS',1,'SENT','2020-01-01'),(5004,1,'AMBIGUOUS',1,'SENT','2020-01-01'),(5005,1,'NOLINK',1,'SENT','2020-01-01'),(5006,1,'UNIQUE_LEGACY',1,'SENT','2020-01-01'),(10001,2,'PO-0000001',2,'SENT','2020-01-01');
    CREATE TABLE shipments(id int PRIMARY KEY,organization_id int,purchase_order_id int,po_number text,carrier text,status text,eta timestamp,tracking_number text,created_at timestamp);
    INSERT INTO shipments SELECT i,1,i,'PO-'||lpad(i::text,7,'0'),'Own &amp; carrier','in_transit','2020-01-01','000'||i,'2020-01-01' FROM generate_series(1,5001)i;
    INSERT INTO shipments VALUES(6001,2,1,'PO-0000001','FOREIGN_CARRIER_SECRET','in_transit','2020-01-01','FOREIGN_TRACKING_SECRET','2020-01-01'),
    (6002,NULL,NULL,'PO-0000001','UNASSIGNED_SECRET','in_transit','2020-01-01','UNASSIGNED_SECRET','2020-01-01'),
    (6003,1,10001,'PO-0000001','Own','in_transit','2020-01-01','OWN_BROKEN_CANONICAL','2020-01-01'),
    (6004,1,NULL,'AMBIGUOUS','Own','in_transit','2020-01-01','OWN_AMBIGUOUS','2020-01-01'),
    (6005,1,NULL,'PO-0000001','Own','in_transit','2020-01-01','OWN_GLOBAL_DUPLICATE','2020-01-01'),
    (6006,1,5002,'DIFFERENT_REFERENCE','Own','UNKNOWN_LEGACY','infinity','OWN_UNKNOWN','2020-01-01'),
    (6007,1,NULL,'UNIQUE_LEGACY','','cancelled',NULL,NULL,'2020-01-01'),
    (6008,1,1,'ALT','Own','DELIVERED','2020-01-01','','2020-01-01'),
    (6009,1,2,'ALT2','Own','closed','2030-01-01','000CLOSED','2020-01-01'),
    (6010,1,3,'ALT3','Own','in_transit','infinity','000INFINITY','2020-01-01'),
    (6011,1,NULL,'NO_SUCH_PO','Ω =literal','mystery',NULL,'%_000','2020-01-01'),
    (6012,2,10001,'PO-0000001','FOREIGN_CARRIER_SECRET','in_transit',NULL,'FOREIGN_OWN_TRACKING_SECRET','2020-01-01');`);
  const input={dataset:'shipments',organizationId:1,actorId:1,root,filters:{},authorize:async()=>{}};
  const timing:Record<string,number>={};let started=Date.now();const capture=await captureOperationalCompact(db,input);timing.shipmentCaptureMs=Date.now()-started;
  assert.equal(capture.manifest.rowCount,5010);assert.equal(capture.manifest.sourceInformation!.unlinkedRows,'4');
  const records=new Map<string,Record<string,unknown>>();for await(const row of (await readCompactSpool(capture.directory,capture.scope)).rows){records.set(String(row.shipmentId),row);assert.doesNotMatch(JSON.stringify(row),/FOREIGN_.*SECRET|UNASSIGNED_SECRET/);}
  assert.equal(records.size,5010);assert.equal(records.get('1')!.trackingNumber,'0001');assert.equal(records.get('1')!.carrier,'Own &amp; carrier');assert.equal(records.get('1')!.lateRisk,'Unavailable: ETA timezone unverified');
  assert.equal(records.get('6003')!.purchaseOrderId,null);assert.equal(records.get('6004')!.purchaseOrderId,null);assert.equal(records.get('6005')!.purchaseOrderId,null);
  assert.equal(records.get('6006')!.status,'UNKNOWN_LEGACY');assert.equal(records.get('6006')!.eta,'infinity');assert.equal(records.get('6006')!.lateRisk,'Unavailable: unknown shipment status');
  assert.equal(records.get('6007')!.trackingNumber,null);assert.equal(records.get('6007')!.carrier,'');assert.equal(records.get('6008')!.trackingNumber,'');
  assert.equal(records.get('6007')!.purchaseOrderId,'5006');assert.equal(records.get('6009')!.lateRisk,'Recorded closed; delivery unverified');
  started=Date.now();const compared=await captureOperationalCompact(db,{...input,dataset:'po_delivery_comparison'});timing.comparisonCaptureMs=Date.now()-started;
  assert.equal(compared.manifest.rowCount,5009);const comparison=[];for await(const row of (await readCompactSpool(compared.directory,compared.scope)).rows)comparison.push(row);
  assert.equal(comparison.filter(row=>row.purchaseOrderId==='1').length,2);
  assert.equal(comparison.find(row=>row.shipmentId==='6006')!.supplierName,null);assert.equal(comparison.find(row=>row.shipmentId==='6006')!.shipmentPoNumber,'DIFFERENT_REFERENCE');
  assert.equal(comparison.find(row=>row.purchaseOrderId==='5003')!.shipmentId,null);assert.equal(comparison.find(row=>row.purchaseOrderId==='5003')!.shipmentStatus,null);assert.equal(comparison.find(row=>row.purchaseOrderId==='5003')!.deliveryGap,'No verified linked shipment');
  const literal=await captureOperationalCompact(db,{...input,filters:{q:'%_000'},columns:['shipmentId','trackingNumber']});assert.equal(literal.manifest.rowCount,1);
  const inaccessible=await captureOperationalCompact(db,{...input,filters:{supplierId:2}});assert.equal(inaccessible.manifest.rowCount,0);
  const other=await captureOperationalCompact(db,{...input,organizationId:2,actorId:2});assert.equal(other.manifest.rowCount,2);
  for(const filters of [{unknown:'ignored?'},{shipmentStatus:'delivered'},{supplierId:'1 OR 1=1'},{from:'2020-01-01T00:00:00Z'}])await assert.rejects(captureOperationalCompact(db,{...input,filters}));
  await assert.rejects(captureOperationalCompact(db,{...input,columns:['bankAccount']}),/registered/);
  const utcInput={...input,utcTimestampEvidence:'reviewed-synthetic-UTC-storage',filters:{from:'2019-01-01T00:00:00Z',to:'2021-01-01T00:00:00Z'}};
  const verified=await captureOperationalCompact(db,utcInput);const verifiedRows=new Map();for await(const row of (await readCompactSpool(verified.directory,verified.scope)).rows)verifiedRows.set(row.shipmentId,row);
  assert.equal(verifiedRows.get('1').lateRisk,'Late at observation');assert.equal(verifiedRows.get('6010').lateRisk,'Unavailable: nonfinite ETA');
  assert.equal(verifiedRows.get('6008').lateRisk,'Recorded delivered; POD unverified');
  await db.query("UPDATE shipments SET status='received' WHERE id=6008");
  const received=await captureOperationalCompact(db,{...input,filters:{status:'RECEIVED'}});let receivedRows=0;
  for await(const row of (await readCompactSpool(received.directory,received.scope)).rows){receivedRows++;assert.equal(row.lateRisk,'Recorded received; delivery unverified');}
  assert.equal(receivedRows,1);await db.query("UPDATE shipments SET status='DELIVERED' WHERE id=6008");
  await assert.rejects(captureOperationalCompact(db,{...utcInput,filters:{from:'2020-02-30T00:00:00Z'}}),/calendar/);
  const client=await db.connect();try{
    await assert.rejects(createCompactLogisticsReader(client,input),/read-only/);await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL TimeZone='Pacific/Auckland'");
    let pages=0,maxPage=0,planned=false;const query=client.query.bind(client);const observedClient=new Proxy(client,{get(target,key){if(key==='query')return async(...args:unknown[])=>{
      if(!planned&&process.argv.includes('--plans')&&typeof args[0]==='string'&&args[0].includes('LIMIT 1000')){
        planned=true;const explained=await (query as (...args:unknown[])=>Promise<pg.QueryResult>)(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${args[0]}`,args[1]);
        const plan=explained.rows[0]['QUERY PLAN'][0],nodes:Record<string,unknown>[]=[];
        const visit=(node:Record<string,unknown>)=>{nodes.push({type:node['Node Type'],rows:node['Actual Rows'],loops:node['Actual Loops'],removedByJoin:node['Rows Removed by Join Filter']});for(const child of node.Plans as Record<string,unknown>[]??[])visit(child);};visit(plan.Plan);
        console.log(JSON.stringify({sourceQueryPlan:{executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],nodes}}));
      }
      const result=await (query as (...args:unknown[])=>Promise<pg.QueryResult>)(...args);if(typeof args[0]==='string'&&args[0].includes('LIMIT 1000')){pages++;maxPage=Math.max(maxPage,result.rows.length);}return result;
    };return Reflect.get(target,key);}});
    const reader=await createCompactLogisticsReader(observedClient,utcInput);
    await db.query("UPDATE shipments SET tracking_number='CHANGED_AFTER_CAPTURE' WHERE id=1;INSERT INTO shipments VALUES(7000,1,5001,'PO-0005001','Own','in_transit','2020-01-01','NEW_AFTER_CAPTURE','2020-01-01');INSERT INTO purchase_orders VALUES(10002,2,'UNIQUE_LEGACY',2,'SENT','2020-01-01')");
    let oldRows=0;for await(const row of reader.rows){oldRows++;if(row.shipmentId==='1'){assert.equal(row.trackingNumber,'0001');assert.equal(row.lateRisk,'Late at observation');}if(row.shipmentId==='6007')assert.equal(row.purchaseOrderId,'5006');assert.notEqual(row.trackingNumber,'NEW_AFTER_CAPTURE');}
    assert.equal(oldRows,5010);assert.equal(pages,6);assert.ok(maxPage<=1000);await client.query('ROLLBACK');
  }finally{client.release();}
  const fresh=await captureOperationalCompact(db,input);assert.equal(fresh.manifest.rowCount,5011);
  for await(const row of (await readCompactSpool(fresh.directory,fresh.scope)).rows)if(row.shipmentId==='6007')assert.equal(row.purchaseOrderId,null,'New global ambiguity affects only new observations; the owned shipment is not discarded');
  await db.query('UPDATE shipments SET purchase_order_id=NULL WHERE id BETWEEN 2 AND 5001');
  started=Date.now();const legacy=await captureOperationalCompact(db,input);timing.legacyShipmentCaptureMs=Date.now()-started;
  assert.equal(legacy.manifest.rowCount,5011);let legacyLinks=0;
  for await(const row of (await readCompactSpool(legacy.directory,legacy.scope)).rows){const id=Number(row.shipmentId);if(id>=2&&id<=5001){legacyLinks++;assert.equal(row.purchaseOrderId,row.shipmentId);}}
  assert.equal(legacyLinks,5000);
  started=Date.now();const legacyComparison=await captureOperationalCompact(db,{...input,dataset:'po_delivery_comparison'});timing.legacyComparisonCaptureMs=Date.now()-started;assert.equal(legacyComparison.manifest.rowCount,5010);
  const before=(await readdir(root)).sort();let auth=0;await assert.rejects(captureOperationalCompact(db,{...input,authorize:async()=>{if(++auth===3)throw new Error('Access revoked');}}),/Access revoked/);assert.deepEqual((await readdir(root)).sort(),before);
  await assert.rejects(captureOperationalCompact(db,{...input,quotaBytes:100}),error=>error instanceof CompactCaptureQuotaError&&error.code==='COMPACT_CAPTURE_QUOTA'&&error.quotaBytes===100);assert.deepEqual((await readdir(root)).sort(),before);
  const abort=new AbortController();abort.abort();await assert.rejects(captureOperationalCompact(db,{...input,signal:abort.signal}));
  await db.query("ALTER TABLE shipments ALTER COLUMN eta TYPE timestamptz USING eta AT TIME ZONE 'UTC'");await assert.rejects(captureOperationalCompact(db,utcInput),/storage differs/);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0].n,0);
  console.log(JSON.stringify({status:'passed',testDatabase:name,shipmentRows:5010,comparisonRows:5009,timing,checks:['complete bounded keyset pages','explicit ownership and canonical linking','ambiguous/global duplicate links remain unverified','tenant-safe supplier references','raw status/date/empty/null/literal text preservation','verified UTC policy and fixed observation risk','unknown/nonfinite/no ETA states','snapshot consistency and source changes','authorization revocation/quota/cancellation cleanup','read-only transaction release'],limitations:'Internal readers only; public Compact Excel orchestration, UI, independent validation and benchmarks remain pending.'}));
}finally{await db?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});}
