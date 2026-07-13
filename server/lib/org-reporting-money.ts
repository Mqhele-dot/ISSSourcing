import type { AppSettings } from "@shared/schema";
import type { IStorage } from "../storage";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getActiveOrganizationId } from "../organization-context";

/**
 * Fallback when `app_settings` is missing or `currency_code` is unset/invalid (bootstrap, legacy rows).
 * Keep in sync with `normalizeReportingCurrencyCode` fallbacks in document generation.
 */
export const REPORTING_CURRENCY_FALLBACK_CODE = "ZAR";

function isValidIso4217(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Normalize org reporting currency from a loaded settings row (sync). */
export function reportingCurrencyCodeFromAppSettings(settings: AppSettings | null | undefined): string {
  const raw = settings?.currencyCode?.trim().toUpperCase() ?? "";
  if (raw && isValidIso4217(raw)) return raw;
  return REPORTING_CURRENCY_FALLBACK_CODE;
}

export async function getReportingCurrencyCode(storage: IStorage): Promise<string> {
  try {
    const [organization] = await db
      .select({ defaultCurrencyCode: organizations.defaultCurrencyCode })
      .from(organizations)
      .where(eq(organizations.id, getActiveOrganizationId()))
      .limit(1);
    const organizationCode = organization?.defaultCurrencyCode?.trim().toUpperCase() ?? "";
    if (organizationCode && isValidIso4217(organizationCode)) return organizationCode;
    const s = await storage.getAppSettings();
    return reportingCurrencyCodeFromAppSettings(s ?? undefined);
  } catch {
    return REPORTING_CURRENCY_FALLBACK_CODE;
  }
}
