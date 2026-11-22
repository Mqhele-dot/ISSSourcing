import {captureCompactSpool} from "./compact-capture-spool";
import type {CompactDatasetReader} from "./compact-dataset-reader";
import {rm} from "node:fs/promises";

/** Invoke while the adapter's read-only observation is open. Close/release that
 * observation after this resolves, before passing the saved scope to a child.
 */
export async function captureCompactDataset(reader:CompactDatasetReader,input:{root:string;organizationId:number;actorId:number;signal?:AbortSignal;quotaBytes?:number}){
  const scope={organizationId:input.organizationId,actorId:input.actorId,dataset:reader.dataset,schemaVersion:reader.schemaVersion,observationReference:reader.observationReference,columns:reader.columns.map(column=>column.key),normalizedFilters:reader.normalizedFilters,sourceInformation:reader.information};
  const capture=await captureCompactSpool({...scope,root:input.root,rows:reader.rows,signal:input.signal,quotaBytes:input.quotaBytes});
  if(capture.manifest.rowCount!==reader.expectedRows){await rm(capture.directory,{recursive:true,force:true});throw new Error("The dataset capture does not match its source count. No workbook was generated.");}
  return {...capture,scope,columns:reader.columns};
}
