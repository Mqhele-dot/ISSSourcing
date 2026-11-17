import type {PoolClient} from "pg";
import {z} from "zod";
import {generateFinancialMeasure} from "./financial-measure-service";
import {apAgingBuckets} from "./ap-historical-balances";
import {apObservationScope,readApHistoricalContributions} from './ap-historical-balances';
import {readReportingEvidenceContext,readApprovedReportingRates} from '../../lib/reporting-evidence-context';
import {parseReportingDecimal,formatReportingDecimal} from "../../lib/exact-reporting-decimal";

export const apAgingQuery=z.object({asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),supplierId:z.coerce.number().int().positive().optional(),
  bucket:z.enum(apAgingBuckets).optional(),page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().refine(n=>[25,50,100].includes(n)).default(25),
  runId:z.string().uuid().optional(),disputedRunId:z.string().uuid().optional(),unapprovedRunId:z.string().uuid().optional()}).strict()
  .refine(q=>q.runId||(!q.disputedRunId&&!q.unapprovedRunId),"Related observations require an approved-balance run.");

/** Caller owns a repeatable-read transaction and current Finance/reports authorization. */
export async function buildApAgingReport(c:PoolClient,organizationId:number,actorUserId:number,q:z.infer<typeof apAgingQuery>) {
  const started=performance.now();let sourceEvidenceMs=0,measureAndFreezeMs=0;
  let measures:Array<Record<string,any>>;
  if(q.runId) {
    const ids=[q.runId,q.disputedRunId,q.unapprovedRunId].filter(Boolean);
    const saved=await c.query(`SELECT id,measure,summary,normalized_filters FROM financial_reporting_runs WHERE organization_id=$1 AND id=ANY($2::uuid[])`,[organizationId,ids]);
    const approved=saved.rows.find(r=>r.id===q.runId&&r.measure==='ap_outstanding');
    if(!approved||saved.rowCount!==ids.length||new Set(ids).size!==ids.length) throw Object.assign(new Error("This AP observation is not available in your organization."),{code:"AP_RUN_NOT_FOUND",status:404});
    for(const row of saved.rows) {
      const expected=row.id===q.runId?'ap_outstanding':row.id===q.disputedRunId?'ap_disputed':'ap_unapproved';
      if(row.measure!==expected||row.summary.generatedAt!==approved.summary.generatedAt||JSON.stringify(row.normalized_filters)!==JSON.stringify(approved.normalized_filters)) throw Object.assign(new Error("Choose measures from the same AP observation."),{code:"AP_RUN_SCOPE_MISMATCH",status:400});
    }
    if((q.asOf&&q.asOf!==approved.normalized_filters.asOf)||(q.supplierId&&q.supplierId!==approved.normalized_filters.supplierId)) throw Object.assign(new Error("These filters do not match the saved AP observation. Refresh to create a new one."),{code:"AP_RUN_SCOPE_MISMATCH",status:400});
    measures=saved.rows.map(r=>({id:r.id,measure:r.measure,...r.summary,normalizedFilters:r.normalized_filters,precisionNotice:"Legacy source amounts retain their stored precision; earlier rounding cannot be recovered."}));
  } else {
    measures=[];
    const scope=await apObservationScope(c,organizationId,q.asOf),context=await readReportingEvidenceContext(c,organizationId);
    const sources=await readApHistoricalContributions(c,organizationId,'all',{asOf:q.asOf,supplierId:q.supplierId},scope);
    const rates=context?await readApprovedReportingRates(c,organizationId,context.currencyCode,[...new Set(sources.flatMap(s=>s.currencyCode?[s.currencyCode]:[]))]):[];
    sourceEvidenceMs=performance.now()-started;const freezeStarted=performance.now();
    for(const measure of ['ap_outstanding','ap_disputed','ap_unapproved'] as const){
      const eligible=sources.filter(s=>s.exclusion||(measure==='ap_disputed'?s.balanceStatus==='DISPUTED':measure==='ap_unapproved'?['DRAFT','PENDING_APPROVAL'].includes(s.balanceStatus??''):['APPROVED','SENT','OVERDUE','PARTIALLY_PAID','PAID'].includes(s.balanceStatus??'')));
      measures.push(await generateFinancialMeasure(c,{organizationId,actorUserId,measure,filters:{asOf:q.asOf,supplierId:q.supplierId}},{scope,context,sources:eligible,rates}));
    }
    measureAndFreezeMs=performance.now()-freezeStarted;
  }
  const main=measures.find(m=>m.measure==='ap_outstanding')!;
  const buckets=apAgingBuckets.map(bucket=>({bucket,count:0,excludedCount:0,amount:null as string|null,state:'empty'}));
  const classified=`WITH classified AS (SELECT ordinal,evidence,
    CASE WHEN evidence->>'dueDate' IS NULL THEN 'unknown_due_date'
      WHEN (evidence->>'dueDate')::date-$3::date>30 THEN 'not_due'
      WHEN (evidence->>'dueDate')::date-$3::date>7 THEN 'due_30'
      WHEN (evidence->>'dueDate')::date-$3::date>=0 THEN 'due_7'
      WHEN (evidence->>'dueDate')::date-$3::date>=-30 THEN 'od_1_30'
      WHEN (evidence->>'dueDate')::date-$3::date>=-60 THEN 'od_31_60' ELSE 'od_60p' END AS bucket
    FROM financial_reporting_contributions WHERE organization_id=$1 AND run_id=$2)`;
  const values=[organizationId,main.id,main.asOf];
  const totals=await c.query(classified+` SELECT bucket,count(*) FILTER(WHERE evidence->>'reportingAmount' IS NOT NULL)::int AS included,
    count(*) FILTER(WHERE evidence->>'reportingAmount' IS NULL)::int AS excluded,
    coalesce(sum((evidence->>'reportingAmount')::numeric),0)::text AS amount FROM classified GROUP BY bucket`,values);
  let total=0;
  for(const b of buckets){
    const row=totals.rows.find(row=>row.bucket===b.bucket);b.count=row?.included??0;b.excludedCount=row?.excluded??0;
    if(!q.bucket||b.bucket===q.bucket)total+=b.count+b.excludedCount;
    b.state=main.state==='setup_required'?'setup_required':!b.count&&!b.excludedCount?'empty':!b.count?'unavailable':b.excludedCount?'partial':'complete';
    b.amount=['setup_required','unavailable'].includes(b.state)?null:formatReportingDecimal(parseReportingDecimal(row?.amount??'0'),main.decimalPlaces??2);
  }
  const page=await c.query(classified+` SELECT evidence,bucket FROM classified WHERE ($4::text IS NULL OR bucket=$4) ORDER BY ordinal LIMIT $5 OFFSET $6`,[...values,q.bucket??null,q.pageSize,(q.page-1)*q.pageSize]);
  const items=page.rows.map(({evidence:e,bucket})=>({invoiceId:e.sourceId,invoiceNumber:`Invoice #${e.sourceId}`,href:`/finance/invoices?invoiceId=${encodeURIComponent(e.sourceId)}`,amount:e.reportingAmount,originalAmount:e.amount,originalCurrencyCode:e.currencyCode,currencyCode:main.currencyCode,dueDate:e.dueDate,bucket,balanceEventId:e.balanceEventId,baselineId:e.baselineId,exclusion:e.exclusion}));
  return {items,total,page:q.page,pageSize:q.pageSize,buckets,asOf:main.asOf,timezone:main.timezone,currencyCode:main.currencyCode,generatedAt:main.generatedAt,runId:main.id,
    timingMs:{sourceEvidence:Math.round(sourceEvidenceMs),measureCalculationAndFreeze:Math.round(measureAndFreezeMs),frozenAgingRead:Math.round(performance.now()-started-sourceEvidenceMs-measureAndFreezeMs),total:Math.round(performance.now()-started)},
    disputedRunId:measures.find(m=>m.measure==='ap_disputed')?.id,unapprovedRunId:measures.find(m=>m.measure==='ap_unapproved')?.id,measures,
    notice:measures.length===1?"This frozen observation contains approved AP only. Other exposure measures were not supplied.":"Three separate exposure measures from one observation; do not add them to invoiced value, commitments or recorded payments."};
}
