import type { PoolClient } from "pg";
import type { DiagnosticFinding } from "../../shared/diagnostics/findings";
import {explainDiagnosticFinding} from '../../shared/diagnostics/findings';

export async function diagnosticStorageReady(client: PoolClient): Promise<boolean> {
  const result = await client.query(`SELECT bool_and(to_regclass('public.' || name) IS NOT NULL) AS ready
    FROM unnest(ARRAY['diagnostic_check_runs','diagnostic_persistent_findings','diagnostic_observations']) name`);
  return result.rows[0]?.ready === true;
}

async function deliveryStorageReady(client: PoolClient): Promise<boolean> {
  const result = await client.query("SELECT to_regclass('public.diagnostic_notification_intents') IS NOT NULL AS ready");
  return result.rows[0]?.ready === true;
}

function severityRank(value: unknown): number {
  return ({ info: 0, warning: 1, error: 2, critical: 3 } as Record<string, number>)[String(value)] ?? 0;
}

export async function readPersistentFindings(client: PoolClient, organizationId: number, page = 1, pageSize = 25) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || ![25,50,100].includes(pageSize)) throw new Error("Invalid diagnostics page");
  const result = await client.query(`SELECT finding_key,lifecycle,first_failed_at,last_failed_at,last_passed_at,
    last_checked_at,occurrences,evidence FROM diagnostic_persistent_findings
    WHERE organization_id=$1 ORDER BY last_checked_at DESC,finding_key LIMIT $2 OFFSET $3`,
  [organizationId,pageSize,(page-1)*pageSize]);
  const count = await client.query("SELECT count(*)::int AS total FROM diagnostic_persistent_findings WHERE organization_id=$1",[organizationId]);
  const scheduleSchema=await client.query("SELECT to_regclass('public.diagnostic_schedules') IS NOT NULL AS ready");
  const schedules=scheduleSchema.rows[0].ready ? (await client.query(`SELECT tier,next_run_at AS "nextRunAt",
    last_completed_at AS "lastCompletedAt",last_outcome AS "lastOutcome",
    next_run_at < now()-interval '5 minutes' AS stale FROM diagnostic_schedules WHERE organization_id=$1 ORDER BY tier`,[organizationId])).rows : [];
  return {items:result.rows.map(row=>({...explainDiagnosticFinding(row.evidence),id:row.finding_key,lifecycle:row.lifecycle,
    firstSeen:row.first_failed_at?.toISOString()??row.evidence.firstSeen,lastSeen:row.last_checked_at.toISOString(),
    lastPassedAt:row.last_passed_at?.toISOString()??null,lastFailedAt:row.last_failed_at?.toISOString()??null,
    occurrences:row.occurrences,evidenceState:row.lifecycle==='resolved'?'historical':'current'})),
  total:count.rows[0].total,page,pageSize,schedules};
}

export async function acknowledgePersistentFinding(client:PoolClient,organizationId:number,findingKey:string){
  return client.query(`UPDATE diagnostic_persistent_findings SET lifecycle='acknowledged'
    WHERE organization_id=$1 AND finding_key=$2 AND lifecycle='open' RETURNING finding_key,lifecycle`,[organizationId,findingKey]);
}

/** A future due date is not evidence that a check ever ran or completed successfully. */
export async function readMonitoringScheduleHealth(client:PoolClient,organizationId:number,observedAt=new Date()){
  const result=await client.query<{tier:string;next_run_at:Date;last_completed_at:Date|null;last_outcome:string|null}>(
    `SELECT tier,next_run_at,last_completed_at,last_outcome FROM diagnostic_schedules
      WHERE organization_id=$1 ORDER BY tier`,[organizationId]);
  const schedules=result.rows;
  const verified=schedules.length===2 && schedules.every(row=>row.last_completed_at!==null);
  const monitoringFresh=verified && schedules.every(row=>row.next_run_at.getTime()>=observedAt.getTime()-300_000);
  const monitoringState=!verified?"unverified":schedules.some(row=>row.last_outcome!=="completed")?"degraded"
    :monitoringFresh?"healthy":"stale";
  return {monitoringFresh,monitoringState};
}

export async function readModuleHealth(client:PoolClient,organizationId:number){
  if(!await diagnosticStorageReady(client))return {state:"setup-required",modules:[],monitoringFresh:false};
  const scheduleSchema=await client.query("SELECT to_regclass('public.diagnostic_schedules') IS NOT NULL AS ready");
  if(!scheduleSchema.rows[0]?.ready)return {state:"setup-required",modules:[],monitoringFresh:false};
  const modules=await client.query(`SELECT COALESCE(evidence->>'category','backend') AS module,
    count(*) FILTER(WHERE lifecycle<>'resolved')::int AS open,
    count(*) FILTER(WHERE lifecycle<>'resolved' AND evidence->>'status'='failed')::int AS failed,
    max(last_checked_at) AS last_checked_at
    FROM diagnostic_persistent_findings WHERE organization_id=$1 GROUP BY 1 ORDER BY 1`,[organizationId]);
  const {monitoringFresh,monitoringState}=await readMonitoringScheduleHealth(client,organizationId);
  const items=modules.rows.map(row=>({module:row.module,state:Number(row.failed)>0?"failed":Number(row.open)>0?"degraded":monitoringState,
    open:Number(row.open),failed:Number(row.failed),lastCheckedAt:row.last_checked_at?.toISOString()??null}));
  return {state:items.some(row=>row.state==="failed")?"failed":items.some(row=>row.state==="degraded")?"degraded":monitoringState,modules:items,monitoringFresh,monitoringState};
}

/** Caller owns transaction. Only freshly executed checks qualify as recovery evidence. */
export async function persistDiagnosticChecks(client: PoolClient, organizationId: number,
  runId: string, checks: DiagnosticFinding[], recoveryPasses: 1 | 2 = 1, scheduled = false) {
  const inserted = await client.query(`INSERT INTO diagnostic_check_runs(id,organization_id)
    VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id`,[runId,organizationId]);
  if (!inserted.rowCount) return; // Idempotent replay cannot increase pass/failure counters.
  await client.query("SELECT pg_advisory_xact_lock(74183,$1)",[organizationId]);
  for (const original of checks) {
    const check=explainDiagnosticFinding(original);
    if (!["working", "failed", "degraded"].includes(check.status)) continue;
    const key = `${check.category}:${check.code.replace(/_PROBE_FAILED$/, "")}${check.resourceKey?`:${check.resourceKey}`:""}`;
    const previous = await client.query(`SELECT lifecycle,consecutive_passes,evidence FROM diagnostic_persistent_findings
      WHERE organization_id=$1 AND finding_key=$2 FOR UPDATE`,[organizationId,key]);
    const old = previous.rows[0];
    const failed = check.status === "failed" || check.status === "degraded";
    const passed = check.status === "working";
    // Query execution failures are transient incidents, even when the underlying
    // rule normally reports a deterministic data condition. Preserve that policy
    // until recovery; a manual refresh must not resolve a failed service probe.
    const transient=check.code.endsWith("_PROBE_FAILED") || check.code==="DATABASE_READINESS" ||
      (old?.lifecycle!=="resolved" && (String(old?.evidence?.code??"").endsWith("_PROBE_FAILED") ||
        old?.evidence?.evidence?.recoveryPolicy==="two_scheduled_successes"));
    const requiredPasses = transient ? 2 : check.code === "AP_BALANCE_RECONCILIATION" ? 1 : recoveryPasses;
    const passes = passed ? Number(old?.consecutive_passes ?? 0)+(requiredPasses===1 || scheduled ? 1 : 0) : 0;
    const lifecycle = failed ? (old?.lifecycle === "acknowledged" ? "acknowledged" : "open")
      : passed && passes >= requiredPasses ? "resolved" : old?.lifecycle ?? "resolved";
    const currentEvidence = passed && old && lifecycle!=="resolved" ? old.evidence : failed && requiredPasses===2
      ? {...check,evidence:{...(check.evidence && typeof check.evidence==="object" && !Array.isArray(check.evidence)?check.evidence:{}),recoveryPolicy:"two_scheduled_successes"}}
      : check;
    await client.query(`INSERT INTO diagnostic_persistent_findings
      (organization_id,finding_key,lifecycle,first_failed_at,last_failed_at,last_passed_at,last_checked_at,
       occurrences,consecutive_passes,evidence)
      VALUES($1,$2,$3,CASE WHEN $4 THEN now() END,CASE WHEN $4 THEN now() END,
        CASE WHEN $5 THEN now() END,now(),CASE WHEN $4 THEN 1 ELSE 0 END,$6,$7::jsonb)
      ON CONFLICT(organization_id,finding_key) DO UPDATE SET lifecycle=EXCLUDED.lifecycle,
        first_failed_at=COALESCE(diagnostic_persistent_findings.first_failed_at,EXCLUDED.first_failed_at),
        last_failed_at=COALESCE(EXCLUDED.last_failed_at,diagnostic_persistent_findings.last_failed_at),
        last_passed_at=COALESCE(EXCLUDED.last_passed_at,diagnostic_persistent_findings.last_passed_at),
        last_checked_at=EXCLUDED.last_checked_at,
        occurrences=diagnostic_persistent_findings.occurrences+EXCLUDED.occurrences,
        consecutive_passes=EXCLUDED.consecutive_passes,evidence=EXCLUDED.evidence`,
    [organizationId,key,lifecycle,failed,passed,passes,JSON.stringify(currentEvidence)]);
    await client.query(`INSERT INTO diagnostic_observations
      (organization_id,run_id,finding_key,evidence,previous_lifecycle,lifecycle)
      VALUES($1,$2,$3,$4::jsonb,$5,$6)`,[organizationId,runId,key,JSON.stringify(check),old?.lifecycle??null,lifecycle]);
    if (!(check.evidence&&typeof check.evidence==='object'&&'observationOnly' in check.evidence&&check.evidence.observationOnly===true)&&await deliveryStorageReady(client)) {
      const transition = failed && (!old || old.lifecycle === "resolved") ? "opened"
        : failed && old && severityRank(check.severity) > severityRank(old.evidence?.severity) ? "worsened"
        : passed && old && old.lifecycle !== "resolved" && lifecycle === "resolved" ? "recovered" : null;
      if (transition) {
        const payload = {
          title: transition === "recovered" ? `Recovered: ${check.title}` : check.title,
          message: transition === "recovered"
            ? scheduled ? "Scheduled monitoring verified that this incident recovered." : "A successful check verified that this finding cleared."
            : check.message,
          severity: check.severity,
          module: check.category,
          targetRoute: check.targetRoute ?? "/admin/system-diagnostics",
          code: check.code,
        };
        await client.query(`INSERT INTO diagnostic_notification_intents
          (organization_id,finding_key,transition,transition_key,payload)
          VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(organization_id,transition_key) DO NOTHING`,
        [organizationId,key,transition,`${runId}:${key}:${transition}`,JSON.stringify(payload)]);
      }
    }
  }
  await client.query("UPDATE diagnostic_check_runs SET completed_at=clock_timestamp(),outcome=COALESCE(outcome,'completed') WHERE id=$1 AND organization_id=$2",[runId,organizationId]);
}
