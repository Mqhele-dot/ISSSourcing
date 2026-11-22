import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { mdmExchangeRates, organizations } from "@shared/schema";
import { appendAuditEvent } from "../../services/audit-chain-service";

export type FxProviderRate = {
  fromCurrencyCode: string;
  toCurrencyCode: string;
  rate: number;
  effectiveDate: Date;
};

export interface FxProviderAdapter {
  readonly name: string;
  fetchRates(reportingCurrencies: string[]): Promise<FxProviderRate[]>;
}

class ConfiguredJsonFxProvider implements FxProviderAdapter {
  readonly name = String(process.env.FX_PROVIDER_NAME ?? "configured-json");

  async fetchRates(reportingCurrencies: string[]): Promise<FxProviderRate[]> {
    const endpoint = process.env.FX_PROVIDER_URL;
    if (!endpoint) throw new Error("FX_PROVIDER_URL is not configured.");
    const response = await fetch(endpoint, {
      headers: process.env.FX_PROVIDER_TOKEN ? { Authorization: `Bearer ${process.env.FX_PROVIDER_TOKEN}` } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`FX provider returned HTTP ${response.status}.`);
    const payload = await response.json() as { rates?: Array<{ from?: unknown; to?: unknown; rate?: unknown; effectiveDate?: unknown }> };
    if (!Array.isArray(payload.rates)) throw new Error("FX provider payload must contain a rates array.");
    const reportingSet = new Set(reportingCurrencies.map((code) => code.toUpperCase()));
    return payload.rates.map((entry) => ({
      fromCurrencyCode: String(entry.from ?? "").trim().toUpperCase(),
      toCurrencyCode: String(entry.to ?? "").trim().toUpperCase(),
      rate: Number(entry.rate),
      effectiveDate: new Date(String(entry.effectiveDate ?? new Date().toISOString())),
    })).filter((rate) => /^[A-Z]{3}$/.test(rate.fromCurrencyCode) && reportingSet.has(rate.toCurrencyCode) && Number.isFinite(rate.rate) && rate.rate > 0 && !Number.isNaN(rate.effectiveDate.getTime()));
  }
}

export function getFxProviderStatus() {
  return {
    provider: String(process.env.FX_PROVIDER_NAME ?? "configured-json"),
    configured: Boolean(process.env.FX_PROVIDER_URL),
    tokenConfigured: Boolean(process.env.FX_PROVIDER_TOKEN),
    scheduleMinutes: Math.max(60, Number(process.env.FX_IMPORT_INTERVAL_MINUTES ?? 1440)),
    contract: { rates: [{ from: "USD", to: "ZAR", rate: 18.25, effectiveDate: "ISO-8601" }] },
  };
}

export async function importFxRatesForOrganizations(adapter: FxProviderAdapter = new ConfiguredJsonFxProvider()) {
  const orgRows = await db.select({ id: organizations.id, reportingCurrency: organizations.defaultCurrencyCode, active: organizations.active }).from(organizations).where(eq(organizations.active, true));
  const reportingCurrencies = [...new Set(orgRows.map((org) => org.reportingCurrency.toUpperCase()))];
  const rates = await adapter.fetchRates(reportingCurrencies);
  const results: Array<{ organizationId: number; imported: number }> = [];
  for (const organization of orgRows) {
    const orgRates = rates.filter((rate) => rate.toCurrencyCode === organization.reportingCurrency.toUpperCase());
    let imported = 0;
    for (const rate of orgRates) {
      const [saved] = await db.insert(mdmExchangeRates).values({
        organizationId: organization.id,
        fromCurrencyCode: rate.fromCurrencyCode,
        toCurrencyCode: rate.toCurrencyCode,
        rate: rate.rate,
        source: adapter.name,
        effectiveDate: rate.effectiveDate,
        manualOverrideAllowed: false,
        active: true,
      }).onConflictDoUpdate({
        target: [mdmExchangeRates.organizationId, mdmExchangeRates.fromCurrencyCode, mdmExchangeRates.toCurrencyCode, mdmExchangeRates.effectiveDate],
        set: { rate: rate.rate, source: adapter.name, active: true },
      }).returning({ id: mdmExchangeRates.id });
      if (saved) imported += 1;
    }
    if (imported > 0) {
      await appendAuditEvent({ organizationId: organization.id, actor: { systemActor: "fx-provider-import" }, action: "FX_RATES_IMPORTED", resourceType: "fx_rate", details: { provider: adapter.name, imported, reportingCurrency: organization.reportingCurrency }, requestId: `fx-import-${Date.now()}` });
    }
    results.push({ organizationId: organization.id, imported });
  }
  return { provider: adapter.name, ratesReceived: rates.length, organizations: results };
}

export async function getFxRateFreshness(organizationId: number) {
  const org = await db.select({ reportingCurrency: organizations.defaultCurrencyCode }).from(organizations).where(and(eq(organizations.id, organizationId), eq(organizations.active, true))).limit(1);
  const rates = await db.select().from(mdmExchangeRates).where(and(eq(mdmExchangeRates.organizationId, organizationId), eq(mdmExchangeRates.toCurrencyCode, org[0]?.reportingCurrency ?? "ZAR"), eq(mdmExchangeRates.active, true)));
  const latest = rates.reduce<Date | null>((current, rate) => !current || rate.effectiveDate > current ? rate.effectiveDate : current, null);
  const ageHours = latest ? (Date.now() - latest.getTime()) / 3_600_000 : null;
  return { reportingCurrency: org[0]?.reportingCurrency ?? null, activeRates: rates.length, latestEffectiveDate: latest, ageHours, stale: ageHours == null || ageHours > 48 };
}
