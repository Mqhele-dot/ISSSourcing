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
  ApPage,
  Supplier,
} from "./types";

export function useApWorkspaceQueries(options: { invoicePage: number; batchPage: number; capturePage: number; pageSize: number; q: string; status: string; captureQ: string; supplierQ: string }) {
  const overviewQuery = useQuery({
    queryKey: apQueryKeys.overview,
    queryFn: () => requestJson<Overview>("GET", "/api/ap/overview"),
    throwOnError: false,
  });

  const secondaryEnabled = overviewQuery.isFetched;

  const suppliersQuery = useQuery({
    queryKey: ["/api/v2/suppliers", "ap", options.supplierQ],
    queryFn: async () => (await requestJson<ApPage<Supplier>>("GET", `/api/v2/suppliers?page=1&pageSize=25&q=${encodeURIComponent(options.supplierQ)}&status=active&sort=name_asc`)).items,
    enabled: secondaryEnabled,
    throwOnError: false,
  });

  const capturesQuery = useQuery({
    queryKey: ["/api/v2/ap/captures", options.capturePage, options.pageSize, options.captureQ],
    queryFn: () => requestJson<ApPage<Capture>>("GET", `/api/v2/ap/captures?page=${options.capturePage}&pageSize=${options.pageSize}&q=${encodeURIComponent(options.captureQ)}`),
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
    queryKey: ["/api/v2/ap/payment-batches", options.batchPage, options.pageSize, options.q, options.status],
    queryFn: () => requestJson<ApPage<PaymentBatch>>("GET", `/api/v2/ap/payment-batches?page=${options.batchPage}&pageSize=${options.pageSize}&q=${encodeURIComponent(options.q)}&status=${encodeURIComponent(options.status || "all")}`),
    enabled: secondaryEnabled,
    throwOnError: false,
    placeholderData: (previous) => previous,
  });

  const payableInvoicesQuery = useQuery({
    queryKey: ["/api/v2/ap/invoices", "payable", options.invoicePage, options.pageSize, options.q],
    queryFn: () => requestJson<ApPage<Invoice>>("GET", `/api/v2/ap/invoices?page=${options.invoicePage}&pageSize=${options.pageSize}&eligibility=payable&q=${encodeURIComponent(options.q)}`),
    enabled: secondaryEnabled,
    throwOnError: false,
    placeholderData: (previous) => previous,
  });

  const invoicesQuery = useQuery({
    queryKey: apQueryKeys.invoices,
    queryFn: () => requestJson<Invoice[]>("GET", "/api/ap/invoices"),
    enabled: secondaryEnabled,
    throwOnError: false,
  });

  const overview = overviewQuery.data;
  const suppliers = suppliersQuery.data ?? [];
  const capturePage = capturesQuery.data && !Array.isArray(capturesQuery.data) && Array.isArray(capturesQuery.data.items)
    ? capturesQuery.data
    : { items: [], total: 0, page: options.capturePage, pageSize: options.pageSize, hasNext: false };
  const captures = capturePage.items;
  const approvalQueue = approvalQueueQuery.data ?? { invoices: [], paymentBatches: [] };
  const exceptions = exceptionsQuery.data ?? { captureExceptions: [], matchExceptions: [], disputedInvoices: [] };
  const paymentBatchPage = paymentBatchesQuery.data && !Array.isArray(paymentBatchesQuery.data) && Array.isArray(paymentBatchesQuery.data.items)
    ? paymentBatchesQuery.data
    : { items: [], total: 0, page: options.batchPage, pageSize: options.pageSize, hasNext: false };
  const paymentBatches = paymentBatchPage.items;
  const invoices = invoicesQuery.data ?? [];

  const payableInvoicePage = payableInvoicesQuery.data && !Array.isArray(payableInvoicesQuery.data) && Array.isArray(payableInvoicesQuery.data.items)
    ? payableInvoicesQuery.data
    : { items: [], total: 0, page: options.invoicePage, pageSize: options.pageSize, hasNext: false };
  const readyForBatch = payableInvoicePage.items;

  return {
    overview,
    suppliers,
    captures,
    capturePage,
    approvalQueue,
    exceptions,
    paymentBatches,
    paymentBatchPage,
    payableInvoicePage,
    invoices,
    readyForBatch,
    overviewQuery,
    suppliersQuery,
    capturesQuery,
    approvalQueueQuery,
    exceptionsQuery,
    paymentBatchesQuery,
    payableInvoicesQuery,
    invoicesQuery,
  };
}
