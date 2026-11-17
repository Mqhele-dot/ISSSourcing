import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { approvalHistory, approvalPolicies, userApprovalLimits, type ApprovalPolicy } from "@shared/schema";
import { roleMatchesPolicy } from "../modules/procurement/service";
import {
  governedApprovalEntityTypes,
  isGovernedApprovalEntityType,
  type GovernedApprovalEntityType,
} from "@shared/authority-catalogs";

export { governedApprovalEntityTypes, isGovernedApprovalEntityType };
export type { GovernedApprovalEntityType };

export type ApprovalWorkflowProgress = {
  state: "not_configured" | "pending" | "approved" | "rejected";
  requiredLevels: number[];
  completedLevels: number[];
  nextPolicy: ApprovalPolicy | null;
  completedApproverIds: number[];
  applicablePolicyVersions: { id: number; level: number; version: number }[];
};

export async function getApprovalWorkflowProgress(input: {
  organizationId: number;
  entityType: GovernedApprovalEntityType;
  entityId: number;
  amount: number;
}, database: Pick<typeof db, "select"> = db, afterHistoryId?: number): Promise<ApprovalWorkflowProgress> {
  const policies = await database
    .select()
    .from(approvalPolicies)
    .where(and(
      eq(approvalPolicies.organizationId, input.organizationId),
      eq(approvalPolicies.entityType, input.entityType),
      eq(approvalPolicies.isActive, true),
    ))
    .orderBy(asc(approvalPolicies.approvalLevel), asc(approvalPolicies.amountMin), asc(approvalPolicies.id));
  const applicable = policies.filter((policy) => {
    const min = Number(policy.amountMin ?? 0);
    const max = policy.amountMax == null ? Number.POSITIVE_INFINITY : Number(policy.amountMax);
    return input.amount >= min && input.amount <= max;
  });
  const history = await database
    .select()
    .from(approvalHistory)
    .where(and(
      eq(approvalHistory.organizationId, input.organizationId),
      eq(approvalHistory.entityType, input.entityType),
      eq(approvalHistory.entityId, input.entityId),
      afterHistoryId === undefined ? undefined : gt(approvalHistory.id, afterHistoryId),
    ))
    .orderBy(asc(approvalHistory.performedAt), asc(approvalHistory.id));
  const rejected = history.some((entry) => String(entry.action).toLowerCase() === "rejected");
  const completedLevels = [...new Set(history
    .filter((entry) => String(entry.action).toLowerCase() === "approved")
    .map((entry) => Number(entry.level))
    .filter((level) => level > 0))];
  const completedApproverIds = [...new Set(history
    .filter((entry) => String(entry.action).toLowerCase() === "approved")
    .map((entry) => Number(entry.performedBy))
    .filter((id) => id > 0))];
  const requiredLevels = [...new Set(applicable.map((policy) => Number(policy.approvalLevel ?? 1)))];
  const nextPolicy = applicable.find((policy) => !completedLevels.includes(Number(policy.approvalLevel ?? 1))) ?? null;
  return {
    state: rejected ? "rejected" : applicable.length === 0 ? "not_configured" : nextPolicy ? "pending" : "approved",
    requiredLevels,
    completedLevels,
    nextPolicy,
    completedApproverIds,
    applicablePolicyVersions: applicable.map(policy=>({id:policy.id,level:Number(policy.approvalLevel??1),version:policy.version})),
  };
}

export async function authorizeApprovalStep(input: {
  organizationId: number;
  entityType: GovernedApprovalEntityType;
  entityId: number;
  amount: number;
  actorUserId: number;
  actorRole: string;
  actorPreferences?: unknown;
  amountCurrency?: string;
}, database: Pick<typeof db, "select"> = db, options: { afterHistoryId?: number; independent?: boolean } = {}): Promise<{ level: number; isFinal: boolean; progress: ApprovalWorkflowProgress }> {
  const [authority] = await database
    .select({ amountLimit: userApprovalLimits.amountLimit, currencyCode: userApprovalLimits.currencyCode })
    .from(userApprovalLimits)
    .where(and(
      eq(userApprovalLimits.organizationId, input.organizationId),
      eq(userApprovalLimits.userId, input.actorUserId),
      eq(userApprovalLimits.entityType, input.entityType),
    ))
    .limit(1);
  const configuredLimit = authority?.amountLimit == null ? null : Number(authority.amountLimit);
  if (authority && input.amountCurrency && authority.currencyCode.toUpperCase() !== input.amountCurrency.toUpperCase()) {
    throw Object.assign(new Error("No matching currency is configured for your approval limit."), { status: 409, code: "APPROVAL_LIMIT_CURRENCY_UNVERIFIED" });
  }
  if (configuredLimit != null && Number.isFinite(configuredLimit) && input.amount > configuredLimit) {
    throw Object.assign(
      new Error(`This approval exceeds your ${input.entityType.replaceAll("_", " ")} limit of ${authority.currencyCode} ${configuredLimit.toFixed(2)}.`),
      { status: 403, code: "APPROVAL_LIMIT_EXCEEDED", limit: configuredLimit, currencyCode: authority.currencyCode },
    );
  }
  const progress = await getApprovalWorkflowProgress(input, database, options.afterHistoryId);
  if (progress.completedApproverIds.includes(input.actorUserId) && (options.independent || input.actorRole.toLowerCase() !== "admin")) {
    throw Object.assign(new Error("A different approver is required for the next approval level."), { status: 403, code: "INDEPENDENT_APPROVER_REQUIRED" });
  }
  const policy = progress.nextPolicy;
  if (!policy) {
    if (progress.state === "not_configured") {
      throw Object.assign(new Error(`No active approval policy is configured for ${input.entityType} at this amount.`), { status: 409, code: "APPROVAL_POLICY_NOT_CONFIGURED" });
    }
    throw Object.assign(new Error("This approval workflow is already complete."), { status: 409, code: "APPROVAL_WORKFLOW_COMPLETE" });
  }
  if (policy.approverUserId != null && Number(policy.approverUserId) !== input.actorUserId && (options.independent || input.actorRole.toLowerCase() !== "admin")) {
    throw Object.assign(new Error("Only the configured approver can complete this approval level."), { status: 403, code: "APPROVER_USER_REQUIRED" });
  }
  if (!roleMatchesPolicy(policy.approverRole, input.actorRole, input.actorPreferences)) {
    throw Object.assign(new Error("Your role is not allowed to complete this approval level."), { status: 403, code: "APPROVER_ROLE_REQUIRED" });
  }
  const level = Number(policy.approvalLevel ?? 1);
  const remainingLevels = progress.requiredLevels.filter((candidate) => !progress.completedLevels.includes(candidate));
  return { level, isFinal: remainingLevels.length === 1, progress };
}
