import type {CompactDetailColumn} from "./compact-full-detail-writer";

export type CompactSourceRow=Record<string,string|number|boolean|null>;
/** Adapters must authorize before queries, scope every query, use stable bounded
 * iteration and return exact registered fields. No buffered legacy-export wrapper.
 * Information is mandatory source evidence for the future workbook/capture
 * orchestrator; it must not be dropped when a zero-row dataset is exported.
 */
export type CompactDatasetReader={
  dataset:string;schemaVersion:string;observationReference:string;
  normalizedFilters:Record<string,unknown>;columns:CompactDetailColumn[];expectedRows:number;
  information:Record<string,string|null>;rows:AsyncGenerator<CompactSourceRow>;
};

export function selectCompactColumns(registered:CompactDetailColumn[],requested?:string[]){
  if(requested===undefined)return registered.map(column=>({...column}));
  if(!requested.length||new Set(requested).size!==requested.length||requested.some(key=>!registered.some(column=>column.key===key)))throw new Error("Choose distinct registered export columns. Unknown columns are not ignored.");
  return requested.map(key=>({...registered.find(column=>column.key===key)!}));
}
