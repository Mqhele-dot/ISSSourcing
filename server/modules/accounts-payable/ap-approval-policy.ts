import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { approvalPolicies, users } from "@shared/schema";
import { authorizeApprovalStep } from "../../services/approval-workflow-service";
import {governanceEnabled,GovernanceError} from "../rbac/governance-context";
import {paymentPolicyRoleMatches} from "./payment-risk";

export type ApApprovalEntityType = "invoice" | "payment_batch";

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
  entityId: number;
  amount: number;
  actorUserId: number;
  actorRole: string;
}) {
  const actor = await db.select().from(users).where(eq(users.id, params.actorUserId)).limit(1);
  if (actor.length === 0) {
    throw new Error("Approver user is not valid.");
  }
  const governed=await governanceEnabled(params.organizationId,"payment_risk");
  const step=await authorizeApprovalStep({
    ...params,
    actorPreferences: actor[0].preferences,
  },db,{independent:governed});
  const customRoleId=Number((actor[0].preferences as Record<string,unknown>|null)?.customRoleId)||null;
  if(governed&&!paymentPolicyRoleMatches(step.progress.nextPolicy?.approverRole,params.actorRole,customRoleId))
    throw new GovernanceError("APPROVER_ROLE_REQUIRED","The current invoice approval level does not explicitly authorize this role. Administrator overrides do not bypass the configured approval authority.",403);
  return step;
}
