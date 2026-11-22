import type {Pool,PoolClient} from 'pg';
import {exportSourceResources} from '../../../shared/export-source-access';
import {queryRolePermission,queryUserCustomRoleId,queryCustomRolePermission} from '../../services/permission-query-service';
import {spendSourceResources} from "@shared/spend-cube";

type Scope={organizationId:number;userId:number;dataset:string;filters?:Record<string,unknown>};
export class ExportActorAccessError extends Error{
  constructor(readonly code:string,message:string){super(message);}
}
/** Same canonical membership and permission rules as interactive requests. A
 * publication caller passes its existing RW client with lock=true, never a pool.
 */
export async function assertExportActorAccess(database:Pick<Pool,'query'>,input:Scope,lock=false){
  const {organizationId,userId,dataset}=input,resources=exportSourceResources(dataset,input.filters??{});
  if(!Number.isSafeInteger(organizationId)||organizationId<1||!Number.isSafeInteger(userId)||userId<1||!resources)throw new ExportActorAccessError('EXPORT_SOURCE_DENIED','This export is not available to the requesting user.');
  const membership=await database.query(`SELECT m.id,m.application_role::text AS application_role,u.warehouse_id FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active=true JOIN organizations o ON o.id=m.organization_id AND o.active=true WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active=true AND m.status='active'${lock?' FOR SHARE OF m,u,o':''}`,[organizationId,userId]);
  if(membership.rowCount!==1)throw new ExportActorAccessError('EXPORT_MEMBERSHIP_DENIED','The requesting user no longer has active organization access.');
  const actor=membership.rows[0],role=String(actor.application_role),customRoleId=role==='custom'?await queryUserCustomRoleId(database,organizationId,userId,lock):null;
  let cube=false;const requiredResources=[...resources];
  if(dataset==='financial_measure'&&typeof input.filters?.runId==='string'){
    const id=input.filters.runId;
    if(!/^[a-f0-9-]{36}$/i.test(id))throw new ExportActorAccessError('EXPORT_SOURCE_DENIED','Choose a saved financial observation.');
    const run=(await database.query("SELECT measure,summary FROM financial_reporting_runs WHERE organization_id=$1 AND id=$2",[organizationId,id])).rows[0];
    if(!run)throw new ExportActorAccessError('EXPORT_SOURCE_DENIED','The saved observation is unavailable in this organization.');
    if(run.summary.spendCubeVersion===1){cube=true;requiredResources.push(...spendSourceResources(run.measure));}
  }
  if(cube&&actor.warehouse_id!==null)throw new ExportActorAccessError('EXPORT_SOURCE_DENIED','This company-wide Spend Cube observation requires unrestricted warehouse scope.');
  for(const [resource,action]of [['reports','read'],['reports','export'],...[...new Set(requiredResources)].map(resource=>[resource,'read'])]){
    if(await queryRolePermission(database,role,resource,action,lock))continue;
    if(customRoleId&&await queryCustomRolePermission(database,organizationId,customRoleId,resource,action,lock))continue;
    throw new ExportActorAccessError('EXPORT_SOURCE_DENIED',"The requesting user no longer has access to this export's source records.");
  }
  const warehouseId=actor.warehouse_id===null?null:Number(actor.warehouse_id);
  if(warehouseId!==null&&(!Number.isSafeInteger(warehouseId)||warehouseId<1))throw new ExportActorAccessError('EXPORT_WAREHOUSE_SCOPE_UNVERIFIED','Your warehouse assignment requires administrator review before exporting.');
  return {membershipId:Number(actor.id),role,warehouseId};
}

/** Compact-only fail-closed location policy. No implicit scope changes: the
 * user must explicitly select their assigned warehouse for reorder records.
 * Current un-attributable operational readers cannot serve restricted actors.
 * This does not silently change existing standard export/query policies.
 */
export async function assertCompactExportActorWithClient(client:PoolClient,input:Scope,lock=false){
  const registered=['inventory','suppliers','purchase_orders','purchase_requisitions','reorder_requests','invoices','shipments','po_delivery_comparison','activity_logs'];
  if(!registered.includes(input.dataset))throw new ExportActorAccessError('COMPACT_SCOPE_UNVERIFIED','This dataset needs its own verified record-access checks before Compact Excel can use it.');
  const actor=await assertExportActorAccess(client,input,lock);
  if(actor.warehouseId===null)return actor;
  const owned=await client.query(`SELECT w.id FROM warehouses w WHERE w.id=$1 AND w.organization_id=$2${lock?' FOR SHARE OF w':''}`,[actor.warehouseId,input.organizationId]);
  if(owned.rowCount!==1)throw new ExportActorAccessError('EXPORT_WAREHOUSE_SCOPE_UNVERIFIED','Your warehouse assignment is unavailable in this organization. Ask an administrator to review it.');
  if(input.dataset==='reorder_requests'){
    const requested=input.filters?.warehouseId;
    if(!(typeof requested==='number'||typeof requested==='string'&&/^\d+$/.test(requested))||Number(requested)!==actor.warehouseId)throw new ExportActorAccessError('EXPORT_WAREHOUSE_FILTER_REQUIRED','Select your assigned warehouse explicitly before exporting reorder requests. No filters were changed.');
  }else if(!['suppliers','invoices'].includes(input.dataset))throw new ExportActorAccessError('EXPORT_WAREHOUSE_SCOPE_UNVERIFIED','This dataset cannot yet prove your assigned-warehouse scope. Ask for a warehouse-scoped workflow; no company-wide file was prepared.');
  return actor;
}
