import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";

const patch = z.object({required:z.boolean(),revision:z.number().int().nonnegative(),reason:z.string().trim().min(5).max(2000)}).strict();
type Auth={ensureAuthenticated:RequestHandler;ensurePermission:(resource:string,action:string)=>RequestHandler};
export function registerInspectionRuleRoutes(app:Express,auth:Auth) {
  const handler:RequestHandler=async(req,res)=>{
    const client=await pool.connect();
    try {
      const org=getActiveOrganizationId(),type=z.enum(["item","supplier"]).parse(req.params.subjectType);
      const id=z.coerce.number().int().positive().parse(req.params.subjectId);
      const user=z.number().int().positive().parse((req as typeof req & {user?:{id:number}}).user?.id);
      const write=req.method==="PUT";
      const body=write?patch.parse(req.body):undefined;
      await client.query("BEGIN");
      if(write) {
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:inspection-policy`]);
      }
      const table=type==="item"?"inventory_items":"suppliers";
      const owned=await client.query(`SELECT id FROM ${table} WHERE organization_id=$1 AND id=$2`,[org,id]);
      if(!owned.rowCount){await client.query("ROLLBACK");sendError(res,404,"INSPECTION_SUBJECT_NOT_FOUND","Item or supplier not found.");return;}
      const scope=await client.query(`SELECT u.warehouse_id FROM users u
        JOIN organization_members om ON om.user_id=u.id AND om.organization_id=$1 AND om.active=true AND om.status='active'
        WHERE u.id=$2`,[org,user]);
      if(!scope.rowCount||scope.rows[0].warehouse_id!==null){await client.query("ROLLBACK");sendError(res,403,"INSPECTION_SCOPE_DENIED","All-warehouse access is required for organization-wide inspection rules.");return;}
      const prior=await client.query("SELECT required,revision,reason FROM inventory_inspection_rules WHERE organization_id=$1 AND subject_type=$2 AND subject_id=$3",[org,type,id]);
      const current=prior.rows[0]??{required:false,revision:0,reason:null};
      if(!body){await client.query("COMMIT");sendOk(res,{...current,scope:"item_wide",configured:Boolean(prior.rowCount)});return;}
      if(current.revision!==body.revision){await client.query("ROLLBACK");sendError(res,409,"INSPECTION_RULE_STALE","This rule changed. Reload it before saving.");return;}
      const saved=await client.query(`INSERT INTO inventory_inspection_rules(organization_id,subject_type,subject_id,required,reason,updated_by)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,subject_type,subject_id) DO UPDATE SET required=EXCLUDED.required,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now(),revision=inventory_inspection_rules.revision+1 RETURNING required,revision,reason`,[org,type,id,body.required,body.reason,user]);
      await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:user},action:"INSPECTION_RULE_CHANGED",resourceType:type,resourceId:id,before:current,after:saved.rows[0]});
      await client.query("COMMIT");sendOk(res,{...saved.rows[0],scope:"item_wide",configured:true});
    }catch(error){
      await client.query("ROLLBACK");
      if(error instanceof z.ZodError){sendError(res,400,"INVALID_INSPECTION_RULE","Check the inspection rule and reason.");return;}
      const code=(error as {code?:string}).code;
      if(code==="42P01"){sendError(res,503,"INSPECTION_MIGRATION_REQUIRED","Apply the receipt inspection migration first.");return;}
      if(code==="55P03"||code==="40P01"){sendError(res,409,"INSPECTION_RULE_BUSY","Receipt or policy changes are in progress. Retry.");return;}
      sendError(res,500,"INSPECTION_RULE_FAILED","Inspection rule was not saved; changes rolled back.");
    }finally{client.release();}
  };
  const path="/api/v2/inventory/inspection-rules/:subjectType/:subjectId";
  app.get(path,auth.ensureAuthenticated,auth.ensurePermission("inventory","read"),handler);
  app.put(path,auth.ensureAuthenticated,auth.ensurePermission("inventory","approve"),handler);
}
