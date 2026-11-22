import type {PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import {getExportDatasetRegistry} from "../../services/export-registry";
import {selectCompactColumns,type CompactDatasetReader,type CompactSourceRow} from "./compact-dataset-reader";
import type {CompactDetailColumn} from "./compact-full-detail-writer";

const fields:Record<string,string>={action:'a.action',description:'a.description',userName:"COALESCE(NULLIF(u.full_name,''),u.username)",timestamp:'a.timestamp::text'};
function utc(value:unknown){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw new Error("Supply an explicit UTC timestamp for activity date filters.");
  const date=new Date(value);if(!Number.isFinite(date.getTime())||date.toISOString()!==value.replace(/(?<!\.\d{3})Z$/,'.000Z'))throw new Error("Invalid activity calendar date.");return date.toISOString();
}
export async function createCompactActivityReader(client:PoolClient,input:{organizationId:number;filters:Record<string,unknown>;columns?:string[];authorize:()=>Promise<void>;utcTimestampEvidence?:string}):Promise<CompactDatasetReader>{
  if(!Number.isSafeInteger(input.organizationId)||input.organizationId<1)throw new Error("Invalid activity export scope.");
  if(Object.keys(input.filters).some(key=>!['q','actorId','action','from','to'].includes(key)))throw new Error("Unsupported activity export filter. No filters were ignored.");
  if(input.utcTimestampEvidence!==undefined&&(!input.utcTimestampEvidence.trim()||input.utcTimestampEvidence.length>200))throw new Error("Invalid timestamp storage evidence.");
  if((input.filters.from!==undefined||input.filters.to!==undefined)&&!input.utcTimestampEvidence)throw new Error("Activity date filtering requires verified UTC timestamp storage evidence.");
  const registered=getExportDatasetRegistry().find(entry=>entry.key==='activity_logs')!;
  if(registered.columns.some(column=>!Object.hasOwn(fields,column.key)))throw new Error("The activity schema requires a reader update.");
  const columns=selectCompactColumns(registered.columns.map(column=>({key:column.key,label:column.label,kind:'text'} as CompactDetailColumn)),input.columns);
  const values:unknown[]=[input.organizationId],where=['a.organization_id=$1'],filters:Record<string,unknown>={};
  if(input.filters.q!==undefined){if(typeof input.filters.q!=='string'||input.filters.q.length>200)throw new Error("Activity search must be at most 200 characters.");filters.q=input.filters.q.trim();values.push(filters.q);where.push(`strpos(lower(coalesce(a.action,'')||' '||coalesce(a.description,'')),lower($${values.length}))>0`);}
  if(input.filters.actorId!==undefined){const id=input.filters.actorId;if(!(typeof id==='number'||typeof id==='string'&&/^[0-9]+$/.test(id))||!Number.isInteger(Number(id))||Number(id)<1||Number(id)>2147483647)throw new Error("Choose a valid actor identifier.");filters.actorId=Number(id);values.push(Number(id));where.push(`a.user_id=$${values.length}`);}
  if(input.filters.action!==undefined){if(typeof input.filters.action!=='string'||!input.filters.action.trim()||input.filters.action.length>100)throw new Error("Choose a valid activity action.");filters.action=input.filters.action.trim().toLowerCase();values.push(filters.action);where.push(`lower(a.action)=$${values.length}`);}
  for(const key of ['from','to'] as const)if(input.filters[key]!==undefined){filters[key]=utc(input.filters[key]);values.push(filters[key]);where.push(`a.timestamp ${key==='from'?'>=':'<'} ($${values.length}::timestamptz AT TIME ZONE 'UTC')`);}
  if(filters.from&&filters.to&&String(filters.from)>=String(filters.to))throw new Error("The activity date range must end after it starts.");
  await input.authorize();
  const isolation=await client.query('SHOW transaction_isolation'),readOnly=await client.query('SHOW transaction_read_only');
  if(isolation.rows[0].transaction_isolation!=='repeatable read'||readOnly.rows[0].transaction_read_only!=='on')throw new Error("Activity capture requires a repeatable-read, read-only observation.");
  const observation=await client.query(`SELECT txid_current_snapshot()::text AS snapshot,to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at`);
  const from=`FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id AND EXISTS(SELECT 1 FROM organization_members m WHERE m.user_id=u.id AND m.organization_id=a.organization_id)`;
  const predicate=where.join(' AND '),counted=await client.query(`SELECT count(*)::text AS count ${from} WHERE ${predicate}`,values);
  const expectedRows=Number(counted.rows[0].count);if(!Number.isSafeInteger(expectedRows)||expectedRows<0)throw new Error("Activity count exceeds the supported range.");
  async function* rows():AsyncGenerator<CompactSourceRow>{
    let after=0,emitted=0;
    for(;;){
      const page=await client.query(`SELECT a.id::text AS "__sourceId",${columns.map(column=>`${fields[column.key]} AS "${column.key}"`).join(',')} ${from}
        WHERE ${predicate} AND a.id>$${values.length+1} ORDER BY a.id LIMIT 1000`,[...values,after]);
      for(const record of page.rows){
        const id=Number(record.__sourceId);if(!Number.isSafeInteger(id)||id<=after)throw new Error("Activity ordering evidence is invalid.");
        const row:CompactSourceRow=Object.create(null);for(const column of columns){const value=record[column.key];if(value!==null&&typeof value!=='string')throw new Error("Activity field is not valid literal text.");row[column.key]=value;}
        after=id;if(++emitted>expectedRows)throw new Error("Activity capture exceeds its observed count.");yield row;
      }
      if(page.rows.length<1000)break;
    }
    if(emitted!==expectedRows)throw new Error("Activity capture is incomplete.");await input.authorize();
  }
  return {dataset:'activity_logs',schemaVersion:'activity-compact-v1',observationReference:`activity-${randomUUID()}`,normalizedFilters:filters,columns,expectedRows,information:{observedAt:observation.rows[0].observed_at,databaseSnapshot:observation.rows[0].snapshot,evidenceBasis:'Operational activity only; this is not the append-only governed audit ledger.',actorBasis:'Current display names from same-organization current or historical memberships. Missing/inaccessible actors remain null; names are not verified historical identity evidence.',dateBasis:input.utcTimestampEvidence?'timestamp filters use verified UTC storage, from inclusive/to exclusive; exported timestamps retain raw database text.':'Legacy timestamp timezone is unverified; date filtering is unavailable. Exported timestamps retain raw database text.',timestampStorageEvidence:input.utcTimestampEvidence??null},rows:rows()};
}
