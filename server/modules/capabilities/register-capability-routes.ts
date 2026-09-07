import type {Express,RequestHandler} from "express";
import {erpCapabilityCatalog,erpCapabilitySummary} from "@shared/erp-capability-catalog";
import {sendOk} from "../../api-response";
export function registerCapabilityRoutes(app:Express,auth:{ensureAuthenticated:RequestHandler;ensureRole:(roles:string[])=>RequestHandler}){
  app.get("/api/v2/diagnostics/capability-coverage",auth.ensureAuthenticated,auth.ensureRole(["admin"]),(_req,res)=>sendOk(res,{summary:erpCapabilitySummary,items:erpCapabilityCatalog,generatedAt:new Date().toISOString()}));
}
