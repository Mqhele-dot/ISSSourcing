import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { approvalPolicies, type ApprovalPolicy } from "@shared/schema";
import type { ProcurementRepository } from "./repository";

export function roleMatchesPolicy(policyRole: string | null | undefined, actorRole: string): boolean {
  if (!policyRole) return true;
  const normalizedActor = actorRole.trim().toLowerCase();
  if (!normalizedActor) return false;
  if (normalizedActor === "admin") return true;
  const allowedRoles = policyRole
    .split(/[,\s|/]+/)
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  if (allowedRoles.length === 0) return true;
  return allowedRoles.includes(normalizedActor);
}

function selectApplicableRequisitionPolicyFromRows(
  policies: ApprovalPolicy[],
  requisitionTotal: number,
): ApprovalPolicy | undefined {
  return policies
    .filter((policy) => {
      if (!policy.isActive) return false;
      const min = Number(policy.amountMin ?? 0);
      const max = policy.amountMax == null ? Number.POSITIVE_INFINITY : Number(policy.amountMax);
      return requisitionTotal >= min && requisitionTotal <= max;
    })
    .sort((a, b) => Number(b.approvalLevel ?? 0) - Number(a.approvalLevel ?? 0))[0];
}

/** Org-scoped applicable requisition approval policy (highest approval level first). */
export async function getApplicableRequisitionPolicyForOrg(
  organizationId: number,
  requisitionTotal: number,
): Promise<ApprovalPolicy | undefined> {
  const policies = await db
    .select()
    .from(approvalPolicies)
    .where(and(eq(approvalPolicies.organizationId, organizationId), eq(approvalPolicies.entityType, "requisition")));
  return selectApplicableRequisitionPolicyFromRows(policies, requisitionTotal);
}

/** @deprecated Prefer getApplicableRequisitionPolicyForOrg — this ignores organization. */
export async function getApplicableRequisitionPolicy(requisitionTotal: number) {
  const policies = await db.select().from(approvalPolicies).where(eq(approvalPolicies.entityType, "requisition"));
  return selectApplicableRequisitionPolicyFromRows(policies, requisitionTotal);
}

export type ProcurementService = {
  repo: ProcurementRepository;
};

export function createProcurementService(repo: ProcurementRepository): ProcurementService {
  return { repo };
}
