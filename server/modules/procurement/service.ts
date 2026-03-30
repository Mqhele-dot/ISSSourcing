import { eq } from "drizzle-orm";
import { db } from "../../db";
import { approvalPolicies } from "@shared/schema";
import { createProcurementRepository } from "./repository";

type ProcurementRepo = ReturnType<typeof createProcurementRepository>;

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

/** Resolve the single applicable approval policy row for a requisition total (highest level first). */
export async function getApplicableRequisitionPolicy(requisitionTotal: number) {
  const policies = await db.select().from(approvalPolicies).where(eq(approvalPolicies.entityType, "requisition"));
  return policies
    .filter((policy) => {
      if (!policy.isActive) return false;
      const min = Number(policy.amountMin ?? 0);
      const max = policy.amountMax == null ? Number.POSITIVE_INFINITY : Number(policy.amountMax);
      return requisitionTotal >= min && requisitionTotal <= max;
    })
    .sort((a, b) => Number(b.approvalLevel ?? 0) - Number(a.approvalLevel ?? 0))[0];
}

export type ProcurementService = {
  repo: ProcurementRepo;
};

export function createProcurementService(repo: ProcurementRepo): ProcurementService {
  return { repo };
}
