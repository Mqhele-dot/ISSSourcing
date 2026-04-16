import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import { apQueryKeys } from "./ap-query-keys";
import type {
  ApprovalQueue,
  Capture,
  Exceptions,
  Invoice,
  Overview,
  PaymentBatch,
  Supplier,
} from "./types";

export function useApWorkspaceQueries() {
  const {
    data: overview,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: apQueryKeys.overview,
    queryFn: () => requestJson<Overview>("GET", "/api/ap/overview"),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers", "ap"],
    queryFn: () => requestJson<Supplier[]>("GET", "/api/suppliers"),
  });

  const { data: captures = [] } = useQuery({
    queryKey: apQueryKeys.captures,
    queryFn: () => requestJson<Capture[]>("GET", "/api/ap/captures"),
  });

  const { data: approvalQueue = { invoices: [], paymentBatches: [] } } = useQuery({
    queryKey: apQueryKeys.approvalQueue,
    queryFn: () => requestJson<ApprovalQueue>("GET", "/api/ap/approval-queue"),
  });

  const { data: exceptions = { captureExceptions: [], matchExceptions: [], disputedInvoices: [] } } = useQuery({
    queryKey: apQueryKeys.exceptions,
    queryFn: () => requestJson<Exceptions>("GET", "/api/ap/exceptions"),
  });

  const { data: paymentBatches = [] } = useQuery({
    queryKey: apQueryKeys.paymentBatches,
    queryFn: () => requestJson<PaymentBatch[]>("GET", "/api/ap/payment-batches"),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: apQueryKeys.invoices,
    queryFn: () => requestJson<Invoice[]>("GET", "/api/ap/invoices"),
  });

  const readyForBatch = useMemo(
    () => invoices.filter((invoice) => ["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(String(invoice.status))),
    [invoices],
  );

  return {
    overview,
    suppliers,
    captures,
    approvalQueue,
    exceptions,
    paymentBatches,
    invoices,
    readyForBatch,
    isLoading,
    isError,
    error,
    refetch,
  };
}
