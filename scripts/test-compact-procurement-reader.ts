import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm,readdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import "dotenv/config";
import {assertDisposableDatabaseUrl} from "../server/config/database-safety";
import {captureOperationalCompact} from "../server/modules/exports/capture-operational-compact";
import {createCompactProcurementReader} from "../server/modules/exports/compact-procurement-reader";
import {readCompactSpool} from "../server/modules/exports/compact-capture-spool";
if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; application databases are never mutation targets.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false;let db:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-procurement-capture-test-'));
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString()});assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await db.query(`CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int,name text); INSERT INTO suppliers VALUES(1,1,'Own supplier'),(2,2,'FOREIGN_SECRET');
    CREATE TABLE units_of_measure(id int PRIMARY KEY,organization_id int,code text,symbol text); INSERT INTO units_of_measure VALUES(1,NULL,'EA',NULL),(2,2,'FOREIGN_UOM',NULL);
    CREATE TABLE tax_codes(id int PRIMARY KEY,organization_id int,code text); INSERT INTO tax_codes VALUES(1,1,'VAT'),(2,2,'FOREIGN_TAX');
    CREATE TABLE purchase_orders(id int PRIMARY KEY,organization_id int,order_number text,supplier_id int,status text,currency_code text,total_amount real,created_at timestamp,project_id int);
    CREATE TABLE purchase_order_items(id int PRIMARY KEY,order_id int,line_number int,line_type text,item_code_snapshot text,description text,item_description_snapshot text,quantity numeric(20,6),unit_price real,total_price real,received_quantity numeric(20,6),unit_of_measure_id int,tax_code_id int);
    CREATE TABLE purchase_requisitions(id int PRIMARY KEY,organization_id int,requisition_number text,supplier_id int,status text,currency_code text,total_amount real,created_at timestamp,required_date timestamp,project_id int);
    CREATE TABLE purchase_requisition_items(id int PRIMARY KEY,requisition_id int,line_number int,line_type text,item_code_snapshot text,description text,item_description_snapshot text,quantity numeric(20,6),unit_price real,total_price real,unit_of_measure_id int,tax_code_id int);
    INSERT INTO purchase_orders VALUES(1,1,'000-PO',1,'SENT','USD',123.45,'2020-01-01',1),(2,1,'NO-LINES',2,'historical_unknown',NULL,NULL,'2020-01-01',1),(3,2,'FOREIGN_DOC',2,'SENT','USD',999,'2020-01-01',2);
    INSERT INTO purchase_order_items SELECT i,1,(i%5)+1,'CATALOG',CASE WHEN i=1 THEN NULL ELSE '000SKU' END,NULL,CASE WHEN i=1 THEN NULL ELSE 'Saved description' END,0.125001,12.34,1.23,0.000001,CASE WHEN i=1 THEN 2 ELSE 1 END,CASE WHEN i=1 THEN 2 ELSE 1 END FROM generate_series(1,5000)i;
    INSERT INTO purchase_order_items VALUES(6001,3,1,'CATALOG','FOREIGN_ITEM','FOREIGN_LINE',NULL,1,1,1,0,2,2);
    INSERT INTO purchase_requisitions SELECT id,organization_id,order_number,supplier_id,status,currency_code,total_amount,created_at,'2020-02-01',project_id FROM purchase_orders;
    INSERT INTO purchase_requisition_items SELECT id,order_id,line_number,line_type,item_code_snapshot,description,item_description_snapshot,quantity,unit_price,total_price,unit_of_measure_id,tax_code_id FROM purchase_order_items;
    UPDATE purchase_requisitions SET required_date='infinity'::timestamp WHERE id=2`);
  const input={organizationId:1,actorId:1,root,filters:{},authorize:async()=>{}};
  for(const dataset of ['purchase_orders','purchase_requisitions']){
    const capture=await captureOperationalCompact(db,{...input,dataset});assert.equal(capture.manifest.rowCount,5001);assert.ok(capture.columns.some(column=>column.key==='currencyCode'));
    let count=0,missing=0;const pageNames:string[]=[];
    for await(const row of (await readCompactSpool(capture.directory,capture.scope)).rows){
      count++;assert.equal(JSON.stringify(row).includes('FOREIGN'),false);pageNames.push(String(row.documentNumber));
      if(row.documentNumber==='NO-LINES'){missing++;assert.equal(row.supplierName,null);assert.equal(row.currencyCode,null);assert.equal(row.quantity,null);assert.equal(row.lineNumber,null);if(dataset==='purchase_requisitions')assert.equal(row.requiredDate,'infinity');}
      else{assert.equal(row.quantity,'0.125001');assert.equal(row.unitPrice,'12.34');assert.equal(row.currencyCode,'USD');if(row.itemCode===null){assert.equal(row.lineDescription,null);assert.equal(row.uom,null);assert.equal(row.taxCode,null);}}
    }
    assert.equal(count,5001);assert.equal(missing,1);assert.equal(pageNames.at(-1),'NO-LINES');
    const filter=await captureOperationalCompact(db,{...input,dataset,filters:{status:'sEnT',documentNumber:'000-',projectId:1},columns:['documentNumber','status']});assert.equal(filter.manifest.rowCount,5000);
    await assert.rejects(captureOperationalCompact(db,{...input,dataset,columns:['unitPrice']}),/currencyCode/);
    await assert.rejects(captureOperationalCompact(db,{...input,dataset,columns:['quantity']}),/uom/);
    await assert.rejects(captureOperationalCompact(db,{...input,dataset,filters:{from:'2020-01-01T00:00:00Z'}}),/verified UTC/);
    await assert.rejects(captureOperationalCompact(db,{...input,dataset,filters:{unknown:'ignored?'}}),/Unsupported/);
    const foreign=await captureOperationalCompact(db,{...input,dataset,organizationId:2,actorId:2});assert.equal(foreign.manifest.rowCount,1);
  }
  const client=await db.connect();try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const reader=await createCompactProcurementReader(client,{organizationId:1,dataset:'purchase_orders',filters:{},authorize:async()=>{}});
    await db.query("UPDATE purchase_order_items SET description='Changed outside observation' WHERE id=1; INSERT INTO purchase_order_items VALUES(5001,1,1,'SERVICE','NEW','New line',NULL,1,1,1,0,1,1)");
    let count=0;for await(const row of reader.rows){count++;assert.notEqual(row.lineDescription,'Changed outside observation');assert.notEqual(row.itemCode,'NEW');}assert.equal(count,5001);await client.query('ROLLBACK');
  }finally{client.release();}
  const fresh=await captureOperationalCompact(db,{...input,dataset:'purchase_orders'});assert.equal(fresh.manifest.rowCount,5002);
  const before=(await readdir(root)).sort();let auth=0;
  await assert.rejects(captureOperationalCompact(db,{...input,dataset:'purchase_requisitions',authorize:async()=>{if(++auth===3)throw new Error('Access revoked');}}),/Access revoked/);assert.deepEqual((await readdir(root)).sort(),before);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0].n,0);
  console.log(JSON.stringify({status:'passed',testDatabase:name,datasets:['purchase_orders','purchase_requisitions'],rowsPerDataset:5001,checks:['duplicate line-number keyset ties','no lost rows across 1000-row batches','tenant-safe supplier/UOM/tax joins','no currency/default substitution','no current item-master reconstruction','fractional quantity text','legacy monetary precision disclosure','documents without lines','mandatory currency/UOM context','snapshot consistency under live changes','new observation sees changes','revocation cleanup','source transaction released'],limitations:'Internal readers only; production access wiring, UI and release enablement remain gated.'}));
}finally{await db?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});}
