import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { generateFinancialMeasure } from "./financial-measure-service";
import { readFinancialReportingEvidence } from "./financial-reporting-run-store";

const measureSchema = z.enum(["ordered","open_commitment","received","invoiced","recorded_payments"]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
});
export const financialSummaryQuery = z.object({measure:measureSchema,
  from:day.optional(),to:day.optional(),supplierId:z.coerce.number().int().positive().optional()
}).strict().refine(value=>!value.from || !value.to || value.from<=value.to,{message:"Start date must not follow end date."});
const evidenceQuery=z.object({runId:z.string().uuid(),page:z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize:z.coerce.number().refine(value=>[25,50,100].includes(value)).default(25)}).strict();

export function registerFinancialMeasureRoutes(app:Express,auth:{ensureAuthenticated:RequestHandler;
  ensurePermission:(resource:string,action:string)=>RequestHandler}) {
  const sourceAccess:RequestHandler=(req,res,next)=>{
    const parsed=measureSchema.safeParse(req.params.measure ?? req.query.measure);
    if(!parsed.success) return sendError(res,400,"INVALID_MEASURE","Choose a supported financial measure.");
    const resource=["invoiced","recorded_payments"].includes(parsed.data)?"finance":"purchases";
    return auth.ensurePermission(resource,"read")(req,res,next);
  };
  const access=[auth.ensureAuthenticated,auth.ensurePermission("reports","read"),sourceAccess];
  app.get("/api/v2/analytics/financial-measures",...access,async(req,res)=>{
    const parsed=financialSummaryQuery.safeParse(req.query);
    if(!parsed.success) return sendError(res,400,"INVALID_FINANCIAL_FILTERS","Check the reporting dates, supplier and measure. Unsupported filters cannot be used.");
    const actorUserId=Number((req.user as {id?:number}|undefined)?.id);
    if(!Number.isSafeInteger(actorUserId)||actorUserId<1) return sendError(res,401,"SIGN_IN_REQUIRED","Sign in again to generate this report.");
    let client;
    try {
      client=await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const {measure,...filters}=parsed.data;
      const result=await generateFinancialMeasure(client,{organizationId:getActiveOrganizationId(),actorUserId,measure,filters});
      await client.query("COMMIT");
      res.setHeader("Cache-Control","private, no-store");
      return sendOk(res,result);
    } catch {
      if(client) await client.query("ROLLBACK").catch(()=>undefined);
      return sendError(res,503,"FINANCIAL_REPORT_UNAVAILABLE","The financial report could not be prepared.",{hint:"Retry. If the problem continues, contact your administrator with the request ID."});
    } finally {client?.release();}
  });
  app.get("/api/v2/analytics/financial-measures/:measure/evidence",...access,async(req,res)=>{
    const parsed=evidenceQuery.safeParse(req.query);
    if(!parsed.success) return sendError(res,400,"INVALID_EVIDENCE_PAGE","Choose a report and a page size of 25, 50 or 100.");
    let client;
    try {
      client=await pool.connect();
      const {runId,page,pageSize}=parsed.data;
      const result=await readFinancialReportingEvidence(client,getActiveOrganizationId(),runId,page,pageSize);
      if(!result || result.measure!==req.params.measure) return sendError(res,404,"REPORT_NOT_FOUND","This report is not available in your organization.");
      res.setHeader("Cache-Control","private, no-store");
      return sendOk(res,result);
    } catch {
      return sendError(res,503,"FINANCIAL_EVIDENCE_UNAVAILABLE","The report evidence could not be loaded.",{hint:"Retry or contact your administrator with the request ID."});
    } finally {client?.release();}
  });
}
