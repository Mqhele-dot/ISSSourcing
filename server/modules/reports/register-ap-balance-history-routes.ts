import type { Express,RequestHandler,Response } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { sendError,sendOk,resolveRequestId } from "../../api-response";
import { getActiveOrganizationId,getTenantContext } from "../../organization-context";
import { recordServerDiagnosticEvent } from "../../diagnostics/server-diagnostics-store";
import { prepareApBaseline,prepareApCorrection,transitionApBaseline } from "./ap-balance-baseline-service";

type Auth={ensureAuthenticated:RequestHandler;ensureTwoFactorAuthenticated:RequestHandler;ensurePermission:(resource:string,action:string)=>RequestHandler};
const pageQuery=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25)}).strict();
function failed(res:Response,error:unknown) {
  const e=error as {status?:number;code?:string;message?:string};
  if(e.code?.startsWith("AP_BASELINE_")) return sendError(res,e.status??409,e.code,e.message??"Review this opening baseline before continuing.");
  if(e.code&&["APPROVAL_POLICY_NOT_CONFIGURED","APPROVAL_LIMIT_EXCEEDED","INDEPENDENT_APPROVER_REQUIRED","APPROVER_USER_REQUIRED","APPROVER_ROLE_REQUIRED","APPROVAL_WORKFLOW_COMPLETE"].includes(e.code))
    return sendError(res,e.status??409,e.code,e.message??"Review the configured approval policy before continuing.");
  recordServerDiagnosticEvent({source:"request",severity:"error",title:"AP balance history unavailable",message:"Verify the AP balance-history migration and source evidence, then retry.",route:"/api/v2/ap/balance-baselines",status:503,details:{organizationId:getActiveOrganizationId(),requestId:resolveRequestId(res),requiredMigration:"20261025090000_ap_balance_history.sql"}});
  return sendError(res,503,"AP_HISTORY_UNAVAILABLE","AP balance history is not ready. Ask an administrator to verify its migration and retry.");
}

export function registerApBalanceHistoryRoutes(app:Express,auth:Auth) {
  const read=[auth.ensureAuthenticated,auth.ensurePermission("finance","read"),auth.ensurePermission("reports","read")];
  app.post("/api/v2/ap/balance-corrections",...read,auth.ensurePermission("finance","create"),auth.ensureTwoFactorAuthenticated,async(req,res)=>{
    const p=z.object({invoiceId:z.number().int().positive(),targetEventId:z.string().regex(/^[1-9][0-9]{0,18}$/),patch:z.record(z.string(),z.union([z.string().max(128),z.null()])),documentIds:z.array(z.number().int().positive()).min(1).max(20),reason:z.string().trim().min(1).max(1000)}).strict().safeParse(req.body);
    if(!p.success) return sendError(res,400,"AP_BASELINE_INVALID_CORRECTION","Choose an invoice event, reason, verified supporting documents and supported corrected values.");
    try {const actor=getTenantContext();return sendOk(res,await prepareApCorrection({...p.data,organizationId:actor.organizationId,actorUserId:actor.userId,actorRole:actor.userRole}),201);}catch(e){return failed(res,e);}
  });
  app.get("/api/v2/ap/balance-baseline-candidates",...read,async(req,res)=>{
    const p=pageQuery.safeParse(req.query);
    if(!p.success) return sendError(res,400,"INVALID_PAGE","Choose a page size of 25, 50 or 100.");
    try {
      const {page,pageSize}=p.data,org=getActiveOrganizationId();
      const where=`i.organization_id=$1 AND i.supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ap_balance_events e WHERE e.organization_id=i.organization_id AND e.invoice_id=i.id AND (e.event_kind='OPENING_BASELINE' OR (e.event_kind='CREATED' AND e.actor_user_id IS NOT NULL)))`;
      const items=await pool.query(`SELECT i.id,i.invoice_number AS "invoiceNumber",i.currency_code AS "currencyCode",i.total::numeric::text AS total,i.paid_amount::numeric::text AS "paidAmount",i.due_amount::numeric::text AS "remainingBalance",i.status::text FROM invoices i WHERE ${where} ORDER BY i.id LIMIT $2 OFFSET $3`,[org,pageSize,(page-1)*pageSize]);
      const count=await pool.query(`SELECT count(*)::int total FROM invoices i WHERE ${where}`,[org]);
      return sendOk(res,{items:items.rows,total:count.rows[0].total,page,pageSize});
    }catch(e){return failed(res,e);}
  });
  app.get("/api/v2/ap/balance-baselines",...read,async(req,res)=>{
    const parsed=pageQuery.safeParse(req.query);
    if(!parsed.success) return sendError(res,400,"INVALID_PAGE","Choose a page size of 25, 50 or 100.");
    try {
      const {page,pageSize}=parsed.data,org=getActiveOrganizationId();
      const rows=await pool.query(`SELECT id,status,reason,request_kind AS "requestKind",target_event_id::text AS "targetEventId",created_by AS "createdBy",submitted_by AS "submittedBy",approved_by AS "approvedBy",created_at AS "createdAt",applied_at AS "appliedAt",jsonb_array_length(proposal) AS "invoiceCount"
        FROM ap_balance_baselines WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,[org,pageSize,(page-1)*pageSize]);
      const count=await pool.query("SELECT count(*)::int total FROM ap_balance_baselines WHERE organization_id=$1",[org]);
      return sendOk(res,{items:rows.rows,total:count.rows[0].total,page,pageSize});
    }catch(e){return failed(res,e);}
  });
  app.get("/api/v2/ap/balance-baselines/:id",...read,async(req,res)=>{
    const id=z.coerce.number().int().positive().safeParse(req.params.id);
    if(!id.success) return sendError(res,400,"INVALID_BASELINE","Choose a valid opening baseline.");
    try {
      const row=await pool.query("SELECT id,status,reason,proposal,request_kind AS \"requestKind\",target_event_id::text AS \"targetEventId\",requested_effective_at AS \"effectiveAt\",document_evidence AS \"documentEvidence\",created_by AS \"createdBy\",submitted_by AS \"submittedBy\",approved_by AS \"approvedBy\",applied_at AS \"appliedAt\" FROM ap_balance_baselines WHERE organization_id=$1 AND id=$2",[getActiveOrganizationId(),id.data]);
      if(!row.rowCount) return sendError(res,404,"AP_BASELINE_NOT_FOUND","This opening baseline is not available in your organization.");
      return sendOk(res,row.rows[0]);
    }catch(e){return failed(res,e);}
  });
  app.post("/api/v2/ap/balance-baselines",...read,auth.ensurePermission("finance","create"),auth.ensureTwoFactorAuthenticated,async(req,res)=>{
    const parsed=z.object({invoiceIds:z.array(z.number().int().positive()).min(1).max(100),reason:z.string().trim().min(1).max(1000)}).strict().safeParse(req.body);
    if(!parsed.success) return sendError(res,400,"INVALID_BASELINE","Select up to 100 invoices and give a review reason.");
    try {
      const actor=getTenantContext();
      return sendOk(res,await prepareApBaseline({...parsed.data,organizationId:actor.organizationId,actorUserId:actor.userId,actorRole:actor.userRole}),201);
    }catch(e){return failed(res,e);}
  });
  app.post("/api/v2/ap/balance-baselines/:id/:action",...read,auth.ensureTwoFactorAuthenticated,async(req,res,next)=>{
    if(!["submit","approve"].includes(req.params.action)) return next();
    return auth.ensurePermission("finance",req.params.action==="approve"?"approve":"create")(req,res,async()=>{
      const id=z.coerce.number().int().positive().safeParse(req.params.id);
      if(!id.success||Object.keys(req.body??{}).length) return sendError(res,400,"INVALID_BASELINE","Choose a valid baseline. Its reviewed values cannot be edited during approval.");
      try {
        const actor=getTenantContext();
        return sendOk(res,await transitionApBaseline({id:id.data,action:req.params.action as "submit"|"approve",organizationId:actor.organizationId,actorUserId:actor.userId,actorRole:actor.userRole}));
      }catch(e){return failed(res,e);}
    });
  });
  app.get("/api/v2/ap/invoices/:id/balance-history",...read,async(req,res)=>{
    const id=z.coerce.number().int().positive().safeParse(req.params.id),p=pageQuery.safeParse(req.query);
    if(!id.success||!p.success) return sendError(res,400,"INVALID_HISTORY_PAGE","Choose an invoice and page size of 25, 50 or 100.");
    try {
      const {page,pageSize}=p.data,org=getActiveOrganizationId();
      const owned=await pool.query("SELECT 1 FROM invoices WHERE organization_id=$1 AND id=$2 UNION ALL SELECT 1 FROM ap_balance_events WHERE organization_id=$1 AND invoice_id=$2 LIMIT 1",[org,id.data]);
      if(!owned.rowCount) return sendError(res,404,"INVOICE_NOT_FOUND","This invoice history is not available in your organization.");
      const rows=await pool.query(`SELECT id,event_kind AS "eventKind",source_revision AS "sourceRevision",source_command_ref AS "sourceCommandRef",baseline_id AS "baselineId",actor_user_id AS "actorUserId",actor_provenance AS "actorProvenance",effective_at AS "effectiveAt",recorded_at AS "recordedAt",snapshot
        ,correction_request_id AS "correctionId",target_event_id::text AS "targetEventId"
        FROM ap_balance_events WHERE organization_id=$1 AND invoice_id=$2 ORDER BY effective_at DESC,id DESC LIMIT $3 OFFSET $4`,[org,id.data,pageSize,(page-1)*pageSize]);
      const count=await pool.query("SELECT count(*)::int total FROM ap_balance_events WHERE organization_id=$1 AND invoice_id=$2",[org,id.data]);
      return sendOk(res,{items:rows.rows,total:count.rows[0].total,page,pageSize,notice:"Database observations without authenticated actor context are unverified. Dates before verified opening coverage remain unavailable."});
    }catch(e){return failed(res,e);}
  });
}
