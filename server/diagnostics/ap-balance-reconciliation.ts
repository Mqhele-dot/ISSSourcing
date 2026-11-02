import type {PoolClient} from "pg";
import type {DiagnosticFinding} from "../../shared/diagnostics/findings";

/** SELECT-only probe. Never creates reporting runs, baselines or corrections. */
export async function collectApBalanceReconciliation(c:PoolClient,organizationId:number,schemaOnly=false):Promise<DiagnosticFinding> {
  const at=new Date().toISOString();
  const base={id:schemaOnly?'ap-history-schema':'ap-balance-reconciliation',category:'consistency' as const,code:schemaOnly?'AP_HISTORY_SCHEMA':'AP_BALANCE_RECONCILIATION',title:schemaOnly?'AP history prerequisites':'AP balance reconciliation',occurrences:1,firstSeen:at,lastSeen:at,evidenceState:'current' as const,targetRoute:'/finance/accounts-payable/aging#opening-baselines'};
  const ready=(await c.query(`SELECT to_regclass('public.ap_balance_events') IS NOT NULL AND to_regclass('public.ap_balance_baselines') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.invoices') AND tgname='ap_invoice_balance_capture' AND tgenabled IN ('O','A'))
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.ap_balance_events') AND tgname='ap_balance_event_immutable' AND tgenabled IN ('O','A')) AS ready`)).rows[0].ready;
  if(!ready) return {...base,severity:'warning',status:'degraded',message:'AP historical reporting requires its additive migration and capture/immutability guards.',evidence:{observationOnly:true,state:'setup_required'},remediation:'Review migration 20261025090000_ap_balance_history.sql through the approved backup and migration process. Do not synthesize opening balances.'};
  if(schemaOnly) return {...base,severity:'info',status:'working',message:'AP history storage and guards are installed. Coverage and runtime verification remain separate.',evidence:{observationOnly:true}};
  const result=await c.query(`WITH latest AS (SELECT DISTINCT ON(invoice_id) * FROM ap_balance_events WHERE organization_id=$1 AND effective_at<=clock_timestamp() ORDER BY invoice_id,effective_at DESC,id DESC),
    coverage AS (SELECT invoice_id,max(effective_at) AS starts_at FROM ap_balance_events WHERE organization_id=$1 AND actor_user_id IS NOT NULL AND event_kind IN ('CREATED','OPENING_BASELINE') GROUP BY invoice_id),
    gaps AS (SELECT DISTINCT e.invoice_id FROM ap_balance_events e JOIN coverage o ON o.invoice_id=e.invoice_id WHERE e.organization_id=$1 AND e.actor_user_id IS NULL AND e.effective_at>=o.starts_at
      AND NOT EXISTS(SELECT 1 FROM ap_balance_events correction WHERE correction.organization_id=$1 AND correction.target_event_id=e.id AND correction.event_kind='CORRECTION' AND correction.actor_user_id IS NOT NULL)),
    problems AS (SELECT i.id,CASE WHEN o.invoice_id IS NULL THEN 'missing_coverage' WHEN g.invoice_id IS NOT NULL THEN 'unverified_capture'
      WHEN l.id IS NULL OR (l.snapshot-'deleted') IS DISTINCT FROM ap_reporting_invoice_snapshot(to_jsonb(i)) THEN 'source_mismatch'
      WHEN CASE WHEN (l.snapshot->>'total')~'^-?[0-9]+([.][0-9]+)?$' AND (l.snapshot->>'paidAmount')~'^-?[0-9]+([.][0-9]+)?$' AND (l.snapshot->>'remainingBalance')~'^-?[0-9]+([.][0-9]+)?$'
        THEN (l.snapshot->>'total')::numeric<>(l.snapshot->>'paidAmount')::numeric+(l.snapshot->>'remainingBalance')::numeric OR (l.snapshot->>'remainingBalance')::numeric<0 ELSE true END THEN 'unreconciled_balance' END AS reason
      FROM invoices i LEFT JOIN latest l ON l.invoice_id=i.id LEFT JOIN coverage o ON o.invoice_id=i.id LEFT JOIN gaps g ON g.invoice_id=i.id WHERE i.organization_id=$1 AND i.supplier_id IS NOT NULL)
    SELECT count(*) FILTER(WHERE reason IS NOT NULL)::int AS total,
      count(*) FILTER(WHERE reason='missing_coverage')::int AS missing_coverage,
      count(*) FILTER(WHERE reason='unverified_capture')::int AS unverified_capture,
      count(*) FILTER(WHERE reason='source_mismatch')::int AS source_mismatch,
      count(*) FILTER(WHERE reason='unreconciled_balance')::int AS unreconciled_balance,
      ARRAY(SELECT id FROM problems WHERE reason IS NOT NULL ORDER BY id LIMIT 25) AS sample_invoice_ids FROM problems`,[organizationId]);
  const evidence=result.rows[0];
  return {...base,severity:evidence.total?'warning':'info',status:evidence.total?'degraded':'working',message:evidence.total?`${evidence.total} supplier invoice(s) have missing or inconsistent AP reporting evidence. No balances were corrected.`:'Captured AP balances agree with current supplier-invoice evidence.',evidence:{...evidence,observationOnly:true},remediation:evidence.total?'Review opening coverage, capture provenance and linked corrections. Financial reports exclude unreliable evidence.':undefined};
}
