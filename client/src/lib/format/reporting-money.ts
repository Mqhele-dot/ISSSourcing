import { formatCurrency } from "@/lib/utils";

const DEFAULT_LOCALE = "en-US";

function normalizeCurrencyCode(raw: string | null | undefined): string {
  const c = String(raw ?? "USD")
    .trim()
    .toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  return "USD";
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
      formatMoney: (value: number | null | undefined) => formatCurrency(value, "USD", locale),
      currencyCode: "USD" as const,
    };
  }
  return {
    formatMoney: (value: number | null | undefined) => formatCurrency(value, code, locale),
    currencyCode: code,
  };
}
