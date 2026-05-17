import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  FileBadge,
  FileDown,
  Loader2,
  Package,
  Printer,
  Send,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useReportingMoney } from "@/hooks/use-reporting-money";
import { createReportingMoneyFormatter } from "@/lib/format/reporting-money";
import { REPORTING_CURRENCY_FALLBACK_CODE } from "@/lib/reporting-currency-fallback";
import { ToastAction } from "@/components/ui/toast";
import { invalidatePurchaseOrderDomain } from "@/lib/domain-invalidation";
import { formatMutationError, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { downloadBlobAsFile } from "@/lib/utils";
import { Can } from "@/components/auth/can";
import {
  downloadPurchaseOrderSignedPdf,
  fetchPurchaseOrderRecordById,
  normalizeBatchInput,
  normalizeOperationalPoParam,
  normalizeSerialTokensCsv,
  useApprovePurchaseOrderMutation,
  usePurchaseOrderOperationalDetailQuery,
  useReceivePurchaseOrderMutation,
  useSendPurchaseOrderMutation,
  validateReceiveLines,
  type ReceiveLineFieldError,
} from "@/features/purchase-orders";
import { fetchApprovalSuggestions } from "@/api/client";
import type { PurchaseReceiveResult } from "@/api/types";
import { EntityActivityPanel } from "@/components/activity/entity-activity-panel";
import {
  procurementPoApproveUrl,
  procurementPoCommercialUrl,
  procurementPoReceiveUrl,
  procurementPoRevisionsUrl,
  procurementPoSendUrl,
} from "@/api/procurement-purchase-order-paths";
import { useAuth } from "@/hooks/use-auth";
import { PoReceivePanel } from "./po-receive-panel";
import { PoRevisionHistoryCard } from "./po-revision-history-card";
import { PoApprovalPolicyCard } from "./po-approval-policy-card";
import { PoCommercialTermsCard } from "./po-commercial-terms-card";
import { PoLastReceiveSummaryCard } from "./po-last-receive-summary-card";
import {
  approveActionDisabledReason,
  canApprove,
  canApproveWithRole,
  canReceive,
  canSend,
  canSendWithRole,
  canUpdatePurchaseOrder,
  poWorkflowRoleAllowed,
  formatDate,
  formatDateTime,
  openPurchaseOrderPrintView,
  sendActionDisabledReason,
} from "./purchase-order-shared";

export function PurchaseOrderDetailView({ po }: { po: string }) {
  const [pathname, setLocation] = useLocation();
  const backToPoList = () => {
    if (pathname.startsWith("/procurement")) setLocation(APP_ROUTES.procurement.orders);
    else if (pathname.startsWith("/orders")) setLocation("/orders");
    else setLocation("/purchase");
  };
  const { toast } = useToast();
  const { formatMoney } = useReportingMoney();
  const { user } = useAuth();
  const poNumber = normalizeOperationalPoParam(po);

  const [receiveState, setReceiveState] = useState<Record<string, number>>({});
  const [batchState, setBatchState] = useState<Record<string, string>>({});
  const [serialState, setSerialState] = useState<Record<string, string>>({});
  const [receiverName, setReceiverName] = useState("");
  const [warehouseLocation, setWarehouseLocation] = useState("");
  const [lastChangeSummary, setLastChangeSummary] = useState<PurchaseReceiveResult | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [departmentId, setDepartmentId] = useState<string>("none");
  const [contractId, setContractId] = useState<string>("none");
  const [paymentTermsId, setPaymentTermsId] = useState<string>("none");
  const [incotermId, setIncotermId] = useState<string>("none");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [receiveLineIssues, setReceiveLineIssues] = useState<ReceiveLineFieldError[]>([]);
  const [commercialSaveError, setCommercialSaveError] = useState<string | null>(null);
  const [commercialApplyHint, setCommercialApplyHint] = useState<string | null>(null);
  const purchaseOrderIdRef = useRef<number | null>(null);

  const detailQuery = usePurchaseOrderOperationalDetailQuery(po);
  const approvePurchaseOrderMutation = useApprovePurchaseOrderMutation(po);
  const sendPurchaseOrderMutation = useSendPurchaseOrderMutation(po);
  const receivePurchaseOrderMutation = useReceivePurchaseOrderMutation(po);
  const statusMutationPending =
    approvePurchaseOrderMutation.isPending || sendPurchaseOrderMutation.isPending;
  const loading = detailQuery.isLoading;
  const error =
    detailQuery.error instanceof Error
      ? detailQuery.error
      : detailQuery.error
        ? new Error(String(detailQuery.error))
        : null;
  const data = detailQuery.data ?? null;
  const refetch = async () => {
    await detailQuery.refetch();
  };

  useEffect(() => {
    purchaseOrderIdRef.current = data?.id ?? null;
  }, [data?.id]);
  const { data: revisions = [], isError: revisionsError } = useQuery({
    queryKey: ["/api/procurement/purchase-orders/records/revisions", data?.id],
    enabled: Boolean(data?.id),
    queryFn: () =>
      requestJson<
        Array<{
          id: number;
          revisionNumber: number;
          createdBy: number | null;
          createdAt: string;
          snapshot: Record<string, unknown>;
        }>
      >("GET", procurementPoRevisionsUrl(data!.id)),
  });
  const { data: approvalHistory = [], isError: approvalHistoryError } = useQuery({
    queryKey: ["/api/approval-history/purchase-order", data?.id],
    enabled: Boolean(data?.id),
    queryFn: () =>
      requestJson<
        Array<{
          id: number;
          action: string;
          level: number;
          performedBy: number;
          comment: string | null;
          previousStatus: string | null;
          newStatus: string | null;
          performedAt: string;
        }>
      >("GET", `/api/approval-history/purchase_order/${data?.id}`),
  });
  const { data: purchaseOrderRecord, isError: purchaseOrderRecordError } = useQuery({
    queryKey: ["/api/procurement/purchase-orders/records", data?.id],
    enabled: Boolean(data?.id),
    queryFn: ({ signal }) => fetchPurchaseOrderRecordById(Number(data?.id), { signal }),
  });
  const { data: departments = [], isError: departmentsError } = useQuery({
    queryKey: ["/api/departments"],
    queryFn: () => requestJson<Array<{ id: number; code: string; name: string }>>("GET", "/api/departments"),
  });
  const { data: contracts = [], isError: contractsError } = useQuery({
    queryKey: ["/api/contracts"],
    queryFn: () =>
      requestJson<Array<{ id: number; title: string; supplierId: number; currency?: string | null }>>(
        "GET",
        "/api/contracts",
      ),
  });
  const { data: currenciesList = [], isError: currenciesError } = useQuery({
    queryKey: ["/api/currencies"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/currencies");
      return normalizeApiList<{ code: string; name: string; active?: boolean | null }>(raw).filter(
        (c) => c.active !== false,
      );
    },
  });
  const { data: paymentTerms = [], isError: paymentTermsError } = useQuery({
    queryKey: ["/api/payment-terms"],
    queryFn: () => requestJson<Array<{ id: number; code: string; name: string }>>("GET", "/api/payment-terms"),
  });
  const { data: supplierRow } = useQuery({
    queryKey: ["/api/suppliers", data?.supplierId],
    enabled: Boolean(data?.supplierId),
    queryFn: () =>
      requestJson<{
        id: number;
        paymentTermsId?: number | null;
        defaultCurrencyCode?: string | null;
      }>("GET", `/api/suppliers/${data!.supplierId}`),
  });
  const { data: incoterms = [], isError: incotermsError } = useQuery({
    queryKey: ["/api/incoterms"],
    queryFn: () => requestJson<Array<{ id: number; code: string; name: string }>>("GET", "/api/incoterms"),
  });
  const { data: approvalPoliciesRaw, isError: approvalPoliciesError } = useQuery({
    queryKey: ["/api/approval-policies"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/approval-policies");
      return normalizeApiList<{
        id: number;
        name: string;
        entityType: string;
        amountMin: number;
        amountMax: number | null;
        approvalLevel: number;
        approverRole: string | null;
        isActive: boolean | null;
      }>(raw);
    },
  });
  const poApprovalPolicies = useMemo(() => {
    const rows = approvalPoliciesRaw ?? [];
    return rows
      .filter((p) => String(p.entityType).toLowerCase() === "purchase_order" && p.isActive !== false)
      .slice()
      .sort((a, b) => a.approvalLevel - b.approvalLevel || a.amountMin - b.amountMin);
  }, [approvalPoliciesRaw]);

  const { data: poApproverSuggestions, isError: approvalSuggestionsError } = useQuery({
    queryKey: ["/api/approval-suggestions", "purchase_order", data?.totalAmount, data?.status],
    enabled: Boolean(data && canApprove(data.status)),
    queryFn: () =>
      fetchApprovalSuggestions({
        entityType: "purchase_order",
        amount: Number(data?.totalAmount ?? 0),
      }),
  });

  const saveCommercialTerms = useMutation({
    mutationFn: () => {
      const id = purchaseOrderIdRef.current;
      if (!id) throw new Error("Purchase order ID missing");
      return requestJson("PATCH", procurementPoCommercialUrl(id), {
        departmentId: departmentId === "none" ? null : Number(departmentId),
        contractId: contractId === "none" ? null : Number(contractId),
        paymentTermsId: paymentTermsId === "none" ? null : Number(paymentTermsId),
        incotermId: incotermId === "none" ? null : Number(incotermId),
        currencyCode: currencyCode.trim().toUpperCase(),
      });
    },
    onSuccess: async () => {
      const id = purchaseOrderIdRef.current;
      if (id) {
        await queryClient.invalidateQueries({ queryKey: ["/api/procurement/purchase-orders/records", id] });
        await queryClient.invalidateQueries({ queryKey: ["/api/procurement/purchase-orders/records/revisions", id] });
      }
      await invalidatePurchaseOrderDomain(queryClient);
      await refetch();
      setCommercialSaveError(null);
      setCommercialApplyHint(null);
      toast({ title: "PO commercial terms updated" });
    },
    onError: (e) => {
      const description = e instanceof Error ? e.message : String(e);
      setCommercialSaveError(description);
      toast({
        title: "Failed to update PO terms",
        description,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!purchaseOrderRecord) return;
    setDepartmentId(
      purchaseOrderRecord.departmentId == null ? "none" : String(purchaseOrderRecord.departmentId),
    );
    setContractId(purchaseOrderRecord.contractId == null ? "none" : String(purchaseOrderRecord.contractId));
    setPaymentTermsId(
      purchaseOrderRecord.paymentTermsId == null ? "none" : String(purchaseOrderRecord.paymentTermsId),
    );
    setIncotermId(
      purchaseOrderRecord.incotermId == null ? "none" : String(purchaseOrderRecord.incotermId),
    );
    const rawCc = purchaseOrderRecord.currencyCode;
    setCurrencyCode(
      typeof rawCc === "string" && /^[A-Za-z]{3}$/.test(rawCc) ? rawCc.toUpperCase() : "USD",
    );
  }, [purchaseOrderRecord]);

  useEffect(() => {
    setReceiveLineIssues([]);
  }, [receiveState, batchState, serialState]);

  const receivePayload = useMemo(
    () =>
      Object.entries(receiveState)
        .filter(([, qty]) => qty > 0)
        .map(([sku, qty]) => {
          const batchRaw = batchState[sku];
          const batchNorm = normalizeBatchInput(batchRaw);
          const serials = serialState[sku] ? normalizeSerialTokensCsv(serialState[sku]) : undefined;
          return {
            sku,
            qtyReceivedNow: qty,
            ...(batchNorm ? { batchNumber: batchNorm } : {}),
            ...(serials?.length ? { serialNumbers: serials } : {}),
          };
        }),
    [batchState, receiveState, serialState],
  );

  const updateStatus = (action: "approve" | "send") => {
    const mutation = action === "approve" ? approvePurchaseOrderMutation : sendPurchaseOrderMutation;
    if (mutation.isPending || !poNumber) return;
    mutation.mutate(undefined, {
      onError: (statusError) => {
        const err = statusError as Error & { status?: number };
        const actionLabel = action === "approve" ? "Approve PO" : "Send PO";
        toast({
          title: "Update failed",
          description: formatMutationError(
            actionLabel,
            "POST",
            action === "approve" ? procurementPoApproveUrl(poNumber) : procurementPoSendUrl(poNumber),
            err,
          ),
          variant: "destructive",
          action: (
            <ToastAction altText="Retry" onClick={() => updateStatus(action)}>
              Retry
            </ToastAction>
          ),
        });
      },
    });
  };

  const submitReceive = () => {
    if (!data || !poNumber) return;
    if (receivePurchaseOrderMutation.isPending) return;

    const checked = validateReceiveLines(data, receivePayload);
    if (!checked.ok) {
      setReceiveLineIssues(checked.errors);
      const combined = checked.errors
        .map((e) => (e.sku ? `${e.sku}: ${e.message}` : e.message))
        .join(" ")
        .trim();
      setReceiveError(combined || "Receive validation failed.");
      const toastParts = checked.errors.map((e) => (e.sku ? `${e.sku}: ${e.message}` : e.message)).filter(Boolean);
      if (toastParts.length) {
        toast({
          title: "Receive validation failed",
          description: toastParts.join(" "),
          variant: "destructive",
        });
      }
      return;
    }

    setReceiveError(null);
    setReceiveLineIssues([]);

    receivePurchaseOrderMutation.mutate(
      {
        lines: checked.lines,
        receiveOptions: {
          receiverUserId: typeof user?.id === "number" ? user.id : undefined,
          receiverName: receiverName.trim() || undefined,
          warehouseLocation: warehouseLocation.trim() || undefined,
          receivedAt: new Date().toISOString(),
        },
      },
      {
        onSuccess: (result) => {
          setLastChangeSummary(result);
          setReceiveState({});
          setBatchState({});
          setSerialState({});
          setReceiveError(null);
          setReceiveLineIssues([]);
        },
        onError: (receiveErr) => {
          const err = receiveErr as Error & { status?: number };
          toast({
            title: "Receive failed",
            description: formatMutationError("Receive PO", "POST", procurementPoReceiveUrl(poNumber), err),
            variant: "destructive",
            action: (
              <ToastAction altText="Retry" onClick={() => submitReceive()}>
                Retry
              </ToastAction>
            ),
          });
        },
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)]">
      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={() => false}
        emptyTitle="PO detail unavailable"
        onRetry={refetch}
      >
        {(detail) => {
          const commercialReferenceError =
            purchaseOrderRecordError ||
            departmentsError ||
            contractsError ||
            paymentTermsError ||
            incotermsError ||
            currenciesError ||
            approvalPoliciesError ||
            approvalSuggestionsError;

          const poMoneyFormatter = createReportingMoneyFormatter(
            purchaseOrderRecord &&
              typeof purchaseOrderRecord.currencyCode === "string" &&
              /^[A-Za-z]{3}$/.test(purchaseOrderRecord.currencyCode)
              ? purchaseOrderRecord.currencyCode
              : REPORTING_CURRENCY_FALLBACK_CODE,
          );

          const applyCommercialDefaults = () => {
            if (contractId === "none") {
              toast({ title: "Select a contract first", variant: "destructive" });
              return;
            }
            const contractRow = contracts.find((x) => String(x.id) === contractId);
            if (!contractRow) return;
            const fromContract =
              typeof contractRow.currency === "string" && /^[A-Za-z]{3}$/.test(contractRow.currency)
                ? contractRow.currency.toUpperCase()
                : null;
            const fromSupplier =
              supplierRow?.defaultCurrencyCode &&
              typeof supplierRow.defaultCurrencyCode === "string" &&
              /^[A-Za-z]{3}$/.test(supplierRow.defaultCurrencyCode)
                ? supplierRow.defaultCurrencyCode.toUpperCase()
                : null;
            const contractCurrencyOk = Boolean(fromContract && currenciesList.some((row) => row.code === fromContract));
            const supplierCurrencyOk = Boolean(fromSupplier && currenciesList.some((row) => row.code === fromSupplier));
            let pick: string | null = null;
            let currencyNote: string | null = null;
            if (contractCurrencyOk && fromContract) {
              pick = fromContract;
              currencyNote = `Currency ${pick} from contract “${contractRow.title}” (#${contractRow.id}).`;
            } else if (supplierCurrencyOk && fromSupplier) {
              pick = fromSupplier;
              currencyNote =
                fromContract && !contractCurrencyOk
                  ? `Contract currency ${fromContract} is not in the active currency list; using supplier default ${pick}.`
                  : `Currency ${pick} from supplier defaults.`;
            } else if (fromContract || fromSupplier) {
              toast({
                title: "No matching currency",
                description:
                  "Neither the contract nor supplier default currency is available in master data. Add the code under Master data or choose a currency manually.",
                variant: "destructive",
              });
              setCommercialApplyHint(null);
              return;
            }

            const hintParts: string[] = [];
            if (pick) {
              setCurrencyCode(pick);
              if (currencyNote) hintParts.push(currencyNote);
            }
            if (supplierRow?.paymentTermsId != null) {
              setPaymentTermsId(String(supplierRow.paymentTermsId));
              hintParts.push("Payment terms from supplier master data (contracts do not store payment terms in this schema).");
            }
            setCommercialApplyHint(hintParts.length ? hintParts.join(" ") : null);
            toast({
              title: "Defaults applied",
              description: "Review fields — incoterms are not inherited from the contract. Save terms to persist.",
            });
          };
          const downloadSignedPdf = async () => {
            setPdfLoading(true);
            try {
              const blob = await downloadPurchaseOrderSignedPdf(detail.poNumber);
              downloadBlobAsFile(blob, `PO-${detail.poNumber}-for-signature.pdf`);
              toast({
                title: "Signable PDF downloaded",
                description: "Includes line items, standard terms, and buyer/supplier signature lines.",
              });
            } catch (err) {
              toast({
                title: "Could not export PDF",
                description: err instanceof Error ? err.message : "Request failed",
                variant: "destructive",
              });
            } finally {
              setPdfLoading(false);
            }
          };

          const sectionLinks = [
            { href: "#po-summary", label: "Summary", icon: ClipboardList },
            { href: "#po-document", label: "Official PDF", icon: FileBadge },
            { href: "#po-commercial", label: "Commercial", icon: Briefcase },
            { href: "#po-receive", label: "Lines & GRN", icon: Package },
            { href: "#po-shipments", label: "Shipments", icon: Truck },
            { href: "#po-approval-history", label: "Approvals", icon: ShieldCheck },
            { href: "#po-activity", label: "Activity", icon: Activity },
          ] as const;

          const approveDisabledMsg = approveActionDisabledReason({
            poNumber,
            status: detail.status,
            role: user?.role ?? undefined,
            mutationPending: statusMutationPending,
          });
          const sendDisabledMsg = sendActionDisabledReason({
            poNumber,
            status: detail.status,
            role: user?.role ?? undefined,
            mutationPending: statusMutationPending,
          });

          return (
            <>
              <Button
                variant="ghost"
                onClick={backToPoList}
                className="mb-3 -ml-2 w-fit text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Purchase orders
              </Button>

              <header
                data-testid="po-detail-page"
                className="sticky top-0 z-20 -mx-4 mb-6 border-b border-border/80 bg-background/90 px-4 py-3 shadow-sm backdrop-blur-md md:-mx-6 md:px-6 supports-[backdrop-filter]:bg-background/80"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Operations / Purchase orders / {detail.poNumber}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 data-testid="po-detail-title" className="truncate text-xl font-semibold tracking-tight">
                        PO {detail.poNumber}
                      </h1>
                      <span data-testid="po-detail-status">
                        <StatusBadge status={detail.status} />
                      </span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {detail.supplierName || `Supplier #${detail.supplierId}`}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-col items-stretch gap-1 lg:items-end">
                    <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      className="gap-2"
                      disabled={!poNumber || pdfLoading || !detail.poNumber.trim()}
                      data-testid="po-signable-pdf-button"
                      onClick={() => void downloadSignedPdf()}
                    >
                      {pdfLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <FileDown className="h-4 w-4" aria-hidden />
                      )}
                      Signable PDF
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      data-testid="po-quick-print-button"
                      onClick={() => openPurchaseOrderPrintView(detail, formatMoney)}
                    >
                      <Printer className="h-4 w-4" aria-hidden />
                      Quick print
                    </Button>
                    <Can roles={["manager", "planner", "admin"]} reason="Requires Manager, Planner, or Admin">
                      <Button
                        variant="outline"
                        className="gap-2"
                        disabled={!!approveDisabledMsg}
                        title={approveDisabledMsg ?? undefined}
                        data-testid="po-approve-button"
                        onClick={() => updateStatus("approve")}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        Approve
                      </Button>
                    </Can>
                    <Can roles={["manager", "planner", "admin"]} reason="Requires Manager, Planner, or Admin">
                      <Button
                        variant="outline"
                        className="gap-2"
                        disabled={!!sendDisabledMsg}
                        title={sendDisabledMsg ?? undefined}
                        data-testid="po-send-button"
                        onClick={() => updateStatus("send")}
                      >
                        <Send className="h-4 w-4" aria-hidden />
                        Send
                      </Button>
                    </Can>
                    </div>
                    {(approveDisabledMsg || sendDisabledMsg) && poWorkflowRoleAllowed(user?.role ?? undefined) ? (
                      <div
                        className="max-w-md text-xs text-muted-foreground lg:text-right"
                        data-testid="po-workflow-disabled-hints"
                        role="status"
                      >
                        {approveDisabledMsg ? <p>{approveDisabledMsg}</p> : null}
                        {sendDisabledMsg ? <p>{sendDisabledMsg}</p> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <nav
                  className="mt-3 flex flex-wrap gap-1 border-t border-border/60 pt-3 text-xs font-medium"
                  aria-label="On-page sections"
                >
                  {sectionLinks.map((item) => {
                    const Icon = item.icon;
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-3 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                        {item.label}
                      </a>
                    );
                  })}
                </nav>
              </header>

              <div className="grid gap-8 xl:grid-cols-12">
                <div className="space-y-6 xl:col-span-8">
                  <section id="po-summary" className="scroll-mt-36 space-y-3">
                    <h2 className="sr-only">Summary</h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <StatusBadge status={detail.status} />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">Requested</CardTitle>
                        </CardHeader>
                        <CardContent className="text-lg font-semibold">{formatDate(detail.requestedDate)}</CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">Receive progress</CardTitle>
                        </CardHeader>
                        <CardContent data-testid="po-detail-progress" className="text-lg font-semibold">
                          {detail.progress?.percent ?? 0}%
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">Order total</CardTitle>
                        </CardHeader>
                        <CardContent data-testid="po-detail-total" className="text-lg font-semibold">
                          <div>{poMoneyFormatter.formatMoney(detail.totalAmount)}</div>
                          <p className="mt-1 text-xs font-normal text-muted-foreground">
                            PO currency {poMoneyFormatter.currencyCode}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                  </section>

                  <div className="space-y-3">
                    {commercialReferenceError ? (
                      <Card className="mb-3 border-amber-500/50 bg-amber-500/10">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">Commercial reference data could not load</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          The PO remains available, but departments, contracts, payment terms, incoterms, or approval
                          references may be incomplete. Refresh this section before updating commercial terms.
                        </CardContent>
                      </Card>
                    ) : null}
                    <PoCommercialTermsCard
                      departmentId={departmentId}
                      setDepartmentId={setDepartmentId}
                      contractId={contractId}
                      setContractId={setContractId}
                      currencyCode={currencyCode}
                      setCurrencyCode={setCurrencyCode}
                      currencies={currenciesList}
                      onApplyContractTerms={applyCommercialDefaults}
                      paymentTermsId={paymentTermsId}
                      setPaymentTermsId={setPaymentTermsId}
                      incotermId={incotermId}
                      setIncotermId={setIncotermId}
                      departments={departments}
                      contractsForSupplier={contracts.filter((contract) => contract.supplierId === detail.supplierId)}
                      paymentTerms={paymentTerms}
                      incoterms={incoterms}
                      saveCommercialTerms={saveCommercialTerms}
                      canSaveCommercial={canUpdatePurchaseOrder(detail.status)}
                      commercialLockedReason="Commercial terms can only be updated before the PO is sent."
                      commercialSaveError={commercialSaveError}
                      applyDefaultsHint={commercialApplyHint}
                    />
                  </div>

                  <PoReceivePanel
                    sectionId="po-receive"
                    className="scroll-mt-36"
                    detail={detail}
                    canReceive={canReceive(detail.status)}
                    receiveState={receiveState}
                    setReceiveState={setReceiveState}
                    batchState={batchState}
                    setBatchState={setBatchState}
                    serialState={serialState}
                    setSerialState={setSerialState}
                    receiverName={receiverName}
                    setReceiverName={setReceiverName}
                    warehouseLocation={warehouseLocation}
                    setWarehouseLocation={setWarehouseLocation}
                    userId={typeof user?.id === "number" ? user.id : undefined}
                    receiving={receivePurchaseOrderMutation.isPending}
                    receiveError={receiveError}
                    receiveLineIssues={receiveLineIssues}
                    onSubmitReceive={submitReceive}
                  />

                  {lastChangeSummary ? <PoLastReceiveSummaryCard summary={lastChangeSummary} /> : null}

                  <section id="po-activity" className="scroll-mt-36" data-testid="po-activity">
                    <EntityActivityPanel entityType="purchase_order" entityId={detail.poNumber} />
                  </section>

                  <div id="po-revisions" className="scroll-mt-36">
                    {revisionsError ? (
                      <Card className="mb-3 border-amber-500/50 bg-amber-500/10">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">Revision history unavailable</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          Revision records could not load. The current PO details are still shown.
                        </CardContent>
                      </Card>
                    ) : null}
                    <PoRevisionHistoryCard revisions={revisions} formatDateTime={formatDateTime} />
                  </div>

                  {canApprove(detail.status) &&
                  (poApprovalPolicies.length > 0 || (poApproverSuggestions?.suggestedApprovers?.length ?? 0) > 0) ? (
                    <div id="po-approval-rules" className="scroll-mt-36">
                      <PoApprovalPolicyCard
                        policies={poApprovalPolicies}
                        suggestedApprovers={poApproverSuggestions?.suggestedApprovers ?? []}
                      />
                    </div>
                  ) : null}

                  <Card id="po-approval-history" className="scroll-mt-36" data-testid="po-approval-history">
                    <CardHeader>
                      <CardTitle>Approval history</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {approvalHistoryError ? (
                        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-muted-foreground">
                          Approval history unavailable
                        </div>
                      ) : approvalHistory.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No approval history found.</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Action</TableHead>
                              <TableHead>Level</TableHead>
                              <TableHead>By</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>At</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {approvalHistory.map((entry) => (
                              <TableRow key={entry.id}>
                                <TableCell>{entry.action}</TableCell>
                                <TableCell>{entry.level}</TableCell>
                                <TableCell>User #{entry.performedBy}</TableCell>
                                <TableCell>
                                  {(entry.previousStatus ?? "-") + " -> " + (entry.newStatus ?? "-")}
                                </TableCell>
                                <TableCell>{formatDateTime(entry.performedAt)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>

                  <Card id="po-shipments" className="scroll-mt-36" data-testid="po-shipments">
                    <CardHeader>
                      <CardTitle>Linked shipments</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>ID</TableHead>
                            <TableHead>Carrier</TableHead>
                            <TableHead>Tracking</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>ETA</TableHead>
                            <TableHead>Updated</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.shipments.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-sm text-muted-foreground">
                                No linked shipments
                              </TableCell>
                            </TableRow>
                          ) : (
                            detail.shipments.map((shipment) => (
                              <TableRow key={shipment.id}>
                                <TableCell>{shipment.id}</TableCell>
                                <TableCell>{shipment.carrier || "-"}</TableCell>
                                <TableCell className="font-mono text-xs">
                                  {shipment.trackingNumber?.trim() ? shipment.trackingNumber : "—"}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge status={shipment.status} />
                                </TableCell>
                                <TableCell>{formatDate(shipment.eta)}</TableCell>
                                <TableCell>{formatDateTime(shipment.updatedAt)}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>

                <aside className="space-y-4 xl:col-span-4">
                  <Card id="po-document" className="scroll-mt-36 border-primary/30 bg-muted/25">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Official order document</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                      <p>
                        Portrait PDF matches a typical purchase order packet: header, supplier block, line table with
                        totals, standard terms, and separate signature lines for buyer and supplier (wet ink or your
                        e-sign tool).
                      </p>
                      <Button
                        type="button"
                        className="w-full gap-2 sm:w-auto"
                        disabled={!poNumber || pdfLoading || !detail.poNumber.trim()}
                        onClick={() => void downloadSignedPdf()}
                      >
                        {pdfLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <FileDown className="h-4 w-4" aria-hidden />
                        )}
                        Download signable PDF
                      </Button>
                    </CardContent>
                  </Card>
                </aside>
              </div>
            </>
          );
        }}
      </DataState>
    </div>
  );
}
