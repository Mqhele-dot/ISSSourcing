import type {PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import {getExportDatasetRegistry} from "../../services/export-registry";
import {selectCompactColumns,type CompactDatasetReader,type CompactSourceRow} from "./compact-dataset-reader";
import type {CompactDetailColumn} from "./compact-full-detail-writer";

const fields:Record<string,string>={name:'s.name',email:'s.email',phone:'s.phone',defaultCurrencyCode:'s.default_currency_code',status:'s.status'};
function utc(value:unknown){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw new Error("Supply an explicit UTC timestamp for supplier date filters.");
  const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))throw new Error("Invalid supplier date filter.");
  const normalized=parsed.toISOString();if(normalized!==value.replace(/(?<!\.\d{3})Z$/,'.000Z'))throw new Error("Invalid supplier calendar date.");
  return normalized;
}

/** Must run within the caller-owned repeatable-read, read-only observation. */
export async function createCompactSupplierReader(client:PoolClient,input:{organizationId:number;filters:Record<string,unknown>;columns?:string[];authorize:()=>Promise<void>;utcTimestampEvidence?:string}):Promise<CompactDatasetReader>{
  if(!Number.isSafeInteger(input.organizationId)||input.organizationId<1)throw new Error("Invalid supplier export scope.");
  if(Object.keys(input.filters).some(key=>!['q','supplierId','status','from','to'].includes(key)))throw new Error("Unsupported supplier export filter. No filters were ignored.");
  if(input.utcTimestampEvidence!==undefined&&(!input.utcTimestampEvidence.trim()||input.utcTimestampEvidence.length>200))throw new Error("Invalid timestamp storage evidence.");
  // Legacy timestamp-without-time-zone values do not prove their own timezone.
  // Only trusted, verified storage provenance may enable date filtering.
  if((input.filters.from!==undefined||input.filters.to!==undefined)&&!input.utcTimestampEvidence)throw new Error("Supplier date filtering requires verified UTC timestamp storage evidence. Remove date filters or complete timestamp reconciliation.");
  const registered=getExportDatasetRegistry().find(entry=>entry.key==='suppliers')!;
  if(registered.columns.some(column=>!Object.hasOwn(fields,column.key)))throw new Error("The supplier export schema requires a reader update.");
  const columns=selectCompactColumns(registered.columns.map(column=>({key:column.key,label:column.label,kind:'text'} as CompactDetailColumn)),input.columns);
  const values:unknown[]=[input.organizationId],where=['s.organization_id=$1'];const filters:Record<string,unknown>={};
  if(input.filters.q!==undefined){if(typeof input.filters.q!=='string'||input.filters.q.length>200)throw new Error("Supplier search must be at most 200 characters.");filters.q=input.filters.q.trim();values.push(filters.q);where.push(`strpos(lower(coalesce(s.name,'')||' '||coalesce(s.email,'')),lower($${values.length}))>0`);}
  if(input.filters.supplierId!==undefined){const id=input.filters.supplierId;if(!(typeof id==='number'||typeof id==='string'&&/^[0-9]+$/.test(id))||!Number.isInteger(Number(id))||Number(id)<1||Number(id)>2147483647)throw new Error("Choose a valid supplier identifier.");filters.supplierId=Number(id);values.push(Number(id));where.push(`s.id=$${values.length}`);}
  if(input.filters.status!==undefined){if(typeof input.filters.status!=='string'||!input.filters.status.trim()||input.filters.status.length>100)throw new Error("Choose a valid supplier status.");filters.status=input.filters.status.trim().toLowerCase();if(filters.status!=='all'){values.push(filters.status);where.push(`lower(s.status)=$${values.length}`);}}
  for(const key of ['from','to'] as const)if(input.filters[key]!==undefined){filters[key]=utc(input.filters[key]);values.push(filters[key]);where.push(`s.created_at ${key==='from'?'>=':'<'} ($${values.length}::timestamptz AT TIME ZONE 'UTC')`);}
  if(filters.from&&filters.to&&String(filters.from)>=String(filters.to))throw new Error("The supplier date range must end after it starts.");
  await input.authorize();
  const isolation=await client.query('SHOW transaction_isolation'),readOnly=await client.query('SHOW transaction_read_only');
  if(isolation.rows[0].transaction_isolation!=='repeatable read'||readOnly.rows[0].transaction_read_only!=='on')throw new Error("Supplier capture requires a repeatable-read, read-only observation.");
  const observation=await client.query(`SELECT txid_current_snapshot()::text AS snapshot,to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at`);
  const predicate=where.join(' AND ');
  const counted=await client.query(`SELECT count(*)::text AS count FROM suppliers s WHERE ${predicate}`,values);
  const expectedRows=Number(counted.rows[0].count);if(!Number.isSafeInteger(expectedRows)||expectedRows<0)throw new Error("Supplier count exceeds the supported range.");
  async function* rows():AsyncGenerator<CompactSourceRow>{
    let after=0,emitted=0;
    for(;;){
      const page=await client.query(`SELECT s.id::text AS "__sourceId",${columns.map(column=>`${fields[column.key]} AS "${column.key}"`).join(',')}
        FROM suppliers s WHERE ${predicate} AND s.id>$${values.length+1} ORDER BY s.id LIMIT 1000`,[...values,after]);
      for(const record of page.rows){
        const id=Number(record.__sourceId);if(!Number.isSafeInteger(id)||id<=after)throw new Error("Supplier ordering evidence is invalid.");
        const row:CompactSourceRow=Object.create(null);for(const column of columns){const value=record[column.key];if(value!==null&&typeof value!=='string')throw new Error("Supplier source field is not valid text.");row[column.key]=value;}
        after=id;if(++emitted>expectedRows)throw new Error("Supplier capture exceeds its observed count.");yield row;
      }
      if(page.rows.length<1000)break;
    }
    if(emitted!==expectedRows)throw new Error("Supplier capture is incomplete.");await input.authorize();
  }
  return {dataset:'suppliers',schemaVersion:'suppliers-compact-v1',observationReference:`suppliers-${randomUUID()}`,normalizedFilters:filters,columns,expectedRows,information:{observedAt:observation.rows[0].observed_at,databaseSnapshot:observation.rows[0].snapshot,dateBasis:input.utcTimestampEvidence?'Supplier created_at; from inclusive, to exclusive; verified UTC timestamp storage.':'Legacy created_at timezone is unverified; date filtering is unavailable.',timestampStorageEvidence:input.utcTimestampEvidence??null,scope:'All tenant-owned suppliers matching the chosen filters, including inactive suppliers when no status filter is selected.'},rows:rows()};
}
