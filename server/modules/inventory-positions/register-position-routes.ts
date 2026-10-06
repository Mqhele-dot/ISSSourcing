import type { Express, Request, RequestHandler, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId } from "../../organization-context";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";
import { binCreate, locationQuery, positionQuery, positionReconcile, siteLink, zoneCreate } from "./contracts";
type Auth={ensureAuthenticated:RequestHandler;ensurePermission:(resource:string,action:string)=>RequestHandler};
const actor=(req:Request)=>z.number().int().positive().parse((req as Request&{user?:{id:number}}).user?.id);
const positiveId=(value:unknown)=>z.coerce.number().int().positive().parse(value);
async function transaction<T>(work:(client:PoolClient)=>Promise<T>) {
  const client=await pool.connect();try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result;}
  catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
async function requireWarehouse(client:Pick<PoolClient,"query">,org:number,user:number,id:number) {
  const result=await client.query(`SELECT w.id FROM warehouses w
    JOIN organization_members om ON om.organization_id=w.organization_id AND om.user_id=$3 AND om.active=true AND om.status='active'
    JOIN users u ON u.id=om.user_id
    WHERE w.organization_id=$1 AND w.id=$2 AND (u.warehouse_id IS NULL OR u.warehouse_id=w.id)`,[org,id,user]);
  if(!result.rowCount)throw new Error("POSITION_WAREHOUSE_DENIED");
}
const source=`FROM warehouse_inventory w
 JOIN inventory_items i ON i.id=w.item_id AND i.organization_id=w.organization_id
 JOIN warehouses wh ON wh.id=w.warehouse_id AND wh.organization_id=w.organization_id
 LEFT JOIN LATERAL (SELECT * FROM wms_position_reconciliations r WHERE r.organization_id=w.organization_id AND r.position_id=w.id ORDER BY r.id DESC LIMIT 1) r ON true
 LEFT JOIN wms_bins b ON b.id=r.bin_id AND b.organization_id=w.organization_id AND b.warehouse_id=w.warehouse_id
 LEFT JOIN wms_zones z ON z.id=b.zone_id AND z.organization_id=b.organization_id AND z.warehouse_id=b.warehouse_id
 LEFT JOIN wms_warehouse_sites ws ON ws.organization_id=w.organization_id AND ws.warehouse_id=w.warehouse_id
 LEFT JOIN mdm_sites s ON s.id=ws.site_id AND s.organization_id=w.organization_id
 LEFT JOIN LATERAL (SELECT COALESCE(sum(a.quantity),0) quantity FROM inventory_allocations a WHERE a.organization_id=w.organization_id AND a.item_id=w.item_id AND a.warehouse_id=w.warehouse_id AND a.status='reserved') a ON true`;
const reconciled=`(r.id IS NOT NULL AND r.source_revision=w.count_revision AND r.item_id=w.item_id AND r.warehouse_id=w.warehouse_id AND r.site_id=s.id AND r.quantity_snapshot=w.quantity AND b.active AND z.active AND s.active)`;
function fail(res:Response,error:unknown) {
  if(error instanceof z.ZodError)return sendError(res,400,"INVALID_POSITION_REQUEST","Check the location and position fields.",{details:error.flatten()});
  const code=(error as {code?:string})?.code;
  if(code==="42P01"||code==="42703")return sendError(res,503,"POSITION_MIGRATION_REQUIRED","Stock positions require the counting and location migrations.");
  if(code==="23505")return sendError(res,409,"POSITION_DUPLICATE","This location code or reconciliation already exists.");
  const message=error instanceof Error?error.message:"";
  if(message.startsWith("POSITION_"))return sendError(res,message.endsWith("DENIED")?403:message.endsWith("NOT_FOUND")?404:409,message,message.replaceAll("_"," "),{hint:"Refresh stock and verify an active, tenant-owned site, warehouse, zone and bin. Reconciliation never changes quantity."});
  return sendError(res,500,"POSITION_OPERATION_FAILED","The position operation failed. Changes were rolled back.");
}
export function registerPositionRoutes(app:Express,auth:Auth) {
  const read=[auth.ensureAuthenticated,auth.ensurePermission("inventory","read")];
  const manage=[auth.ensureAuthenticated,auth.ensurePermission("warehouses","update")];
  const verify=[auth.ensureAuthenticated,auth.ensurePermission("inventory","approve")];
  const wrap=(fn:(req:Request,res:Response)=>Promise<unknown>):RequestHandler=>async(req,res)=>{try{await fn(req,res);}catch(error){fail(res,error);}};
  app.get("/api/v2/inventory/positions",...read,wrap(async(req,res)=>{
    const query=positionQuery.parse(req.query),org=getActiveOrganizationId(),user=actor(req);
    const filter=`WHERE w.organization_id=$1 AND EXISTS(SELECT 1 FROM organization_members om JOIN users u ON u.id=om.user_id WHERE om.organization_id=$1 AND om.user_id=$2 AND om.active=true AND om.status='active' AND (u.warehouse_id IS NULL OR u.warehouse_id=w.warehouse_id))
      AND ($3::integer IS NULL OR w.warehouse_id=$3) AND ($4='' OR i.sku ILIKE $5 OR i.name ILIKE $5 OR wh.name ILIKE $5)
      AND ($6='all' OR ($6='reconciled' AND ${reconciled}) OR ($6='unresolved' AND NOT COALESCE(${reconciled},false)))`;
    const args=[org,user,query.warehouseId??null,query.q,`%${query.q.replace(/[\\%_]/g,"\\$&")}%`,query.status];
    const rows=await pool.query(`SELECT w.id,w.item_id AS "itemId",i.sku,i.name,w.warehouse_id AS "warehouseId",wh.name AS "warehouseName",
      w.quantity::text AS "onHand",w.count_revision::text AS revision,w.bin AS "legacyBin",w.location AS "legacyLocation",
      CASE WHEN ${reconciled} THEN 'reconciled' ELSE 'unresolved' END AS "locationState",
      CASE WHEN ${reconciled} THEN b.code ELSE NULL END AS "binCode",CASE WHEN ${reconciled} THEN b.id ELSE NULL END AS "binId",
      s.name AS "siteName",z.name AS "zoneName",r.verified_at AS "lastVerifiedAt",a.quantity::text AS "warehouseItemReserved",
      CASE WHEN COALESCE((to_jsonb(i)->>'safety_hold')::boolean,false) THEN 'item_safety_hold' ELSE 'unassessed' END AS "qualityState" ${source} ${filter} ORDER BY w.id LIMIT $7 OFFSET $8`,[...args,query.pageSize,(query.page-1)*query.pageSize]);
    const totals=await pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE ${reconciled})::int reconciled,COALESCE(sum(w.quantity),0)::text AS "onHand" ${source} ${filter}`,args);
    sendOk(res,{items:rows.rows,total:totals.rows[0].total,page:query.page,pageSize:query.pageSize,summary:{...totals.rows[0],unresolved:totals.rows[0].total-totals.rows[0].reconciled},capabilities:{locationReconciliation:true,qualityHolds:false,splitPositions:false},notice:"Location reconciliation only. Bin/lot-level quantities and quality eligibility are not implemented. The separate availability enquiry provides a limited planning projection, not allocation authority."});
  }));
  app.get("/api/v2/inventory/locations",...read,wrap(async(req,res)=>{
    const query=locationQuery.parse(req.query),org=getActiveOrganizationId(),user=actor(req);
    const member="EXISTS(SELECT 1 FROM organization_members om JOIN users u ON u.id=om.user_id WHERE om.organization_id=$1 AND om.user_id=$2 AND om.active=true AND om.status='active'";
    const definitions={sites:{from:"mdm_sites x",select:"x.id,x.code,x.name",scope:`x.active=true AND ${member} AND u.warehouse_id IS NULL)`},warehouses:{from:"warehouses x",select:"x.id,x.name",scope:`${member} AND (u.warehouse_id IS NULL OR u.warehouse_id=x.id))`},zones:{from:"wms_zones x",select:'x.id,x.code,x.name,x.warehouse_id AS "warehouseId"',scope:`x.active AND ${member} AND (u.warehouse_id IS NULL OR u.warehouse_id=x.warehouse_id))`},bins:{from:"wms_bins x",select:'x.id,x.code,x.zone_id AS "zoneId",x.warehouse_id AS "warehouseId"',scope:`x.active AND ${member} AND (u.warehouse_id IS NULL OR u.warehouse_id=x.warehouse_id))`}};
    const def=definitions[query.kind];
    const col=query.kind==="warehouses"?"x.name":"x.code";
    const warehouseFilter=query.kind==="zones"||query.kind==="bins"?"AND ($3::integer IS NULL OR x.warehouse_id=$3)":"AND $3::integer IS NULL";
    const nameSearch=query.kind==="bins"?"":" OR x.name ILIKE $5";
    const filter=`WHERE x.organization_id=$1 AND ${def.scope} AND $2::integer>0 ${warehouseFilter} AND ($4='' OR ${col} ILIKE $5${nameSearch})`;
    const args=[org,user,query.kind==="zones"||query.kind==="bins"?query.warehouseId??null:null,query.q,`%${query.q.replace(/[\\%_]/g,"\\$&")}%`];
    const rows=await pool.query(`SELECT ${def.select} FROM ${def.from} ${filter} ORDER BY x.id LIMIT $6 OFFSET $7`,[...args,query.pageSize,(query.page-1)*query.pageSize]);
    const total=await pool.query(`SELECT count(*)::int total FROM ${def.from} ${filter}`,args);
    sendOk(res,{items:rows.rows,total:total.rows[0].total,page:query.page,pageSize:query.pageSize});
  }));
  for(const kind of ["warehouse-site","zones","bins"] as const)app.post(`/api/v2/inventory/locations/${kind}`,...manage,wrap(async(req,res)=>{
    const org=getActiveOrganizationId(),user=actor(req);
    const result=await transaction(async client=>{
      if(kind==="warehouse-site") {
        const body=siteLink.parse(req.body);await requireWarehouse(client,org,user,body.warehouseId);
        const site=await client.query("SELECT id FROM mdm_sites WHERE id=$1 AND organization_id=$2 AND active",[body.siteId,org]);
        if(!site.rowCount)throw new Error("POSITION_SITE_NOT_FOUND");
        // Moving a reconciled warehouse to a different site requires explicit re-verification.
        const linked=await client.query(`SELECT site_id FROM wms_warehouse_sites WHERE warehouse_id=$1 FOR UPDATE`,[body.warehouseId]);
        if(linked.rowCount&&linked.rows[0].site_id!==body.siteId)await client.query(`UPDATE warehouse_inventory SET updated_at=now() WHERE organization_id=$1 AND warehouse_id=$2`,[org,body.warehouseId]);
        await client.query(`INSERT INTO wms_warehouse_sites(organization_id,warehouse_id,site_id,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(warehouse_id) DO UPDATE SET site_id=EXCLUDED.site_id,updated_by=EXCLUDED.updated_by,updated_at=now()`,[org,body.warehouseId,body.siteId,user]);
        await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:"WAREHOUSE_SITE_LINKED",resourceType:"warehouse",resourceId:body.warehouseId,after:body,reason:body.reason});return {warehouseId:body.warehouseId};
      }
      if(kind==="zones") {
        const body=zoneCreate.parse(req.body);await requireWarehouse(client,org,user,body.warehouseId);
        const created=await client.query(`INSERT INTO wms_zones(organization_id,warehouse_id,code,name) VALUES($1,$2,$3,$4) RETURNING id`,[org,body.warehouseId,body.code,body.name]);
        await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:"WAREHOUSE_ZONE_CREATED",resourceType:"warehouse",resourceId:body.warehouseId,after:{...body,id:created.rows[0].id}});return created.rows[0];
      }
      const body=binCreate.parse(req.body);await requireWarehouse(client,org,user,body.warehouseId);
      const oldWarehouse=await client.query(`SELECT bins FROM warehouses WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[body.warehouseId,org]);
      const oldBins=oldWarehouse.rows[0]?.bins;
      if(oldBins!==null&&!Array.isArray(oldBins))throw new Error("POSITION_INVALID_LEGACY_BINS");
      const existing=(oldBins??[]).filter((entry:{code?:string})=>entry.code?.toLowerCase()===body.code.toLowerCase());
      if(existing.length>1)throw new Error("POSITION_AMBIGUOUS_LEGACY_BIN");
      if(existing.length){
        for(const field of ["aisle","shelf"] as const){
          if(body[field]!==undefined&&existing[0][field]!==undefined&&body[field]!==existing[0][field])throw new Error("POSITION_LEGACY_BIN_CONFLICT");
          body[field]??=existing[0][field];
        }
      }
      const zone=await client.query(`SELECT id FROM wms_zones WHERE id=$1 AND organization_id=$2 AND warehouse_id=$3 AND active`,[body.zoneId,org,body.warehouseId]);if(!zone.rowCount)throw new Error("POSITION_ZONE_NOT_FOUND");
      const created=await client.query(`INSERT INTO wms_bins(organization_id,warehouse_id,zone_id,code,aisle,bay,shelf) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[org,body.warehouseId,body.zoneId,body.code,body.aisle??null,body.bay??null,body.shelf??null]);
      // Keep the existing put-away bin selector compatible; this is not a second item/bin quantity ledger.
      await client.query(`UPDATE warehouses SET bins=COALESCE(bins,'[]'::jsonb)||$1::jsonb WHERE id=$2 AND organization_id=$3 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(bins,'[]'::jsonb)) entry WHERE lower(entry->>'code')=lower($4))`,[JSON.stringify([{code:body.code,aisle:body.aisle,shelf:body.shelf}]),body.warehouseId,org,body.code]);
      await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:"WAREHOUSE_BIN_CREATED",resourceType:"warehouse",resourceId:body.warehouseId,after:{...body,id:created.rows[0].id}});return created.rows[0];
    });sendOk(res,result);
  }));
  app.post("/api/v2/inventory/positions/:id/reconcile",...verify,wrap(async(req,res)=>{
    const body=positionReconcile.parse(req.body),org=getActiveOrganizationId(),user=actor(req),id=positiveId(req.params.id);
    const result=await transaction(async client=>{
      const rows=await client.query(`SELECT * FROM warehouse_inventory WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,org]);const row=rows.rows[0];if(!row)throw new Error("POSITION_NOT_FOUND");
      await requireWarehouse(client,org,user,row.warehouse_id);
      if(String(row.count_revision)!==body.revision)throw new Error("POSITION_STALE_REVISION");
      if(row.quantity<0)throw new Error("POSITION_NEGATIVE_BALANCE");
      const bins=await client.query(`SELECT b.*,s.id AS site_id FROM wms_bins b JOIN wms_zones z ON z.id=b.zone_id AND z.organization_id=b.organization_id AND z.warehouse_id=b.warehouse_id JOIN wms_warehouse_sites ws ON ws.warehouse_id=b.warehouse_id AND ws.organization_id=b.organization_id JOIN mdm_sites s ON s.id=ws.site_id AND s.organization_id=ws.organization_id WHERE b.id=$1 AND b.organization_id=$2 AND b.warehouse_id=$3 AND b.active AND z.active AND s.active`,[body.binId,org,row.warehouse_id]);
      const bin=bins.rows[0];if(!bin)throw new Error("POSITION_ACTIVE_LOCATION_REQUIRED");
      const item=await client.query(`SELECT id FROM inventory_items WHERE id=$1 AND organization_id=$2`,[row.item_id,org]);if(!item.rowCount)throw new Error("POSITION_ITEM_NOT_FOUND");
      const updated=await client.query(`UPDATE warehouse_inventory SET bin=$1,location=$1,aisle=$2,updated_at=now() WHERE id=$3 AND organization_id=$4 RETURNING count_revision::text revision`,[bin.code,bin.aisle,id,org]);
      const evidence=await client.query(`INSERT INTO wms_position_reconciliations(organization_id,position_id,warehouse_id,item_id,bin_id,quantity_snapshot,source_revision,previous_location,reason,verified_by,site_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING id,verified_at AS "verifiedAt"`,[org,id,row.warehouse_id,row.item_id,bin.id,row.quantity,updated.rows[0].revision,JSON.stringify({bin:row.bin,location:row.location,aisle:row.aisle}),body.reason,user,bin.site_id]);
      await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:"INVENTORY_POSITION_RECONCILED",resourceType:"inventory_item",resourceId:row.item_id,reason:body.reason,before:{positionId:id,bin:row.bin,quantity:row.quantity},after:{positionId:id,binId:bin.id,bin:bin.code,quantity:row.quantity,revision:updated.rows[0].revision}});
      return {id,revision:updated.rows[0].revision,evidence:evidence.rows[0],quantityChanged:false};
    });sendOk(res,result);
  }));
  app.get("/api/v2/inventory/positions/:id/history",...read,wrap(async(req,res)=>{
    const org=getActiveOrganizationId(),user=actor(req),id=positiveId(req.params.id),{page,pageSize}=positionQuery.pick({page:true,pageSize:true}).parse(req.query);
    const parent=await pool.query(`SELECT warehouse_id FROM warehouse_inventory WHERE id=$1 AND organization_id=$2 UNION ALL SELECT warehouse_id FROM wms_position_reconciliations WHERE position_id=$1 AND organization_id=$2 LIMIT 1`,[id,org]);
    if(!parent.rowCount)throw new Error("POSITION_NOT_FOUND");
    await requireWarehouse(pool,org,user,parent.rows[0].warehouse_id);
    const rows=await pool.query(`SELECT id::text,bin_id AS "binId",site_id AS "siteId",quantity_snapshot::text AS "quantitySnapshot",source_revision::text AS revision,previous_location AS "previousLocation",reason,verified_by AS "verifiedBy",verified_at AS "verifiedAt" FROM wms_position_reconciliations WHERE organization_id=$1 AND position_id=$2 ORDER BY id DESC LIMIT $3 OFFSET $4`,[org,id,pageSize,(page-1)*pageSize]);
    const total=await pool.query(`SELECT count(*)::int total FROM wms_position_reconciliations WHERE organization_id=$1 AND position_id=$2`,[org,id]);
    sendOk(res,{items:rows.rows,total:total.rows[0].total,page,pageSize});
  }));
}
