import { normalizeApiList, requestJson } from "@/lib/queryClient";

export type MasterCurrencyOption = { code: string; name: string; active?: boolean | null };

export const MASTER_CURRENCIES_QUERY_KEY = ["/api/currencies"] as const;

export async function fetchActiveMasterCurrencies(): Promise<MasterCurrencyOption[]> {
  const raw = await requestJson<unknown>("GET", "/api/currencies");
  return normalizeApiList<MasterCurrencyOption>(raw).filter((c) => c.active !== false);
}

function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const u = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(u) ? u : null;
}

/**
 * Active master-data currencies plus any document/supplier/contract codes so selects stay valid and aligned
 * with supplier portal options (`fetchActiveMasterCurrencies`).
 */
export function currencyOptionsForSelect(
  activeFromMaster: MasterCurrencyOption[],
  extraCodes: (string | null | undefined)[],
): MasterCurrencyOption[] {
  const byCode = new Map(activeFromMaster.map((c) => [c.code.toUpperCase(), { ...c, code: c.code.toUpperCase() }]));
  for (const raw of extraCodes) {
    const code = normalizeCurrencyCode(raw);
    if (!code || byCode.has(code)) continue;
    byCode.set(code, { code, name: code });
  }
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}
