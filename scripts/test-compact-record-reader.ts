import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';
import {assertDisposableDatabaseUrl} from '../server/config/database-safety';
import {captureOperationalCompact} from '../server/modules/exports/capture-operational-compact';
import {createCompactRecordReader} from '../server/modules/exports/compact-record-reader';
import {readCompactSpool,CompactCaptureQuotaError} from '../server/modules/exports/compact-capture-spool';
import {runCompactIsolatedWorker} from '../server/modules/exports/compact-isolated-worker';
if(!process.argv.includes('--local-disposable'))throw new Error('Use --local-disposable; business databases are never mutation targets.');
const configured=process.env.DATABASE_URL||(process.env.PGHOST&&process.env.PGUSER&&process.env.PGPASSWORD?`postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT||5432}/postgres`:null);assert.ok(configured);
const url=new URL(configured);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));url.pathname='/postgres';
const name=`iss_export_test_${randomUUID().replaceAll('-','')}`,owner=new pg.Client({connectionString:url.toString()});let created=false,db:pg.Pool|undefined;
const root=await mkdtemp(path.join(os.tmpdir(),'iss-record-capture-test-'));
const datasets=['inventory','reorder_requests','invoices'] as const;
try{
  await owner.connect();await owner.query(`CREATE DATABASE "${name}"`);created=true;console.log(`Created exact test-owned database ${name}.`);url.pathname=`/${name}`;assertDisposableDatabaseUrl(url.toString());db=new pg.Pool({connectionString:url.toString()});assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await db.query(`CREATE TABLE categories(id int PRIMARY KEY,organization_id int,name text);INSERT INTO categories VALUES(1,1,'Own category'),(2,2,'FOREIGN_CATEGORY_SECRET');
    CREATE TABLE suppliers(id int PRIMARY KEY,organization_id int,name text,bank_account_number text);INSERT INTO suppliers VALUES(1,1,'Own supplier','OWN_BANK_SECRET'),(2,2,'FOREIGN_SUPPLIER_SECRET','FOREIGN_BANK_SECRET');
    CREATE TABLE warehouses(id int PRIMARY KEY,organization_id int,name text);INSERT INTO warehouses VALUES(1,1,'Own warehouse'),(2,2,'FOREIGN_WAREHOUSE_SECRET');
    CREATE TABLE inventory_items(id int PRIMARY KEY,organization_id int,sku text,name text,quantity numeric(20,6),price real,unit_of_measure text,category_id int,supplier_id int,status text,location text,created_at timestamp,images text);
    INSERT INTO inventory_items SELECT i,1,lpad(i::text,8,'0'),'Item '||i,i::numeric/10,12.34,'kg',1,1,'Active','Receiving','2020-01-01','EXCLUDED_IMAGE_SECRET' FROM generate_series(1,5001)i;
    INSERT INTO inventory_items VALUES(5002,1,'OWN-%-ITEM','Own % item',-1.25,1.23456789,NULL,2,2,'UNKNOWN_LEGACY',NULL,'infinity','EXCLUDED_IMAGE_SECRET'),(5003,1,'EMPTY-NAME','',NULL,NULL,'',NULL,NULL,'inactive','','2020-01-01','EXCLUDED_IMAGE_SECRET'),(6001,2,'FOREIGN_SKU_SECRET','FOREIGN_ITEM_SECRET',999,999,'FOREIGN_UOM_SECRET',2,2,'Active','FOREIGN_LOCATION_SECRET','2020-01-01','EXCLUDED_IMAGE_SECRET');
    CREATE TABLE reorder_requests(id int PRIMARY KEY,organization_id int,request_number text,item_id int,quantity numeric(20,6),supplier_id int,warehouse_id int,status text,request_date timestamp,created_at timestamp);
    INSERT INTO reorder_requests SELECT i,1,'REQ-'||lpad(i::text,8,'0'),i,i::numeric/10,1,1,CASE WHEN i%2=0 THEN 'APPROVED' ELSE 'PENDING' END,NULL,'2020-01-01' FROM generate_series(1,5001)i;
    INSERT INTO reorder_requests VALUES(5002,1,'OWN-%-REQUEST',6001,1.25,2,2,'UNKNOWN_LEGACY','2020-01-01','2020-01-01'),(5003,1,'UNRESOLVED',99999,NULL,NULL,NULL,'inactive','infinity','2020-01-01'),(6001,2,'FOREIGN_REQUEST_SECRET',6001,100,2,2,'PENDING','2020-01-01','2020-01-01');
    CREATE TABLE invoices(id int PRIMARY KEY,organization_id int,invoice_number text,supplier_id int,status text,total real,due_amount real,paid_amount real,currency_code text,issue_date timestamp,due_date timestamp);
    INSERT INTO invoices SELECT i,1,'INV-'||lpad(i::text,8,'0'),1,CASE WHEN i%2=0 THEN 'PAID' ELSE 'APPROVED' END,100.1,CASE WHEN i%2=0 THEN 0 ELSE 100.1 END,CASE WHEN i%2=0 THEN 100.1 ELSE 0 END,CASE WHEN i%2=0 THEN 'uSd' ELSE 'ZAR' END,'2020-01-01','2020-01-07' FROM generate_series(1,5001)i;
    INSERT INTO invoices VALUES(5002,1,'0000123',2,'DISPUTED',12.34,0,0,NULL,NULL,'infinity'),(5003,1,'%literal_invoice',NULL,'UNKNOWN_LEGACY','Infinity',NULL,NULL,'','2020-01-01',NULL),(6001,2,'FOREIGN_INVOICE_SECRET',2,'APPROVED',999,999,0,'EUR','2020-01-01','2020-01-07');`);
  const base={organizationId:1,actorId:1,root,filters:{},authorize:async()=>{}};
  const captures:Record<string,Awaited<ReturnType<typeof captureOperationalCompact>>>={},timing:Record<string,number>={};
  for(const dataset of datasets){
    const started=Date.now(),capture=await captureOperationalCompact(db,{...base,dataset});timing[dataset]=Date.now()-started;captures[dataset]=capture;assert.equal(capture.manifest.rowCount,5003);
    let count=0;for await(const row of (await readCompactSpool(capture.directory,capture.scope)).rows){count++;assert.doesNotMatch(JSON.stringify(row),/FOREIGN_.*SECRET|BANK_SECRET|EXCLUDED_IMAGE_SECRET/);
      if(dataset==='inventory'){
        if(count===1){assert.equal(row.sku,'00000001');assert.equal(row.quantity,'0.100000');assert.equal(row.currencyCode,null);assert.equal(row.uom,'kg');}
        if(count===5002){assert.equal(row.quantity,'-1.250000');assert.equal(row.categoryName,null);assert.equal(row.location,null);assert.equal(row.currencyCode,null);assert.equal(row.price,(await db.query('SELECT price::text value FROM inventory_items WHERE id=5002')).rows[0].value);}
        if(count===5003){assert.equal(row.name,'');assert.equal(row.location,'');assert.equal(row.quantity,null);assert.equal(row.price,null);assert.equal(row.uom,'');}
      }else if(dataset==='reorder_requests'){
        if(count===1){assert.equal(row.requestNumber,'REQ-00000001');assert.equal(row.requestedQuantity,'0.100000');assert.equal(row.itemName,'Item 1');assert.equal(row.uom,null);}
        if(count===5002){assert.equal(row.itemName,null);assert.equal(row.supplierName,null);assert.equal(row.warehouseName,null);assert.equal(row.requestedQuantity,'1.250000');}
        if(count===5003){assert.equal(row.itemName,null);assert.equal(row.requestDate,'infinity');}
      }else{
        if(count===2){assert.equal(row.currencyCode,'uSd');assert.equal(row.dueAmount,'0');}
        if(count===5002){assert.equal(row.invoiceNumber,'0000123');assert.equal(row.supplierName,null);assert.equal(row.currencyCode,null);assert.equal(row.dueAmount,'0');assert.equal(row.dueDate,'infinity');}
        if(count===5003){assert.equal(row.total,'Infinity');assert.equal(row.dueAmount,null);assert.equal(row.currencyCode,'');assert.equal(row.dueDate,null);}
      }
    }assert.equal(count,5003);assert.match(capture.manifest.sourceInformation!.financialBasis!,/not approved financial/);
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0].n,0,'Release the source observation before compression/validation');
    const workbook=await runCompactIsolatedWorker({captureDirectory:capture.directory,outputRoot:root,jobId:datasets.indexOf(dataset)+1,scope:capture.scope,columns:capture.columns});
    assert.equal(workbook.validationState,'independently_validated');assert.equal(workbook.validation.verifiedRows,5003);assert.ok(workbook.actualBytes<100_000_000);assert.equal(workbook.validation.sha256,workbook.sha256);
    console.log(JSON.stringify({dataset,chain:'read-only database snapshot -> private capture -> credential-free writer -> independent ZIP/XML validation',rows:5003,actualXlsxBytes:workbook.actualBytes}));
    const literal=await captureOperationalCompact(db,{...base,dataset,filters:{q:'%'}});assert.equal(literal.manifest.rowCount,1);
    const inaccessible=await captureOperationalCompact(db,{...base,dataset,filters:{supplierId:2}});assert.equal(inaccessible.manifest.rowCount,0);
    const foreign=await captureOperationalCompact(db,{...base,dataset,organizationId:2,actorId:2});assert.equal(foreign.manifest.rowCount,1);
    const dated=await captureOperationalCompact(db,{...base,dataset,utcTimestampEvidence:'reviewed-synthetic-UTC',filters:{from:'2020-01-01T00:00:00Z',to:'2021-01-01T00:00:00Z'}});assert.equal(dated.manifest.rowCount,dataset==='reorder_requests'?5003:5002);
    for(const filters of [{unknown:'ignored?'},{from:'2020-01-01T00:00:00Z'},{supplierId:'1 OR 1=1'},{asOf:'2020-01-01'}])await assert.rejects(captureOperationalCompact(db,{...base,dataset,filters}));
    await assert.rejects(captureOperationalCompact(db,{...base,dataset,columns:['bankAccountNumber']}),/registered/);
    await assert.rejects(captureOperationalCompact(db,{...base,dataset,utcTimestampEvidence:'reviewed-UTC',filters:{from:'2020-02-30T00:00:00Z'}}),/calendar/);
    const before=(await readdir(root)).sort();let authorization=0;await assert.rejects(captureOperationalCompact(db,{...base,dataset,authorize:async()=>{if(++authorization===3)throw new Error('Access revoked');}}),/Access revoked/);assert.deepEqual((await readdir(root)).sort(),before);
    await assert.rejects(captureOperationalCompact(db,{...base,dataset,quotaBytes:100}),error=>error instanceof CompactCaptureQuotaError);assert.deepEqual((await readdir(root)).sort(),before);
  }
  await assert.rejects(captureOperationalCompact(db,{...base,dataset:'inventory',columns:['quantity']}),/uom/);await assert.rejects(captureOperationalCompact(db,{...base,dataset:'inventory',columns:['price']}),/currencyCode/);
  await assert.rejects(captureOperationalCompact(db,{...base,dataset:'reorder_requests',columns:['requestedQuantity']}),/uom/);await assert.rejects(captureOperationalCompact(db,{...base,dataset:'invoices',columns:['total']}),/currencyCode/);
  await assert.rejects(captureOperationalCompact(db,{...base,dataset:'inventory',filters:{warehouseId:1}}),/Unsupported/);
  for(const dataset of datasets){
    const client=await db.connect();try{
      await assert.rejects(createCompactRecordReader(client,{...base,dataset}),/read-only/);await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL TimeZone='Pacific/Auckland'");
      let pages=0,maxPage=0;const query=client.query.bind(client),observed=new Proxy(client,{get(target,key){if(key==='query')return async(...args:unknown[])=>{const result=await (query as (...args:unknown[])=>Promise<pg.QueryResult>)(...args);if(typeof args[0]==='string'&&args[0].includes('LIMIT 1000')){pages++;maxPage=Math.max(maxPage,result.rows.length);}return result;};return Reflect.get(target,key);}});
      const reader=await createCompactRecordReader(observed,{...base,dataset});
      if(dataset==='inventory')await db.query("UPDATE inventory_items SET quantity=999.123456 WHERE id=2000;UPDATE categories SET name='Renamed category' WHERE id=1;INSERT INTO inventory_items(id,organization_id,sku,name,created_at) VALUES(7000,1,'NEW','NEW_AFTER_CAPTURE','2020-01-01')");
      if(dataset==='reorder_requests')await db.query("UPDATE reorder_requests SET quantity=999.123456 WHERE id=2000;UPDATE inventory_items SET name='Renamed current item' WHERE id=1;INSERT INTO reorder_requests(id,organization_id,request_number,item_id,created_at) VALUES(7000,1,'NEW_AFTER_CAPTURE',1,'2020-01-01')");
      if(dataset==='invoices')await db.query("UPDATE invoices SET due_amount=999 WHERE id=2000;UPDATE suppliers SET name='Renamed supplier' WHERE id=1;INSERT INTO invoices(id,organization_id,invoice_number,issue_date) VALUES(7000,1,'NEW_AFTER_CAPTURE','2020-01-01')");
      let count=0;for await(const row of reader.rows){count++;if(count===2000){if(dataset==='inventory'){assert.equal(row.quantity,'200.000000');assert.equal(row.categoryName,'Own category');}if(dataset==='reorder_requests')assert.equal(row.requestedQuantity,'200.000000');if(dataset==='invoices')assert.equal(row.dueAmount,'0');}if(count===1){if(dataset==='reorder_requests')assert.equal(row.itemName,'Item 1');if(dataset==='invoices')assert.equal(row.supplierName,'Own supplier');}assert.doesNotMatch(JSON.stringify(row),/NEW_AFTER_CAPTURE/);}
      assert.equal(count,5003);assert.equal(pages,6);assert.ok(maxPage<=1000);await client.query('ROLLBACK');
    }finally{client.release();}
    const fresh=await captureOperationalCompact(db,{...base,dataset});assert.equal(fresh.manifest.rowCount,5004);
    let frozen=0;for await(const _row of (await readCompactSpool(captures[dataset].directory,captures[dataset].scope)).rows)frozen++;assert.equal(frozen,5003);
  }
  await db.query("ALTER TABLE invoices ALTER COLUMN issue_date TYPE timestamptz USING issue_date AT TIME ZONE 'UTC'");await assert.rejects(captureOperationalCompact(db,{...base,dataset:'invoices',utcTimestampEvidence:'reviewed-UTC'}),/storage differs/);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0].n,0);
  console.log(JSON.stringify({status:'passed',testDatabase:name,datasets,rowsPerDataset:5003,timing,checks:['complete six-page captures','capture to isolated writer to independent validation','tenant-safe reference lookups','no bank/image leakage','exact stored fractional/negative/legacy monetary strings','null versus empty values','no currency/UOM/default substitution','stored zero balance not reconstructed','historical/unknown/nonfinite evidence retained','explicit date basis and verified UTC prerequisite','unsupported filter/context refusal','snapshot and master-name consistency','fresh versus saved observations','revocation/quota cleanup','source observation released'],limitations:'Internal structured-record readers only; not authoritative stock availability or historical AP. Public orchestration/UI, text-edge cases and native Excel benchmarks remain gated.'}));
}finally{await db?.end();if(created){await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await owner.query(`DROP DATABASE "${name}"`);console.log(`Removed exact test-owned database ${name}.`);}await owner.end();await rm(root,{recursive:true,force:true});}
