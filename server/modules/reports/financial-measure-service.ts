import type { PoolClient } from "pg";
import type { FinancialMeasure } from "../../../shared/financial-measures";
import { financialMeasureDefinitions,isApBalanceMeasure } from "../../../shared/financial-measures";
import {apObservationScope} from "./ap-historical-balances";
import { buildDatedReportingEvidence } from "../../lib/dated-reporting-evidence";
import { readApprovedReportingRates, readReportingEvidenceContext } from "../../lib/reporting-evidence-context";
import { freezeFinancialReportingRun } from "./financial-reporting-run-store";
import { readFinancialSourceContributions, type FinancialSourceFilters } from "./financial-source-contributions";
type PreparedObservation={context:Awaited<ReturnType<typeof readReportingEvidenceContext>>;scope:Awaited<ReturnType<typeof apObservationScope>>;sources:Awaited<ReturnType<typeof readFinancialSourceContributions>>;rates:Awaited<ReturnType<typeof readApprovedReportingRates>>};

/** Caller must authorize the measure and start a REPEATABLE READ transaction.
 * The same source snapshot produces both summary and frozen drilldown evidence. */
export async function generateFinancialMeasure(client: PoolClient, input: {
  organizationId: number; actorUserId: number; measure: FinancialMeasure; filters: FinancialSourceFilters;
},prepared?:PreparedObservation) {
  const context = prepared?prepared.context:await readReportingEvidenceContext(client,input.organizationId);
  const scope=prepared?prepared.scope:isApBalanceMeasure(input.measure)?await apObservationScope(client,input.organizationId,input.filters.asOf):null;
  const normalizedFilters=scope?{...input.filters,asOf:scope.asOf}:input.filters;
  const sources = prepared?.sources??await readFinancialSourceContributions(client,input.organizationId,input.measure,normalizedFilters);
  const observed = await client.query<{observed:string}>("SELECT transaction_timestamp()::text AS observed");
  const generatedAt = new Date(observed.rows[0].observed).toISOString();
  const rates = prepared?.rates??(context ? await readApprovedReportingRates(client,input.organizationId,context.currencyCode,
    [...new Set(sources.flatMap(row=>row.currencyCode ? [row.currencyCode] : []))]) : []);
  const calculated = buildDatedReportingEvidence({organizationId:input.organizationId,
    currencyCode:context?.currencyCode ?? null,decimalPlaces:context?.decimalPlaces ?? 2,generatedAt,contributions:sources,rates});
  const result={...calculated,decimalPlaces:context?.decimalPlaces??null,definition:{...financialMeasureDefinitions[input.measure]},...(scope?{asOf:scope.asOf,timezone:scope.timezone,calculationVersion:`${calculated.calculationVersion}+ap-history-v1`,coveragePolicy:"Dates before verified coverage and unverified capture gaps are excluded; no historical reconstruction."}:{})};
  const run = await freezeFinancialReportingRun(client,{...input,normalizedFilters:{...normalizedFilters},result});
  return {...run,measure:input.measure,...(scope?{asOf:scope.asOf,timezone:scope.timezone}:{}),decimalPlaces:context?.decimalPlaces??null,definition:financialMeasureDefinitions[input.measure],
    normalizedFilters,precisionNotice:"Legacy source amounts retain their stored precision; earlier rounding cannot be recovered."};
}
