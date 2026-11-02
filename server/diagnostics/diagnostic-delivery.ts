import { pool } from "../db";
import { runWithTenantContext } from "../organization-context";
import { emitNotificationToRoles } from "../services/notification-emitter";
import { readMonitoringScheduleHealth } from "./persistent-findings";
import { persistDiagnosticChecks } from "./persistent-findings";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordDiagnosticCaptureGap } from "./durable-events";
import { retainDiagnosticEvidence } from "./evidence-retention";
import {recordDiagnosticDeliveryFailure} from "./delivery-health";

function localParts(now:Date,timeZone:string){
  const localDate=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",hourCycle:"h23"}).format(now));
  return {localDate,hour};
}

async function recordSummaryFailure(organizationId:number,invalidTimezone:boolean,existingClient?:PoolClient){
  let client=existingClient;
  try{
    client??=await pool.connect();
    await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'");
    const runId=randomUUID(),timestamp=new Date().toISOString();
    await persistDiagnosticChecks(client,organizationId,runId,[{
      id:"daily-summary-generation",resourceKey:String(organizationId),category:"notifications",
      code:invalidTimezone?"DAILY_SUMMARY_GENERATION":"DAILY_SUMMARY_GENERATION_PROBE_FAILED",
      title:"Daily reliability summary unavailable",status:"failed",severity:"error",occurrences:1,
      firstSeen:timestamp,lastSeen:timestamp,evidenceState:"current",
      message:invalidTimezone?"The organization time zone is invalid. Ask an administrator to choose a valid time zone in General Settings. No summary was generated using a substitute zone."
        :"The daily reliability summary could not be saved. Ask an administrator to review diagnostic storage, then retry.",
      targetRoute:invalidTimezone?"/admin/settings/general":"/admin/system-diagnostics",
    }]);
    await client.query("UPDATE diagnostic_check_runs SET outcome='failed',error_code=$2 WHERE id=$1 AND organization_id=$3",
      [runId,invalidTimezone?"DIAGNOSTIC_TIMEZONE_INVALID":"DIAGNOSTIC_SUMMARY_GENERATION_FAILED",organizationId]);
    await client.query("COMMIT");
  }catch{
    await client?.query("ROLLBACK").catch(()=>undefined);
    recordDiagnosticCaptureGap(organizationId);
    console.warn("Daily summary failure evidence could not be stored; monitoring has a capture gap.");
  }finally{if(!existingClient)client?.release();}
}

async function recordSummaryRecovery(client:PoolClient,organizationId:number,scheduled:boolean){
  const open=await client.query(`SELECT 1 FROM diagnostic_persistent_findings WHERE organization_id=$1
    AND finding_key=$2 AND lifecycle<>'resolved'`,[organizationId,`notifications:DAILY_SUMMARY_GENERATION:${organizationId}`]);
  if(!open.rowCount)return;
  const timestamp=new Date().toISOString();
  await persistDiagnosticChecks(client,organizationId,randomUUID(),[{
    id:"daily-summary-generation",resourceKey:String(organizationId),category:"notifications",code:"DAILY_SUMMARY_GENERATION",
    title:"Daily reliability summary available",message:"The organization time zone and saved daily summary were verified.",
    status:"working",severity:"info",occurrences:1,firstSeen:timestamp,lastSeen:timestamp,evidenceState:"current",targetRoute:"/admin/system-diagnostics",
  }],1,scheduled);
}

export async function generateDiagnosticDailySummaries(now=new Date(),options:{scheduled?:boolean}={}){
  const ready=await pool.query("SELECT to_regclass('public.diagnostic_daily_summaries') IS NOT NULL AS ready");
  if(!ready.rows[0]?.ready)return;
  // Diagnostic evidence retention only. Business audit and operational records are never touched.
  await retainDiagnosticEvidence();
  let cursor=0;
  for (;;) {
  const organizations=await pool.query<{id:number;timezone:string|null}>("SELECT id,timezone FROM organizations WHERE active=true AND id>$1 ORDER BY id LIMIT 100",[cursor]);
  if(!organizations.rows.length)break;
  for(const organization of organizations.rows){
    cursor=organization.id;
    const timezone=organization.timezone||"Africa/Johannesburg";
    let parts:{localDate:string;hour:number};
    try{parts=localParts(now,timezone);}catch{await recordSummaryFailure(organization.id,true);continue;}
    if(parts.hour<8)continue;
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SELECT pg_advisory_xact_lock($1,$2)",[74218,organization.id]);
      const exists=await client.query("SELECT 1 FROM diagnostic_daily_summaries WHERE organization_id=$1 AND local_date=$2::date",[organization.id,parts.localDate]);
      if(exists.rowCount){await recordSummaryRecovery(client,organization.id,options.scheduled===true);await client.query("COMMIT");continue;}
      const transitions=await client.query(`SELECT
        count(*) FILTER(WHERE transition='opened')::int AS new_count,
        count(*) FILTER(WHERE transition='worsened')::int AS worsened_count,
        count(*) FILTER(WHERE transition='recovered')::int AS recovered_count
        FROM diagnostic_notification_intents WHERE organization_id=$1
          AND (created_at AT TIME ZONE $2)::date=$3::date`,[organization.id,timezone,parts.localDate]);
      const outstanding=await client.query("SELECT count(*)::int AS count FROM diagnostic_persistent_findings WHERE organization_id=$1 AND lifecycle<>'resolved'",[organization.id]);
      const freshness=await readMonitoringScheduleHealth(client,organization.id,now);
      const counts={new:Number(transitions.rows[0]?.new_count??0),worsened:Number(transitions.rows[0]?.worsened_count??0),
        recovered:Number(transitions.rows[0]?.recovered_count??0),outstanding:Number(outstanding.rows[0]?.count??0)};
      const payload={...counts,monitoringFresh:freshness.monitoringFresh && freshness.monitoringState==="healthy",targetRoute:"/admin/system-diagnostics"};
      const savedSummary=await client.query(`INSERT INTO diagnostic_daily_summaries
        (organization_id,local_date,timezone,new_count,worsened_count,recovered_count,outstanding_count,monitoring_fresh,payload)
        VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING generated_at`,[organization.id,parts.localDate,timezone,counts.new,counts.worsened,counts.recovered,counts.outstanding,payload.monitoringFresh,JSON.stringify(payload)]);
      await client.query(`INSERT INTO diagnostic_notification_intents(organization_id,finding_key,transition,transition_key,payload)
        VALUES($1,'daily-summary','daily_summary',$2,$3::jsonb) ON CONFLICT DO NOTHING`,[organization.id,`daily-summary:${parts.localDate}`,JSON.stringify({
          title:`Reliability summary — ${parts.localDate}`,
          message:`Snapshot for ${parts.localDate}, generated ${new Date(savedSummary.rows[0].generated_at).toLocaleString('en-ZA',{timeZone:timezone})} (${timezone}): ${counts.new} new, ${counts.worsened} worsened, ${counts.recovered} recovered, ${counts.outstanding} outstanding at that time. Later findings may differ. Monitoring ${payload.monitoringFresh?"was current":"needed attention"} at the cutoff.`,
          severity:counts.outstanding?"warning":"info",module:"overview",targetRoute:"/admin/system-diagnostics",code:"DIAGNOSTIC_DAILY_SUMMARY"})]);
      await recordSummaryRecovery(client,organization.id,options.scheduled===true);
      await client.query("COMMIT");
    }catch{await client.query("ROLLBACK").catch(()=>undefined);await recordSummaryFailure(organization.id,false,client);
      console.warn("Diagnostic daily summary failed; generation will retry.");}finally{client.release();}
  }
  }
}

export async function deliverDiagnosticNotificationIntents(){
  const ready=await pool.query("SELECT to_regclass('public.diagnostic_notification_intents') IS NOT NULL AS ready");
  if(!ready.rows[0]?.ready)return;
  const intents=await pool.query<{id:number;organization_id:number;finding_key:string;transition:string;payload:Record<string,unknown>}>(`
    SELECT id,organization_id,finding_key,transition,payload FROM diagnostic_notification_intents
    WHERE delivered_at IS NULL ORDER BY created_at,id LIMIT 100`);
  for(const intent of intents.rows){
    const payload=intent.payload??{};
    const lease=await pool.connect();
    let claimed=false;
    try{
      const lock=await lease.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS claimed",[`diagnostic-delivery:${intent.id}`]);
      claimed=lock.rows[0]?.claimed===true;
      if(!claimed)continue;
      const pending=await lease.query("SELECT 1 FROM diagnostic_notification_intents WHERE id=$1 AND delivered_at IS NULL",[intent.id]);
      if(!pending.rowCount)continue;
      await runWithTenantContext({organizationId:intent.organization_id,membershipId:0,userId:0,userRole:"system",membershipRole:"system",
        effectivePermissions:["notifications:create"],correlationId:`diagnostic-intent-${intent.id}`,
        systemActor:{id:"diagnostic-delivery",purpose:"Deliver reliability transition"}},()=>emitNotificationToRoles(["admin"],{
          type:intent.transition==="daily_summary"?"diagnostic_daily_summary":intent.transition==="recovered"?"diagnostic_recovery":"diagnostic_transition",
          deliveryKey:`diagnostic-intent:${intent.id}`,
          title:String(payload.title??"Reliability update"),body:String(payload.message??"Open Diagnostics for details."),
          entityType:"diagnostic_finding",targetPath:String(payload.targetRoute??"/admin/system-diagnostics"),
          findingCode:intent.finding_key,priority:payload.severity==="critical"?"urgent":payload.severity==="error"?"high":"normal",
        }));
      await pool.query("UPDATE diagnostic_notification_intents SET delivered_at=clock_timestamp(),attempts=attempts+1,last_error=NULL WHERE id=$1 AND delivered_at IS NULL",[intent.id]);
    }catch{
      await pool.query("UPDATE diagnostic_notification_intents SET attempts=attempts+1,last_error='Delivery will be retried.' WHERE id=$1",[intent.id]).catch(()=>undefined);
      await recordDiagnosticDeliveryFailure(lease,intent.organization_id);
    }finally{
      if(claimed)await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`diagnostic-delivery:${intent.id}`]).catch(()=>undefined);
      lease.release();
    }
  }
}

export async function readDiagnosticDailySummaries(organizationId:number,page:number,pageSize:number){
  const result=await pool.query(`SELECT to_char(local_date,'YYYY-MM-DD') AS "localDate",timezone,generated_at AS "generatedAt",new_count AS "newCount",
    worsened_count AS "worsenedCount",recovered_count AS "recoveredCount",outstanding_count AS "outstandingCount",
    monitoring_fresh AS "monitoringFresh",payload FROM diagnostic_daily_summaries WHERE organization_id=$1
    ORDER BY local_date DESC LIMIT $2 OFFSET $3`,[organizationId,pageSize,(page-1)*pageSize]);
  const total=await pool.query("SELECT count(*)::int AS total FROM diagnostic_daily_summaries WHERE organization_id=$1",[organizationId]);
  return {items:result.rows,total:Number(total.rows[0]?.total??0),page,pageSize};
}
