import type { Response } from "express";
import { getOrgPlanLimits } from "./org-feature-registry";
import { getOrgSubscriptionForActiveOrg } from "./org-features";
import { sendError } from "./api-response";

export type PlanLimitKey = "users" | "warehouses" | "skus";

const PLAN_LIMIT_LABELS: Record<PlanLimitKey, string> = {
  users: "users",
  warehouses: "warehouses",
  skus: "SKUs",
};

export async function ensurePlanLimitAllowsCreate(
  res: Response,
  limitKey: PlanLimitKey,
  currentCount: number,
): Promise<boolean> {
  const subscription = await getOrgSubscriptionForActiveOrg();
  const limit = getOrgPlanLimits(subscription.normalizedPlanTier)[limitKey];
  if (limit == null || currentCount < limit) return true;

  sendError(
    res,
    403,
    "PLAN_LIMIT_EXCEEDED",
    `Your ${subscription.normalizedPlanTier} plan allows ${limit} ${PLAN_LIMIT_LABELS[limitKey]}.`,
    {
      hint: `Upgrade your plan or reduce ${PLAN_LIMIT_LABELS[limitKey]} before creating another record.`,
      details: {
        planTier: subscription.normalizedPlanTier,
        limitKey,
        limit,
        currentCount,
      },
    },
  );
  return false;
}
