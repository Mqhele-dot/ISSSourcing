function isAdmin(role: string): boolean {
  return role.toLowerCase() === "admin";
}

function requiresOverride(role: string, overrideExplicit: boolean, overrideReason?: string): boolean {
  if (isAdmin(role) && overrideExplicit && overrideReason?.trim()) return false;
  return true;
}

export function assertNotSelfInvoiceApproval(params: {
  actorUserId: number;
  actorRole: string;
  invoiceCreatedBy: number | null | undefined;
  overrideExplicit?: boolean;
  overrideReason?: string;
}) {
  if (!params.invoiceCreatedBy || params.actorUserId !== Number(params.invoiceCreatedBy)) return;
  if (requiresOverride(params.actorRole, Boolean(params.overrideExplicit), params.overrideReason)) {
    throw new Error("Invoice creator cannot approve their own invoice without explicit admin override.");
  }
}

export function assertNotSelfBatchApproval(params: {
  actorUserId: number;
  actorRole: string;
  batchCreatedBy: number | null | undefined;
  overrideExplicit?: boolean;
  overrideReason?: string;
}) {
  if (!params.batchCreatedBy || params.actorUserId !== Number(params.batchCreatedBy)) return;
  if (requiresOverride(params.actorRole, Boolean(params.overrideExplicit), params.overrideReason)) {
    throw new Error("Batch creator cannot approve or release their own batch without explicit admin override.");
  }
}

export function assertBatchReleaseApproverSeparation(params: {
  actorUserId: number;
  actorRole: string;
  approvedByIds: number[];
  overrideExplicit?: boolean;
  overrideReason?: string;
}) {
  if (params.approvedByIds.length === 0) return;
  const allApprovedByActor = params.approvedByIds.every((id) => id === params.actorUserId);
  if (!allApprovedByActor) return;
  if (requiresOverride(params.actorRole, Boolean(params.overrideExplicit), params.overrideReason)) {
    throw new Error(
      "Batch releaser cannot release a batch containing only invoices they approved without explicit admin override.",
    );
  }
}
