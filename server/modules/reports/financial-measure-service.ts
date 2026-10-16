import type { PoolClient } from "pg";
import type { FinancialMeasure } from "../../../shared/financial-measures";
import { financialMeasureDefinitions } from "../../../shared/financial-measures";
import { buildDatedReportingEvidence } from "../../lib/dated-reporting-evidence";
import { readApprovedReportingRates, readReportingEvidenceContext } from "../../lib/reporting-evidence-context";
import { freezeFinancialReportingRun } from "./financial-reporting-run-store";
import { readFinancialSourceContributions, type FinancialSourceFilters } from "./financial-source-contributions";

/** Caller must authorize the measure and start a REPEATABLE READ transaction.
 * The same source snapshot produces both summary and frozen drilldown evidence. */
export async function generateFinancialMeasure(client: PoolClient, input: {
  organizationId: number; actorUserId: number; measure: FinancialMeasure; filters: FinancialSourceFilters;
}) {
  const context = await readReportingEvidenceContext(client,input.organizationId);
  const sources = await readFinancialSourceContributions(client,input.organizationId,input.measure,input.filters);
  const observed = await client.query<{observed:string}>("SELECT transaction_timestamp()::text AS observed");
  const generatedAt = new Date(observed.rows[0].observed).toISOString();
  const rates = context ? await readApprovedReportingRates(client,input.organizationId,context.currencyCode,
    [...new Set(sources.flatMap(row=>row.currencyCode ? [row.currencyCode] : []))]) : [];
  const result = buildDatedReportingEvidence({organizationId:input.organizationId,
    currencyCode:context?.currencyCode ?? null,decimalPlaces:context?.decimalPlaces ?? 2,generatedAt,contributions:sources,rates});
  const run = await freezeFinancialReportingRun(client,{...input,normalizedFilters:{...input.filters},result});
  return {...run,measure:input.measure,definition:financialMeasureDefinitions[input.measure],
    normalizedFilters:input.filters,precisionNotice:"Legacy source amounts retain their stored precision; earlier rounding cannot be recovered."};
}
