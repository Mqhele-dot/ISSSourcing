import type { ApprovedReportingRate, FinancialContribution, FinancialEvidenceState, FinancialExclusion } from "../../shared/financial-measures";
import { addReportingDecimals, formatReportingDecimal, multiplyReportingDecimals, parseReportingDecimal } from "./exact-reporting-decimal";

/** Evaluate an explicitly authorized source set; callers must apply tenant/RBAC scope first. */
export function buildDatedReportingEvidence(input: {
  organizationId: number;
  currencyCode: string | null;
  decimalPlaces: number;
  generatedAt: string;
  contributions: readonly FinancialContribution[];
  rates: readonly ApprovedReportingRate[];
}) {
  const now = Date.parse(input.generatedAt);
  if (!Number.isInteger(input.decimalPlaces) || input.decimalPlaces < 0 || input.decimalPlaces > 12) throw new Error("Invalid currency precision");
  if (!Number.isFinite(now)) throw new Error("Invalid reporting observation time");
  const configured = input.currencyCode !== null && /^[A-Z]{3}$/.test(input.currencyCode);
  const evidence = input.contributions.map(source => {
    let exclusion: FinancialExclusion | null = source.exclusion ?? null;
    let amount: ReturnType<typeof parseReportingDecimal> | null = null;
    try { amount = source.amount === null ? null : parseReportingDecimal(source.amount); } catch { /* invalid source evidence */ }
    if (!exclusion && !amount) exclusion = "invalid_amount";
    if (!exclusion && (!source.currencyCode || !/^[A-Z]{3}$/.test(source.currencyCode))) exclusion = "missing_currency";
    const date = source.date === null ? NaN : Date.parse(source.date);
    if (!exclusion && !Number.isFinite(date)) exclusion = "missing_date";
    const sameCurrency = configured && source.currencyCode === input.currencyCode;
    const candidates = input.rates.filter(rate => rate.organizationId === input.organizationId
      && rate.fromCurrencyCode === source.currencyCode && rate.toCurrencyCode === input.currencyCode
      && Date.parse(rate.approvedAt) <= now && (!rate.supersededAt || Date.parse(rate.supersededAt) > now)
      && Date.parse(rate.effectiveAt) <= date && (!rate.expiresAt || Date.parse(rate.expiresAt) > date))
      .sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt) || b.version - a.version || b.id.localeCompare(a.id));
    const rate = sameCurrency ? null : candidates[0] ?? null;
    let multiplier: ReturnType<typeof parseReportingDecimal> | null = null;
    try { multiplier = sameCurrency ? parseReportingDecimal("1") : rate ? parseReportingDecimal(rate.rate) : null; } catch { /* invalid rate is unavailable */ }
    if (!exclusion && configured && (!multiplier || multiplier.coefficient <= 0n)) exclusion = "missing_approved_fx";
    const reportingAmount = configured && !exclusion && amount && multiplier
      ? formatReportingDecimal(multiplyReportingDecimals(amount, multiplier), input.decimalPlaces) : null;
    return { ...source, exclusion, reportingAmount, rateId: rate?.id ?? null, rateVersion: rate?.version ?? null,
      rate: sameCurrency ? "1" : rate?.rate ?? null, rateEffectiveAt: rate?.effectiveAt ?? null };
  });
  const included = evidence.filter(row => row.reportingAmount !== null);
  const excluded = evidence.filter(row => row.reportingAmount === null);
  const total = included.reduce((sum, row) => addReportingDecimals(sum, parseReportingDecimal(row.reportingAmount!)), parseReportingDecimal("0"));
  const exclusionTotals = new Map<string, ReturnType<typeof parseReportingDecimal>>();
  for (const row of excluded) {
    if (!row.currencyCode || !/^[A-Z]{3}$/.test(row.currencyCode) || row.amount === null) continue;
    try {
      const amount = parseReportingDecimal(row.amount);
      exclusionTotals.set(row.currencyCode, addReportingDecimals(exclusionTotals.get(row.currencyCode) ?? parseReportingDecimal("0"), amount));
    } catch { /* unknown original values cannot contribute to a subtotal */ }
  }
  const state: FinancialEvidenceState = !configured ? "setup_required" : !evidence.length ? "empty"
    : !included.length ? "unavailable" : excluded.length ? "partial" : "complete";
  return { calculationVersion: "dated-direct-line-rounded-v1", generatedAt: input.generatedAt,
    currencyCode: configured ? input.currencyCode : null, state,
    amount: state === "setup_required" || state === "unavailable" ? null : formatReportingDecimal(total, input.decimalPlaces),
    includedCount: included.length, excludedCount: excluded.length,
    excludedOriginalAmounts: [...exclusionTotals].map(([currencyCode, amount]) => ({ currencyCode, amount: formatReportingDecimal(amount, amount.scale) })),
    evidence };
}
