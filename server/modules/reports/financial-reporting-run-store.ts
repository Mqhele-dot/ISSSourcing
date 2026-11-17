import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FinancialMeasure } from "../../../shared/financial-measures";
import type { buildDatedReportingEvidence } from "../../lib/dated-reporting-evidence";

type ReportingResult = ReturnType<typeof buildDatedReportingEvidence>;

/** Caller owns the transaction and must select source data under the same snapshot. */
export async function freezeFinancialReportingRun(client: PoolClient, input: {
  organizationId: number; actorUserId: number; measure: FinancialMeasure;
  normalizedFilters: Record<string, unknown>; result: ReportingResult;
}) {
  const id = randomUUID();
  const { evidence, ...summary } = input.result;
  const identities = new Set(evidence.map(row => `${row.sourceType}:${row.sourceId}`));
  if (identities.size !== evidence.length) throw new Error("Duplicate financial source contribution");
  const hash = createHash("sha256").update(JSON.stringify({ measure:input.measure,filters:input.normalizedFilters,summary,evidence })).digest("hex");
  await client.query(`INSERT INTO financial_reporting_runs
    (id,organization_id,actor_user_id,measure,calculation_version,normalized_filters,reporting_currency_code,generated_at,summary,evidence_hash)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10)`,
  [id,input.organizationId,input.actorUserId,input.measure,summary.calculationVersion,JSON.stringify(input.normalizedFilters),summary.currencyCode,summary.generatedAt,JSON.stringify(summary),hash]);
  // One insert for all contributions; no per-row database operations.
  await client.query(`INSERT INTO financial_reporting_contributions(run_id,organization_id,ordinal,evidence)
    SELECT $1,$2,(ordinality-1)::int,value FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY`,
  [id,input.organizationId,JSON.stringify(evidence)]);
  return { id, evidenceHash:hash, ...summary };
}

/** Authentication and current source permissions remain mandatory at the route boundary. */
export async function readFinancialReportingEvidence(client: PoolClient, organizationId: number, runId: string, page: number, pageSize: number) {
  if (!Number.isSafeInteger(page) || page < 1 || ![25,50,100].includes(pageSize) || !Number.isSafeInteger((page-1)*pageSize)) throw new Error("Invalid evidence page");
  const run = await client.query(`SELECT id,measure,normalized_filters AS "normalizedFilters",summary,evidence_hash AS "evidenceHash"
    FROM financial_reporting_runs WHERE organization_id=$1 AND id=$2`,[organizationId,runId]);
  if (!run.rowCount) return null;
  const rows = await client.query(`SELECT evidence FROM financial_reporting_contributions
    WHERE organization_id=$1 AND run_id=$2 ORDER BY ordinal LIMIT $3 OFFSET $4`,[organizationId,runId,pageSize,(page-1)*pageSize]);
  return { ...run.rows[0], items:rows.rows.map(row=>row.evidence),page,pageSize,
    total:Number(run.rows[0].summary.includedCount)+Number(run.rows[0].summary.excludedCount) };
}
