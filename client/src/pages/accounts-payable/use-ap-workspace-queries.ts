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
  const overviewQuery = useQuery({
    queryKey: apQueryKeys.overview,
    queryFn: () => requestJson<Overview>("GET", "/api/ap/overview"),
    throwOnError: false,
  });

  const secondaryEnabled = overviewQuery.isFetched;

  const suppliersQuery = useQuery({
    queryKey: ["/api/suppliers", "ap"],
    queryFn: () => requestJson<Supplier[]>("GET", "/api/suppliers"),
    enabled: secondaryEnabled,
    throwOnError: false,
  });

  const capturesQuery = useQuery({
    queryKey: apQueryKeys.captures,
    queryFn: () => requestJson<Capture[]>("GET", "/api/ap/captures"),
    enabled: secondaryEnabled,
    throwOnError: false,
  });

  const approvalQueueQuery = useQuery({
    queryKey: apQueryKeys.approvalQueue,
    queryFn: () => requestJson<ApprovalQueue>("GET", "/api/ap/approval-queue"),
    enabled: secondaryEnabled,
    throwOnError: false,
  });

  const exceptionsQuery = useQuery({
    queryKey: apQueryKeys.exceptions,
    queryFn: () => requestJson<Exceptions>("GET", "/api/ap/exceptions"),
    enabled: secondaryEnabled,
    throwOnError: false,
  });

  const paymentBatchesQuery = useQuery({
    queryKey: apQueryKeys.paymentBatches,
    queryFn: () => requestJson<PaymentBatch[]>("GET", "/api/ap/payment-batches"),
    enabled: secondaryEnabled,
    throwOnError: false,
  });

  const invoicesQuery = useQuery({
    queryKey: apQueryKeys.invoices,
    queryFn: () => requestJson<Invoice[]>("GET", "/api/ap/invoices"),
    enabled: secondaryEnabled,
    throwOnError: false,
  });

  const overview = overviewQuery.data;
  const suppliers = suppliersQuery.data ?? [];
  const captures = capturesQuery.data ?? [];
  const approvalQueue = approvalQueueQuery.data ?? { invoices: [], paymentBatches: [] };
  const exceptions = exceptionsQuery.data ?? { captureExceptions: [], matchExceptions: [], disputedInvoices: [] };
  const paymentBatches = paymentBatchesQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];

  const readyForBatch = useMemo(() => {
    const list = invoicesQuery.data ?? [];
    return list.filter((invoice) => {
      const status = String(invoice.status).toUpperCase();
      if (!["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(status)) return false;
      const matchStatus = String(invoice.latestMatchResult?.status ?? "").toUpperCase();
      if (matchStatus === "EXCEPTION") return false;
      if (invoice.purchaseOrderId != null && matchStatus !== "MATCHED") return false;
      return true;
    });
  }, [invoicesQuery.data]);

  return {
    overview,
    suppliers,
    captures,
    approvalQueue,
    exceptions,
    paymentBatches,
    invoices,
    readyForBatch,
    overviewQuery,
    suppliersQuery,
    capturesQuery,
    approvalQueueQuery,
    exceptionsQuery,
    paymentBatchesQuery,
    invoicesQuery,
  };
}
