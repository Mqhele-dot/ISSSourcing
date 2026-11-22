import type {PoolClient} from "pg";
import type {TenantContext} from "../../organization-context";
import {queryRolePermission,queryUserCustomRoleId,queryCustomRolePermission} from "../../services/permission-query-service";

export const documentSources={purchase_order:{table:"purchase_orders",resource:"purchases"},requisition:{table:"purchase_requisitions",resource:"purchases"},
  invoice:{table:"invoices",resource:"finance"},supplier:{table:"suppliers",resource:"suppliers"},warehouse:{table:"warehouses",resource:"warehouses"},contract:{table:"supplier_contracts",resource:"purchases"}} as const;
export type DocumentEntity=keyof typeof documentSources;
export class DocumentAccessError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message);}}
/** One canonical current-role check per resource, not per document. No admin location bypass. */
export async function documentAccess(client:PoolClient,actor:TenantContext,requireDocuments=true,lock=false){
  const membership=await client.query(`SELECT m.application_role::text AS role,u.warehouse_id FROM organization_members m
    JOIN users u ON u.id=m.user_id AND u.active=true JOIN organizations o ON o.id=m.organization_id AND o.active=true
    WHERE m.organization_id=$1 AND m.user_id=$2 AND m.id=$3 AND m.active=true AND m.status='active'${lock?" FOR SHARE OF m,u,o":""}`,[actor.organizationId,actor.userId,actor.membershipId]);
  if(membership.rowCount!==1)throw new DocumentAccessError(403,"DOCUMENT_MEMBERSHIP_DENIED","An active organization membership is required.");
  if(membership.rows[0].warehouse_id!==null)throw new DocumentAccessError(403,"DOCUMENT_SCOPE_UNVERIFIED","Organization-wide document scope cannot be verified for your warehouse assignment. Ask an authorized colleague to review the evidence.");
  const role=String(membership.rows[0].role),custom=role==="custom"?await queryUserCustomRoleId(client,actor.organizationId,actor.userId,lock):null;
  const grants=new Map<string,boolean>();
  async function can(resource:string,action="read"){
    const key=`${resource}:${action}`;if(grants.has(key))return grants.get(key)!;
    const allowed=await queryRolePermission(client,role,resource,action,lock)||!!custom&&await queryCustomRolePermission(client,actor.organizationId,custom,resource,action,lock);
    grants.set(key,allowed);return allowed;
  }
  const documents=await can("documents");
  if(requireDocuments&&!documents)throw new DocumentAccessError(403,"DOCUMENT_READ_DENIED","You need document read access to review this evidence.");
  const types:DocumentEntity[]=[];
  for(const [type,source]of Object.entries(documentSources))if(documents&&await can(source.resource)&& (type!=="invoice"||await can("invoices")))types.push(type as DocumentEntity);
  return {types,documents,can};
}
export function ownedDocumentSql(alias="d"){
  return "("+Object.entries(documentSources).map(([type,{table}])=>`(${alias}.entity_type='${type}' AND EXISTS(SELECT 1 FROM ${table} source WHERE source.organization_id=${alias}.organization_id AND source.id=${alias}.entity_id))`).join(" OR ")+")";
}
