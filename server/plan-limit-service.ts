import type { Response } from "express";
import { pool } from "./db";
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

export async function countOrganizationUsers(organizationId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT u.id)::text AS count
      FROM users u
      LEFT JOIN organization_members om
        ON om.user_id = u.id
       AND om.organization_id = $1
      WHERE om.id IS NOT NULL
         OR u.default_organization_id = $1
    `,
    [organizationId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function ensurePlanLimitAllowsCreate(
  res: Response,
  limitKey: PlanLimitKey,
  currentCount: number,
): Promise<boolean> {
  const subscription = await getOrgSubscriptionForActiveOrg();
  const writeAccess = getSubscriptionWriteAccessDecision({
    stripeStatus: subscription.lifecycle.subscriptionStatus,
    currentPeriodEnd: subscription.lifecycle.trialEndsAt ?? subscription.lifecycle.currentPeriodEnd,
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
          limitKey,
          billingStatus: subscription.lifecycle.subscriptionStatus,
          currentPeriodEnd: subscription.lifecycle.currentPeriodEnd,
          trialEndsAt: subscription.lifecycle.trialEndsAt,
        },
      },
    );
    return false;
  }

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
    "PLAN_LIMIT_REACHED",
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
