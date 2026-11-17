import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk, resolveRequestId } from "../../api-response";
import { generateFinancialMeasure } from "./financial-measure-service";
import { readFinancialReportingEvidence } from "./financial-reporting-run-store";
import { recordServerDiagnosticEvent } from "../../diagnostics/server-diagnostics-store";
import { createExportJob } from "../exports/export-jobs";
import { streamFrozenFinancialCsv } from "./frozen-financial-export";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import { exportRateLimiter } from "../../services/security-service";
import {financialMeasureKeys,financialMeasureResource,isApBalanceMeasure} from "../../../shared/financial-measures";
import type {Response} from "express";

function sendScopeError(res:Response,error:unknown) {
  const e=error as {code?:string;status?:number;message?:string};
  if(e.code?.startsWith("AP_")&&[400,403,409].includes(e.status??0)) {
    sendError(res,e.status!,e.code,e.message??"Review the AP reporting scope.");return true;
  }
  return false;
}

function recordReportingFailure(error: unknown, requestId: unknown, route: string) {
  // Capture classification, not database messages: those can contain source values.
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
  const schemaMissing = code === "42P01" || code === "42703";
  recordServerDiagnosticEvent({
    severity: "error", source: "request", title: "Financial reporting unavailable",
    message: schemaMissing
      ? "Required reporting schema is unavailable. Verify pending reporting migrations before retrying."
      : "Financial reporting failed. Review the correlated server request and reporting dependencies.",
    route, method: "GET", status: 503,
    details: { organizationId: getActiveOrganizationId(), requestId, databaseCode: /^[A-Z0-9]{5}$/.test(code) ? code : "UNKNOWN" },
  });
}

const measureSchema = z.enum(financialMeasureKeys);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
});
export const financialSummaryQuery = z.object({measure:measureSchema,
  from:day.optional(),to:day.optional(),asOf:day.optional(),supplierId:z.coerce.number().int().positive().optional()
}).strict().refine(value=>!value.from || !value.to || value.from<=value.to,{message:"Start date must not follow end date."})
  .refine(value=>isApBalanceMeasure(value.measure)?!value.from&&!value.to:!value.asOf,{message:"AP balances use asOf; lifecycle measures use from/to."});
const evidenceQuery=z.object({runId:z.string().uuid(),page:z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize:z.coerce.number().refine(value=>[25,50,100].includes(value)).default(25)}).strict();
export const financialSnapshotQuery=z.object({
  measures:z.string().transform(value=>value.split(",")).pipe(z.array(measureSchema).min(1).max(8))
    .refine(value=>new Set(value).size===value.length,"Choose each measure only once."),
  from:day.optional(),to:day.optional(),asOf:day.optional(),supplierId:z.coerce.number().int().positive().optional(),
}).strict().refine(value=>!value.from||!value.to||value.from<=value.to,{message:"Start date must not follow end date."})
  .refine(value=>value.measures.every(measure=>isApBalanceMeasure(measure)?!value.from&&!value.to:!value.asOf),{message:"Do not combine as-of and lifecycle date scopes."});

export function registerFinancialMeasureRoutes(app:Express,auth:{ensureAuthenticated:RequestHandler;
  ensurePermission:(resource:string,action:string)=>RequestHandler}) {
  const sourceAccess:RequestHandler=(req,res,next)=>{
    const parsed=measureSchema.safeParse(req.params.measure ?? req.query.measure);
    if(!parsed.success) return sendError(res,400,"INVALID_MEASURE","Choose a supported financial measure.");
    const resource=financialMeasureResource(parsed.data);
    return auth.ensurePermission(resource,"read")(req,res,next);
  };
  const access=[auth.ensureAuthenticated,auth.ensurePermission("reports","read"),sourceAccess];
  app.post("/api/v2/analytics/financial-measures/:measure/export",...access,auth.ensurePermission("reports","export"),exportRateLimiter,async(req,res)=>{
    const parsed=z.object({runId:z.string().uuid()}).strict().safeParse(req.body);
    if(!parsed.success) return sendError(res,400,"INVALID_REPORT_REFERENCE","Choose a saved reporting observation to export.");
    const run=await pool.query("SELECT id FROM financial_reporting_runs WHERE organization_id=$1 AND id=$2 AND measure=$3",[getActiveOrganizationId(),parsed.data.runId,req.params.measure]);
    if(!run.rowCount) return sendError(res,404,"REPORT_NOT_FOUND","This report is not available in your organization.");
    const job=await createExportJob({userId:Number((req.user as {id:number}).id),dataset:"financial_measure",format:"csv",
      filters:{runId:parsed.data.runId,measure:req.params.measure},sourcePage:"/analytics",reason:"Frozen financial evidence; no recalculation"});
    return sendOk(res,{jobId:job.id,runId:parsed.data.runId,destination:"/analytics/export-center"},202);
  });
  app.get("/api/export/financial_measure/csv",...access,auth.ensurePermission("reports","export"),async(req,res)=>{
    const parsed=z.object({runId:z.string().uuid(),measure:measureSchema}).strict().safeParse(req.query);
    if(!parsed.success) return sendError(res,400,"INVALID_REPORT_REFERENCE","Choose a saved reporting observation to export.");
    const client=await pool.connect();
    try {
      const result=await streamFrozenFinancialCsv(client,getActiveOrganizationId(),parsed.data.runId,parsed.data.measure);
      if(!result) return sendError(res,404,"REPORT_NOT_FOUND","This report is not available in your organization.");
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition",`attachment; filename="financial-${parsed.data.measure}-${parsed.data.runId}.csv"`);
      res.setHeader("X-Export-Row-Count",String(result.rowCount));
      res.setHeader("Cache-Control","private, no-store");
      await pipeline(Readable.from(result.chunks),res);
    } finally {client.release();}
  });
  const snapshotAccess:RequestHandler=(req,res,next)=>{
    const parsed=financialSnapshotQuery.safeParse(req.query);
    if(!parsed.success) return sendError(res,400,"INVALID_FINANCIAL_FILTERS","Choose distinct supported measures and valid reporting dates. Unsupported filters cannot be used.");
    const resources=[...new Set(parsed.data.measures.map(financialMeasureResource))];
    const authorize=(index:number):void=>{
      if(index===resources.length) {next();return;}
      auth.ensurePermission(resources[index],"read")(req,res,()=>authorize(index+1));
    };
    authorize(0);
  };
  app.get("/api/v2/analytics/financial-measures/snapshot",auth.ensureAuthenticated,auth.ensurePermission("reports","read"),snapshotAccess,async(req,res)=>{
    const parsed=financialSnapshotQuery.safeParse(req.query);
    if(!parsed.success) return sendError(res,400,"INVALID_FINANCIAL_FILTERS","Check the reporting filters.");
    const actorUserId=Number((req.user as {id?:number}|undefined)?.id);
    if(!Number.isSafeInteger(actorUserId)||actorUserId<1) return sendError(res,401,"SIGN_IN_REQUIRED","Sign in again to generate this report.");
    let client;
    try {
      client=await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const {measures,...filters}=parsed.data;
      const results=[];
      // One connection and observation: all cards and their frozen evidence agree.
      for(const measure of measures) results.push(await generateFinancialMeasure(client,{organizationId:getActiveOrganizationId(),actorUserId,measure,filters}));
      await client.query("COMMIT");
      res.setHeader("Cache-Control","private, no-store");
      return sendOk(res,{generatedAt:results[0].generatedAt,normalizedFilters:filters,measures:results});
    } catch(error) {
      if(client) await client.query("ROLLBACK").catch(()=>undefined);
      if(sendScopeError(res,error)) return;
      recordReportingFailure(error,resolveRequestId(res),"/api/v2/analytics/financial-measures/snapshot");
      return sendError(res,503,"FINANCIAL_REPORT_UNAVAILABLE","The dashboard snapshot could not be prepared.",{hint:"Retry. No incomplete dashboard snapshot was saved."});
    } finally {client?.release();}
  });
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
    } catch (error) {
      if(client) await client.query("ROLLBACK").catch(()=>undefined);
      if(sendScopeError(res,error)) return;
      recordReportingFailure(error, resolveRequestId(res), "/api/v2/analytics/financial-measures");
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
    } catch (error) {
      recordReportingFailure(error, resolveRequestId(res), "/api/v2/analytics/financial-measures/:measure/evidence");
      return sendError(res,503,"FINANCIAL_EVIDENCE_UNAVAILABLE","The report evidence could not be loaded.",{hint:"Retry or contact your administrator with the request ID."});
    } finally {client?.release();}
  });
}
