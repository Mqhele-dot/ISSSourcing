import type {Express,RequestHandler} from "express";
import {z} from "zod";
import type {PoolClient} from "pg";
import {getTenantContext} from "../../organization-context";
import {sendError,sendOk} from "../../api-response";
import {GovernanceError,governanceEnabled,governanceHash,governanceTransaction,governanceRetry,requireGovernanceAdmin,recordGovernanceDenial} from "./governance-context";
import {analyzeSod,mutateSod,requestSodException,approveSodException,sodProjection,sodUserWorklist} from "./segregation-analysis";
import {assessPaymentRisk,reviewPaymentRisk,paymentRiskView,paymentActor} from "../accounts-payable/payment-risk";
import {sodAnalyzeSchema,governanceReviewSchema} from "@shared/procurement-governance";
import {appendAuditEventWithClient} from "../../services/audit-chain-client";
import {recordGovernanceNotification} from "../../services/notification-emitter";

type Auth={ensureAuthenticated:RequestHandler;ensureTwoFactorAuthenticated:RequestHandler};
const paging=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25)});
const positive=z.coerce.number().int().positive().max(2147483647);
type Scope={org:number;user:number};
export function registerGovernanceRoutes(app:Express,auth:Auth){
 // Compatibility routes cannot use their pre-governance, independently pooled
 // writes when the organization opts in. The existing editor uses commands
 // above with a reviewed revision; database triggers also guard storage callers.
 app.use(async(req,res,next)=>{
  const roleWrite=/^\/api\/custom-roles\/\d+(?:\/permissions(?:\/\d+)?)?$/.test(req.path)&&["POST","PUT","PATCH","DELETE"].includes(req.method);
  const assignment=req.method==="PUT"&&/^\/api\/users\/\d+$/.test(req.path)&&
    (Object.hasOwn(req.body??{},"role")||Object.hasOwn(req.body??{},"active")||Object.hasOwn(req.body?.preferences??{},"customRoleId"));
  if(!roleWrite&&!assignment)return next();
  if(!req.isAuthenticated())return auth.ensureAuthenticated(req,res,next);
  try{if(!await governanceEnabled(getTenantContext().organizationId,"sod"))return next();
   await governanceTransaction(async c=>{
    await requireGovernanceAdmin(c);
   });
   if(assignment&&!Object.hasOwn(req.body??{},"role")&&!Object.hasOwn(req.body??{},"active")){
    const unchanged=await governanceTransaction(async c=>(await c.query(`SELECT 1 FROM users u JOIN organization_members m ON m.user_id=u.id
      WHERE m.organization_id=$1 AND u.id=$2 AND (u.preferences->>'customRoleId') IS NOT DISTINCT FROM $3::text`,
      [getTenantContext().organizationId,Number(req.path.split("/").at(-1)),req.body.preferences.customRoleId===null?null:String(req.body.preferences.customRoleId)])).rowCount===1);
    if(unchanged)return next();
   }
   return sendError(res,409,"SOD_REVIEW_REQUIRED","Review this access change in Role management before saving. Use the governed command with a current revision and retry key; no changes were applied.");
  }catch(error){if(error instanceof GovernanceError)return sendError(res,error.status,error.code,error.message);return sendError(res,503,"GOVERNANCE_UNAVAILABLE","Current access controls could not be verified. Retry; no changes were applied.");}
 });
 const route=(feature:"sod"|"payment_risk",work:(c:PoolClient,s:Scope,req:Parameters<RequestHandler>[0])=>Promise<unknown>):RequestHandler=>async(req,res)=>{
  try{
   const t=getTenantContext(),s={org:t.organizationId,user:t.userId};
   const result=await governanceTransaction(async c=>{
    if(feature==="sod")await requireGovernanceAdmin(c);else await paymentActor(c,s.org,s.user,"read");
    if(!await governanceEnabled(s.org,feature,c))throw new GovernanceError("GOVERNANCE_DISABLED","This capability is not enabled for this organization. An administrator must verify its prerequisites before activation.",409);
    const ready=(await c.query("SELECT to_regclass($1) ready",[feature==="sod"?"sod_conflict_rules":"payment_risk_assessments"])).rows[0].ready;
    if(!ready)throw new GovernanceError("GOVERNANCE_SETUP_REQUIRED","The approved Build 4 migration is required before these controls are available.",503);
    return work(c,s,req);
   });
   return sendOk(res,result);
  }catch(error){
   if(error instanceof GovernanceError){if(req.method!=="GET"){const t=getTenantContext();await recordGovernanceDenial(t.organizationId,t.userId,error,feature==="sod"?"sod_review":"payment_batch",Number(req.params.id)||undefined);}return sendError(res,error.status,error.code,error.message,{details:error.details});}
   if(error instanceof z.ZodError)return sendError(res,400,"GOVERNANCE_INPUT_INVALID","Check the selected scope, pagination and required review fields.");
   // Log only the rule/category, never bank payloads, SQL, parameters or stacks.
   console.error(JSON.stringify({event:"governance_request_failed",code:(error as {code?:string}).code??"UNEXPECTED",requestId:getTenantContext().correlationId}));
   return sendError(res,503,"GOVERNANCE_UNAVAILABLE","The review could not be completed. Retry with the same command key; no partial change was applied.");
  }
 };
 const read=[auth.ensureAuthenticated],write=[auth.ensureAuthenticated,auth.ensureTwoFactorAuthenticated];
 app.get("/api/v2/admin/sod/context",...read,async(_req,res)=>{
  try{return sendOk(res,await governanceTransaction(async c=>{await requireGovernanceAdmin(c);return {enabled:await governanceEnabled(getTenantContext().organizationId,"sod",c)};}));}
  catch(error){if(error instanceof GovernanceError)return sendError(res,error.status,error.code,error.message);return sendError(res,503,"GOVERNANCE_UNAVAILABLE","Access review is unavailable. Retry.");}
 });
 app.get("/api/v2/admin/sod/summary",...read,route("sod",async(c,s)=>{
  const result=(await c.query(`${sodProjection} SELECT count(*) FILTER(WHERE severity='CRITICAL' AND exception_id IS NULL)::int critical,
   count(*) FILTER(WHERE severity='HIGH' AND exception_id IS NULL)::int high,
   count(DISTINCT subject_key) FILTER(WHERE subject_key LIKE 'user:%' AND exception_id IS NULL)::int users,
   count(DISTINCT subject_key) FILTER(WHERE subject_key NOT LIKE 'user:%' AND exception_id IS NULL)::int roles FROM findings`,[s.org])).rows[0];
  const expiring=(await c.query("SELECT count(*)::int count FROM sod_conflict_exceptions WHERE organization_id=$1 AND status='APPROVED' AND expires_at>now() AND expires_at<now()+interval '7 days'",[s.org])).rows[0].count;
  return {...result,expiringExceptions:expiring,checkedAt:new Date().toISOString(),state:"observation",limitation:"Legacy conflicts are reported, not silently altered. One application role per active organization membership."};
 }));
 for(const view of ["users","roles","conflicts"] as const)app.get(`/api/v2/admin/sod/${view}`,...read,route("sod",async(c,s,req)=>{
  const {page,pageSize}=paging.parse(req.query);
  const q=z.string().trim().max(100).default("").parse(req.query.q);
  if(view!=="users"&&q)throw new GovernanceError("SOD_QUERY_UNSUPPORTED","Text search currently applies to the active-user worklist only.",400);
  const filter=view==="users"?"subject_key LIKE 'user:%'":view==="roles"?"subject_key NOT LIKE 'user:%'":"true";
  const base=view==="users"?sodUserWorklist:
    view==="conflicts"?`SELECT * FROM findings WHERE ${filter}`:`SELECT s.subject_key,s.label,s.role,s.custom_id,
    count(rule_id)::int conflicts,count(rule_id) FILTER(WHERE severity='CRITICAL' AND exception_id IS NULL)::int critical FROM subjects s
    LEFT JOIN findings f USING(subject_key) WHERE ${filter} GROUP BY s.subject_key,s.label,s.role,s.custom_id`;
  const countParameters=view==="users"?[s.org,q]:[s.org],parameters=[...countParameters,pageSize,(page-1)*pageSize];
  const total=Number((await c.query(`${sodProjection} SELECT count(*) n FROM (${base})p`,countParameters)).rows[0].n);
  const items=(await c.query(`${sodProjection} SELECT * FROM (${base})p ORDER BY subject_key${view==="conflicts"?",rule_id":""} LIMIT $${countParameters.length+1} OFFSET $${countParameters.length+2}`,parameters)).rows;
  return {items,total,page,pageSize};
 }));
 for(const view of ["rules","exceptions"] as const)app.get(`/api/v2/admin/sod/${view}`,...read,route("sod",async(c,s,req)=>{
  const {page,pageSize}=paging.parse(req.query),table=view==="rules"?"sod_conflict_rules":"sod_conflict_exceptions";
  const predicate=view==="rules"?"(organization_id=$1 OR organization_id IS NULL)":"organization_id=$1";
  const total=Number((await c.query(`SELECT count(*) n FROM ${table} WHERE ${predicate}`,[s.org])).rows[0].n);
  const items=(await c.query(`SELECT * FROM ${table} WHERE ${predicate} ORDER BY id DESC LIMIT $2 OFFSET $3`,[s.org,pageSize,(page-1)*pageSize])).rows;
  return {items,total,page,pageSize};
 }));
 app.post("/api/v2/admin/sod/analyze",...read,route("sod",(c,s,req)=>analyzeSod(c,s.org,sodAnalyzeSchema.parse(req.body))));
 app.post("/api/v2/admin/sod/commands",...write,route("sod",(c,s,req)=>mutateSod(c,s.org,s.user,req.get("Idempotency-Key")??"",req.body)));
 app.post("/api/v2/admin/sod/exceptions",...write,route("sod",(c,s,req)=>requestSodException(c,s.org,s.user,req.get("Idempotency-Key")??"",req.body)));
 app.post("/api/v2/admin/sod/exceptions/:id/approve",...write,route("sod",(c,s,req)=>approveSodException(c,s.org,s.user,positive.parse(req.params.id),req.get("Idempotency-Key")??"",governanceReviewSchema.parse(req.body).reason)));
 app.post("/api/v2/admin/sod/exceptions/:id/revoke",...write,route("sod",async(c,s,req)=>{
  const id=positive.parse(req.params.id),body=governanceReviewSchema.parse(req.body);
  return governanceRetry(c,s.org,s.user,req.get("Idempotency-Key")??"","SOD_EXCEPTION_REVOKED",{id,...body},async()=>{
   const row=(await c.query("SELECT * FROM sod_conflict_exceptions WHERE organization_id=$1 AND id=$2 FOR UPDATE",[s.org,id])).rows[0];
   if(!row)throw new GovernanceError("SOD_SUBJECT_UNAVAILABLE","Exception unavailable in this organization.",404);
   if(row.status!=="APPROVED")throw new GovernanceError("SOD_EXCEPTION_NOT_ACTIVE","Only approved exceptions can be revoked.");
   await c.query("UPDATE sod_conflict_exceptions SET status='REVOKED' WHERE organization_id=$1 AND id=$2",[s.org,id]);
   await appendAuditEventWithClient(c,{organizationId:s.org,actor:{userId:s.user},action:"SOD_EXCEPTION_REVOKED",resourceType:"sod_exception",resourceId:id,before:row,after:{status:"REVOKED"},reason:body.reason});
   return {id,status:"REVOKED"};
  });
 }));
 app.post("/api/v2/admin/sod/scan",...write,route("sod",async(c,s,req)=>governanceRetry(c,s.org,s.user,req.get("Idempotency-Key")??"","SOD_CONFLICT_DETECTED",{},async()=>{
  await c.query("SELECT pg_advisory_xact_lock(723410,$1)",[s.org]);
  await c.query(`${sodProjection} INSERT INTO sod_conflict_findings(organization_id,subject_key,rule_id,status,evidence)
    SELECT $1,subject_key,rule_id,CASE WHEN exception_id IS NULL THEN 'EXISTING_CONFLICT' ELSE 'MITIGATED' END,to_jsonb(f) FROM findings f
    ON CONFLICT(organization_id,subject_key,rule_id) DO UPDATE SET status=excluded.status,evidence=excluded.evidence,last_checked_at=clock_timestamp()`,[s.org]);
  await c.query(`${sodProjection} UPDATE sod_conflict_findings p SET status='RESOLVED',last_checked_at=clock_timestamp()
    WHERE p.organization_id=$1 AND NOT EXISTS(SELECT 1 FROM findings f WHERE f.subject_key=p.subject_key AND f.rule_id=p.rule_id)`,[s.org]);
  const snapshot=(await c.query("SELECT coalesce(jsonb_agg(jsonb_build_array(subject_key,rule_id,status) ORDER BY subject_key,rule_id),'[]'::jsonb) evidence FROM sod_conflict_findings WHERE organization_id=$1",[s.org])).rows[0].evidence;
  await recordGovernanceNotification(c,s.org,{entityType:"sod_conflict",entityId:s.org,transitionKey:`sod-review:${governanceHash(snapshot)}`,title:"Access conflicts reviewed",
   body:"An access review has recorded current conflicts. Existing access was not changed. Review critical findings and expiring mitigations.",targetPath:"/admin/segregation-of-duties?view=conflicts"});
  await appendAuditEventWithClient(c,{organizationId:s.org,actor:{userId:s.user},action:"SOD_CONFLICT_DETECTED",resourceType:"sod_review",details:{mode:"read-only business observation"}});
  return {checkedAt:new Date().toISOString(),businessChanges:false};
 })));
 app.get("/api/v2/ap/payment-risk/context",...read,async(_req,res)=>{
  try{const t=getTenantContext();return sendOk(res,await governanceTransaction(async c=>{
   const enabled=await governanceEnabled(t.organizationId,"payment_risk",c);
   if(!enabled)return {enabled:false,canCreate:false,canApprove:false,canRelease:false};
   const actor=await paymentActor(c,t.organizationId,t.userId,"read");
   return {enabled:true,canCreate:await actor.can("payments","create")&&await actor.can("finance","create"),
    canApprove:await actor.can("payments","approve")&&await actor.can("finance","approve"),canRelease:await actor.can("payments","execute")&&await actor.can("finance","execute")};
  }));}catch(error){if(error instanceof GovernanceError)return sendError(res,error.status,error.code,error.message);return sendError(res,503,"PAYMENT_ACCESS_UNAVAILABLE","Payment authority could not be verified. Retry.");}
 });
 app.get("/api/v2/ap/payment-batches/:id/risk",...read,route("payment_risk",(c,s,req)=>{
  const {page,pageSize}=paging.parse(req.query);return paymentRiskView(c,s.org,s.user,positive.parse(req.params.id),page,pageSize,req.query.assessmentId===undefined?undefined:positive.parse(req.query.assessmentId));
 }));
 app.get("/api/v2/ap/payment-batches/:id/risk/history",...read,route("payment_risk",async(c,s,req)=>{
  const id=positive.parse(req.params.id),{page,pageSize}=paging.parse(req.query);
  if(!(await c.query("SELECT id FROM ap_payment_batches WHERE organization_id=$1 AND id=$2",[s.org,id])).rowCount)throw new GovernanceError("PAYMENT_BATCH_NOT_FOUND","Batch unavailable in this organization.",404);
  const total=Number((await c.query("SELECT count(*) n FROM payment_risk_assessments WHERE organization_id=$1 AND batch_id=$2",[s.org,id])).rows[0].n);
  const items=(await c.query(`SELECT id,version,assessed_at,assessed_by,source_fingerprint,amount::text,currency_code,score,risk_level,status,stale_at,stale_reason
   FROM payment_risk_assessments WHERE organization_id=$1 AND batch_id=$2 ORDER BY version DESC,id DESC LIMIT $3 OFFSET $4`,[s.org,id,pageSize,(page-1)*pageSize])).rows;
  return {items,total,page,pageSize};
 }));
 for(const action of ["assess","review"] as const)app.post(`/api/v2/ap/payment-batches/:id/risk/${action}`,...write,route("payment_risk",async(c,s,req)=>{
  const id=positive.parse(req.params.id),body=action==="review"?governanceReviewSchema.parse(req.body):z.object({}).strict().parse(req.body??{});
  return governanceRetry(c,s.org,s.user,req.get("Idempotency-Key")??"",`PAYMENT_RISK_${action.toUpperCase()}`,{id,...body},async()=>{
   if(action==="assess")return assessPaymentRisk(c,s.org,s.user,id);
   const review=governanceReviewSchema.parse(body);if(!review.assessmentId)throw new GovernanceError("PAYMENT_RISK_REFERENCE_REQUIRED","Select the exact assessment to review.",400);
   return reviewPaymentRisk(c,s.org,s.user,id,review.assessmentId,review.reason);
  });
 }));
}
