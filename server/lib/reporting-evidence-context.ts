import type { PoolClient } from "pg";
import type { ApprovedReportingRate } from "../../shared/financial-measures";

/** Strict authority for new measures only; does not change legacy currency fallback behavior. */
export async function readReportingEvidenceContext(client: PoolClient, organizationId: number) {
  const result = await client.query<{code:string;places:number}>(`SELECT c.code,c.decimal_places AS places
    FROM app_settings s JOIN currencies c ON c.organization_id=s.organization_id
      AND c.code=upper(trim(s.currency_code)) AND c.active=true
    WHERE s.organization_id=$1 ORDER BY c.id LIMIT 2`,[organizationId]);
  if (result.rows.length !== 1 || !/^[A-Z]{3}$/.test(result.rows[0].code)
    || !Number.isInteger(result.rows[0].places) || result.rows[0].places < 0 || result.rows[0].places > 12) return null;
  return {currencyCode:result.rows[0].code,decimalPlaces:result.rows[0].places};
}

/** Legacy mutable rates are deliberately not inferred to have approval evidence. */
export async function readApprovedReportingRates(client: PoolClient, organizationId: number, toCurrencyCode: string, fromCurrencyCodes: string[]): Promise<ApprovedReportingRate[]> {
  const result = await client.query(`WITH revisions AS (
    SELECT *,lead(approved_at) OVER(PARTITION BY organization_id,source_rate_id ORDER BY version) AS superseded_at
    FROM reporting_fx_revisions WHERE organization_id=$1
  ) SELECT id::text,version,organization_id AS "organizationId",from_currency_code AS "fromCurrencyCode",
    to_currency_code AS "toCurrencyCode",rate::text,effective_at AS "effectiveAt",expires_at AS "expiresAt",
    approved_at AS "approvedAt",superseded_at AS "supersededAt" FROM revisions
    WHERE to_currency_code=$2 AND from_currency_code=ANY($3::text[])`,[organizationId,toCurrencyCode,fromCurrencyCodes]);
  return result.rows.map(row=>({...row,
    effectiveAt:new Date(row.effectiveAt).toISOString(), approvedAt:new Date(row.approvedAt).toISOString(),
    expiresAt:row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    supersededAt:row.supersededAt ? new Date(row.supersededAt).toISOString() : null }));
}
