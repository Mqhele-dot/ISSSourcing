import type {PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import {getExportDatasetRegistry} from "../../services/export-registry";
import {selectCompactColumns,type CompactDatasetReader,type CompactSourceRow} from "./compact-dataset-reader";
import type {CompactDetailColumn} from "./compact-full-detail-writer";

const specifications={purchase_orders:{table:'purchase_orders',lines:'purchase_order_items',parent:'order_id',number:'order_number'},purchase_requisitions:{table:'purchase_requisitions',lines:'purchase_requisition_items',parent:'requisition_id',number:'requisition_number'}} as const;
function utc(value:unknown){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw new Error("Supply an explicit UTC timestamp for procurement date filters.");
  const parsed=new Date(value);if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value.replace(/(?<!\.\d{3})Z$/,'.000Z'))throw new Error("Invalid procurement calendar date.");return parsed.toISOString();
}
export async function createCompactProcurementReader(client:PoolClient,input:{dataset:string;organizationId:number;filters:Record<string,unknown>;columns?:string[];authorize:()=>Promise<void>;utcTimestampEvidence?:string}):Promise<CompactDatasetReader>{
  if(!Object.hasOwn(specifications,input.dataset)||!Number.isSafeInteger(input.organizationId)||input.organizationId<1)throw new Error("Invalid procurement export dataset or scope.");
  const spec=specifications[input.dataset as keyof typeof specifications],order=input.dataset==='purchase_orders';
  if(Object.keys(input.filters).some(key=>!['documentNumber','supplierId','projectId','status','from','to'].includes(key)))throw new Error("Unsupported procurement export filter. No filters were ignored.");
  if(input.utcTimestampEvidence!==undefined&&(!input.utcTimestampEvidence.trim()||input.utcTimestampEvidence.length>200))throw new Error("Invalid timestamp storage evidence.");
  if((input.filters.from!==undefined||input.filters.to!==undefined)&&!input.utcTimestampEvidence)throw new Error("Procurement date filtering requires verified UTC timestamp storage evidence.");
  const fields:Record<string,string>={documentNumber:`d.${spec.number}`,supplierName:'s.name',status:'d.status::text',currencyCode:'d.currency_code',documentTotal:'d.total_amount::text',requiredDate:'d.required_date::text',lineNumber:'l.line_number::text',lineType:'l.line_type',itemCode:'l.item_code_snapshot',lineDescription:'COALESCE(l.description,l.item_description_snapshot)',quantity:'l.quantity::text',uom:'COALESCE(u.code,u.symbol)',unitPrice:'l.unit_price::text',taxCode:'t.code',lineTotal:'l.total_price::text',receivedQuantity:'l.received_quantity::text'};
  if(order)delete fields.requiredDate;else delete fields.receivedQuantity;
  const registered=getExportDatasetRegistry().find(entry=>entry.key===input.dataset)!;
  if(registered.columns.some(column=>!Object.hasOwn(fields,column.key)))throw new Error("The procurement schema requires a reader update.");
  const decimals=new Set(['documentTotal','quantity','unitPrice','lineTotal','receivedQuantity']);
  const registeredColumns:CompactDetailColumn[]=registered.columns.map(column=>({key:column.key,label:column.label,kind:decimals.has(column.key)?'decimal':'text'}));
  // Requisition's legacy registry omits currency, but monetary detail must carry
  // its actual currency context. This explicit compact schema never defaults it.
  if(!registeredColumns.some(column=>column.key==='currencyCode'))registeredColumns.push({key:'currencyCode',label:'Currency',kind:'text'});
  const columns=selectCompactColumns(registeredColumns,input.columns);
  const selected=new Set(columns.map(column=>column.key));
  if(['documentTotal','unitPrice','lineTotal'].some(key=>selected.has(key))&&!selected.has('currencyCode'))throw new Error("Include currencyCode with monetary columns, or explicitly remove the monetary columns.");
  if(['quantity','receivedQuantity'].some(key=>selected.has(key))&&!selected.has('uom'))throw new Error("Include uom with quantity columns, or explicitly remove the quantity columns.");
  const values:unknown[]=[input.organizationId],where=['d.organization_id=$1'],filters:Record<string,unknown>={};
  for(const key of ['supplierId','projectId'] as const)if(input.filters[key]!==undefined){const value=input.filters[key];if(!(typeof value==='number'||typeof value==='string'&&/^[0-9]+$/.test(value))||!Number.isInteger(Number(value))||Number(value)<1||Number(value)>2147483647)throw new Error("Choose a valid procurement filter identifier.");filters[key]=Number(value);values.push(Number(value));where.push(`d.${key==='supplierId'?'supplier_id':'project_id'}=$${values.length}`);}
  if(input.filters.documentNumber!==undefined){if(typeof input.filters.documentNumber!=='string'||input.filters.documentNumber.length>200)throw new Error("Invalid document-number filter.");filters.documentNumber=input.filters.documentNumber.trim();values.push(filters.documentNumber);where.push(`strpos(lower(d.${spec.number}),lower($${values.length}))>0`);}
  if(input.filters.status!==undefined){if(typeof input.filters.status!=='string'||!input.filters.status.trim()||input.filters.status.length>100)throw new Error("Invalid procurement status filter.");filters.status=input.filters.status.trim().toLowerCase();if(filters.status!=='all'){values.push(filters.status);where.push(`lower(d.status::text)=$${values.length}`);}}
  for(const key of ['from','to'] as const)if(input.filters[key]!==undefined){filters[key]=utc(input.filters[key]);values.push(filters[key]);where.push(`d.created_at ${key==='from'?'>=':'<'} ($${values.length}::timestamptz AT TIME ZONE 'UTC')`);}
  if(filters.from&&filters.to&&String(filters.from)>=String(filters.to))throw new Error("The procurement date range must end after it starts.");
  await input.authorize();
  const isolation=await client.query('SHOW transaction_isolation'),readOnly=await client.query('SHOW transaction_read_only');
  if(isolation.rows[0].transaction_isolation!=='repeatable read'||readOnly.rows[0].transaction_read_only!=='on')throw new Error("Procurement capture requires a repeatable-read, read-only observation.");
  const observation=await client.query(`SELECT txid_current_snapshot()::text AS snapshot,to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at`);
  const from=`FROM ${spec.table} d LEFT JOIN ${spec.lines} l ON l.${spec.parent}=d.id
    LEFT JOIN suppliers s ON s.id=d.supplier_id AND s.organization_id=d.organization_id
    LEFT JOIN units_of_measure u ON u.id=l.unit_of_measure_id AND (u.organization_id IS NULL OR u.organization_id=d.organization_id)
    LEFT JOIN tax_codes t ON t.id=l.tax_code_id AND (t.organization_id IS NULL OR t.organization_id=d.organization_id)`;
  const predicate=where.join(' AND '),counted=await client.query(`SELECT count(*)::text AS count ${from} WHERE ${predicate}`,values);
  const expectedRows=Number(counted.rows[0].count);if(!Number.isSafeInteger(expectedRows)||expectedRows<0)throw new Error("Procurement row count exceeds the supported range.");
  async function* rows():AsyncGenerator<CompactSourceRow>{
    let after=[0,0,0],emitted=0;
    for(;;){
      const n=values.length;
      const page=await client.query(`SELECT d.id::text AS "__documentId",COALESCE(l.line_number,0)::text AS "__lineNumber",COALESCE(l.id,0)::text AS "__lineId",${columns.map(column=>`${fields[column.key]} AS "${column.key}"`).join(',')}
        ${from} WHERE ${predicate} AND (d.id,COALESCE(l.line_number,0),COALESCE(l.id,0))>($${n+1}::int,$${n+2}::int,$${n+3}::int)
        ORDER BY d.id,COALESCE(l.line_number,0),COALESCE(l.id,0) LIMIT 1000`,[...values,...after]);
      for(const record of page.rows){
        const key=[Number(record.__documentId),Number(record.__lineNumber),Number(record.__lineId)];
        const later=key[0]>after[0]||key[0]===after[0]&&(key[1]>after[1]||key[1]===after[1]&&key[2]>after[2]);
        if(key.some(value=>!Number.isSafeInteger(value))||!later)throw new Error("Procurement ordering evidence is invalid.");
        const row:CompactSourceRow=Object.create(null);for(const column of columns){const value=record[column.key];if(value!==null&&typeof value!=='string')throw new Error("Procurement source field is not valid literal text.");row[column.key]=value;}
        after=key;if(++emitted>expectedRows)throw new Error("Procurement capture exceeds its observed count.");yield row;
      }
      if(page.rows.length<1000)break;
    }
    if(emitted!==expectedRows)throw new Error("Procurement capture is incomplete.");await input.authorize();
  }
  return {dataset:input.dataset,schemaVersion:'procurement-lines-compact-v1',observationReference:`procurement-${randomUUID()}`,normalizedFilters:filters,columns,expectedRows,information:{observedAt:observation.rows[0].observed_at,databaseSnapshot:observation.rows[0].snapshot,rowBasis:'One row per stored line; documents without lines appear once with null line fields. Document totals repeat per line and must not be summed.',financialBasis:'Operational document detail, not approved spend or commitment measures. Missing currency is null; no FX or tax calculation occurs.',precisionEvidence:'Amounts stored in legacy REAL columns retain only their original stored precision; text export does not restore lost digits. Numeric quantities are copied as stored.',referenceEvidence:'Tenant-inaccessible supplier/UOM/tax references remain null. Missing historical item snapshots are not replaced by current item-master values.',dateBasis:input.utcTimestampEvidence?'created_at filters: UTC from inclusive/to exclusive. requiredDate retains its stored local timestamp text without inventing a timezone.':'Legacy timestamp timezone is unverified; date filtering is unavailable. requiredDate retains raw stored local timestamp text.',timestampStorageEvidence:input.utcTimestampEvidence??null,statusBasis:'Case-insensitive raw status filtering; original historical and unknown status values are preserved.'},rows:rows()};
}
