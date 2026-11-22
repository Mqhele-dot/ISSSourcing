import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { runWithTenantContext } from "../organization-context";
import { collectDiagnosticFindings } from "./diagnostic-findings-service";
import { diagnosticStorageReady, persistDiagnosticChecks } from "./persistent-findings";
import { claimDiagnosticSchedule, finishDiagnosticSchedule } from "./schedule-store";
import { captureGapFinding, clearCaptureGap } from "./durable-events";

let running=false;
let organizationCursor=0;
export async function runDiagnosticMonitoringCycle(options: {
  database?: typeof pool;
  collect?: typeof collectDiagnosticFindings;
  timeoutMs?: number;
} = {}) {
  if(running)return;
  running=true;
  let client;
  try {
    client=await (options.database ?? pool).connect();
    const schema=await client.query("SELECT to_regclass('public.diagnostic_schedules') IS NOT NULL AS ready");
    if(!schema.rows[0].ready || !await diagnosticStorageReady(client))return;
    const organizations=await client.query("SELECT id FROM organizations WHERE active=true AND id>$1 ORDER BY id LIMIT 25",[organizationCursor]);
    for(const org of organizations.rows) {
      await client.query(`INSERT INTO diagnostic_schedules(organization_id,tier) VALUES($1,'critical'),($1,'deep') ON CONFLICT DO NOTHING`,[org.id]);
      organizationCursor=org.id;
    }
    if(organizations.rows.length<25)organizationCursor=0;
    // One bounded claim per tick; no long transaction while probes execute.
    const job=await claimDiagnosticSchedule(client);
    if(!job)return;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const checks=await Promise.race([runWithTenantContext({organizationId:job.organization_id,membershipId:0,userId:0,
        userRole:"system",membershipRole:"system",effectivePermissions:[],correlationId:job.token,
        systemActor:{id:"diagnostic-worker",purpose:"Read-only scheduled checks"}},
      ()=>(options.collect ?? collectDiagnosticFindings)(job.organization_id,{tier:job.tier})),
        new Promise<never>((_resolve,reject)=> { probeTimer=setTimeout(()=>reject(new Error("DIAGNOSTIC_PROBE_TIMEOUT")),options.timeoutMs ?? 60_000); })]);
      if(probeTimer)clearTimeout(probeTimer);
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='10s'");
      const owned=await finishDiagnosticSchedule(client,job,true);
      const gap=captureGapFinding(job.organization_id);
      if(owned.rowCount)await persistDiagnosticChecks(client,job.organization_id,randomUUID(),
        [...checks.filter(check=>!check.id.startsWith("event:") && check.status!=="not_exercised"),...(gap?[gap]:[])],1,true);
      else await client.query(`INSERT INTO diagnostic_check_runs(id,organization_id,completed_at,outcome,error_code)
        VALUES($1,$2,clock_timestamp(),'lease_expired','DIAGNOSTIC_LEASE_EXPIRED')`,[randomUUID(),job.organization_id]);
      await client.query("COMMIT");
      if(gap && owned.rowCount)clearCaptureGap(job.organization_id);
    } catch (error) {
      await client.query("ROLLBACK").catch(()=>undefined);
      await finishDiagnosticSchedule(client,job,false);
      await client.query(`INSERT INTO diagnostic_check_runs(id,organization_id,completed_at,outcome,error_code)
        VALUES($1,$2,clock_timestamp(),$3,$4) ON CONFLICT DO NOTHING`,[randomUUID(),job.organization_id,
          error instanceof Error && error.message==="DIAGNOSTIC_PROBE_TIMEOUT"?"timed_out":"failed",
          error instanceof Error && error.message==="DIAGNOSTIC_PROBE_TIMEOUT"?"DIAGNOSTIC_PROBE_TIMEOUT":"SCHEDULED_CHECK_FAILED"]).catch(()=>undefined);
      console.warn("Scheduled diagnostic check failed; review monitoring freshness.");
    } finally { if(probeTimer)clearTimeout(probeTimer); }
  } catch {
    console.warn("Diagnostic monitoring unavailable; no successful check was recorded.");
  } finally {client?.release();running=false;}
}

export function startDiagnosticMonitoringWorker(server:Server) {
  if((process.env.NODE_ENV==="test" && process.env.ENABLE_TEST_DIAGNOSTIC_WORKER!=="1") || process.env.LOCAL_TEST_API_ONLY==="1")return;
  let stopped=false;
  let pending:Promise<void>|undefined;
  const tick=()=>{
    if(stopped||pending)return;
    pending=runDiagnosticMonitoringCycle().finally(()=>{pending=undefined;});
  };
  tick();
  const timer=setInterval(tick,10000);
  timer.unref();
  const stop=async()=>{stopped=true;clearInterval(timer);await pending;};
  server.once("close",()=>{void stop();});
  // Existing bootstrap callers may ignore the handle. Isolated verification
  // and graceful shutdown can drain an already running read-only check before
  // releasing fixtures/resources; stopping never fabricates a successful run.
  return {stop};
}
