import type {Express,RequestHandler} from "express";
import {erpCapabilityCatalog,erpCapabilitySummary} from "@shared/erp-capability-catalog";
import {sendOk} from "../../api-response";
import {pool} from "../../db";
import {getActiveOrganizationId} from "../../organization-context";
export function registerCapabilityRoutes(app:Express,auth:{ensureAuthenticated:RequestHandler;ensureRole:(roles:string[])=>RequestHandler}){
  app.get("/api/v2/diagnostics/capability-coverage",auth.ensureAuthenticated,auth.ensureRole(["admin"]),async(_req,res)=>{
    const organizationId=getActiveOrganizationId();
    const settings=await pool.query(`SELECT phase1_enabled AS "phase1Enabled",phase2_enabled AS "phase2Enabled",phase3_enabled AS "phase3Enabled",phase4_enabled AS "phase4Enabled",updated_at AS "verifiedAt" FROM procurement_feature_settings WHERE organization_id=$1`,[organizationId]);
    const flags=settings.rows[0]??{};
    const flagValue=(flag:string|null)=>flag==="procurement.phase2Enabled"?flags.phase2Enabled:flag==="procurement.phase3Enabled"?flags.phase3Enabled:flag==="procurement.phase4Enabled"?flags.phase4Enabled:true;
    const verifiedAt=flags.verifiedAt?new Date(flags.verifiedAt).toISOString():null;
    const items=erpCapabilityCatalog.map(item=>item.featureFlag&&!flagValue(item.featureFlag)?{...item,status:"disabled" as const,verifiedAt}:item.evidence.length?{...item,verifiedAt}:item);
    const summary={...erpCapabilitySummary,implemented:items.filter(x=>x.status==="implemented").length,partial:items.filter(x=>x.status==="partial").length,missing:items.filter(x=>x.status==="missing").length,disabled:items.filter(x=>x.status==="disabled").length};
    return sendOk(res,{summary,items,generatedAt:new Date().toISOString()});
  });
}
