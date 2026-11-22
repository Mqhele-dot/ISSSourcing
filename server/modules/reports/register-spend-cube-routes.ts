import type {Express,RequestHandler} from "express";
import {z} from "zod";
import {getTenantContext} from "../../organization-context";
import {sendError,sendOk} from "../../api-response";
import {governanceTransaction,governanceRetry,governanceEnabled,GovernanceError} from "../rbac/governance-context";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
import {generateFinancialMeasure} from "./financial-measure-service";
import {assertSpendAccess} from "./spend-access";
import {spendCaptureSchema,spendPageSchema,spendEvidenceSchema,spendMeasures,spendDimensionNotice} from "@shared/spend-cube";
import type {PoolClient} from "pg";
const runId=z.string().uuid();
async function saved(c:PoolClient,org:number,id:string){
 const run=(await c.query("SELECT id,measure,summary,normalized_filters,evidence_hash FROM financial_reporting_runs WHERE organization_id=$1 AND id=$2",[org,id])).rows[0];
 if(!run||run.summary.spendCubeVersion!==1)throw new GovernanceError("SPEND_RUN_NOT_FOUND","Choose a captured Spend Cube observation in this organization. Older financial runs have no frozen dimensions.",404);
 await assertSpendAccess(c,org,run.measure);return run;
}
const grouped=`WITH rows AS (SELECT evidence,(evidence->'dimensions'->$3::text->>'key') bucket_key FROM financial_reporting_contributions WHERE organization_id=$1 AND run_id=$2),
 groups AS (SELECT bucket_key,min(evidence->'dimensions'->$3::text->>'label') label,min(evidence->'dimensions'->$3::text->>'state') dimension_state,
 count(*)::int count,count(*) FILTER(WHERE evidence->>'reportingAmount' IS NOT NULL)::int included,
 count(*) FILTER(WHERE evidence->>'reportingAmount' IS NULL)::int excluded,
 sum((evidence->>'reportingAmount')::numeric)::text amount FROM rows GROUP BY bucket_key)`;
export function registerSpendCubeRoutes(app:Express,auth:{ensureAuthenticated:RequestHandler}){
 const wrap=(work:(c:PoolClient,req:Parameters<RequestHandler>[0])=>Promise<unknown>):RequestHandler=>async(req,res)=>{
  try{const result=await governanceTransaction(c=>work(c,req));res.setHeader("Cache-Control","private, no-store");return sendOk(res,result);}
  catch(e){if(e instanceof GovernanceError)return sendError(res,e.status,e.code,e.message);if(e instanceof z.ZodError)return sendError(res,400,"SPEND_FILTERS_INVALID","Select a supported measure, dimension, real dates and 25/50/100 pagination. Unsupported filters were not ignored.");
   console.error(JSON.stringify({event:"spend_cube_failed",code:(e as {code?:string}).code??"UNKNOWN",requestId:getTenantContext().correlationId}));return sendError(res,503,"SPEND_UNAVAILABLE","The observation could not be completed. Retry with the same command key; no incomplete observation was saved.");}
 };
 app.get("/api/v2/analytics/spend-cube/context",auth.ensureAuthenticated,wrap(async c=>{const t=getTenantContext();await assertSpendAccess(c,t.organizationId,"ordered");return {enabled:await governanceEnabled(t.organizationId,"spend_cube",c),measures:spendMeasures,notice:spendDimensionNotice};}));
 app.post("/api/v2/analytics/spend-cube",auth.ensureAuthenticated,wrap(async(c,req)=>{
  const t=getTenantContext(),{measure,...filters}=spendCaptureSchema.parse(req.body);await assertSpendAccess(c,t.organizationId,measure);
  if(!await governanceEnabled(t.organizationId,"spend_cube",c))throw new GovernanceError("SPEND_DISABLED","New Spend Cube captures are disabled until this organization's prerequisites and release gate are approved.");
  if(filters.supplierId&&!(await c.query("SELECT id FROM suppliers WHERE organization_id=$1 AND id=$2",[t.organizationId,filters.supplierId])).rowCount)throw new GovernanceError("SPEND_SUPPLIER_UNAVAILABLE","Supplier unavailable in this organization.",404);
  return governanceRetry(c,t.organizationId,t.userId,req.get("Idempotency-Key")??"","SPEND_CUBE_CAPTURED",{measure,...filters},async()=>{
   const run=await generateFinancialMeasure(c,{organizationId:t.organizationId,actorUserId:t.userId,measure,filters,captureSpendDimensions:true});
   await appendAuditEventWithClient(c,{organizationId:t.organizationId,actor:{userId:t.userId},action:"SPEND_CUBE_CAPTURED",resourceType:"financial_reporting_run",details:{runId:run.id,measure,filters,evidenceHash:run.evidenceHash},requestId:t.correlationId});return run;
  });
 }));
 app.get("/api/v2/analytics/spend-cube/:id",auth.ensureAuthenticated,wrap(async(c,req)=>{
  const t=getTenantContext(),id=runId.parse(req.params.id),q=spendPageSchema.parse(req.query),run=await saved(c,t.organizationId,id),args=[t.organizationId,id,q.dimension];
  const total=Number((await c.query(`${grouped} SELECT count(*)::int n FROM groups`,args)).rows[0].n);
  const items=(await c.query(`${grouped} SELECT * FROM groups ORDER BY bucket_key COLLATE "C" LIMIT $4 OFFSET $5`,[...args,q.pageSize,(q.page-1)*q.pageSize])).rows;
  return {runId:id,measure:run.measure,summary:run.summary,filters:run.normalized_filters,evidenceHash:run.evidence_hash,dimension:q.dimension,items,total,page:q.page,pageSize:q.pageSize,notice:spendDimensionNotice};
 }));
 app.get("/api/v2/analytics/spend-cube/:id/evidence",auth.ensureAuthenticated,wrap(async(c,req)=>{
  const t=getTenantContext(),id=runId.parse(req.params.id),q=spendEvidenceSchema.parse(req.query),run=await saved(c,t.organizationId,id);
  const scope="organization_id=$1 AND run_id=$2 AND evidence->'dimensions'->$3::text->>'key'=$4";
  const args=[t.organizationId,id,q.dimension,q.bucketKey];
  const total=Number((await c.query(`SELECT count(*)::int n FROM financial_reporting_contributions WHERE ${scope}`,args)).rows[0].n);
  const rows=await c.query(`SELECT ordinal,evidence FROM financial_reporting_contributions WHERE ${scope} ORDER BY ordinal LIMIT $5 OFFSET $6`,[...args,q.pageSize,(q.page-1)*q.pageSize]);
  return {runId:id,measure:run.measure,dimension:q.dimension,bucketKey:q.bucketKey,items:rows.rows,total,page:q.page,pageSize:q.pageSize,evidenceHash:run.evidence_hash};
 }));
}
