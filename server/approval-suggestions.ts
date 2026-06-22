import { db } from "./db";
import { approvalPolicies, organizationMembers, users, type User } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getActiveOrganizationId } from "./organization-context";

export type ApproverSuggestion = {
  userId: number;
  username: string;
  fullName: string | null;
  email: string;
  role: string | null;
  approverAmountLimit: number | null;
  matchedPolicyId: number;
  matchedPolicyName: string;
  approvalLevel: number;
};

function canApproveAmount(user: User, amount: number): boolean {
  const role = String(user.role ?? "").toLowerCase();
  if (role === "admin") return true;
  const cap = user.approverAmountLimit != null ? Number(user.approverAmountLimit) : null;
  if (cap == null || !Number.isFinite(cap) || cap <= 0) return true;
  return amount <= cap;
}

/**
 * Users who may approve the given amount for an entity type, derived from active approval_policies.
 */
export async function getApprovalSuggestions(
  entityType: "requisition" | "purchase_order" | "invoice" | "payment_batch",
  amount: number,
): Promise<{
  entityType: string;
  amount: number;
  applicablePolicies: Array<{
    id: number;
    name: string;
    amountMin: number;
    amountMax: number | null;
    approvalLevel: number;
    approverRole: string | null;
    approverUserId: number | null;
  }>;
  suggestedApprovers: ApproverSuggestion[];
}> {
  const amt = Number(amount);
  const orgId = getActiveOrganizationId();
  if (!Number.isFinite(amt) || amt < 0) {
    return { entityType, amount: amt, applicablePolicies: [], suggestedApprovers: [] };
  }

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

  const applicable = policies
    .filter((p) => {
      const min = Number(p.amountMin ?? 0);
      const max = p.amountMax == null ? Number.POSITIVE_INFINITY : Number(p.amountMax);
      return amt >= min && amt <= max;
    })
    .sort((a, b) => a.approvalLevel - b.approvalLevel || a.amountMin - b.amountMin);

  const allUsers = await db
    .select({ user: users })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, orgId));
  const suggested: ApproverSuggestion[] = [];
  const seen = new Set<number>();

  for (const p of applicable) {
    const candidates: User[] = [];
    if (p.approverUserId != null) {
      const u = allUsers.map((row) => row.user).find((x) => x.id === p.approverUserId);
      if (u) candidates.push(u);
    } else if (p.approverRole && String(p.approverRole).trim()) {
      const want = String(p.approverRole).trim().toLowerCase();
      for (const u of allUsers.map((row) => row.user)) {
        if (String(u.role ?? "").toLowerCase() === want) candidates.push(u);
      }
    }

    for (const u of candidates) {
      if (!u.id || seen.has(u.id)) continue;
      if (!canApproveAmount(u, amt)) continue;
      seen.add(u.id);
      suggested.push({
        userId: u.id,
        username: u.username,
        fullName: u.fullName ?? null,
        email: u.email,
        role: u.role ?? null,
        approverAmountLimit: u.approverAmountLimit != null ? Number(u.approverAmountLimit) : null,
        matchedPolicyId: p.id,
        matchedPolicyName: p.name,
        approvalLevel: p.approvalLevel,
      });
    }
  }

  suggested.sort((a, b) => a.approvalLevel - b.approvalLevel || a.username.localeCompare(b.username));

  return {
    entityType,
    amount: amt,
    applicablePolicies: applicable.map((p) => ({
      id: p.id,
      name: p.name,
      amountMin: Number(p.amountMin ?? 0),
      amountMax: p.amountMax == null ? null : Number(p.amountMax),
      approvalLevel: p.approvalLevel,
      approverRole: p.approverRole ?? null,
      approverUserId: p.approverUserId ?? null,
    })),
    suggestedApprovers: suggested,
  };
}
