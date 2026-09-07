/**
 * Query key roots for AP workspace — keep in sync with `requestJson` paths.
 *
 * - `invoices`: canonical AP list (`/api/ap/invoices`). Mutations that affect invoice lifecycle should
 *   invalidate both `invoices` and `legacyInvoices` when the legacy page (`/api/invoices`) must refresh.
 */
export const apQueryKeys = {
  overview: ["/api/ap/overview"] as const,
  captures: ["/api/ap/captures"] as const,
  approvalQueue: ["/api/ap/approval-queue"] as const,
  exceptions: ["/api/ap/exceptions"] as const,
  paymentBatches: ["/api/ap/payment-batches"] as const,
  invoices: ["/api/ap/invoices"] as const,
  legacyInvoices: ["/api/invoices"] as const,
} as const;
