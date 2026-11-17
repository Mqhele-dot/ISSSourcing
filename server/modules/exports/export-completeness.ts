/** Temporary bounded-export guard until each dataset has a full streaming reader. */
export const quickExportRowLimit=10_000;
export class ExportScopeTooLargeError extends Error {
  readonly code="EXPORT_SCOPE_TOO_LARGE";
  readonly status=422;
  readonly hint="Choose a shorter date range or more specific filters. No partial export was created.";
  constructor(){super("This export contains more than 10,000 rows and cannot be exported completely through the current quick-export path.");}
}
export function requireCompleteQuickExport<T>(rows:T[]):T[]{
  if(rows.length>quickExportRowLimit)throw new ExportScopeTooLargeError();
  return rows;
}
