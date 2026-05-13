import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ToastAction } from "@/components/ui/toast";
import { formatMutationError, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { downloadFile } from "@/lib/utils";
import { usePurchaseOrderOperationalDetailQuery } from "@/features/purchase-orders";
import { Can } from "@/components/auth/can";
import { EntityActivityPanel } from "@/components/activity/entity-activity-panel";
import {
  approvePurchaseOrder,
  downloadPurchaseOrderSignedPdf,
  fetchApprovalSuggestions,
  receivePurchaseOrder,
  sendPurchaseOrder,
  type PurchaseOrderDetail,
  type PurchaseReceiveResult,
} from "@/api/client";
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
  canApprove,
  canApproveWithRole,
  canReceive,
  canSend,
  canSendWithRole,
  canUpdatePurchaseOrder,
  fetchPurchaseOrderRecordById,
  formatDate,
  formatDateTime,
  openPurchaseOrderPrintView,
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

  const [receiving, setReceiving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
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
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [commercialSaveError, setCommercialSaveError] = useState<string | null>(null);
  const purchaseOrderIdRef = useRef<number | null>(null);

  const detailQuery = usePurchaseOrderOperationalDetailQuery(po);
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
    queryFn: () => fetchPurchaseOrderRecordById(Number(data?.id)),
  });
  const { data: departments = [], isError: departmentsError } = useQuery({
    queryKey: ["/api/departments"],
    queryFn: () => requestJson<Array<{ id: number; code: string; name: string }>>("GET", "/api/departments"),
  });
  const { data: contracts = [], isError: contractsError } = useQuery({
    queryKey: ["/api/contracts"],
    queryFn: () => requestJson<Array<{ id: number; title: string; supplierId: number }>>("GET", "/api/contracts"),
  });
  const { data: paymentTerms = [], isError: paymentTermsError } = useQuery({
    queryKey: ["/api/payment-terms"],
    queryFn: () => requestJson<Array<{ id: number; code: string; name: string }>>("GET", "/api/payment-terms"),
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
      });
    },
    onSuccess: async () => {
      const id = purchaseOrderIdRef.current;
      if (id) {
        await queryClient.invalidateQueries({ queryKey: ["/api/procurement/purchase-orders/records", id] });
        await queryClient.invalidateQueries({ queryKey: ["/api/procurement/purchase-orders/records/revisions", id] });
      }
      await refetch();
      setCommercialSaveError(null);
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
  }, [purchaseOrderRecord]);

  const receivePayload = useMemo(
    () =>
      Object.entries(receiveState)
        .filter(([, qty]) => qty > 0)
        .map(([sku, qty]) => ({
          sku,
          qtyReceivedNow: qty,
          batchNumber: batchState[sku]?.trim() || undefined,
          serialNumbers: serialState[sku]
            ? serialState[sku]
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : undefined,
        })),
    [batchState, receiveState, serialState],
  );

  const validateReceive = useCallback(
    (detail: PurchaseOrderDetail): string | null => {
      let hasPositiveQty = false;
      for (const line of detail.lines) {
        const rawQty = receiveState[line.sku] ?? 0;
        const qty = Number(rawQty);
        if (!Number.isFinite(qty)) {
          return `Receive quantity for ${line.sku} must be a finite number.`;
        }
        if (qty > 0 && !Number.isInteger(qty)) {
          return `Receive quantity for ${line.sku} must be a whole number.`;
        }
        if (qty < 0) {
          return `Receive quantity for ${line.sku} cannot be negative.`;
        }
        if (qty > Number(line.expectedRemaining ?? 0)) {
          return `Receive quantity for ${line.sku} cannot exceed remaining quantity (${line.expectedRemaining}).`;
        }
        if (qty > 0) hasPositiveQty = true;
      }
      return hasPositiveQty ? null : "Enter at least one receive quantity greater than 0.";
    },
    [receiveState],
  );

  const updateStatus = async (action: "approve" | "send") => {
    setStatusUpdating(true);
    try {
      if (action === "approve") {
        await approvePurchaseOrder(po);
      } else {
        await sendPurchaseOrder(po);
      }
      await refetch();
    } catch (statusError) {
      const err = statusError as Error & { status?: number };
      const actionLabel = action === "approve" ? "Approve PO" : "Send PO";
      toast({
        title: "Update failed",
        description: formatMutationError(
          actionLabel,
          "POST",
          action === "approve" ? procurementPoApproveUrl(po) : procurementPoSendUrl(po),
          err,
        ),
        variant: "destructive",
        action: (
          <ToastAction altText="Retry" onClick={() => updateStatus(action)}>
            Retry
          </ToastAction>
        ),
      });
    } finally {
      setStatusUpdating(false);
    }
  };

  const submitReceive = async () => {
    if (!data) return;
    const validationMessage = validateReceive(data);
    if (validationMessage) {
      setReceiveError(validationMessage);
      toast({
        title: "Receive validation failed",
        description: validationMessage,
        variant: "destructive",
      });
      return;
    }
    setReceiveError(null);
    if (receivePayload.length === 0) {
      setReceiveError("Enter at least one receive quantity greater than 0.");
      toast({
        title: "No lines selected",
        description: "Enter at least one receive quantity.",
      });
      return;
    }

    setReceiving(true);
    try {
      const result = await receivePurchaseOrder(po, receivePayload, {
        receiverUserId: typeof user?.id === "number" ? user.id : undefined,
        receiverName: receiverName.trim() || undefined,
        warehouseLocation: warehouseLocation.trim() || undefined,
        receivedAt: new Date().toISOString(),
      });
      setLastChangeSummary(result);
      setReceiveState({});
      setBatchState({});
      setSerialState({});
      setReceiveError(null);
      await refetch();
    } catch (receiveError) {
      const err = receiveError as Error & { status?: number };
      toast({
        title: "Receive failed",
        description: formatMutationError("Receive PO", "POST", procurementPoReceiveUrl(po), err),
        variant: "destructive",
        action: (
          <ToastAction altText="Retry" onClick={() => submitReceive()}>
            Retry
          </ToastAction>
        ),
      });
    } finally {
      setReceiving(false);
    }
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
            approvalPoliciesError ||
            approvalSuggestionsError;
          const downloadSignedPdf = async () => {
            setPdfLoading(true);
            try {
              const blob = await downloadPurchaseOrderSignedPdf(detail.poNumber);
              downloadFile(blob, `PO-${detail.poNumber}-for-signature.pdf`, "application/pdf");
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      className="gap-2"
                      disabled={pdfLoading}
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
                        disabled={!canApproveWithRole(detail.status, user?.role ?? undefined) || statusUpdating}
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
                        disabled={!canSendWithRole(detail.status, user?.role ?? undefined) || statusUpdating}
                        data-testid="po-send-button"
                        onClick={() => updateStatus("send")}
                      >
                        <Send className="h-4 w-4" aria-hidden />
                        Send
                      </Button>
                    </Can>
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
                          {formatMoney(detail.totalAmount)}
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
                    receiving={receiving}
                    receiveError={receiveError}
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
                        disabled={pdfLoading}
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
