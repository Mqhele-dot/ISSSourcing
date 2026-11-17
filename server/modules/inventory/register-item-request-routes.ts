import type { Express,RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError,sendOk } from "../../api-response";
import { requestInventoryItem } from "./item-request-service";
type Auth={ensureAuthenticated:RequestHandler;ensurePermission:(resource:string,action:string)=>RequestHandler};
export function registerItemRequestRoutes(app:Express,auth:Auth) {
  const guards=[auth.ensureAuthenticated,auth.ensurePermission("stock_movements","execute")];
  app.post('/api/v2/inventory/item-requests',...guards,async(req,res)=>{
    try {
      const actor=z.number().int().positive().parse((req as typeof req&{user?:{id:number}}).user?.id);
      sendOk(res,await requestInventoryItem(getActiveOrganizationId(),actor,req.body),201);
    }catch(error){
      if(error instanceof z.ZodError){sendError(res,400,'INVALID_ITEM_REQUEST','Supply a SKU, item name and reason. Stock quantities and master-data defaults cannot be requested here.');return;}
      const message=error instanceof Error?error.message:'';
      if(message.startsWith('ITEM_REQUEST_')){sendError(res,409,message,message.replaceAll('_',' '));return;}
      sendError(res,500,'ITEM_REQUEST_FAILED','Request was not saved. All changes rolled back.');
    }
  });
  app.get('/api/v2/inventory/item-requests',...guards,async(req,res)=>{
    try {
      const actor=z.number().int().positive().parse((req as typeof req&{user?:{id:number}}).user?.id);
      const q=z.object({page:z.coerce.number().int().positive().default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25)}).strict().parse(req.query);
      const org=getActiveOrganizationId();
      const result=await pool.query(`SELECT id,status,entity_id AS "itemId",proposed_patch->>'sku' AS sku,proposed_patch->>'name' AS name,created_at AS "createdAt" FROM mdm_change_requests WHERE organization_id=$1 AND submitted_by=$2 AND domain='items' AND action='create' ORDER BY id DESC LIMIT $3 OFFSET $4`,[org,actor,q.pageSize,(q.page-1)*q.pageSize]);
      const count=await pool.query("SELECT count(*)::int total FROM mdm_change_requests WHERE organization_id=$1 AND submitted_by=$2 AND domain='items' AND action='create'",[org,actor]);
      sendOk(res,{items:result.rows,total:count.rows[0].total,page:q.page,pageSize:q.pageSize});
    }catch(error){sendError(res,error instanceof z.ZodError?400:500,'ITEM_REQUEST_LIST_FAILED','Could not load your item requests.');}
  });
}
