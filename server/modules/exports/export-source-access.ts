import {pool} from "../../db";
import {storage} from "../../storage";
import {getTenantContext} from "../../organization-context";
import {assertExportActorAccess} from "./export-actor-access";
import {exportSourceResources} from "../../../shared/export-source-access";
import type {RequestHandler} from "express";
import {sendError} from "../../api-response";

export async function filterExportHistoryForAccess<T extends {dataset:string;filters:Record<string,unknown>}>(rows:T[]):Promise<T[]>{
  const tenant=getTenantContext();
  if(tenant.userRole==="admin")return rows;
  const resources=[...new Set(rows.flatMap(row=>exportSourceResources(row.dataset,row.filters)??[]))];
  const customRole=tenant.userRole==="custom"?await storage.getUserCustomRoleId(tenant.userId):null;
  const allowed=new Set<string>();
  await Promise.all(resources.map(async resource=>{
    // PostgreSQL expects the enum value, not the TypeScript enum key.
    if(await storage.checkPermission(tenant.userRole,resource,"read")||customRole&&await storage.checkCustomRolePermission(customRole,resource as Parameters<typeof storage.checkCustomRolePermission>[1],"read" as Parameters<typeof storage.checkCustomRolePermission>[2]))allowed.add(resource);
  }));
  return rows.filter(row=>{const required=exportSourceResources(row.dataset,row.filters);return required!==null&&required.every(resource=>allowed.has(resource));});
}

export function requireExportSource(auth:{ensurePermission:(resource:string,action:string)=>RequestHandler},dataset:string,filters:Record<string,unknown>={}):RequestHandler{
  return(req,res,next)=>{
    const sources=exportSourceResources(dataset,filters);
    if(!sources)return sendError(res,400,"EXPORT_DATASET_UNSUPPORTED","Choose a supported export dataset.");
    const resources=["reports",...sources];
    const check=(index:number):void=>{
      if(index===resources.length){next();return;}
      auth.ensurePermission(resources[index],"read")(req,res,()=>check(index+1));
    };
    check(0);
  };
}

/** Recheck the real requester, not the privileged internal transport identity. */
export async function assertCurrentExportActor(organizationId:number,userId:number,dataset:string,filters:Record<string,unknown>={}){
  await assertExportActorAccess(pool,{organizationId,userId,dataset,filters});
}
