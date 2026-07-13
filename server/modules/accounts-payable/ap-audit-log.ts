import { appendAuditEvent } from "../../services/audit-chain-service";

export type ApAuditAction =
  | "AP_CAPTURE_CREATED"
  | "AP_CAPTURE_PROMOTED"
  | "AP_INVOICE_MATCHED"
  | "AP_INVOICE_SUBMITTED"
  | "AP_INVOICE_APPROVED"
  | "AP_INVOICE_REJECTED"
  | "AP_INVOICE_WITHDRAWN_FROM_APPROVAL"
  | "AP_PAYMENT_BATCH_CREATED"
  | "AP_PAYMENT_BATCH_APPROVED"
  | "AP_PAYMENT_BATCH_RELEASED";

export async function writeApAuditLog(input: {
  organizationId: number;
  actorUserId: number;
  action: ApAuditAction;
  entityType: "capture" | "invoice" | "payment_batch" | "match_result";
  entityId: number;
  priorState?: string | null;
  nextState?: string | null;
  reason?: string | null;
  extra?: Record<string, unknown>;
}) {
  await appendAuditEvent({
    organizationId: input.organizationId,
    actor: { userId: input.actorUserId },
    action: input.action,
    resourceType: input.entityType,
    resourceId: input.entityId,
    before: input.priorState == null ? null : { status: input.priorState },
    after: input.nextState == null ? null : { status: input.nextState },
    reason: input.reason ?? null,
    details: {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      ...input.extra,
    },
  });
}
