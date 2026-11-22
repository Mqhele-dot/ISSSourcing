import pg from "pg";
import { assertDisposableE2eEnvironment } from "./e2e-database-guard.mjs";

assertDisposableE2eEnvironment();
const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await client.connect();
try {
  const requirements = [
    ["sod_conflict_rules","enforcement_mode","immutable_governance_evidence"],
    ["invoices","governance_revision","invoice_governance_revision"],
    ["invoice_items","invoice_id","governed_invoice_line_guard"],
    ["sod_conflict_exceptions","source_evidence",null],
    ["payment_risk_assessments","source_fingerprint","immutable_governance_evidence"],
    ["supplier_bank_revisions","beneficiary_fingerprint","immutable_governance_evidence"],
    ["payment_risk_policy_approvals","source_snapshot","immutable_governance_evidence"],
    ["payment_risk_policy_revisions","source_snapshot","immutable_governance_evidence"],
    ["mdm_procurement_policies","config","governed_risk_policy_write_guard"],
    ["payments","risk_assessment_id","governed_payment_record_guard"],
    ["custom_role_permissions","id","sod_guard_grant"],
    ["supplier_export_publications","policy_version","supplier_export_publication_guard"],
    ["supplier_compliance_approvals","frozen","supplier_compliance_approval_immutable"],
    ["supplier_compliance_publications","effective_at","supplier_compliance_publication_immutable"],
    ["supplier_delivery_observations","evidence","supplier_delivery_observation_immutable"],
    ["contract_obligation_versions","document_sha256","contract_obligation_immutable"],
    ["purchase_budget_policy_evidence","policy_revision","purchase_budget_evidence_immutable"],
    ["purchase_order_budget_provenance","exception_revision","purchase_order_budget_provenance_immutable"],
    ["agreement_release_policy_evidence","snapshot","agreement_release_policy_evidence_immutable"],
    ...(process.env.ENABLE_COMPACT_FULL_DETAIL_TESTS==='1'?[["export_jobs","profile",null],["compact_export_attempts","lease_token",null],["compact_export_publications","capture_sha256","compact_publication_immutable"],["compact_export_workspaces","reserved_bytes","compact_workspace_identity_guard"],["compact_export_workspaces","cleanup_until",null],["compact_export_captures","capture_sha256","compact_capture_evidence_guard"],["compact_export_captures","columns",null]]:[]),
    ["ap_balance_events","source_transaction_id","ap_balance_event_immutable"],
    ["ap_balance_baselines","proposal","ap_baseline_guard"],
    ["invoices","id","ap_invoice_balance_capture"],
    ["reporting_fx_revisions", "applied_at", "reporting_fx_immutable"],
    ["reporting_fx_approvals", "target_snapshot", "reporting_fx_approval_immutable"],
    ["receipt_value_evidence", "source_price_reference", "receipt_value_immutable"],
    ["receipt_value_reversal_evidence", "original_evidence_id", "receipt_reversal_value_immutable"],
    ["financial_reporting_runs", "evidence_hash", "financial_runs_immutable"],
    ["financial_reporting_contributions", "ordinal", "financial_contributions_immutable"],
    ["diagnostic_check_runs", "outcome", null],
    ["diagnostic_observations", "previous_lifecycle", null],
    ["diagnostic_persistent_findings", "lifecycle", null],
    ["diagnostic_schedules", "lease_until", null],
    ["diagnostic_notification_intents", "transition_key", null],
    ["diagnostic_daily_summaries", "local_date", null],
    ["diagnostic_client_events", "received_at", null],
  ];
  for (const [table, column, trigger] of requirements) {
    const result = await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS column_ready,
      ($3::text IS NULL OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.' || $1)
      AND tgname=$3 AND tgenabled IN ('O','A'))) AS trigger_ready`, [table,column,trigger]);
    if (!result.rows[0].column_ready || !result.rows[0].trigger_ready) {
      throw new Error(`Release schema prerequisite missing: ${table}.${column}${trigger ? ` / ${trigger}` : ""}`);
    }
  }
  for (const [table, types] of [
    ["supplier_export_publications",["p","f","c"]],
    ["contract_obligation_versions",["p","f","c","u"]],
    ["purchase_budget_policy_evidence",["p","f","c"]],
    ["purchase_order_budget_provenance",["p","f","c"]],
    ["agreement_release_policy_evidence",["p","f","c"]],
    ...(process.env.ENABLE_COMPACT_FULL_DETAIL_TESTS==='1'?[["compact_export_attempts",["p","u","f","c"]],["compact_export_publications",["p","u","f","c"]],["compact_export_workspaces",["p","u","f","c"]],["compact_export_captures",["p","u","f","c"]]]:[]),
    ["diagnostic_persistent_findings",["p","f","c"]],
    ["diagnostic_schedules",["p","f","c"]],
    ["diagnostic_notification_intents",["p","u","f","c"]],
    ["diagnostic_daily_summaries",["p","f"]],
    ["diagnostic_client_events",["p","f","c"]],
    ["financial_reporting_contributions",["p","f","c"]],
    ["receipt_value_reversal_evidence",["p","u","f","c"]],
  ]) {
    const constraints=await client.query(`SELECT contype FROM pg_constraint
      WHERE conrelid=to_regclass('public.'||$1) AND convalidated`,[table]);
    for(const type of types)if(!constraints.rows.some(row=>row.contype===type))
      throw new Error(`Release schema constraint prerequisite missing: ${table} (${type}).`);
  }
  const apSchema = await client.query(`SELECT to_regprocedure('public.ap_reporting_invoice_snapshot(jsonb)') IS NOT NULL AS snapshot_ready,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.financial_reporting_runs')
      AND conname='financial_reporting_runs_measure_check' AND convalidated
      AND pg_get_constraintdef(oid) LIKE ALL(ARRAY['%''ap_outstanding''%','%''ap_disputed''%','%''ap_unapproved''%'])) AS measures_ready`);
  if (!apSchema.rows[0].snapshot_ready || !apSchema.rows[0].measures_ready) {
    throw new Error("Release schema prerequisite missing: 20261025090000_ap_balance_history.sql (invoice snapshot function or AP reporting measure constraint).");
  }
  for(const index of ["reporting_fx_request_uidx","diagnostic_schedules_due_idx","diagnostic_notification_intents_pending_idx","diagnostic_findings_lifecycle_idx",...(process.env.ENABLE_COMPACT_FULL_DETAIL_TESTS==='1'?["compact_attempt_identity_idx","compact_workspace_quota_idx","compact_workspace_cleanup_idx","compact_workspace_source_identity_idx","compact_capture_job_idx","compact_retry_command_uidx"]:[])]) {
    const result=await client.query("SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||$1) AND indisvalid AND indisready",[index]);
    if(!result.rowCount)throw new Error(`Release schema index prerequisite missing: ${index}.`);
  }
  console.log("Release schema prerequisites verified before fixture initialization.");
} finally { await client.end(); }
