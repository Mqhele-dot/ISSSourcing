import { useMutation } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import {
  invalidateAfterCaptureWorkflow,
  invalidateAfterInvoiceLifecycle,
  invalidateAfterPaymentBatch,
} from "./ap-invalidate";
import type { ApprovalPreview } from "./types";

export type ApPaymentBatchPayload = {
  paymentMethod: string;
  scheduledDate: string | undefined;
  invoiceIds: number[];
};

export type ApCapturePayload = {
  supplierId: number;
  source: string;
  invoiceNumber: string | undefined;
  totalAmount: number;
  confidenceScore: number;
  reviewerNotes: string | undefined;
  extractedHeader: Record<string, string>;
  extractedLines: unknown[];
};

export function useApWorkspaceMutations(toast: {
  toast: (opts: { title: string; description?: string; variant?: "destructive" }) => void;
}) {
  const { toast: showToast } = toast;

  const createCaptureMutation = useMutation({
    mutationFn: async (payload: ApCapturePayload) =>
      requestJson("POST", "/api/ap/captures", payload),
    onSuccess: async () => {
      await invalidateAfterCaptureWorkflow();
      showToast({ title: "AP capture staged", description: "The invoice capture is now in the AP inbox." });
    },
    onError: (mutationError) =>
      showToast({
        title: "Capture failed",
        description: mutationError instanceof Error ? mutationError.message : String(mutationError),
        variant: "destructive",
      }),
  });

  const promoteCaptureMutation = useMutation({
    mutationFn: (captureId: number) => requestJson("POST", `/api/ap/captures/${captureId}/promote`),
    onSuccess: async () => {
      await invalidateAfterCaptureWorkflow();
      showToast({
        title: "Capture promoted",
        description: "The staged invoice has been converted into an AP invoice.",
      });
    },
    onError: (e) =>
      showToast({
        title: "Promote failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
  });

  const previewApproversMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      requestJson<ApprovalPreview>("GET", `/api/ap/invoices/${invoiceId}/approval-preview`),
    onSuccess: (data) => {
      const summary =
        data.suggestedApprovers.length > 0
          ? data.suggestedApprovers.map((item) => `${item.username} (L${item.approvalLevel})`).join(", ")
          : "No approvers suggested for the current amount band.";
      showToast({ title: "Approval preview", description: summary });
    },
    onError: (mutationError) =>
      showToast({
        title: "Preview failed",
        description: mutationError instanceof Error ? mutationError.message : String(mutationError),
        variant: "destructive",
      }),
  });

  const submitApprovalMutation = useMutation({
    mutationFn: (invoiceId: number) => requestJson("POST", `/api/ap/invoices/${invoiceId}/submit-approval`, {}),
    onSuccess: async () => {
      await invalidateAfterInvoiceLifecycle();
      showToast({ title: "Invoice queued", description: "The invoice is now awaiting approval." });
    },
  });

  const matchInvoiceMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      requestJson("POST", `/api/ap/invoices/${invoiceId}/match`, {
        priceTolerancePct: 2,
        quantityTolerancePct: 2,
        taxTolerancePct: 0,
      }),
    onSuccess: async () => {
      await invalidateAfterInvoiceLifecycle();
      showToast({ title: "Match complete", description: "The invoice match result has been refreshed." });
    },
  });

  const approveInvoiceMutation = useMutation({
    mutationFn: (invoiceId: number) => requestJson("POST", `/api/ap/invoices/${invoiceId}/approve`, {}),
    onSuccess: async () => {
      await invalidateAfterInvoiceLifecycle();
      showToast({
        title: "Invoice approved",
        description: "The invoice is now ready for payment batching.",
      });
    },
  });

  const rejectInvoiceMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      requestJson("POST", `/api/ap/invoices/${invoiceId}/reject`, {
        comment: "Rejected from AP workbench",
      }),
    onSuccess: async () => {
      await invalidateAfterInvoiceLifecycle();
      showToast({
        title: "Invoice rejected",
        description: "The invoice has been sent to exception handling.",
      });
    },
  });

  const createBatchMutation = useMutation({
    mutationFn: (body: ApPaymentBatchPayload) =>
      requestJson("POST", "/api/ap/payment-batches", {
        batchNumber: "",
        status: "PENDING_APPROVAL",
        paymentMethod: body.paymentMethod,
        scheduledDate: body.scheduledDate,
        invoiceIds: body.invoiceIds,
      }),
    onSuccess: async () => {
      await invalidateAfterPaymentBatch();
      showToast({
        title: "Batch created",
        description: "The payment batch is waiting for release approval.",
      });
    },
    onError: (mutationError) =>
      showToast({
        title: "Batch failed",
        description: mutationError instanceof Error ? mutationError.message : String(mutationError),
        variant: "destructive",
      }),
  });

  const approveBatchMutation = useMutation({
    mutationFn: (batchId: number) => requestJson("POST", `/api/ap/payment-batches/${batchId}/approve`, {}),
    onSuccess: async () => {
      await invalidateAfterPaymentBatch();
      showToast({ title: "Batch approved", description: "The payment batch can now be released." });
    },
  });

  const releaseBatchMutation = useMutation({
    mutationFn: (batchId: number) => requestJson("POST", `/api/ap/payment-batches/${batchId}/release`, {}),
    onSuccess: async () => {
      await invalidateAfterPaymentBatch();
      showToast({ title: "Batch released", description: "Payments were posted for the batch items." });
    },
  });

  return {
    createCaptureMutation,
    promoteCaptureMutation,
    previewApproversMutation,
    submitApprovalMutation,
    matchInvoiceMutation,
    approveInvoiceMutation,
    rejectInvoiceMutation,
    createBatchMutation,
    approveBatchMutation,
    releaseBatchMutation,
  };
}
