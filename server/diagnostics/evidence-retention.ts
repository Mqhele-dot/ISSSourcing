import { pool } from "../db";

// Fixed diagnostic-only policy registry. Never accept a table or predicate from a request.
const policies=[
  {table:"diagnostic_client_events",where:"d.received_at<now()-interval '90 days'",order:"d.received_at,d.organization_id,d.user_id,d.client_event_id"},
  {table:"diagnostic_observations",where:"d.observed_at<now()-interval '90 days'",order:"d.observed_at,d.id"},
  {table:"diagnostic_check_runs",where:"d.completed_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM diagnostic_observations o WHERE o.organization_id=d.organization_id AND o.run_id=d.id)",order:"d.completed_at,d.id"},
  {table:"diagnostic_daily_summaries",where:"d.generated_at<now()-interval '365 days'",order:"d.generated_at,d.organization_id,d.local_date"},
  {table:"diagnostic_notification_intents",where:"d.delivered_at IS NOT NULL AND d.delivered_at<now()-interval '365 days'",order:"d.delivered_at,d.id"},
  {table:"diagnostic_persistent_findings",where:"d.lifecycle='resolved' AND d.last_checked_at<now()-interval '365 days'",order:"d.last_checked_at,d.organization_id,d.finding_key"},
] as const;

/** One bounded batch per policy, owned by the existing inbox worker. Backlogs drain on later cycles. */
export async function retainDiagnosticEvidence(batchSize=1000){
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>1000)throw new Error("Invalid diagnostic retention batch size");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'");
    const lease=await client.query("SELECT pg_try_advisory_xact_lock(74220,1) AS claimed");
    if(!lease.rows[0]?.claimed){await client.query("ROLLBACK");return {claimed:false,deleted:{} as Record<string,number>};}
    const deleted:Record<string,number>={};
    for(const policy of policies){
      const result=await client.query(`WITH expired AS (
        SELECT d.ctid FROM ${policy.table} d WHERE ${policy.where}
        ORDER BY ${policy.order} LIMIT $1 FOR UPDATE OF d SKIP LOCKED
      ) DELETE FROM ${policy.table} d USING expired e WHERE d.ctid=e.ctid`,[batchSize]);
      deleted[policy.table]=result.rowCount??0;
    }
    await client.query("COMMIT");return {claimed:true,deleted};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
