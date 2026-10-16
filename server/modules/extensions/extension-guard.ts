import type { NextFunction, Request, Response } from "express";
import { getFeatureFlagsForActiveOrg, isOrgFeatureEnabled, sendOrgFeatureDisabled } from "../../org-features";

/** `organization_settings.feature_flags.extensions === false` disables extension APIs. */
export async function requireExtensionsEnabled(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const flags = await getFeatureFlagsForActiveOrg();
    if (!isOrgFeatureEnabled(flags, "extensions")) {
      sendOrgFeatureDisabled(res, "extensions");
      return;
    }
    next();
  } catch {
    next();
  }
}
