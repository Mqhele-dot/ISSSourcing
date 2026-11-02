import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {DiagnosticFinding} from "../../shared/diagnostics/findings";
import {persistDiagnosticChecks} from "./persistent-findings";
import {recordDiagnosticCaptureGap} from "./durable-events";

export const diagnosticDeliveryHealthSql=`WITH completed AS (
  SELECT DISTINCT delivery_key FROM notification_delivery_keys WHERE organization_id=$1 AND completed_at IS NOT NULL
    AND delivery_key LIKE 'diagnostic-intent:%'
) SELECT count(*)::text AS observed,
  count(*) FILTER(WHERE delivered_at IS NULL)::text AS queued,
  count(*) FILTER(WHERE delivered_at IS NULL AND attempts>0)::text AS failed,
  count(*) FILTER(WHERE delivered_at IS NULL AND created_at<now()-interval '5 minutes')::text AS overdue,
  count(*) FILTER(WHERE delivered_at IS NOT NULL AND completed.delivery_key IS NOT NULL)::text AS delivered
  FROM diagnostic_notification_intents i LEFT JOIN completed ON completed.delivery_key='diagnostic-intent:'||i.id
  WHERE organization_id=$1
    AND (delivered_at IS NULL OR delivered_at>now()-interval '1 day')`;
type DeliveryCounts={observed:string;queued:string;failed:string;overdue:string;delivered:string};
export function evaluateDiagnosticDeliveryHealth(rows:DeliveryCounts[]):DiagnosticFinding{
  const counts=rows[0],failed=Number(counts?.failed??0),overdue=Number(counts?.overdue??0),delivered=Number(counts?.delivered??0);
  const timestamp=new Date().toISOString();
  return {id:"notifications:DIAGNOSTIC_DELIVERY:diagnostic-delivery",resourceKey:"diagnostic-delivery",category:"notifications",
    code:"DIAGNOSTIC_DELIVERY",title:"Reliability notification delivery",firstSeen:timestamp,lastSeen:timestamp,occurrences:1,evidenceState:"current",
    status:failed?"failed":overdue?"degraded":delivered?"working":"not_exercised",
    severity:failed?"error":overdue?"warning":"info",
    message:failed?"Some reliability updates could not reach the in-app inbox. The worker will retry; ask an administrator to review delivery history."
      :overdue?"Reliability updates have waited more than five minutes for delivery. Check that the notification worker is running."
      :delivered?"Recent in-app delivery is recorded, with no failed or overdue reliability updates waiting. This does not prove email delivery."
      :"There is no recent completed reliability delivery to verify. New updates may still be waiting for their first attempt.",
    evidence:counts??{},targetRoute:"/admin/system-diagnostics?view=notifications"};
}

/** Persist the known tenant's worker fault independently of a failed inbox insertion. */
export async function recordDiagnosticDeliveryFailure(client:PoolClient,organizationId:number){
  try{
    await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'");
    const timestamp=new Date().toISOString();
    await persistDiagnosticChecks(client,organizationId,randomUUID(),[{
      id:"diagnostic-delivery",resourceKey:"diagnostic-delivery",category:"notifications",code:"DIAGNOSTIC_DELIVERY_PROBE_FAILED",
      title:"Reliability notification delivery failed",message:"A reliability update could not be added to its authorized in-app inbox. The worker will retry; recovery has not been verified.",
      status:"failed",severity:"error",firstSeen:timestamp,lastSeen:timestamp,occurrences:1,evidenceState:"current",targetRoute:"/admin/system-diagnostics?view=notifications",
    }],2,false);
    await client.query("COMMIT");
  }catch{
    await client.query("ROLLBACK").catch(()=>undefined);recordDiagnosticCaptureGap(organizationId);
    console.warn("Reliability delivery failure evidence could not be stored; a capture gap remains.");
  }
}
