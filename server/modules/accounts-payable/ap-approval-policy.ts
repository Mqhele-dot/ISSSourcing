import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { approvalPolicies, users } from "@shared/schema";

export type ApApprovalEntityType = "invoice" | "payment_batch";

function roleMatchesPolicy(requiredRole: string | null | undefined, actorRole: string): boolean {
  if (!requiredRole) return true;
  const want = requiredRole.trim().toLowerCase();
  if (!want) return true;
  return actorRole.toLowerCase() === want || actorRole.toLowerCase() === "admin";
}

export async function resolveApplicablePolicy(
  orgId: number,
  entityType: ApApprovalEntityType,
  amount: number,
) {
  const policies = await db
    .select()
    .from(approvalPolicies)
    .where(
      and(
        eq(approvalPolicies.organizationId, orgId),
        eq(approvalPolicies.entityType, entityType),
        eq(approvalPolicies.isActive, true),
      ),
    );

  return (
    policies
      .filter((policy) => {
        const min = Number(policy.amountMin ?? 0);
        const max = policy.amountMax == null ? Number.POSITIVE_INFINITY : Number(policy.amountMax);
        return amount >= min && amount <= max;
      })
      .sort((a, b) => Number(b.approvalLevel ?? 0) - Number(a.approvalLevel ?? 0))[0] ?? null
  );
}

export async function enforceApprovalPolicy(params: {
  organizationId: number;
  entityType: ApApprovalEntityType;
  amount: number;
  actorUserId: number;
  actorRole: string;
}) {
  const policy = await resolveApplicablePolicy(params.organizationId, params.entityType, params.amount);
  if (!policy) {
    throw new Error(`No active approval policy found for ${params.entityType} amount ${params.amount}.`);
  }

  if (policy.approverUserId != null && Number(policy.approverUserId) !== params.actorUserId) {
    throw new Error("This action requires the configured approver user.");
  }

  if (!roleMatchesPolicy(policy.approverRole, params.actorRole)) {
    throw new Error("Your role is not allowed by the active approval policy.");
  }

  const actor = await db.select().from(users).where(eq(users.id, params.actorUserId)).limit(1);
  if (actor.length === 0) {
    throw new Error("Approver user is not valid.");
  }
  return policy;
}
