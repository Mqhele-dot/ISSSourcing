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
// Supplier-file confidentiality proof: separate from every prior approval group.
export const supplierExportMigrations = Object.freeze(["20261103160000_supplier_export_publication.sql"]);
// Supplier 360 evidence is not included in prior business migration approvals.
export const supplierObservationMigrations = Object.freeze(["20261108090000_supplier_observations.sql"]);
// Build 2 obligations are not covered by any existing business migration approval.
export const contractObligationMigrations = Object.freeze(["20261109090000_contract_obligations.sql"]);
export const purchaseBudgetEvidenceMigrations = Object.freeze(["20261109100000_purchase_budget_policy_evidence.sql"]);
// Prospective PO binding requires its own business migration approval.
export const purchaseOrderBudgetProvenanceMigrations = Object.freeze(["20261117090000_purchase_order_budget_provenance.sql"]);
// New release-time provenance is not covered by previous business approvals.
export const agreementReleaseEvidenceMigrations = Object.freeze(["20261112090000_agreement_release_policy_evidence.sql"]);
