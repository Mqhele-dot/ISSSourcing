import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {getExportDatasetRegistry} from '../../services/export-registry';
import {shipmentOrderCandidateJoinSql} from '../operations/shipment-order-link';
import {selectCompactColumns,type CompactDatasetReader,type CompactSourceRow} from './compact-dataset-reader';
import type {CompactDetailColumn} from './compact-full-detail-writer';

function utc(value:unknown){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw new Error('Supply an explicit UTC timestamp for logistics date filters.');
  const parsed=new Date(value);if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value.replace(/(?<!\.\d{3})Z$/,'.000Z'))throw new Error('Invalid logistics calendar date.');return parsed.toISOString();
}

/** Internal adapter, never the buffered legacy exporter. The caller owns the
 * read-only source transaction and supplies trusted authorization/provenance.
 */
export async function createCompactLogisticsReader(client:PoolClient,input:{dataset:string;organizationId:number;filters:Record<string,unknown>;columns?:string[];authorize:()=>Promise<void>;utcTimestampEvidence?:string}):Promise<CompactDatasetReader>{
  if(!['shipments','po_delivery_comparison'].includes(input.dataset)||!Number.isSafeInteger(input.organizationId)||input.organizationId<1)throw new Error('Invalid logistics export dataset or scope.');
  const comparison=input.dataset==='po_delivery_comparison';
  const allowed=['q','documentNumber','supplierId','status','from','to',...(comparison?['shipmentStatus']:[])];
  if(Object.keys(input.filters).some(key=>!allowed.includes(key)))throw new Error('Unsupported logistics export filter. No filters were ignored.');
  if(input.utcTimestampEvidence!==undefined&&(!input.utcTimestampEvidence.trim()||input.utcTimestampEvidence.length>200))throw new Error('Invalid timestamp storage evidence.');
  if((input.filters.from!==undefined||input.filters.to!==undefined)&&!input.utcTimestampEvidence)throw new Error('Logistics date filtering requires verified UTC timestamp storage evidence.');
  const values:unknown[]=[input.organizationId],where=[`${comparison?'po':'sh'}.organization_id=$1`],filters:Record<string,unknown>={};
  const textFilter=(key:string,expression:string,max=200,exact=false)=>{
    if(input.filters[key]===undefined)return;
    const value=input.filters[key];if(typeof value!=='string'||value.length>max||(exact&&!value.trim()))throw new Error('Choose a valid logistics text filter.');
    const normalized=value.trim().toLowerCase();filters[key]=normalized;if(exact&&normalized==='all')return;
    values.push(normalized);where.push(exact?`lower(${expression})=$${values.length}`:`strpos(lower(coalesce(${expression},'')),$${values.length})>0`);
  };
  textFilter('q',comparison?"coalesce(po.order_number,'')||' '||coalesce(sh.tracking_number,'')||' '||coalesce(s.name,'')":"coalesce(sh.po_number,'')||' '||coalesce(sh.tracking_number,'')||' '||coalesce(sh.carrier,'')");
  textFilter('documentNumber',comparison?'po.order_number':'sh.po_number');
  textFilter('status',comparison?'po.status::text':'sh.status::text',100,true);
  if(comparison)textFilter('shipmentStatus','sh.status::text',100,true);
  if(input.filters.supplierId!==undefined){
    const id=input.filters.supplierId;if(!(typeof id==='number'||typeof id==='string'&&/^\d+$/.test(id))||!Number.isInteger(Number(id))||Number(id)<1||Number(id)>2147483647)throw new Error('Choose a valid supplier identifier.');
    filters.supplierId=Number(id);values.push(Number(id));where.push(`s.id=$${values.length}`);
  }
  for(const key of ['from','to'] as const)if(input.filters[key]!==undefined){filters[key]=utc(input.filters[key]);values.push(filters[key]);where.push(`${comparison?'po':'sh'}.created_at ${key==='from'?'>=':'<'} ($${values.length}::timestamptz AT TIME ZONE 'UTC')`);}
  if(filters.from&&filters.to&&String(filters.from)>=String(filters.to))throw new Error('The logistics date range must end after it starts.');
  await input.authorize();
  const isolation=await client.query('SHOW transaction_isolation'),readOnly=await client.query('SHOW transaction_read_only');
  if(isolation.rows[0].transaction_isolation!=='repeatable read'||readOnly.rows[0].transaction_read_only!=='on')throw new Error('Logistics capture requires a repeatable-read, read-only observation.');
  if(input.utcTimestampEvidence){
    const schema=await client.query(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND ((c.relname='shipments' AND a.attname IN('created_at','eta')) OR (c.relname='purchase_orders' AND a.attname='created_at'))`);
    const expected=comparison?['shipments.eta','purchase_orders.created_at']:['shipments.eta','shipments.created_at'];
    if(expected.some(key=>!schema.rows.some(row=>`${row.relname}.${row.attname}`===key&&row.type==='timestamp without time zone')))throw new Error('Timestamp storage differs from this adapter’s reviewed UTC policy. Reconcile the schema before using date comparisons.');
  }
  const observation=await client.query(`SELECT txid_current_snapshot()::text AS snapshot,to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at`);
  // Pin every derived time comparison to this observation, never per-page NOW().
  values.push(observation.rows[0].observed_at);const observedParameter=values.length;
  const state="lower(trim(coalesce(sh.status::text,'')))";
  const timing=input.utcTimestampEvidence?`CASE WHEN NOT isfinite(sh.eta) THEN 'Unavailable: nonfinite ETA' WHEN (sh.eta AT TIME ZONE 'UTC')<$${observedParameter}::timestamptz THEN 'Late at observation' ELSE 'Not late at observation' END`:"'Unavailable: ETA timezone unverified'";
  const risk=`CASE WHEN sh.id IS NULL THEN NULL
    WHEN ${state}='delivered' THEN 'Recorded delivered; POD unverified'
    WHEN ${state}='received' THEN 'Recorded received; delivery unverified'
    WHEN ${state}='cancelled' THEN 'Recorded cancelled'
    WHEN ${state}='closed' THEN 'Recorded closed; delivery unverified'
    WHEN ${state} NOT IN('created','in_transit','delayed','exception','arrived','partially_received') THEN 'Unavailable: unknown shipment status'
    WHEN sh.eta IS NULL THEN 'Unavailable: no ETA' ELSE ${timing} END`;
  const fields:Record<string,string>=comparison?{
    poNumber:'po.order_number',supplierName:'s.name',poStatus:'po.status::text',shipmentStatus:'sh.status::text',eta:'sh.eta::text',trackingNumber:'sh.tracking_number',
    deliveryGap:`CASE WHEN sh.id IS NULL THEN 'No verified linked shipment' ELSE ${risk} END`,shipmentId:'sh.id::text',purchaseOrderId:'po.id::text',shipmentPoNumber:'sh.po_number',
  }:{poNumber:'sh.po_number',carrier:'sh.carrier',status:'sh.status::text',eta:'sh.eta::text',trackingNumber:'sh.tracking_number',lateRisk:risk,shipmentId:'sh.id::text',purchaseOrderId:'po.id::text'};
  const registered=getExportDatasetRegistry().find(entry=>entry.key===input.dataset)!;
  if(registered.columns.some(column=>!Object.hasOwn(fields,column.key)))throw new Error('The logistics export schema requires a reader update.');
  const available:CompactDetailColumn[]=registered.columns.map(column=>({key:column.key,label:column.label,kind:'text'}));
  available.push({key:'shipmentId',label:'Shipment ID',kind:'identifier'},{key:'purchaseOrderId',label:'Verified linked PO ID',kind:'identifier'});
  if(comparison)available.push({key:'shipmentPoNumber',label:'Stored shipment PO reference',kind:'text'});
  const columns=selectCompactColumns(available,input.columns);
  // Resolve a candidate key set-wise, then validate it with the shared policy.
  // An OR-only join repeatedly compared every PO to every shipment in measured
  // 5000-row plans. The candidate equality permits an indexed/hash join without
  // weakening canonical precedence, ownership or legacy ambiguity checks.
  const {relation:ownedShipments,predicate:link}=shipmentOrderCandidateJoinSql('sh','po');
  const from=comparison?`FROM purchase_orders po LEFT JOIN ${ownedShipments} ON ${link}
    LEFT JOIN suppliers s ON s.id=po.supplier_id AND s.organization_id=po.organization_id`:
    `FROM ${ownedShipments} LEFT JOIN purchase_orders po ON ${link}
    LEFT JOIN suppliers s ON s.id=po.supplier_id AND s.organization_id=po.organization_id`;
  const predicate=where.join(' AND ');
  // The observation parameter is needed only by the derived SELECT fields.
  const filterValues=values.slice(0,-1);
  const counted=await client.query(`SELECT count(*)::text AS count,count(*) FILTER(WHERE ${comparison?'sh':'po'}.id IS NULL)::text AS unlinked ${from} WHERE ${predicate}`,filterValues);
  const expectedRows=Number(counted.rows[0].count);if(!Number.isSafeInteger(expectedRows)||expectedRows<0)throw new Error('Logistics count exceeds the supported range.');
  async function* rows():AsyncGenerator<CompactSourceRow>{
    let after=[0,0],emitted=0;
    for(;;){
      const n=values.length,key=comparison?'(po.id,COALESCE(sh.id,0))':'(sh.id,0)',order=comparison?'po.id,COALESCE(sh.id,0)':'sh.id';
      // Keep the observation placeholder typed even if the selected columns do
      // not include a derived field; sparse parameter lists must not fail.
      const page=await client.query(`SELECT ${comparison?'po.id':'sh.id'}::text AS "__primaryId",${comparison?'COALESCE(sh.id,0)':'0'}::text AS "__secondaryId",${columns.map(column=>`${fields[column.key]} AS "${column.key}"`).join(',')}
        ${from} WHERE ${predicate} AND $${observedParameter}::timestamptz IS NOT NULL AND ${key}>($${n+1}::int,$${n+2}::int) ORDER BY ${order} LIMIT 1000`,[...values,...after]);
      for(const record of page.rows){
        const key=[Number(record.__primaryId),Number(record.__secondaryId)];
        if(key.some(value=>!Number.isSafeInteger(value))||!(key[0]>after[0]||key[0]===after[0]&&key[1]>after[1]))throw new Error('Logistics ordering evidence is invalid.');
        const row:CompactSourceRow=Object.create(null);for(const column of columns){const value=record[column.key];if(value!==null&&typeof value!=='string')throw new Error('Logistics source field is not valid literal text.');row[column.key]=value;}
        after=key;if(++emitted>expectedRows)throw new Error('Logistics capture exceeds its observed count.');yield row;
      }
      if(page.rows.length<1000)break;
    }
    if(emitted!==expectedRows)throw new Error('Logistics capture is incomplete.');await input.authorize();
  }
  return {dataset:input.dataset,schemaVersion:'logistics-compact-v1',observationReference:`logistics-${randomUUID()}`,normalizedFilters:filters,columns,expectedRows,information:{
    observedAt:observation.rows[0].observed_at,databaseSnapshot:observation.rows[0].snapshot,
    scope:comparison?'One row per verified PO/shipment link, including one null-shipment row for each matching PO without a verified link.':'Every explicitly tenant-owned matching shipment, including shipments without a verified PO link. Unassigned/foreign shipments are excluded.',
    linkageBasis:'Canonical PO ID takes precedence within the same explicit tenant. Legacy number links require global uniqueness. Invalid or inaccessible associations remain unverified; records are never reassigned.',
    referenceBasis:'Supplier names come from same-tenant master data in this observation, not verified historical name snapshots. Stored shipment PO-reference text is not rewritten to match a linked PO.',
    unlinkedRows:counted.rows[0].unlinked,statusBasis:'Raw historical/unknown status values and null/empty strings are preserved. Status filters are case-insensitive; comparison status filters PO status, shipmentStatus filters linked shipment status.',
    dateBasis:input.utcTimestampEvidence?'Reviewed UTC timestamp storage; created_at from inclusive/to exclusive. ETA comparisons use the fixed observation timestamp. Exported dates retain raw database text.':'Legacy timestamp timezone unverified. No date filtering or ETA lateness assertion; raw stored timestamp text is preserved.',
    timestampStorageEvidence:input.utcTimestampEvidence??null,
    derivedFields:'lateRisk/deliveryGap are explicitly labelled observation-time planning descriptions, not delivery/POD verification or quality/stock eligibility. Recorded cancellation or closure does not prove delivery.',
  },rows:rows()};
}
