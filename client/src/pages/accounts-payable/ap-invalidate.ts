import { queryClient } from "@/lib/queryClient";
import { apQueryKeys } from "./ap-query-keys";

async function invalidateAll(keys: readonly (readonly string[])[]) {
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
}

/** After creating or updating captures (stage, promote). */
export async function invalidateAfterCaptureWorkflow() {
  await invalidateAll([
    apQueryKeys.overview,
    apQueryKeys.captures,
    apQueryKeys.exceptions,
    apQueryKeys.approvalQueue,
    apQueryKeys.invoices,
  ]);
}

/** After invoice lifecycle (match, submit, approve, reject). */
export async function invalidateAfterInvoiceLifecycle() {
  await invalidateAll([
    apQueryKeys.overview,
    apQueryKeys.approvalQueue,
    apQueryKeys.invoices,
    apQueryKeys.exceptions,
    apQueryKeys.legacyInvoices,
  ]);
}

/** After payment batch create / approve / release. */
export async function invalidateAfterPaymentBatch() {
  await invalidateAll([
    apQueryKeys.overview,
    apQueryKeys.paymentBatches,
    apQueryKeys.invoices,
    apQueryKeys.approvalQueue,
  ]);
}

/** Preview-only or infrequent full refresh (e.g. legacy compatibility). */
export async function invalidateApOverviewOnly() {
  await invalidateAll([apQueryKeys.overview]);
}
