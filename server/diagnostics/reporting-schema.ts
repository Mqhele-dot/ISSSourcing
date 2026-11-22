/** Read-only prerequisites: table existence alone cannot establish readiness. */
export const reportingSchemaRequirements = [
  { table: "reporting_fx_revisions", columns: "id organization_id source_rate_id version from_currency_code to_currency_code rate effective_at expires_at approved_at approved_by approval_reference recorded_at applied_at change_request_id withdrawn", trigger: "reporting_fx_immutable" },
  { table: "reporting_fx_approvals", columns: "organization_id change_request_id payload target_snapshot approved_by approved_at", trigger: "reporting_fx_approval_immutable" },
  { table: "receipt_value_evidence", columns: "id organization_id receipt_item_id original_evidence_id quantity unit_price currency_code source_price_reference posted_at actor_user_id", trigger: "receipt_value_immutable" },
  { table: "receipt_value_reversal_evidence", columns: "id organization_id reversal_id original_evidence_id quantity posted_at actor_user_id", trigger: "receipt_reversal_value_immutable" },
  { table: "financial_reporting_runs", columns: "id organization_id actor_user_id measure calculation_version normalized_filters reporting_currency_code generated_at summary evidence_hash", trigger: "financial_runs_immutable" },
  { table: "financial_reporting_contributions", columns: "run_id organization_id ordinal evidence", trigger: "financial_contributions_immutable" },
] as const;

export const reportingSchemaProbeSql = `
WITH requirements AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS r("table" text, columns text, trigger text)
), checks AS (
  SELECT r."table" AS name, to_regclass('public.' || r."table") IS NOT NULL AS present FROM requirements r
  UNION ALL
  SELECT r."table" || '.' || c.name, EXISTS (
    SELECT 1 FROM information_schema.columns a WHERE a.table_schema='public'
      AND a.table_name=r."table" AND a.column_name=c.name
  ) FROM requirements r CROSS JOIN LATERAL unnest(string_to_array(r.columns,' ')) c(name)
  UNION ALL
  SELECT r."table" || ':immutability', EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.' || r."table")
      AND t.tgname=r.trigger AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
  ) FROM requirements r
  UNION ALL
  SELECT 'reporting_fx_request_uidx:unique', EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.reporting_fx_request_uidx')
      AND indisunique AND indisvalid
  )
)
SELECT name,present FROM checks ORDER BY name`;
