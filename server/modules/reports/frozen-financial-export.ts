import type { PoolClient } from "pg";
import { financialMeasureDefinitions,type FinancialMeasure } from "../../../shared/financial-measures";
import {assertSpendRunRead} from "./spend-access";

function cell(value:unknown):string {
  const text=value==null?"":typeof value==="object"?JSON.stringify(value):String(value);
  // CSV is opened in spreadsheets; do not permit source identifiers to become formulas.
  const safe=/^[=+@\t\r]/.test(text)||(/^[-]/.test(text)&&!/^-[0-9]+(?:\.[0-9]+)?$/.test(text))?`'${text}`:text;
  return `"${safe.replaceAll('"','""')}"`;
}

/** Reads immutable evidence only. No source queries or FX recalculation. */
export async function streamFrozenFinancialCsv(client:PoolClient,organizationId:number,runId:string,measure:string) {
  const run=await client.query(`SELECT measure,summary,normalized_filters,evidence_hash FROM financial_reporting_runs
    WHERE organization_id=$1 AND id=$2 AND measure=$3`,[organizationId,runId,measure]);
  if(!run.rowCount) return null;
  const saved=run.rows[0];
  await assertSpendRunRead(client,organizationId,measure,saved.summary);
  const definition=saved.summary.definition??financialMeasureDefinitions[measure as FinancialMeasure];
  if(!definition) return null;
  const basis=[definition.taxBasis,definition.dateBasis,"notice" in definition?definition.notice:""];
  const metadata=(e:Record<string,unknown>)=>[saved.summary.asOf,saved.summary.timezone,e.balanceEventId,e.baselineId,e.coverageStartsAt,e.historyRecordedAt,e.balanceStatus,e.rateId,e.rateAppliedAt,saved.summary.definition?"frozen":"legacy_current_definition",e.correctionId,e.targetEventId,
    ...(saved.summary.spendCubeVersion===1?[saved.summary.dimensionNotice,e.dimensions]:[])];
  const columns=["runId","measure","observedAt","calculationVersion","evidenceHash","filters","totalState","totalAmount","reportingCurrency","sourceType","sourceId","originalAmount","originalCurrency","rate","rateVersion","rateEffectiveAt","reportingAmount","exclusion","taxBasis","dateBasis","notice","asOf","timezone","balanceEventId","baselineId","coverageStartsAt","historyRecordedAt","balanceStatus","rateId","rateAppliedAt","definitionProvenance"];
  columns.push("correctionId","targetEventId");
  if(saved.summary.spendCubeVersion===1)columns.push("dimensionBasis","frozenDimensions");
  const count=await client.query(`SELECT count(*)::text AS count FROM financial_reporting_contributions WHERE organization_id=$1 AND run_id=$2`,[organizationId,runId]);
  const rowCount=Number(count.rows[0].count);
  if(!Number.isSafeInteger(rowCount))throw new Error("The export contains too many rows to count safely.");
  async function* chunks(){
  yield columns.map(cell).join(",")+"\r\n";
  let after=-1;
  let emitted=0;
  // Stable keyset batches avoid per-contribution queries and unbounded database responses.
  for(;;) {
    const page=await client.query(`SELECT ordinal,evidence FROM financial_reporting_contributions
      WHERE organization_id=$1 AND run_id=$2 AND ordinal>$3 ORDER BY ordinal LIMIT 1000`,[organizationId,runId,after]);
    for(const {ordinal,evidence:e} of page.rows) {
      yield [runId,measure,saved.summary.generatedAt,saved.summary.calculationVersion,saved.evidence_hash,saved.normalized_filters,
        saved.summary.state,saved.summary.amount,saved.summary.currencyCode,e.sourceType,e.sourceId,e.amount,e.currencyCode,e.rate,e.rateVersion,e.rateEffectiveAt,e.reportingAmount,e.exclusion,...basis,...metadata(e)].map(cell).join(",")+"\r\n";
      after=Number(ordinal);emitted++;
    }
    if(page.rows.length<1000) break;
  }
  if(emitted!==rowCount)throw new Error("The saved export evidence changed while it was being read.");
  if(rowCount===0)yield [runId,measure,saved.summary.generatedAt,saved.summary.calculationVersion,saved.evidence_hash,saved.normalized_filters,saved.summary.state,saved.summary.amount,saved.summary.currencyCode,...Array(9).fill(""),...basis,...metadata({})].map(cell).join(",")+"\r\n";
  }
  return {chunks:chunks(),rowCount};
}

/** Compatibility helper for existing small-data callers; production downloads stream. */
export async function buildFrozenFinancialCsv(client:PoolClient,organizationId:number,runId:string,measure:string){
  const result=await streamFrozenFinancialCsv(client,organizationId,runId,measure);
  if(!result)return null;
  const parts:Buffer[]=[];
  for await(const chunk of result.chunks)parts.push(Buffer.from(chunk,"utf8"));
  return {buffer:Buffer.concat(parts),rowCount:result.rowCount};
}
