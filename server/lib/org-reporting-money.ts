import type { AppSettings } from "@shared/schema";
import type { IStorage } from "../storage";
import { db } from "../db";
import { appSettings, organizations } from "@shared/schema";
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

/**
 * The Production Control Plane is the reporting-currency authority. Legacy
 * organizations may temporarily disagree with app_settings after an upgrade,
 * so reads prefer the tenant settings row until the next settings save repairs
 * both records atomically.
 */
export async function getCanonicalReportingCurrencyCode(organizationId = getActiveOrganizationId()): Promise<string> {
  const [settingsRows, organizationRows] = await Promise.all([
    db
      .select({ currencyCode: appSettings.currencyCode })
      .from(appSettings)
      .where(eq(appSettings.organizationId, organizationId))
      .limit(1),
    db
      .select({ defaultCurrencyCode: organizations.defaultCurrencyCode })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
  ]);
  const settingsCode = settingsRows[0]?.currencyCode?.trim().toUpperCase() ?? "";
  if (settingsCode && isValidIso4217(settingsCode)) return settingsCode;
  const organizationCode = organizationRows[0]?.defaultCurrencyCode?.trim().toUpperCase() ?? "";
  if (organizationCode && isValidIso4217(organizationCode)) return organizationCode;
  return REPORTING_CURRENCY_FALLBACK_CODE;
}

export async function getReportingCurrencyCode(storage: IStorage): Promise<string> {
  try {
    const canonicalCode = await getCanonicalReportingCurrencyCode();
    if (canonicalCode) return canonicalCode;
    const s = await storage.getAppSettings();
    return reportingCurrencyCodeFromAppSettings(s ?? undefined);
  } catch {
    return REPORTING_CURRENCY_FALLBACK_CODE;
  }
}
