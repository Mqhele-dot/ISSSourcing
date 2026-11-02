// SQL-only release evidence layered on the canonical schema initializer.
export const releaseMigrations = Object.freeze([
  "20261013090000_financial_reporting_evidence.sql",
  "20261016090000_receipt_reversal_value_evidence.sql",
  "20261017090000_reporting_fx_publication.sql",
  "20261018090000_durable_diagnostic_findings.sql",
  "20261018100000_diagnostic_schedules.sql",
  "20261018110000_diagnostic_delivery_and_ingestion.sql",
]);
// Separate approval boundary: never extend an already-approved local migration batch implicitly.
export const apHistoryMigrations = Object.freeze(["20261025090000_ap_balance_history.sql"]);
// Separate, not-yet-enabled export capability: never append to prior approvals.
export const compactExportMigrations = Object.freeze(["20261028090000_paired_export_artifacts.sql"]);
// Full-detail one-file profile: separate from the earlier paired-artifact approval.
export const compactFullDetailMigrations = Object.freeze(["20261029180000_compact_export_leases.sql"]);
// Publication proof is a NEW approval group, not an extension of old approvals.
export const compactPublicationMigrations = Object.freeze(["20261030120000_compact_export_publication.sql"]);
// Durable private workspaces require their own explicit migration approval.
export const compactWorkspaceMigrations = Object.freeze(["20261030170000_compact_export_workspaces.sql"]);
// Captured source evidence is separate from workspace resource tracking.
export const compactCaptureMigrations = Object.freeze(["20261030180000_compact_capture_evidence.sql"]);
// Retry-command idempotency requires a separately approved canonical audit index.
export const compactRetryMigrations = Object.freeze(["20261101090000_compact_retry_commands.sql"]);
