import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export async function claimDiagnosticSchedule(client: PoolClient, observedAt: Date | null = null) {
  const token=randomUUID();
  const result=await client.query<{organization_id:number;tier:"critical"|"deep"}>(`
    WITH candidate AS (
      SELECT s.organization_id,s.tier FROM diagnostic_schedules s
      JOIN organizations o ON o.id=s.organization_id AND o.active=true
      WHERE s.next_run_at<=coalesce($2::timestamptz,now()) AND (s.lease_until IS NULL OR s.lease_until<coalesce($2::timestamptz,now()))
      ORDER BY s.next_run_at,s.organization_id,s.tier FOR UPDATE OF s SKIP LOCKED LIMIT 1
    ) UPDATE diagnostic_schedules s SET lease_token=$1,lease_until=coalesce($2::timestamptz,now())+interval '2 minutes',last_started_at=coalesce($2::timestamptz,now())
      FROM candidate c WHERE s.organization_id=c.organization_id AND s.tier=c.tier
      RETURNING s.organization_id,s.tier`,[token,observedAt]);
  return result.rows[0]?{...result.rows[0],token}:null;
}

export async function finishDiagnosticSchedule(client:PoolClient, job:{organization_id:number;tier:"critical"|"deep";token:string},success:boolean) {
  return client.query(`UPDATE diagnostic_schedules SET lease_token=NULL,lease_until=NULL,
    last_completed_at=now(),last_outcome=$4,next_run_at=now()+($5::int*interval '1 second')
    WHERE organization_id=$1 AND tier=$2 AND lease_token=$3 AND lease_until>now()`,
  [job.organization_id,job.tier,job.token,success?"completed":"failed",job.tier==="critical"?300:3600]);
}
