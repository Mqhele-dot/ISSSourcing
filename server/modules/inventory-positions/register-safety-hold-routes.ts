import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";

const reason = z.string().trim().min(5).max(2000);
const create = z.object({kind:z.enum(["INSPECTION","QUARANTINE","DAMAGED","BLOCKED"]),reason,requestKey:z.string().uuid()}).strict();
const release = z.object({reason}).strict();
const paging = z.object({page:z.coerce.number().int().positive().default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25)}).strict();
type Auth={ensureAuthenticated:RequestHandler;ensurePermission:(resource:string,action:string)=>RequestHandler};

export function registerSafetyHoldRoutes(app:Express,auth:Auth) {
  for(const command of ["list","create","release"] as const) {
    const handler:RequestHandler=async(req,res)=>{
      const client=await pool.connect();
      try {
        const org=getActiveOrganizationId(),item=z.coerce.number().int().positive().parse(req.params.itemId);
        const user=z.number().int().positive().parse((req as typeof req & {user?:{id:number}}).user?.id);
        await client.query("BEGIN");
        if(command!=="list") {
          // Transitional legacy writers do not all share a transaction. Serialize with
          // their writes and refuse inconsistent aggregates before enabling a hold.
          await client.query("SET LOCAL lock_timeout='3s'");
          await client.query("LOCK TABLE inventory_items, warehouse_inventory IN SHARE ROW EXCLUSIVE MODE");
        }
        const owned=await client.query("SELECT id FROM inventory_items WHERE id=$1 AND organization_id=$2",[item,org]);
        if(!owned.rowCount)throw new Error("SAFETY_ITEM_NOT_FOUND");
        const scope=await client.query(`SELECT u.warehouse_id FROM users u
          JOIN organization_members om ON om.user_id=u.id AND om.organization_id=$2 AND om.active=true AND om.status='active'
          WHERE u.id=$1`,[user,org]);
        // All-warehouse holds require all-warehouse authority, including reading evidence.
        if(!scope.rowCount||scope.rows[0].warehouse_id!==null)throw new Error("SAFETY_ALL_WAREHOUSES_REQUIRED");
        if(command==="list") {
          const q=paging.parse(req.query);
          const result=await client.query(`SELECT h.id::text,h.kind,h.reason,h.created_by AS "createdBy",h.created_at AS "createdAt",r.reason AS "releaseReason",r.released_by AS "releasedBy",r.released_at AS "releasedAt" FROM inventory_safety_holds h LEFT JOIN inventory_safety_releases r ON r.hold_id=h.id WHERE h.organization_id=$1 AND h.item_id=$2 ORDER BY h.id DESC LIMIT $3 OFFSET $4`,[org,item,q.pageSize,(q.page-1)*q.pageSize]);
          const count=await client.query("SELECT count(*)::int total FROM inventory_safety_holds WHERE organization_id=$1 AND item_id=$2",[org,item]);
          await client.query("COMMIT");sendOk(res,{items:result.rows,total:count.rows[0].total,page:q.page,pageSize:q.pageSize});return;
        }
        let holdId:string;
        let evidence:unknown;
        if(command==="create") {
          const body=create.parse(req.body);
          const prior=await client.query("SELECT * FROM inventory_safety_holds WHERE organization_id=$1 AND request_key=$2",[org,body.requestKey]);
          if(prior.rowCount) {
            const row=prior.rows[0];
            if(row.item_id!==item||row.reason!==body.reason||row.kind!==body.kind||row.created_by!==user)throw new Error("SAFETY_IDEMPOTENCY_CONFLICT");
            await client.query("COMMIT");sendOk(res,{id:String(row.id),replayed:true});return;
          }
          const balance=await client.query(`SELECT i.quantity=COALESCE((SELECT sum(w.quantity) FROM warehouse_inventory w WHERE w.organization_id=i.organization_id AND w.item_id=i.id),0) AS consistent FROM inventory_items i WHERE i.id=$1 AND i.organization_id=$2`,[item,org]);
          if(!balance.rows[0].consistent)throw new Error("SAFETY_RECONCILIATION_REQUIRED");
          const row=await client.query("INSERT INTO inventory_safety_holds(organization_id,item_id,kind,reason,created_by,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text",[org,item,body.kind,body.reason,user,body.requestKey]);
          holdId=row.rows[0].id;evidence=body;
        } else {
          const body=release.parse(req.body),id=z.string().regex(/^\d+$/).parse(req.params.holdId);
          const found=await client.query("SELECT * FROM inventory_safety_holds WHERE id=$1 AND organization_id=$2 AND item_id=$3",[id,org,item]);
          if(!found.rowCount)throw new Error("SAFETY_HOLD_NOT_FOUND");
          if(found.rows[0].created_by===user)throw new Error("SAFETY_INDEPENDENT_RELEASE_REQUIRED");
          const prior=await client.query("SELECT * FROM inventory_safety_releases WHERE hold_id=$1",[id]);
          if(prior.rowCount) {
            if(prior.rows[0].released_by!==user||prior.rows[0].reason!==body.reason)throw new Error("SAFETY_ALREADY_RELEASED");
            await client.query("COMMIT");sendOk(res,{id,replayed:true});return;
          }
          await client.query("INSERT INTO inventory_safety_releases(hold_id,reason,released_by) VALUES($1,$2,$3)",[id,body.reason,user]);
          holdId=id;evidence=body;
        }
        await client.query(`UPDATE inventory_items SET safety_hold=EXISTS(SELECT 1 FROM inventory_safety_holds h WHERE h.organization_id=$1 AND h.item_id=$2 AND NOT EXISTS(SELECT 1 FROM inventory_safety_releases r WHERE r.hold_id=h.id)) WHERE organization_id=$1 AND id=$2`,[org,item]);
        await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:command==="create"?"ITEM_SAFETY_HOLD_CREATED":"ITEM_SAFETY_HOLD_RELEASED",resourceType:"inventory_item",resourceId:item,after:{holdId,evidence,scope:"all_warehouses"}});
        await client.query("INSERT INTO event_outbox(organization_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'inventory_item',$2,$3,$4::jsonb)",[org,String(item),command==="create"?"ITEM_SAFETY_HOLD_CREATED":"ITEM_SAFETY_HOLD_RELEASED",JSON.stringify({itemId:item,holdId,actorId:user,targetPath:"/inventory/positions"})]);
        await client.query("COMMIT");sendOk(res,{id:holdId,scope:"all_warehouses"});
      } catch(error) {
        await client.query("ROLLBACK");
        const message=error instanceof Error?error.message:"",code=(error as {code?:string}).code;
        if(error instanceof z.ZodError){sendError(res,400,"INVALID_SAFETY_REQUEST","Check the hold fields.");return;}
        if(code==="42P01"||code==="42703"){sendError(res,503,"SAFETY_MIGRATION_REQUIRED","Apply the safety-hold migration before using this operation.");return;}
        if(code==="55P03"||code==="40P01"){sendError(res,409,"SAFETY_STOCK_BUSY","Stock is changing. Refresh and retry.");return;}
        if(message.startsWith("SAFETY_")){sendError(res,message.endsWith("NOT_FOUND")?404:message.includes("INDEPENDENT")||message.includes("ALL_WAREHOUSES")?403:409,message,message.replaceAll("_"," "));return;}
        sendError(res,500,"SAFETY_OPERATION_FAILED","Safety operation failed; all changes rolled back.");
      } finally {client.release();}
    };
    const path="/api/v2/inventory/items/:itemId/safety-holds";
    const guards=[auth.ensureAuthenticated,auth.ensurePermission("inventory",command==="list"?"read":"approve")];
    if(command==="list")app.get(path,...guards,handler);
    else app.post(command==="release"?`${path}/:holdId/release`:path,...guards,handler);
  }
}
