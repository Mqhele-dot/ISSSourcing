import type {PoolClient} from "pg";
import {financialMeasureKeys} from "../../../shared/financial-measures";
import {selectCompactColumns,type CompactDatasetReader,type CompactSourceRow} from "./compact-dataset-reader";
import type {CompactDetailColumn} from "./compact-full-detail-writer";

const keys=["runId","measure","observedAt","calculationVersion","evidenceHash","filters","totalState","totalAmount","reportingCurrency","sourceType","sourceId","sourceRevision","sourceDate","originalAmount","originalCurrency","rate","rateVersion","rateEffectiveAt","reportingAmount","exclusion","taxBasis","dateBasis","notice","asOf","timezone","balanceEventId","baselineId","coverageStartsAt","historyRecordedAt","balanceStatus","rateId","rateAppliedAt","definitionProvenance","correctionId","targetEventId","dueDate","precisionEvidence","sourceEvidence"];
const decimals=new Set(["totalAmount","originalAmount","rate","reportingAmount"]);
const identifiers=new Set(["runId","sourceId","sourceRevision","balanceEventId","baselineId","rateId","correctionId","targetEventId"]);
export const frozenFinancialCompactColumns:CompactDetailColumn[]=keys.map(key=>({key,label:key,kind:decimals.has(key)?"decimal":identifiers.has(key)?"identifier":"text"}));
function literal(value:unknown):string|null{
  if(value===undefined||value===null)return null;
  if(typeof value==='string')return value;
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error("The frozen evidence contains an invalid numeric value.");
  if(typeof value==='object')return JSON.stringify(value);
  if(typeof value==='number'||typeof value==='boolean')return String(value);
  throw new Error("The frozen evidence contains a value that cannot be exported safely.");
}

/** Reads immutable evidence only. authorize must enforce current reporting and
 * source-record access, including access to older runs. It is a trusted server
 * callback, never a request-provided permission assertion.
 */
export async function createFrozenFinancialCompactReader(client:PoolClient,input:{organizationId:number;filters:Record<string,unknown>;columns?:string[];authorize:()=>Promise<void>}):Promise<CompactDatasetReader>{
  if(!Number.isSafeInteger(input.organizationId)||input.organizationId<1)throw new Error("Invalid financial export scope.");
  if(Object.keys(input.filters).some(key=>!['runId','measure'].includes(key)))throw new Error("Only saved runId and measure filters are supported for frozen financial exports.");
  const runId=input.filters.runId,measure=input.filters.measure;
  if(typeof runId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runId)||typeof measure!=='string'||!(financialMeasureKeys as readonly string[]).includes(measure))throw new Error("Choose a valid saved financial run and measure.");
  const columns=selectCompactColumns(frozenFinancialCompactColumns,input.columns);
  await input.authorize();
  const run=await client.query(`SELECT summary,normalized_filters,evidence_hash FROM financial_reporting_runs WHERE organization_id=$1 AND id=$2 AND measure=$3`,[input.organizationId,runId,measure]);
  if(!run.rowCount)throw new Error("The saved financial run is not available in this organization.");
  const saved=run.rows[0],summary=saved.summary;
  if(summary?.spendCubeVersion===1)throw new Error("Spend Cube dimensions require the frozen CSV export. Compact Excel has not been certified for this observation profile.");
  if(!summary||typeof summary!=='object'||typeof saved.evidence_hash!=='string')throw new Error("The saved financial run has incomplete evidence.");
  const counted=await client.query("SELECT count(*)::text AS count FROM financial_reporting_contributions WHERE organization_id=$1 AND run_id=$2",[input.organizationId,runId]);
  const expectedRows=Number(counted.rows[0].count);
  if(!Number.isSafeInteger(expectedRows)||expectedRows<0)throw new Error("The saved contribution count is not valid.");
  const definition=summary.definition;
  const information={runId,measure,evidenceHash:saved.evidence_hash,summary:JSON.stringify(summary),sourceFilters:JSON.stringify(saved.normalized_filters),definitionProvenance:definition?'frozen':'legacy_unverified',notice:"Recorded payments are not proof of bank settlement. This export reproduces saved evidence; it does not recalculate financial measures."};
  async function* rows():AsyncGenerator<CompactSourceRow>{
    let after=-1,emitted=0;
    for(;;){
      const page=await client.query("SELECT ordinal,evidence FROM financial_reporting_contributions WHERE organization_id=$1 AND run_id=$2 AND ordinal>$3 ORDER BY ordinal LIMIT 1000",[input.organizationId,runId,after]);
      for(const record of page.rows){
        const ordinal=Number(record.ordinal),e=record.evidence;
        if(!Number.isSafeInteger(ordinal)||ordinal<=after||!e||typeof e!=='object')throw new Error("The saved contribution order or evidence is not valid.");
        const legacyNumeric=[summary.amount,e.amount,e.rate,e.reportingAmount].some(value=>typeof value==='number');
        const values:Record<string,unknown>={runId,measure,observedAt:summary.generatedAt,calculationVersion:summary.calculationVersion,evidenceHash:saved.evidence_hash,filters:saved.normalized_filters,totalState:summary.state,totalAmount:summary.amount,reportingCurrency:summary.currencyCode,
          sourceType:e.sourceType,sourceId:e.sourceId,sourceRevision:e.sourceRevision,sourceDate:e.date,originalAmount:e.amount,originalCurrency:e.currencyCode,rate:e.rate,rateVersion:e.rateVersion,rateEffectiveAt:e.rateEffectiveAt,reportingAmount:e.reportingAmount,exclusion:e.exclusion,
          taxBasis:definition?.taxBasis,dateBasis:definition?.dateBasis,notice:definition?.notice,asOf:summary.asOf,timezone:summary.timezone,balanceEventId:e.balanceEventId,baselineId:e.baselineId,coverageStartsAt:e.coverageStartsAt,historyRecordedAt:e.historyRecordedAt,balanceStatus:e.balanceStatus,rateId:e.rateId,rateAppliedAt:e.rateAppliedAt,definitionProvenance:information.definitionProvenance,correctionId:e.correctionId,targetEventId:e.targetEventId,dueDate:e.dueDate,
          precisionEvidence:legacyNumeric?'legacy_numeric_source':'stored_text_evidence',sourceEvidence:e};
        const row:CompactSourceRow=Object.create(null);for(const column of columns)row[column.key]=literal(values[column.key]);
        after=ordinal;if(++emitted>expectedRows)throw new Error("The saved contribution count changed during export.");yield row;
      }
      if(page.rows.length<1000)break;
    }
    if(emitted!==expectedRows)throw new Error("The saved contribution capture is incomplete.");
    // Revocation during capture prevents a completed capture being accepted.
    await input.authorize();
  }
  return {dataset:"financial_measure",schemaVersion:"frozen-financial-compact-v1",observationReference:`${runId}:${saved.evidence_hash}`,normalizedFilters:{runId,measure},columns,expectedRows,information,rows:rows()};
}
