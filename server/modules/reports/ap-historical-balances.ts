import type {PoolClient} from "pg";
import type {FinancialContribution,FinancialExclusion,FinancialMeasure} from "../../../shared/financial-measures";
import {parseReportingDecimal,addReportingDecimals} from "../../lib/exact-reporting-decimal";
import {OrganizationCalendarError,readOrganizationCalendar} from "../../lib/organization-calendar";

const error=(code:string,message:string,status=400)=>Object.assign(new Error(message),{code,status});
export const apAgingBuckets=["not_due","due_7","due_30","od_1_30","od_31_60","od_60p","unknown_due_date"] as const;
export type ApAgingBucket=typeof apAgingBuckets[number];

export const apHistoricalEvidenceQuery=`WITH universe AS (
    SELECT id AS invoice_id FROM invoices WHERE organization_id=$1 AND supplier_id IS NOT NULL
    UNION SELECT invoice_id FROM ap_balance_events WHERE organization_id=$1 AND recorded_at<=$3
  ), chosen AS MATERIALIZED (
    SELECT DISTINCT ON(invoice_id) * FROM ap_balance_events WHERE organization_id=$1 AND effective_at<$2 AND recorded_at<=$3
    ORDER BY invoice_id,effective_at DESC,id DESC
  ), origins AS MATERIALIZED (
    SELECT DISTINCT ON(invoice_id) invoice_id,id,effective_at FROM ap_balance_events WHERE organization_id=$1
    AND effective_at<$2 AND recorded_at<=$3 AND actor_user_id IS NOT NULL AND event_kind IN ('CREATED','OPENING_BASELINE')
    ORDER BY invoice_id,effective_at DESC,id DESC
  ), gaps AS MATERIALIZED (
    SELECT DISTINCT e.invoice_id FROM ap_balance_events e JOIN origins o ON o.invoice_id=e.invoice_id
    WHERE e.organization_id=$1 AND e.actor_user_id IS NULL AND e.effective_at>=o.effective_at AND e.effective_at<$2 AND e.recorded_at<=$3
    AND NOT EXISTS(SELECT 1 FROM ap_balance_events correction WHERE correction.organization_id=$1 AND correction.target_event_id=e.id AND correction.event_kind='CORRECTION' AND correction.actor_user_id IS NOT NULL AND correction.recorded_at<=$3 AND correction.effective_at<$2)
  ) SELECT u.invoice_id,e.id::text AS event_id,e.baseline_id::text,e.correction_request_id::text,e.target_event_id::text,e.snapshot,e.recorded_at,o.effective_at AS coverage_start,
    g.invoice_id IS NOT NULL AS capture_gap,
    CASE WHEN $5::boolean AND i.id IS NOT NULL AND e.id IS NOT NULL THEN (e.snapshot-'deleted')=ap_reporting_invoice_snapshot(to_jsonb(i)) ELSE true END AS reconciled
    FROM universe u LEFT JOIN chosen e ON e.invoice_id=u.invoice_id LEFT JOIN origins o ON o.invoice_id=u.invoice_id
    LEFT JOIN gaps g ON g.invoice_id=u.invoice_id LEFT JOIN invoices i ON i.organization_id=$1 AND i.id=u.invoice_id
    WHERE ($4::int IS NULL OR COALESCE((e.snapshot->>'supplierId')::int,i.supplier_id)=$4)
    ORDER BY u.invoice_id`;

export async function apObservationScope(c:PoolClient,organizationId:number,asOf?:string) {
  const {timezone,today}=await readOrganizationCalendar(c,organizationId).catch((e:unknown)=>{
    if(!(e instanceof OrganizationCalendarError)) throw e;
    if(e.reason==="missing_organization") throw error("AP_ORGANIZATION_UNAVAILABLE",e.message,403);
    throw error("AP_TIMEZONE_SETUP_REQUIRED",e.message,409);
  });
  const day=asOf??today;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day||day>today) throw error("AP_INVALID_AS_OF","Choose a valid as-of date no later than today in your organization's timezone.");
  const times=(await c.query("SELECT ($1::date+1)::timestamp AT TIME ZONE $2 AS cutoff,transaction_timestamp() AS observed",[day,timezone])).rows[0];
  return {asOf:day,timezone,cutoff:times.cutoff,observed:times.observed,today};
}

/** One bulk evidence query. No reconstruction from current editable amounts. */
export async function readApHistoricalContributions(c:PoolClient,organizationId:number,measure:FinancialMeasure|'all',filters:{asOf?:string;supplierId?:number},preparedScope?:Awaited<ReturnType<typeof apObservationScope>>):Promise<FinancialContribution[]> {
  const scope=preparedScope??await apObservationScope(c,organizationId,filters.asOf);
  const rows=await c.query(apHistoricalEvidenceQuery,[organizationId,scope.cutoff,scope.observed,filters.supplierId??null,scope.asOf===scope.today]);
  const approved=new Set(["APPROVED","SENT","OVERDUE","PARTIALLY_PAID","PAID"]),unapproved=new Set(["DRAFT","PENDING_APPROVAL"]);
  return rows.rows.flatMap(row=>{
    const s=row.snapshot as {deleted?:boolean;status?:string;remainingBalance?:string;total?:string;paidAmount?:string;issueDate?:string;currencyCode?:string;dueDate?:string}|null;
    let exclusion:FinancialExclusion|undefined=!row.coverage_start?"missing_balance_history":row.capture_gap?"unverified_balance_actor":s?.deleted===true?"balance_source_deleted":!row.reconciled?"unreconciled_balance":undefined;
    const status=String(s?.status??"").toUpperCase();
    let balance:ReturnType<typeof parseReportingDecimal>|null=null;
    if(!exclusion) {
      try {
        balance=parseReportingDecimal(String(s?.remainingBalance));
        const total=parseReportingDecimal(String(s?.total)),paid=parseReportingDecimal(String(s?.paidAmount));
        const sum=addReportingDecimals(paid,balance);
        if(balance.coefficient<0n||paid.coefficient<0n||total.coefficient*10n**BigInt(sum.scale)!==sum.coefficient*10n**BigInt(total.scale)||(status==="PAID"&&balance.coefficient!==0n)) exclusion="unreconciled_balance";
      }catch {exclusion="unreconciled_balance";}
      if(!approved.has(status)&&!unapproved.has(status)&&!["DISPUTED","CANCELLED","VOID"].includes(status)) exclusion="unknown_invoice_status";
    }
    const relevant=measure==='all'?(approved.has(status)||status==='DISPUTED'||unapproved.has(status)):measure==="ap_outstanding"?approved.has(status):measure==="ap_disputed"?status==="DISPUTED":unapproved.has(status);
    if(!exclusion&&(!relevant||balance?.coefficient===0n)) return [];
    return [{sourceType:"ap_invoice_balance",sourceId:String(row.invoice_id),sourceRevision:row.event_id??"uncovered",date:s?.issueDate??null,
      amount:s?.remainingBalance??null,currencyCode:s?.currencyCode??null,exclusion,
      balanceEventId:row.event_id??null,baselineId:row.baseline_id??null,correctionId:row.correction_request_id??null,targetEventId:row.target_event_id??null,coverageStartsAt:row.coverage_start?new Date(row.coverage_start).toISOString():null,
      dueDate:apCalendarDay(s?.dueDate??null,scope.timezone),asOf:scope.asOf,balanceStatus:status||null,historyRecordedAt:row.recorded_at?new Date(row.recorded_at).toISOString():null}];
  });
}

export function apCalendarDay(value:string|null,timezone:string):string|null {
  if(!value||!Number.isFinite(Date.parse(value))) return null;
  if(!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const calendar=value.slice(0,10);
    // Date.parse normalizes impossible dates; never pass those through to SQL aging casts.
    if(!/^\d{4}-\d{2}-\d{2}$/.test(calendar))return null;
    const parsed=new Date(`${calendar}T00:00:00Z`);
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===calendar?calendar:null;
  }
  const parts=new Intl.DateTimeFormat("en",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));
  return ["year","month","day"].map(key=>parts.find(p=>p.type===key)!.value).join("-");
}
export function apAgingBucket(dueDate:string|null,asOf:string):ApAgingBucket {
  if(!dueDate||!Number.isFinite(Date.parse(dueDate))) return "unknown_due_date";
  const due=dueDate.slice(0,10),days=Math.round((Date.parse(due)-Date.parse(asOf))/86400000);
  return days>30?"not_due":days>7?"due_30":days>=0?"due_7":days>=-30?"od_1_30":days>=-60?"od_31_60":"od_60p";
}
