import { and, eq, isNull } from "drizzle-orm";
import { companyConfigurationSettings } from "@shared/schema";
import { db } from "./db";
import { COMPANY_CONFIGURATION_REGISTRY } from "./company-configuration-registry";

type ConfigPrimitive = boolean | number | string | null;

function registryDefault(key: string): unknown {
  return COMPANY_CONFIGURATION_REGISTRY.find((definition) => definition.key === key)?.defaultValue;
}

export async function getEffectiveCompanyConfigurationValue<T extends ConfigPrimitive>(
  organizationId: number,
  key: string,
  fallback: T,
): Promise<T> {
  const [override] = await db
    .select()
    .from(companyConfigurationSettings)
    .where(
      and(
        eq(companyConfigurationSettings.organizationId, organizationId),
        eq(companyConfigurationSettings.key, key),
        eq(companyConfigurationSettings.scope, "organization"),
        isNull(companyConfigurationSettings.scopeId),
      ),
    )
    .limit(1);

  const value = override?.value ?? registryDefault(key) ?? fallback;
  if (typeof fallback === "boolean") return Boolean(value) as T;
  if (typeof fallback === "number") {
    const numeric = Number(value);
    return (Number.isFinite(numeric) ? numeric : fallback) as T;
  }
  if (typeof fallback === "string") return String(value) as T;
  return (value ?? fallback) as T;
}
