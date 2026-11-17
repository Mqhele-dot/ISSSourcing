import { formatCurrency } from "@/lib/utils";
import { REPORTING_CURRENCY_FALLBACK_CODE } from "@/lib/reporting-currency-fallback";

const DEFAULT_LOCALE = "en-US";

function normalizeCurrencyCode(raw: string | null | undefined): string {
  const c = String(raw ?? REPORTING_CURRENCY_FALLBACK_CODE)
    .trim()
    .toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  return REPORTING_CURRENCY_FALLBACK_CODE;
}

/**
 * Creates a stable formatter for org reporting currency. Falls back to USD if Intl rejects the code.
 */
export function createReportingMoneyFormatter(currencyCode: string, locale: string = DEFAULT_LOCALE) {
  const code = normalizeCurrencyCode(currencyCode);
  try {
    new Intl.NumberFormat(locale, { style: "currency", currency: code });
  } catch {
    return {
      formatMoney: (value: number | null | undefined) =>
        formatCurrency(value, REPORTING_CURRENCY_FALLBACK_CODE, locale),
      currencyCode: REPORTING_CURRENCY_FALLBACK_CODE as typeof REPORTING_CURRENCY_FALLBACK_CODE,
    };
  }
  return {
    formatMoney: (value: number | null | undefined) => formatCurrency(value, code, locale),
    currencyCode: code,
  };
}
