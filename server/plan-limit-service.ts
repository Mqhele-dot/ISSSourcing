import type { Response } from "express";
import { desc, eq } from "drizzle-orm";
import { billingSubscriptions } from "@shared/schema";
import { db } from "./db";
import { getActiveOrganizationId } from "./organization-context";
import { getOrgPlanLimits } from "./org-feature-registry";
import { getOrgSubscriptionForActiveOrg } from "./org-features";
import { sendError } from "./api-response";
import { buildUsageSummaries, getSubscriptionWriteAccessDecision } from "./subscription-enforcement";

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
  const orgId = getActiveOrganizationId();
  const [billingSubscription] = await db
    .select({
      status: billingSubscriptions.status,
      currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
    })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.organizationId, orgId))
    .orderBy(desc(billingSubscriptions.updatedAt))
    .limit(1);
  const writeAccess = getSubscriptionWriteAccessDecision({
    stripeStatus: billingSubscription?.status ?? "active",
    currentPeriodEnd: billingSubscription?.currentPeriodEnd ?? null,
  });
  if (!writeAccess.allowed) {
    sendError(
      res,
      403,
      writeAccess.code,
      writeAccess.message ?? "Subscription access does not allow new writes.",
      {
        hint: writeAccess.hint,
        details: {
          organizationId: orgId,
          limitKey,
          billingStatus: billingSubscription?.status ?? "active",
          currentPeriodEnd: billingSubscription?.currentPeriodEnd ?? null,
        },
      },
    );
    return false;
  }

  const subscription = await getOrgSubscriptionForActiveOrg();
  const limit = getOrgPlanLimits(subscription.normalizedPlanTier)[limitKey];
  if (limit == null || currentCount < limit) return true;
  const usage = buildUsageSummaries(subscription.limits, {
    users: limitKey === "users" ? currentCount : 0,
    warehouses: limitKey === "warehouses" ? currentCount : 0,
    skus: limitKey === "skus" ? currentCount : 0,
  }).find((entry) => entry.key === limitKey);

  sendError(
    res,
    403,
    "USAGE_LIMIT_REACHED",
    `Your ${subscription.normalizedPlanTier} plan allows ${limit} ${PLAN_LIMIT_LABELS[limitKey]}.`,
    {
      hint: `Upgrade your plan or reduce ${PLAN_LIMIT_LABELS[limitKey]} before creating another record.`,
      details: {
        planTier: subscription.normalizedPlanTier,
        limitKey,
        limit,
        currentCount,
        usage,
      },
    },
  );
  return false;
}
