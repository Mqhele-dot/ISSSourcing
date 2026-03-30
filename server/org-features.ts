import { eq } from "drizzle-orm";
import { db } from "./db";
import { organizationSettings } from "@shared/schema";
import { getActiveOrganizationId } from "./organization-context";
import type { Response } from "express";
import { sendError } from "./api-response";

/** Feature flags from `organization_settings.feature_flags` (explicit `false` disables). */
export async function getFeatureFlagsForActiveOrg(): Promise<Record<string, boolean>> {
  const orgId = getActiveOrganizationId();
  const [row] = await db
    .select({ featureFlags: organizationSettings.featureFlags })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1);
  return (row?.featureFlags as Record<string, boolean> | null) ?? {};
}

/** When flag is explicitly `false`, the feature is off; missing/undefined defaults to allowed. */
export function isOrgFeatureEnabled(flags: Record<string, boolean>, key: string): boolean {
  return flags[key] !== false;
}

export function sendOrgFeatureDisabled(res: Response, feature: string): void {
  sendError(res, 403, "FEATURE_DISABLED", `Feature "${feature}" is not enabled for this organization.`, {
    hint: "Update organization_settings.feature_flags for your plan.",
  });
}
