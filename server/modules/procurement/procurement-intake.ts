import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import type { IntakeBlocker, IntakeEvaluation, IntakeNeed, IntakeRoute } from "@shared/procurement-intake";
import type { TenantContext } from "../../organization-context";
import { getCanonicalReportingCurrencyCode } from "../../lib/org-reporting-money";
import { readOrganizationCalendar } from "../../lib/organization-calendar";
import { queryCustomRolePermission, queryRolePermission, queryUserCustomRoleId } from "../../services/permission-query-service";
import { getApprovalWorkflowProgress } from "../../services/approval-workflow-service";
import { applySupplierDefaultsToPurchaseOrder,assertSupplierTransactionAllowed,type SupplierCommercialDefaults } from "./supplier-defaults";
import { normalizeRequisitionLineInput, readRequisitionSourcingPolicy, resolveActiveCurrencyForRequisition,
  validateRequisitionLineMasterDataPolicy } from "./register-procurement-routes";

export class IntakeError extends Error {
  constructor(readonly status:number,readonly code:string,message:string,readonly details?:unknown){super(message);}
}
export const intakeHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function readIntakeAccess(client:PoolClient,actor:TenantContext){
  const {rows:[member]}=await client.query<{role:string;warehouseId:number|null}>(`SELECT m.application_role AS role,u.warehouse_id AS "warehouseId"
    FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active
    JOIN organizations o ON o.id=m.organization_id AND o.active
    WHERE m.organization_id=$1 AND m.user_id=$2 AND m.id=$3 AND m.active AND m.status='active'
    FOR SHARE OF m,u,o`,[actor.organizationId,actor.userId,actor.membershipId]);
  if(!member)throw new IntakeError(403,"INTAKE_PERMISSION_DENIED","An active membership is required to use Smart Intake.");
  const custom=member.role==="custom"?await queryUserCustomRoleId(client,actor.organizationId,actor.userId,true):null;
  const can=async(resource:string,action="read")=>await queryRolePermission(client,member.role,resource,action,true)||
    Boolean(custom&&await queryCustomRolePermission(client,actor.organizationId,custom,resource,action,true));
  if(!await can("purchases"))throw new IntakeError(403,"INTAKE_PERMISSION_DENIED","You need purchase read access to use Smart Intake.");
  return {warehouseId:member.warehouseId,create:await can("purchases","create"),suppliers:await can("suppliers"),inventory:await can("inventory")};
}
export type IntakeAccess=Awaited<ReturnType<typeof readIntakeAccess>>;
const unavailable=(label:string)=>new IntakeError(404,"INTAKE_SOURCE_UNAVAILABLE",`The selected ${label} is not available in your scope.`);

export async function evaluateIntake(client:PoolClient,actor:TenantContext,access:IntakeAccess,need:IntakeNeed){
  const org=actor.organizationId, database=drizzle(client);
  const blockers:IntakeBlocker[]=[],reasons:string[]=[];
  const block=(code:string,state:IntakeBlocker["state"],message:string)=>blockers.push({code,state,message});
  const source=need.source;
  if(source){
    if(access.warehouseId!=null||!access.suppliers)throw unavailable("purchase history");
    const isOrder=source.kind==="order";
    const {rowCount}=await client.query(isOrder?`SELECT id FROM purchase_orders WHERE organization_id=$1 AND id=$2
      AND created_by_user_id=$3 AND upper(approval_status)='APPROVED'`:`SELECT id FROM purchase_requisitions
      WHERE organization_id=$1 AND id=$2 AND requestor_id=$3`,[org,source.id,actor.userId]);
    if(!rowCount)throw unavailable("purchase history");
    reasons.push("This is a new request based on an accessible past purchase. Previous approval and commercial authority are not copied.");
  }
  async function owned<T>(select:string,id:number|undefined,label:string):Promise<T|null>{
    if(id==null)return null;
    const {rows:[row]}=await client.query(select,[org,id]);
    if(!row)throw unavailable(label);
    return row as T;
  }
  type Active={id:number;active:boolean};
  const department=await owned<Active>("SELECT id,active FROM departments WHERE organization_id=$1 AND id=$2",need.departmentId,"department");
  const centre=await owned<Active&{department_id:number|null;gl_account_code:string|null}>(
    "SELECT id,active,department_id,gl_account_code FROM mdm_cost_centres WHERE organization_id=$1 AND id=$2",need.costCentreId,"cost centre");
  const site=await owned<Active&{label:string;default_warehouse_id:number|null;warehouse_valid:boolean}>(
    `SELECT s.id,s.active,s.name AS label,s.default_warehouse_id,(s.default_warehouse_id IS NULL OR w.id IS NOT NULL) AS warehouse_valid
     FROM mdm_sites s LEFT JOIN warehouses w ON w.id=s.default_warehouse_id AND w.organization_id=s.organization_id
     WHERE s.organization_id=$1 AND s.id=$2`,need.siteId,"delivery site");
  if(site&&access.warehouseId!=null&&site.default_warehouse_id!==access.warehouseId)throw unavailable("delivery site");
  if(!department?.active)block("DEPARTMENT_REQUIRED","setup_required","Choose an active department.");
  if(centre&&(!centre.active||(centre.department_id!=null&&centre.department_id!==department?.id)))block("COST_CENTRE_SCOPE","blocked","Choose an active cost centre for the selected department.");
  if((site&&(!site.active||!site.warehouse_valid))||(!site&&access.warehouseId!=null))
    block("DELIVERY_SITE_REQUIRED","setup_required","Choose an active delivery site in your warehouse scope.");
  const calendar=await readOrganizationCalendar(client,org);
  if(need.requiredDate<calendar.today)block("REQUIRED_DATE_PAST","blocked","Choose today or a future delivery date.");
  if(need.itemId&&!access.inventory)throw new IntakeError(403,"INTAKE_PERMISSION_DENIED","Inventory read access is required to use a catalogue reference.");
  const item=await owned<{id:number;name:string;sku:string;status:string;price:number;supplier_id:number|null;unit_of_measure_id:number|null;category_id:number|null;min_order_quantity:number|null}>(
    `SELECT id,name,sku,status,price,supplier_id,unit_of_measure_id,category_id,min_order_quantity
     FROM inventory_items WHERE organization_id=$1 AND id=$2`,need.itemId,"catalogue item");
  if(item?.status?.toLowerCase()!=="active"&&item)block("ITEM_INACTIVE","blocked","This catalogue item is inactive.");
  if(item&&need.quantity<(item.min_order_quantity??1))block("ITEM_MINIMUM_QUANTITY","blocked","Quantity is below the catalogue minimum.");
  const lineType=need.kind==="service"?"SERVICE":item?"CATALOG":"NON_STOCK";
  if(need.kind==="unsure"||(need.kind==="service"&&item))
    block("NEED_CLASSIFICATION_UNVERIFIED","review","Ask Procurement to confirm the goods or service classification.");

  if((need.supplierId||need.contractId)&&!access.suppliers)
    throw new IntakeError(403,"INTAKE_PERMISSION_DENIED","Supplier read access is required to use a supplier or agreement reference.");
  const explicit=await owned<{id:number;supplier_id:number}>("SELECT id,supplier_id FROM supplier_contracts WHERE organization_id=$1 AND id=$2",need.contractId,"agreement");
  const supplierId=need.supplierId??explicit?.supplier_id??item?.supplier_id??undefined;
  const supplier=access.suppliers?await owned<{id:number;name:string;status:string;onboarding_status:string;compliance_status:string|null;
    default_currency_code:string|null;tax_code_id:number|null;expired:boolean}>(
    `SELECT id,name,status,onboarding_status,compliance_status,default_currency_code,tax_code_id,
       (is_once_off AND (once_off_expires_at IS NULL OR once_off_expires_at<=now())) AS expired
     FROM suppliers WHERE organization_id=$1 AND id=$2`,supplierId,"supplier"):null;
  let onboarding=false;
  if(!supplier)block("SUPPLIER_REQUIRED","review","Select an approved supplier, or ask Procurement to identify and review a supplier.");
  else {
    try {
      assertSupplierTransactionAllowed({status:supplier.status,complianceStatus:supplier.compliance_status},"intake drafts");
      if(supplier.status.toLowerCase()!=="active"||supplier.expired)block("INTAKE_SUPPLIER_BLOCKED","blocked","The selected supplier cannot be used for new purchases.");
      else if(supplier.onboarding_status.toLowerCase()!=="approved"){
        onboarding=true;block("SUPPLIER_ONBOARDING_REQUIRED","blocked","Complete the existing supplier onboarding workflow before creating a draft.");
      } else reasons.push(!need.supplierId&&item?.supplier_id===supplier.id ? "The item’s preferred supplier is active and approved." : "The selected supplier is active and approved.");
    }catch{block("INTAKE_SUPPLIER_BLOCKED","blocked","The selected supplier is inactive or blocked for new purchasing.");}
  }
  if(item&&need.kind==="goods")reasons.push(`The need is linked to catalogue item ${item.sku}.`);
  if(need.kind==="service")reasons.push("This need uses a service line; it does not create warehouse stock.");

  const reportCurrency=await getCanonicalReportingCurrencyCode(org,database);
  const commercial:{supplierId?:number;currencyCode?:string;contractId?:number}={supplierId:supplier?.id,currencyCode:need.currency,contractId:need.contractId};
  let defaults:SupplierCommercialDefaults|null=null;
  if(supplier&&!blockers.some(b=>b.code==="INTAKE_SUPPLIER_BLOCKED")){
    try{await applySupplierDefaultsToPurchaseOrder(commercial,{database,observe:value=>{defaults=value;}});}
    catch(error){
      const code=(error as {code?:string}).code;
      if(!code||!code.startsWith("SUPPLIER_"))throw error;
      block("SUPPLIER_COMMERCIAL_SETUP_REQUIRED","setup_required","The selected currency or supplier commercial defaults need review. Use the expert requisition form or ask Procurement to correct the supplier setup; Intake cannot bypass override controls.");
    }
  }
  const currency=commercial.currencyCode??supplier?.default_currency_code?.toUpperCase()??reportCurrency;
  const rate=await resolveActiveCurrencyForRequisition(currency,client);
  if(!rate.ok)block(rate.code,"setup_required",rate.message);
  // The comparable estimate is in the chosen currency. The catalogue's legacy
  // list price is not a verified foreign-currency quote.
  const estimate=need.estimatedValue==null
    ? item&&currency===reportCurrency&&item.price>0 ? Number((item.price*need.quantity).toFixed(4)) : null
    : Number(need.estimatedValue);
  const {policy,threshold}=await readRequisitionSourcingPolicy(org,database);
  const policyIdentity=policy?{id:policy.id,code:policy.code,revision:policy.updatedAt?.toISOString()??null}:null;
  if(policy&&(!Number.isFinite(threshold)||threshold<0))block("SOURCING_THRESHOLD_REQUIRED","setup_required","The active competition policy has no valid threshold. Ask Procurement to configure it.");
  const needTypeMatch=item&&lineType==="CATALOG" || explicit&&lineType!=="CATALOG";
  const {rows:[agreement]}=supplier&&needTypeMatch ? await client.query<{
    id:number;reference:string;version:number;lineId:string;unitPrice:string;currency:string;priceRevision:string|null;
    maximum_value:string|null;committed_value:string;maximum_quantity:string|null;committed_quantity:string;
  }>(`SELECT c.id,COALESCE(NULLIF(c.contract_number,''),NULLIF(c.reference_number,''),c.title) AS reference,
      c.version,l.id::text AS "lineId",COALESCE(p.unit_price,l.unit_price)::text AS "unitPrice",c.currency,
      p.id::text AS "priceRevision",c.maximum_value::text,c.committed_value::text,l.maximum_quantity::text,l.committed_quantity::text
    FROM supplier_contracts c JOIN procurement_feature_settings f ON f.organization_id=c.organization_id AND f.phase2_enabled
    JOIN supplier_contract_lines l ON l.organization_id=c.organization_id AND l.contract_id=c.id
    LEFT JOIN LATERAL (SELECT id,unit_price FROM supplier_contract_price_breaks
      WHERE organization_id=c.organization_id AND contract_line_id=l.id AND minimum_quantity<=$6
      ORDER BY minimum_quantity DESC,id LIMIT 1) p ON true
    WHERE c.organization_id=$1 AND c.supplier_id=$2 AND ($3::int IS NULL OR c.id=$3)
      AND lower(c.contract_type)='blanket' AND c.status='active' AND c.approval_status='APPROVED'
      AND c.start_date<=now() AND (c.end_date IS NULL OR c.end_date>=now()) AND c.currency=$4
      AND l.active AND l.valid_from<=now() AND (l.valid_to IS NULL OR l.valid_to>=now()) AND l.currency_code=c.currency
      AND l.line_type=$5 AND l.item_id IS NOT DISTINCT FROM $7::integer
      AND ($5='CATALOG' OR lower(btrim(l.description))=lower(btrim($8)))
      AND l.minimum_quantity<=$6 AND (l.maximum_quantity IS NULL OR l.committed_quantity+$6<=l.maximum_quantity)
      AND COALESCE(p.unit_price,l.unit_price)>0
      AND (c.maximum_value IS NULL OR c.committed_value+round(COALESCE(p.unit_price,l.unit_price)*$6,4)<=c.maximum_value)
      AND EXISTS (SELECT 1 FROM approval_policies ap WHERE ap.organization_id=c.organization_id AND ap.entity_type='contract_release'
        AND ap.is_active AND round(COALESCE(p.unit_price,l.unit_price)*$6,4)>=COALESCE(ap.amount_min,0)
        AND (ap.amount_max IS NULL OR round(COALESCE(p.unit_price,l.unit_price)*$6,4)<=ap.amount_max))
    ORDER BY c.id,l.line_number,l.id LIMIT 1`,[org,supplier.id,need.contractId??null,currency,lineType,need.quantity,item?.id??null,need.description]) : {rows:[]};
  if(need.contractId&&!agreement)block("INTAKE_CONTRACT_UNAVAILABLE","blocked","This agreement does not currently cover the line, price, capacity, supplier, or release authority. Remove the selection to evaluate other routes.");
  if(agreement)reasons.push(`Agreement ${agreement.reference} has a current priced line and enough remaining capacity. Release still requires separate approval.`);

  const agreementTotal=agreement?Number((Number(agreement.unitPrice)*need.quantity).toFixed(4)):null;
  const highest=Math.max(estimate??0,agreementTotal??0);
  if(highest<=0)block("ESTIMATE_REQUIRED","setup_required","Enter a positive total estimate or select a currently priced item or agreement.");
  const reportingValue=rate.ok?highest*rate.exchangeRateToZar:null;
  const sourcingRequired=Boolean(policy&&Number.isFinite(threshold)&&reportingValue!==null&&reportingValue>=threshold);
  if(sourcingRequired)reasons.push(`The reporting-currency value meets the competition threshold (${reportCurrency} ${threshold}). Obtain the required supplier responses through the existing RFQ workflow.`);
  const base:IntakeRoute=need.kind==="service"?"SERVICE_REQUISITION":item?"CATALOG_REQUISITION":"STANDARD_REQUISITION";
  const route:IntakeRoute=onboarding?"SUPPLIER_ONBOARDING_REQUIRED":blockers.some(b=>b.state==="review")?"MANUAL_PROCUREMENT_REVIEW":
    sourcingRequired?"RFQ_OR_SOURCING":agreement?"CONTRACT_RELEASE":base;
  const draftAmount=(selected:IntakeRoute)=>selected==="CONTRACT_RELEASE"?agreementTotal:selected==="RFQ_OR_SOURCING"?highest:estimate??agreementTotal;
  const approval=await getApprovalWorkflowProgress({organizationId:org,entityType:"requisition",entityId:0,amount:draftAmount(route)??0},database);
  if(approval.state==="not_configured")block("APPROVAL_POLICY_REQUIRED","setup_required","No requisition approval policy covers the proposed draft value. Ask Procurement to configure one.");
  else reasons.push(`The draft will require the existing independent requisition approval workflow (${approval.requiredLevels.length} level${approval.requiredLevels.length===1?"":"s"}). Budget authority is checked by that workflow, not granted by Intake.`);
  const unit=await owned<Active>("SELECT id,active FROM units_of_measure WHERE organization_id=$1 AND id=$2",need.unitId??item?.unit_of_measure_id??undefined,"unit of measure");
  const tax=await owned<Active>("SELECT id,active FROM tax_codes WHERE organization_id=$1 AND id=$2",need.taxId??supplier?.tax_code_id??undefined,"tax code");
  const lineFields={unitOfMeasureId:unit?.id??null,taxCodeId:tax?.id??null,costCentreId:centre?.id??null,glAccountCode:centre?.gl_account_code??null};
  const mdm=await validateRequisitionLineMasterDataPolicy([lineFields],client);
  if(!mdm.ok)for(const issue of mdm.errors)block(issue.code,"setup_required",issue.message.replace(/^Line 1: /,""));
  const alternateApproval=route==="CONTRACT_RELEASE"&&estimate!==null&&estimate>0&&!blockers.length
    ? await getApprovalWorkflowProgress({organizationId:org,entityType:"requisition",entityId:0,amount:estimate},database):null;
  const alternatives:IntakeRoute[]=alternateApproval&&alternateApproval.state!=="not_configured"?[base]:[];
  const proof={item:item&&{id:item.id,sku:item.sku,status:item.status,categoryId:item.category_id},supplier,
    agreement:agreement??null,department,centre,site,unit,tax,policy:policyIdentity,
    thresholds:{competition:Number.isFinite(threshold)?threshold:null,reportingValue,reportCurrency},
    commercialDefaults:defaults,approvalPolicies:approval.applicablePolicyVersions,
    alternativeApprovalPolicies:alternateApproval?.applicablePolicyVersions??[],rate:rate.ok?rate.exchangeRateToZar:null};
  const evaluatedAt=(await client.query<{now:Date}>("SELECT transaction_timestamp() AS now")).rows[0].now.toISOString();
  const view:Omit<IntakeEvaluation,"revision"|"evaluatedAt">={normalized:need,recommendation:route,reasons,blockers,alternatives,
    supplier:supplier&&{id:supplier.id,name:supplier.name},agreement:agreement&&{id:agreement.id,reference:agreement.reference,
      lineId:agreement.lineId,unitPrice:agreement.unitPrice,currency:agreement.currency}||null,
    canCreateDraft:!blockers.length&&access.create,currency,estimatedValue:estimate==null?null:String(estimate),
    requiredNextInformation:blockers.map(b=>b.message),
    sourcing:{required:sourcingRequired,threshold:Number.isFinite(threshold)?threshold:null,minimumResponses:null}};
  const evaluation:IntakeEvaluation={...view,revision:intakeHash([org,actor.userId,view,proof]),evaluatedAt};
  const draftLine=(selected:IntakeRoute)=>{
    const amount=draftAmount(selected);
    const unitPrice=selected==="CONTRACT_RELEASE"?Number(agreement?.unitPrice):Number(amount)/need.quantity;
    return normalizeRequisitionLineInput({...lineFields,itemId:lineType==="CATALOG"?item?.id:null,description:need.description,
      manualEntryReason:need.justification,lineType,quantity:need.quantity,unitPrice},0);
  };
  return {evaluation,proof,draftLine,supplier,site,department,rate,policyIdentity};
}
