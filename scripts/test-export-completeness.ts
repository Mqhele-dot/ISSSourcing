import assert from "node:assert/strict";
import {requireCompleteQuickExport,ExportScopeTooLargeError,quickExportRowLimit} from "../server/modules/exports/export-completeness";
for(const length of [0,1,quickExportRowLimit-1,quickExportRowLimit]){
  const rows=Array.from({length},(_,id)=>({id}));assert.equal(requireCompleteQuickExport(rows),rows);
}
assert.throws(()=>requireCompleteQuickExport(Array(quickExportRowLimit+1)),(error:unknown)=>error instanceof ExportScopeTooLargeError&&error.code==="EXPORT_SCOPE_TOO_LARGE"&&error.status===422&&error.hint.includes("No partial export"));
console.log("Quick-export completeness passed: empty/under/at limit unchanged, sentinel row refuses incomplete output with safe guidance.");
