import type {PoolClient} from "pg";
import {getTenantContext} from "../../organization-context";
import {documentAccess,DocumentAccessError} from "../documents/document-access";
import {GovernanceError} from "../rbac/governance-context";
import {spendMeasures,spendSourceResources} from "@shared/spend-cube";
export async function assertSpendAccess(c:PoolClient,org:number,measure:string,exporting=false){
 const actor=getTenantContext();
 if(actor.organizationId!==org)throw new GovernanceError("SPEND_ACCESS_DENIED","This observation is unavailable in the active organization.",403);
 let access;
 try{access=await documentAccess(c,actor,false,true);}catch(error){if(!(error instanceof DocumentAccessError))throw error;throw new GovernanceError("SPEND_ACCESS_DENIED","Active unrestricted organization access is required. Warehouse-filtered Spend Cube observations are not supported.",403);}
 for(const resource of spendSourceResources(measure))if(!await access.can(resource))throw new GovernanceError("SPEND_ACCESS_DENIED","Current reporting, supplier, purchasing, Master Data and relevant Finance/inventory access is required to read these dimensions.",403);
 if(exporting&&!await access.can("reports","export"))throw new GovernanceError("SPEND_EXPORT_DENIED","Reporting export permission is required.",403);
 return actor;
}
export async function assertSpendRunRead(c:PoolClient,org:number,measure:string,summary:Record<string,unknown>){
 if(summary.spendCubeVersion!==1)return;
 if(!(spendMeasures as readonly string[]).includes(measure))throw new GovernanceError("SPEND_SCOPE_UNSUPPORTED","This saved cube uses an unsupported measure.",409);
 await assertSpendAccess(c,org,measure);
}
