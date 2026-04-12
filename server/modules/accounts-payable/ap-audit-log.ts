import { db } from "../../db";
import { auditLogs } from "@shared/schema";

type ApAuditAction =
  | "AP_CAPTURE_CREATED"
  | "AP_CAPTURE_PROMOTED"
  | "AP_INVOICE_MATCHED"
  | "AP_INVOICE_SUBMITTED"
  | "AP_INVOICE_APPROVED"
  | "AP_INVOICE_REJECTED"
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
  await db.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    action: input.action,
    resourceType: input.entityType,
    resourceId: input.entityId,
    details: {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      timestamp: new Date().toISOString(),
      entityType: input.entityType,
      entityId: input.entityId,
      priorState: input.priorState ?? null,
      nextState: input.nextState ?? null,
      reason: input.reason ?? null,
      ...input.extra,
    },
  });
}
