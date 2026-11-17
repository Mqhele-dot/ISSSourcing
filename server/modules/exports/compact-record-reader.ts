import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {getExportDatasetRegistry} from '../../services/export-registry';
import {selectCompactColumns,type CompactDatasetReader,type CompactSourceRow} from './compact-dataset-reader';
import type {CompactDetailColumn} from './compact-full-detail-writer';

const specifications={
  inventory:{table:'inventory_items',date:'created_at',fields:{sku:'d.sku',name:'d.name',categoryName:'c.name',quantity:'d.quantity::text',price:'d.price::text',location:'d.location',status:'d.status::text',itemId:'d.id::text',uom:'d.unit_of_measure',currencyCode:'NULL::text'},joins:'LEFT JOIN categories c ON c.id=d.category_id AND c.organization_id=d.organization_id LEFT JOIN suppliers s ON s.id=d.supplier_id AND s.organization_id=d.organization_id',ids:{itemId:'d.id',categoryId:'c.id',supplierId:'s.id'},search:"coalesce(d.sku,'')||' '||coalesce(d.name,'')",decimals:['quantity','price'],money:['price'],quantity:['quantity'],extras:[['itemId','Item ID','identifier'],['uom','Stored item UOM','text'],['currencyCode','Verified price currency (unavailable)','text']],labels:{quantity:'Stored item quantity (not allocation availability)',price:'Stored unit-price value (currency unverified)'},rowBasis:'One row per stored item-master record, including inactive items. Stored quantity is not a reconciled warehouse/bin/lot balance or quality-eligible allocation stock.',referenceBasis:'Category and item UOM are current item-master values in this observation. Missing/inaccessible category names remain null. The registered item schema has no verified historical price-currency evidence; no company-currency substitution is made.'},
  reorder_requests:{table:'reorder_requests',date:'created_at',fields:{itemName:'i.name',status:'d.status::text',requestedQuantity:'d.quantity::text',supplierName:'s.name',warehouseName:'w.name',requestId:'d.id::text',requestNumber:'d.request_number',requestDate:'d.request_date::text',uom:'NULL::text'},joins:'LEFT JOIN inventory_items i ON i.id=d.item_id AND i.organization_id=d.organization_id LEFT JOIN suppliers s ON s.id=d.supplier_id AND s.organization_id=d.organization_id LEFT JOIN warehouses w ON w.id=d.warehouse_id AND w.organization_id=d.organization_id',ids:{itemId:'i.id',supplierId:'s.id',warehouseId:'w.id'},search:"coalesce(d.request_number,'')||' '||coalesce(i.name,'')",decimals:['requestedQuantity'],money:[],quantity:['requestedQuantity'],extras:[['requestId','Request ID','identifier'],['requestNumber','Request number','text'],['requestDate','Stored request date','text'],['uom','Historical requested UOM (unavailable)','text']],labels:{itemName:'Current item name',requestedQuantity:'Stored requested quantity'},rowBasis:'One row per stored reorder request, including historical and unknown statuses. Quantity is read from the stored quantity field, not an invented requested_quantity column.',referenceBasis:'Item, supplier and warehouse names come only from same-tenant current master data, including inactive references; these are not verified historical name snapshots. Missing/inaccessible references remain null. The request has no historical UOM snapshot; current item UOM is never substituted.'},
  invoices:{table:'invoices',date:'issue_date',fields:{invoiceNumber:'d.invoice_number',supplierName:'s.name',status:'d.status::text',total:'d.total::text',dueAmount:'d.due_amount::text',dueDate:'d.due_date::text',invoiceId:'d.id::text',currencyCode:'d.currency_code',paidAmount:'d.paid_amount::text',issueDate:'d.issue_date::text'},joins:'LEFT JOIN suppliers s ON s.id=d.supplier_id AND s.organization_id=d.organization_id',ids:{supplierId:'s.id'},search:"coalesce(d.invoice_number,'')||' '||coalesce(s.name,'')",decimals:['total','dueAmount','paidAmount'],money:['total','dueAmount','paidAmount'],quantity:[],extras:[['invoiceId','Invoice ID','identifier'],['currencyCode','Stored currency (unvalidated)','text'],['paidAmount','Stored recorded-payment amount','decimal'],['issueDate','Stored issue date','text']],labels:{total:'Stored invoice total',dueAmount:'Stored due amount (not historical AP)',supplierName:'Current supplier name'},rowBasis:'One row per stored invoice header, including customer-side, supplier-side, historical and unknown-status records. Line items and attachments are not part of this registered header dataset. This is not approved outstanding AP, historical aging or proof of bank settlement.',referenceBasis:'Supplier names are same-tenant current master data, not historical snapshots. Stored total, paid and due fields are copied independently without deriving or repairing balances, approvals or payment state. Missing currency remains null; no FX or accounting calculation occurs.'},
} as const;

function utc(value:unknown){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw new Error('Supply an explicit UTC timestamp for record date filters.');
  const parsed=new Date(value);if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value.replace(/(?<!\.\d{3})Z$/,'.000Z'))throw new Error('Invalid record calendar date.');return parsed.toISOString();
}

/** Raw structured records only. Financial measures and warehouse eligibility
 * continue to use their authoritative services, never these stored counters.
 */
export async function createCompactRecordReader(client:PoolClient,input:{dataset:string;organizationId:number;filters:Record<string,unknown>;columns?:string[];authorize:()=>Promise<void>;utcTimestampEvidence?:string}):Promise<CompactDatasetReader>{
  if(!Object.hasOwn(specifications,input.dataset)||!Number.isSafeInteger(input.organizationId)||input.organizationId<1)throw new Error('Invalid record export dataset or scope.');
  const spec=specifications[input.dataset as keyof typeof specifications],fields:Record<string,string>=spec.fields,ids:Record<string,string>=spec.ids;
  const allowed=['q','status','from','to',...Object.keys(ids),...(input.dataset==='inventory'?['location']:[])];
  if(Object.keys(input.filters).some(key=>!allowed.includes(key)))throw new Error('Unsupported record export filter. No filters were ignored.');
  if(input.utcTimestampEvidence!==undefined&&(!input.utcTimestampEvidence.trim()||input.utcTimestampEvidence.length>200))throw new Error('Invalid timestamp storage evidence.');
  if((input.filters.from!==undefined||input.filters.to!==undefined)&&!input.utcTimestampEvidence)throw new Error('Record date filtering requires verified UTC timestamp storage evidence.');
  const registered=getExportDatasetRegistry().find(entry=>entry.key===input.dataset)!;
  if(registered.columns.some(column=>!Object.hasOwn(fields,column.key)))throw new Error('The record export schema requires a reader update.');
  const labels:Record<string,string>=spec.labels;
  const available:CompactDetailColumn[]=registered.columns.map(column=>({key:column.key,label:labels[column.key]??column.label,kind:(spec.decimals as readonly string[]).includes(column.key)?'decimal':'text'}));
  for(const [key,label,kind] of spec.extras)available.push({key,label,kind});
  const columns=selectCompactColumns(available,input.columns),selected=new Set(columns.map(column=>column.key));
  if((spec.money as readonly string[]).some(key=>selected.has(key))&&!selected.has('currencyCode'))throw new Error('Include currencyCode with stored monetary columns, or explicitly remove those columns. Unknown currency is not replaced.');
  if((spec.quantity as readonly string[]).some(key=>selected.has(key))&&!selected.has('uom'))throw new Error('Include uom with stored quantities, or explicitly remove those columns. Unknown historical units are not replaced.');
  const values:unknown[]=[input.organizationId],where=['d.organization_id=$1'],filters:Record<string,unknown>={};
  for(const [key,expression] of Object.entries(ids))if(input.filters[key]!==undefined){
    const id=input.filters[key];if(!(typeof id==='number'||typeof id==='string'&&/^\d+$/.test(id))||!Number.isInteger(Number(id))||Number(id)<1||Number(id)>2147483647)throw new Error('Choose a valid record filter identifier.');
    filters[key]=Number(id);values.push(Number(id));where.push(`${expression}=$${values.length}`);
  }
  if(input.filters.q!==undefined){if(typeof input.filters.q!=='string'||input.filters.q.length>200)throw new Error('Record search must be at most 200 characters.');filters.q=input.filters.q.trim();values.push(filters.q);where.push(`strpos(lower(${spec.search}),lower($${values.length}))>0`);}
  if(input.filters.status!==undefined){if(typeof input.filters.status!=='string'||!input.filters.status.trim()||input.filters.status.length>100)throw new Error('Choose a valid record status.');filters.status=input.filters.status.trim().toLowerCase();if(filters.status!=='all'){values.push(filters.status);where.push(`lower(d.status::text)=$${values.length}`);}}
  if(input.filters.location!==undefined){if(typeof input.filters.location!=='string'||input.filters.location.length>500)throw new Error('Choose a valid stored location value.');filters.location=input.filters.location;values.push(filters.location);where.push(`d.location=$${values.length}`);}
  for(const key of ['from','to'] as const)if(input.filters[key]!==undefined){filters[key]=utc(input.filters[key]);values.push(filters[key]);where.push(`d.${spec.date} ${key==='from'?'>=':'<'} ($${values.length}::timestamptz AT TIME ZONE 'UTC')`);}
  if(filters.from&&filters.to&&String(filters.from)>=String(filters.to))throw new Error('The record date range must end after it starts.');
  await input.authorize();
  const isolation=await client.query('SHOW transaction_isolation'),readOnly=await client.query('SHOW transaction_read_only');
  if(isolation.rows[0].transaction_isolation!=='repeatable read'||readOnly.rows[0].transaction_read_only!=='on')throw new Error('Record capture requires a repeatable-read, read-only observation.');
  if(input.utcTimestampEvidence){
    const schema=await client.query(`SELECT format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND a.attname=$2 AND a.attnum>0 AND NOT a.attisdropped`,[spec.table,spec.date]);
    if(schema.rows[0]?.type!=='timestamp without time zone')throw new Error('Timestamp storage differs from this adapter’s reviewed UTC policy. Reconcile the schema before date comparisons.');
  }
  const observation=await client.query(`SELECT txid_current_snapshot()::text AS snapshot,to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at`);
  const from=`FROM ${spec.table} d ${spec.joins}`,predicate=where.join(' AND ');
  const counted=await client.query(`SELECT count(*)::text AS count ${from} WHERE ${predicate}`,values),expectedRows=Number(counted.rows[0].count);
  if(!Number.isSafeInteger(expectedRows)||expectedRows<0)throw new Error('Record count exceeds the supported range.');
  async function* rows():AsyncGenerator<CompactSourceRow>{
    let after=0,emitted=0;
    for(;;){
      const page=await client.query(`SELECT d.id::text AS "__sourceId",${columns.map(column=>`${fields[column.key]} AS "${column.key}"`).join(',')} ${from} WHERE ${predicate} AND d.id>$${values.length+1} ORDER BY d.id LIMIT 1000`,[...values,after]);
      for(const record of page.rows){
        const id=Number(record.__sourceId);if(!Number.isSafeInteger(id)||id<=after)throw new Error('Record ordering evidence is invalid.');
        const row:CompactSourceRow=Object.create(null);for(const column of columns){const value=record[column.key];if(value!==null&&typeof value!=='string')throw new Error('Record source field is not valid literal text.');row[column.key]=value;}
        after=id;if(++emitted>expectedRows)throw new Error('Record capture exceeds its observed count.');yield row;
      }
      if(page.rows.length<1000)break;
    }
    if(emitted!==expectedRows)throw new Error('Record capture is incomplete.');await input.authorize();
  }
  return {dataset:input.dataset,schemaVersion:`${input.dataset}-records-compact-v1`,observationReference:`records-${randomUUID()}`,normalizedFilters:filters,columns,expectedRows,information:{
    observedAt:observation.rows[0].observed_at,databaseSnapshot:observation.rows[0].snapshot,rowBasis:spec.rowBasis,referenceBasis:spec.referenceBasis,
    precisionEvidence:'Quantities and amounts are copied as stored text, without rounding or recalculation. Legacy REAL values retain only their stored precision; text does not restore lost digits. Null, negative and nonfinite stored evidence is not repaired or turned into zero.',
    financialBasis:'Raw operational records, not approved financial measures or historical balances. No monetary sums, FX conversion, balance reconstruction or payment/settlement assertion.',
    dateBasis:`${spec.table}.${spec.date}; ${input.utcTimestampEvidence?'reviewed UTC from inclusive/to exclusive':'legacy timezone unverified; date filtering unavailable'}. All exported date fields retain stored database text without timezone invention.`,
    timestampStorageEvidence:input.utcTimestampEvidence??null,statusBasis:'All statuses, including inactive/historical/unknown values, are retained unless explicitly filtered. Case-insensitive raw status filtering.',
  },rows:rows()};
}
