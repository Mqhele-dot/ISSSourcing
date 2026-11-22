import { pool } from "../db";
import { getCanonicalReportingCurrencyCode } from "./org-reporting-money";

export type ReportingFx = {
  reportingCurrencyCode: string;
  rates: Map<string, number>;
};

/** Resolve current effective tenant FX rates into the reporting currency. */
export async function getReportingFx(
  organizationId: number,
  currencyCodes: Iterable<string | null | undefined>,
): Promise<ReportingFx> {
  const reportingCurrencyCode = await getCanonicalReportingCurrencyCode(organizationId);
  const requested = Array.from(
    new Set(
      Array.from(currencyCodes)
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter((value) => /^[A-Z]{3}$/.test(value) && value !== reportingCurrencyCode),
    ),
  );
  const rates = new Map<string, number>([[reportingCurrencyCode, 1]]);
  if (requested.length === 0) return { reportingCurrencyCode, rates };

  const result = await pool.query<{ from_currency_code: string; rate: number }>(
    `
      SELECT DISTINCT ON (upper(from_currency_code))
        upper(from_currency_code) AS from_currency_code,
        rate
      FROM mdm_exchange_rates
      WHERE organization_id = $1
        AND upper(to_currency_code) = $2
        AND upper(from_currency_code) = ANY($3::text[])
        AND COALESCE(active, TRUE) = TRUE
        AND effective_date <= NOW()
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY upper(from_currency_code), effective_date DESC, id DESC
    `,
    [organizationId, reportingCurrencyCode, requested],
  );
  for (const row of result.rows) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate) && rate > 0) rates.set(String(row.from_currency_code).toUpperCase(), rate);
  }
  return { reportingCurrencyCode, rates };
}

export function reportingAmount(amount: unknown, currencyCode: unknown, fx: ReportingFx): number | null {
  const numericAmount = Number(amount);
  const code = String(currencyCode ?? "").trim().toUpperCase();
  const rate = fx.rates.get(code);
  if (!Number.isFinite(numericAmount) || rate == null) return null;
  return numericAmount * rate;
}
