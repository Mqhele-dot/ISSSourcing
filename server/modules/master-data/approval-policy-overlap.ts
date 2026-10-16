export type ApprovalPolicyCandidate = {
  id?: number;
  entityType: string;
  approvalLevel: number;
  amountMin: number;
  amountMax: number | null;
  isActive: boolean | null;
};

export function approvalRangesOverlap(a: ApprovalPolicyCandidate, b: ApprovalPolicyCandidate): boolean {
  if (a.isActive === false || b.isActive === false) return false;
  if (a.entityType !== b.entityType || a.approvalLevel !== b.approvalLevel) return false;
  const aMax = a.amountMax == null ? Number.POSITIVE_INFINITY : Number(a.amountMax);
  const bMax = b.amountMax == null ? Number.POSITIVE_INFINITY : Number(b.amountMax);
  return Math.max(Number(a.amountMin), Number(b.amountMin)) <= Math.min(aMax, bMax);
}
