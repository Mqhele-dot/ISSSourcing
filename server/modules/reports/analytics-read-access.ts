import {storage} from "../../storage";
import {getTenantContext} from "../../organization-context";
import {analyticsResources,type AnalyticsReadAccess} from "../../../shared/analytics-source-access";

/** Uses the same role and custom-role checks as the canonical auth middleware. */
export async function resolveAnalyticsReadAccess():Promise<AnalyticsReadAccess> {
  const actor=getTenantContext();
  if(actor.userRole==="admin")return Object.fromEntries(analyticsResources.map(resource=>[resource,true]));
  const customRole=actor.userRole==="custom"?await storage.getUserCustomRoleId(actor.userId):null;
  return Object.fromEntries(await Promise.all(analyticsResources.map(async resource=>[resource,
    await storage.checkPermission(actor.userRole,resource,"read")||Boolean(customRole&&await storage.checkCustomRolePermission(customRole,
      resource as unknown as Parameters<typeof storage.checkCustomRolePermission>[1],"read" as unknown as Parameters<typeof storage.checkCustomRolePermission>[2]))])));
}
