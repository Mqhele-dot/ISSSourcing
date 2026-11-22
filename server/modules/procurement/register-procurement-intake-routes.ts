import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { z } from "zod";
import { intakeConvertSchema,intakeNeedSchema,intakeOptionKinds,type IntakeOptionKind } from "@shared/procurement-intake";
import { pool } from "../../db";
import { sendError,sendOk } from "../../api-response";
import { getTenantContext } from "../../organization-context";
import { appendAuditEventWithClient } from "../../services/audit-chain-client";
import { evaluateIntake,intakeHash,IntakeError,readIntakeAccess,type IntakeAccess } from "./procurement-intake";
import { writeRequisitionDraft } from "./requisition-draft-writer";
import type { AuthBundle } from "./types";

const optionSource:Record<IntakeOptionKind,{from:string;label:string;where:string;requires?:"inventory"|"suppliers"}>={
  departments:{from:"departments s",label:"s.name",where:"s.active"},
  costCentres:{from:"mdm_cost_centres s",label:"s.name",where:"s.active AND ($4::int IS NULL OR s.department_id IS NULL OR s.department_id=$4)"},
  sites:{from:"mdm_sites s",label:"s.name",where:"s.active AND ($5::int IS NULL OR s.default_warehouse_id=$5)"},
  items:{from:"inventory_items s",label:"s.sku || ' — ' || s.name",where:"lower(s.status)='active'",requires:"inventory"},
  suppliers:{from:"suppliers s",label:"s.name",where:"lower(s.status) IN ('active','blocked','inactive')",requires:"suppliers"},
  contracts:{from:"supplier_contracts s",label:"coalesce(nullif(s.contract_number,''),s.title)",where:"lower(s.contract_type)='blanket' AND s.status='active' AND s.approval_status='APPROVED' AND s.start_date<=now() AND (s.end_date IS NULL OR s.end_date>=now())",requires:"suppliers"},
  units:{from:"units_of_measure s",label:"s.name",where:"s.active"},
  taxes:{from:"tax_codes s",label:"s.name",where:"s.active"},
};
const querySchema=z.object({kind:z.enum(intakeOptionKinds),search:z.string().trim().max(80).default(""),
  page:z.coerce.number().int().min(1).max(1000).default(1),departmentId:z.coerce.number().int().positive().max(2147483647).optional()}).strict();
const sourceKind=z.enum(["requisition","order"]);
const sourceId=z.coerce.number().int().positive().max(2147483647);
const keySchema=z.string().trim().min(1).max(128);

// One snapshot also protects the capture from concurrent source edits and
// enables a clean retry if a same-key transaction won while we were waiting.
async function transact<T>(work:(client:PoolClient)=>Promise<T>,retry=false):Promise<T>{
  for(let attempt=0;;attempt++){
    const client=await pool.connect();
    try{
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SET LOCAL statement_timeout='5s'");
      const result=await work(client);
      await client.query("COMMIT");return result;
    }catch(error){
      await client.query("ROLLBACK").catch(()=>undefined);
      const failure=error as {code?:string;constraint?:string};
      if(retry&&attempt<2&&(["40001","40P01"].includes(failure.code??"")||
        failure.code==="23505"&&failure.constraint==="workflow_idempotency_org_key_uidx"))continue;
      throw error;
    }finally{client.release();}
  }
}

export function registerProcurementIntakeRoutes(app:Express,auth:AuthBundle){
  const root="/api/v2/procurement/intake", read=[auth.ensureAuthenticated,auth.ensurePermission("purchases","read")];
  const request=(fn:(client:PoolClient,req:Request,res:Response,access:IntakeAccess)=>Promise<{data:unknown;status?:number}>, retry=false)=>
    async(req:Request,res:Response)=>{
      if(process.env.NODE_ENV==="production"&&process.env.ENABLE_SMART_PROCUREMENT_INTAKE!=="true")
        return sendError(res,503,"INTAKE_NOT_ENABLED","Smart Intake has not been enabled. Use the existing requisition form.");
      try{
        const actor=getTenantContext();
        const result=await transact(async client=>fn(client,req,res,await readIntakeAccess(client,actor)),retry);
        res.setHeader("Cache-Control","private, no-store");
        return sendOk(res,result.data,result.status);
      }catch(error){
        if(error instanceof z.ZodError)return sendError(res,400,"INTAKE_INVALID","Check the required fields and choose valid values.",{fieldIssues:error.flatten().fieldErrors});
        if(error instanceof IntakeError)return sendError(res,error.status,error.code,error.message,{details:error.details});
        console.warn("Intake command failed",{requestId:res.locals.requestId,kind:(error as {code?:string})?.code??"intake_internal"});
        return sendError(res,503,"INTAKE_CONVERSION_FAILED","Smart Intake is temporarily unavailable. No incomplete draft was saved; retry.");
      }
    };

  app.get(root+"/context",...read,request(async(_client,_req,_res,access)=>{
    const actor=getTenantContext();
    return {data:{...access,organizationId:actor.organizationId,userId:actor.userId}};
  }));
  app.get(root+"/options",...read,request(async(client,req,_res,access)=>{
    const q=querySchema.parse(req.query), source=optionSource[q.kind];
    if(source.requires&&!access[source.requires])throw new IntakeError(403,"INTAKE_PERMISSION_DENIED","You cannot view this source register.");
    const org=getTenantContext().organizationId;
    const {rows}=await client.query(`SELECT id,label FROM (
      SELECT s.id,${source.label} AS label FROM ${source.from} WHERE s.organization_id=$1 AND ${source.where}
      AND ($4::int IS NULL OR $4::int>0) AND ($5::int IS NULL OR $5::int>0)
    ) p WHERE ($2='' OR strpos(lower(label),lower($2))>0) ORDER BY label,id LIMIT 26 OFFSET $3`,
    [org,q.search,(q.page-1)*25,q.departmentId??null,access.warehouseId]);
    return {data:{items:rows.slice(0,25),hasNext:rows.length>25}};
  }));
  app.get(root+"/recent",...read,request(async(client,_req,_res,access)=>{
    if(access.warehouseId!=null||!access.suppliers)return {data:{items:[],limited:true}};
    const {organizationId,userId}=getTenantContext();
    const {rows}=await client.query(`WITH recent AS (
      (SELECT 'requisition' kind,r.id,r.requisition_number label,r.updated_at AS changed
       FROM purchase_requisitions r WHERE r.organization_id=$1 AND r.requestor_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 12)
      UNION ALL
      (SELECT 'order',p.id,p.order_number,p.updated_at FROM purchase_orders p
       WHERE p.organization_id=$1 AND p.created_by_user_id=$2 AND upper(p.approval_status)='APPROVED' ORDER BY updated_at DESC,id DESC LIMIT 12)
    ) SELECT recent.*,count(*) OVER (PARTITION BY kind,ln.item_id) AS frequency,ln.item_id AS "itemId"
    FROM recent LEFT JOIN LATERAL (
      SELECT i.item_id FROM purchase_requisition_items i WHERE recent.kind='requisition' AND i.requisition_id=recent.id
      UNION ALL SELECT i.item_id FROM purchase_order_items i WHERE recent.kind='order' AND i.order_id=recent.id LIMIT 1
    ) ln ON true ORDER BY changed DESC NULLS LAST,kind,id DESC`,[organizationId,userId]);
    return {data:{items:rows,limited:false}};
  }));
  app.get(root+"/recent/:kind/:id",...read,request(async(client,req,_res,access)=>{
    const kind=sourceKind.parse(req.params.kind),id=sourceId.parse(req.params.id),actor=getTenantContext();
    if(access.warehouseId!=null||!access.suppliers)throw new IntakeError(403,"INTAKE_PERMISSION_DENIED","This history is outside your current location or supplier scope.");
    const header=kind==="order"?"purchase_orders":"purchase_requisitions",lines=kind==="order"?"purchase_order_items":"purchase_requisition_items";
    const owner=kind==="order"?"created_by_user_id":"requestor_id",fk=kind==="order"?"order_id":"requisition_id";
    const {rows}=await client.query(`SELECT h.id,h.supplier_id,h.department_id,h.currency_code,l.item_id,l.line_type,
      COALESCE(NULLIF(btrim(l.description),''),catalogue.name,'') AS description,
      l.quantity,l.unit_of_measure_id,l.tax_code_id,l.cost_centre_id
      FROM ${header} h LEFT JOIN ${lines} l ON l.${fk}=h.id
      LEFT JOIN inventory_items catalogue ON catalogue.id=l.item_id AND catalogue.organization_id=h.organization_id AND $4::boolean
      WHERE h.organization_id=$1 AND h.${owner}=$2 AND h.id=$3
      ${kind==="order"?"AND upper(h.approval_status)='APPROVED'":""} ORDER BY l.id LIMIT 2`,[actor.organizationId,actor.userId,id,access.inventory]);
    if(!rows.length)throw new IntakeError(404,"INTAKE_SOURCE_UNAVAILABLE","That purchase history is not available to you.");
    const row=rows[0];
    if(rows.length!==1||row.quantity==null||row.item_id&&!access.inventory)return {data:{requiresExpert:true}};
    return {data:{requiresExpert:false,need:{description:row.description??"",kind:row.line_type==="SERVICE"?"service":"goods",
      quantity:row.quantity,supplierId:row.supplier_id??undefined,departmentId:row.department_id??undefined,currency:row.currency_code,
      itemId:row.item_id??undefined,unitId:row.unit_of_measure_id??undefined,taxId:row.tax_code_id??undefined,
      costCentreId:row.cost_centre_id??undefined,source:{kind,id}}}};
  }));
  app.post(root+"/evaluate",...read,request(async(client,req,_res,access)=>{
    const need=intakeNeedSchema.parse(req.body);
    return {data:(await evaluateIntake(client,getTenantContext(),access,need)).evaluation};
  }));
  app.post(root+"/convert",...read,auth.ensurePermission("purchases","create"),request(async(client,req,res,access)=>{
    const actor=getTenantContext(),org=actor.organizationId;
    if(!access.create)throw new IntakeError(403,"INTAKE_PERMISSION_DENIED","Purchase creation access is required to create a draft.");
    const input=intakeConvertSchema.parse(req.body),key=keySchema.parse(req.get("Idempotency-Key"));
    const hash=intakeHash([actor.userId,input]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`intake:${org}:${key}`]);
    const prior=await client.query(`SELECT w.action,w.response,r.id FROM workflow_idempotency w LEFT JOIN purchase_requisitions r
      ON r.organization_id=w.organization_id AND r.id=w.resource_id AND r.requestor_id=$3
      WHERE w.organization_id=$1 AND w.idempotency_key=$2`,[org,key,actor.userId]);
    if(prior.rowCount){
      const row=prior.rows[0];
      if(row.action!=="INTAKE_CONVERT"||row.response?.hash!==hash||!row.id)throw new IntakeError(409,"INTAKE_RETRY_CONFLICT","This retry key belongs to a different or unavailable draft request.");
      return {data:{id:row.id,route:input.route,replayed:true}};
    }
    const current=await evaluateIntake(client,actor,access,input.need);
    const e=current.evaluation;
    if(e.revision!==input.revision)throw new IntakeError(409,"INTAKE_RECOMMENDATION_CHANGED","The recommendation changed. Review the current reasons before creating a draft.",e);
    if(!e.canCreateDraft||(e.recommendation!==input.route&&!e.alternatives.includes(input.route))||!current.supplier||!current.department||!current.rate.ok)
      throw new IntakeError(409,"INTAKE_DRAFT_BLOCKED","Resolve the blockers before creating a draft.",e);
    const next=input.route==="RFQ_OR_SOURCING"?"After independent requisition approval, start the linked RFQ workflow."
      : input.route==="CONTRACT_RELEASE" ? `After requisition approval, review agreement ${e.agreement?.reference} before any release.`:"Review and submit this draft through the requisition workflow.";
    const draft=await writeRequisitionDraft(drizzle(client),org,{
      organizationId:org,requestorId:actor.userId,requisitionNumber:`REQ-INT-${randomUUID().slice(0,12).toUpperCase()}`,
      supplierId:current.supplier.id,departmentId:current.department.id,currencyCode:e.currency,exchangeRateToZar:current.rate.exchangeRateToZar,
      requiredDate:new Date(input.need.requiredDate+"T00:00:00Z"),justification:input.need.justification,
      notes:[next,current.site?`Requested delivery site: ${current.site.label} (#${current.site.id}).`:null].filter(Boolean).join("\n"),
    },[current.draftLine(input.route)]);
    await appendAuditEventWithClient(client,{organizationId:org,actor:{userId:actor.userId},action:"INTAKE_CONVERTED",
      resourceType:"purchase_requisition",resourceId:draft.id,requestId:res.locals.requestId,ipAddress:req.ip,
      after:{status:"DRAFT",draftId:draft.id},details:{route:input.route,recommended:e.recommendation,reasons:e.reasons,
        revision:e.revision,evaluatedAt:e.evaluatedAt,need:input.need,decision:current.proof}});
    await client.query(`INSERT INTO workflow_idempotency (organization_id,idempotency_key,action,resource_type,resource_id,response)
      VALUES($1,$2,'INTAKE_CONVERT','purchase_requisition',$3,$4::jsonb)`,[org,key,draft.id,JSON.stringify({hash})]);
    return {status:201,data:{id:draft.id,route:input.route,replayed:false}};
  },true));
}
