const INVOICE_TRANSITIONS: Record<string, Set<string>> = {
  DRAFT: new Set(["PENDING_APPROVAL", "DISPUTED", "CANCELLED", "VOID", "SENT"]),
  SENT: new Set(["PENDING_APPROVAL", "DISPUTED", "CANCELLED", "VOID"]),
  PENDING_APPROVAL: new Set(["APPROVED", "DISPUTED", "CANCELLED"]),
  APPROVED: new Set(["PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"]),
  DISPUTED: new Set(["PENDING_APPROVAL", "CANCELLED", "VOID"]),
  OVERDUE: new Set(["PARTIALLY_PAID", "PAID", "DISPUTED", "CANCELLED"]),
  PARTIALLY_PAID: new Set(["PAID", "DISPUTED"]),
  PAID: new Set([]),
  CANCELLED: new Set([]),
  VOID: new Set([]),
};

const PAYMENT_BATCH_TRANSITIONS: Record<string, Set<string>> = {
  DRAFT: new Set(["PENDING_APPROVAL", "CANCELLED"]),
  PENDING_APPROVAL: new Set(["APPROVED", "CANCELLED"]),
  APPROVED: new Set(["RELEASED", "CANCELLED"]),
  RELEASED: new Set([]),
  CANCELLED: new Set([]),
};

function assertTransition(
  transitions: Record<string, Set<string>>,
  currentStatus: string,
  nextStatus: string,
  label: string,
) {
  if (currentStatus === nextStatus) return;
  const allowed = transitions[currentStatus] ?? new Set<string>();
  if (!allowed.has(nextStatus)) {
    throw new Error(`Illegal ${label} transition from ${currentStatus} to ${nextStatus}.`);
  }
}

export function assertInvoiceTransition(currentStatus: string, nextStatus: string) {
  assertTransition(INVOICE_TRANSITIONS, currentStatus, nextStatus, "invoice");
}

export function assertPaymentBatchTransition(currentStatus: string, nextStatus: string) {
  assertTransition(PAYMENT_BATCH_TRANSITIONS, currentStatus, nextStatus, "payment batch");
}
