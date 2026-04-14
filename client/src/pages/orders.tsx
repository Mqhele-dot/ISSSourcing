import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import {
  Activity,
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  FileBadge,
  FileDown,
  FileText,
  Loader2,
  Package,
  Printer,
  Send,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Toolbar } from "@/components/ui/toolbar";
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
import { ToastAction } from "@/components/ui/toast";
import { formatMutationError, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { downloadFile } from "@/lib/utils";
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { Can } from "@/components/auth/can";
import { EntityActivityPanel } from "@/components/activity/entity-activity-panel";
import {
  approvePurchaseOrder,
  downloadPurchaseOrderSignedPdf,
  fetchApprovalSuggestions,
  fetchPurchaseOrder,
  fetchPurchaseOrdersEnvelope,
  receivePurchaseOrder,
  sendPurchaseOrder,
  type PurchaseOrderDetail,
  type PurchaseOrderListItem,
  type PurchaseReceiveResult,
} from "@/api/client";
import { useAuth } from "@/hooks/use-auth";
import type { FallbackKind } from "@/components/ui/data-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RequisitionsPage from "@/pages/requisitions";
import { PoReceivePanel } from "@/pages/orders/po-receive-panel";
import { PoRevisionHistoryCard } from "@/pages/orders/po-revision-history-card";
import { PoApprovalPolicyCard } from "@/pages/orders/po-approval-policy-card";
import { PoCommercialTermsCard } from "@/pages/orders/po-commercial-terms-card";
import { PoLastReceiveSummaryCard } from "@/pages/orders/po-last-receive-summary-card";

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function canApprove(status: string) {
  return status === "open";
}

function canSend(status: string) {
  return status === "approved";
}

function canReceive(status: string) {
  return status === "approved" || status === "sent";
}

function openPurchaseOrderPrintView(detail: PurchaseOrderDetail) {
  const html = `
    <html>
      <head>
        <title>PO ${detail.poNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
          h1 { margin-bottom: 4px; }
          .meta { color: #555; margin-bottom: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #f5f5f5; }
          .right { text-align: right; }
        </style>
      </head>
      <body>
        <h1>Purchase Order ${detail.poNumber}</h1>
        <div class="meta">
          Supplier: ${detail.supplierName || `Supplier #${detail.supplierId}`}<br/>
          Status: ${detail.status}<br/>
          Requested: ${formatDate(detail.requestedDate)}
        </div>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th class="right">Ordered</th>
              <th class="right">Received</th>
              <th class="right">Unit Price</th>
            </tr>
          </thead>
          <tbody>
            ${detail.lines
              .map(
                (line) => `
                  <tr>
                    <td>${line.sku}</td>
                    <td>${line.itemName}</td>
                    <td class="right">${line.qtyOrdered}</td>
                    <td class="right">${line.qtyReceived}</td>
                    <td class="right">$${line.unitPrice.toFixed(2)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1000,height=760");
  if (!printWindow) {
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function fetchPurchaseOrderRecordById(id: number): Promise<{
  id: number;
  departmentId?: number | null;
  contractId?: number | null;
  paymentTermsId?: number | null;
  incotermId?: number | null;
} | null> {
  const response = await fetch(`/api/purchase-orders/${id}`, {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404 || response.status === 401) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message ?? `Request failed with ${response.status}`)
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  if (payload && typeof payload === "object" && "ok" in payload) {
    const envelope = payload as { ok: boolean; data?: unknown; error?: { message?: string } };
    if (!envelope.ok) {
      throw new Error(envelope.error?.message ?? "Failed to fetch purchase order details");
    }
    return (envelope.data as {
      id: number;
      departmentId?: number | null;
      contractId?: number | null;
      paymentTermsId?: number | null;
      incotermId?: number | null;
    }) ?? null;
  }

  return payload as {
    id: number;
    departmentId?: number | null;
    contractId?: number | null;
    paymentTermsId?: number | null;
    incotermId?: number | null;
  };
}

function PurchaseOrdersList({ embedded }: { embedded?: boolean }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [exportingPo, setExportingPo] = useState<string | null>(null);
  const { queryState, setQueryState } = useQueryState({
    status: "",
    supplier: "",
    q: "",
  });

  const fetcher = useCallback(
    () =>
      fetchPurchaseOrdersEnvelope({
        status: String(queryState.status || ""),
        supplier: String(queryState.supplier || ""),
        q: String(queryState.q || ""),
      }),
    [queryState.status, queryState.supplier, queryState.q],
  );

  const { loading, error, data: envelope, refetch } = useAsyncResource(fetcher);
  const data = envelope?.data ?? null;
  const fallback = envelope?.meta?.fallback as FallbackKind | undefined;

  const exportSignedPdfForRow = async (poNumber: string) => {
    setExportingPo(poNumber);
    try {
      const blob = await downloadPurchaseOrderSignedPdf(poNumber);
      downloadFile(blob, `PO-${poNumber}-for-signature.pdf`, "application/pdf");
      toast({
        title: "Signable PDF downloaded",
        description: `PO ${poNumber} — includes terms and signature page.`,
      });
    } catch (err) {
      toast({
        title: "Could not export PDF",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setExportingPo(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
      {!embedded && (
        <PageHeader
          title="Purchase Orders"
          subtitle="Operational purchasing workflow"
          breadcrumb={<span>Operations / Purchase Orders</span>}
        />
      )}

      <div data-tour="po-list" className="space-y-4">
      <Toolbar
        sticky
        left={
          <>
            <Input
              value={String(queryState.q || "")}
              onChange={(event) => setQueryState({ q: event.target.value })}
              placeholder="Search PO number or supplier"
              className="w-full sm:w-[260px]"
            />
            <Input
              value={String(queryState.supplier || "")}
              onChange={(event) => setQueryState({ supplier: event.target.value })}
              placeholder="Supplier id or name"
              className="w-full sm:w-[220px]"
            />
            <Input
              value={String(queryState.status || "")}
              onChange={(event) => setQueryState({ status: event.target.value })}
              placeholder="Status (draft/open/approved/sent/received)"
              className="w-full sm:w-[250px]"
            />
          </>
        }
        right={
          <>
            <Button asChild variant="default" size="sm">
              <Link href={APP_ROUTES.inventory.reorder}>Create reorder request</Link>
            </Button>
            <Button variant="outline" onClick={refetch}>
              Refresh
            </Button>
          </>
        }
      />

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={(orders) => (Array.isArray(orders) ? orders : []).length === 0}
        emptyTitle="No purchase orders found"
        emptyDescription="Create a reorder request from low stock, or run the demo to seed data."
        emptyAction={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="default" size="sm">
              <Link href={APP_ROUTES.inventory.reorder}>Create reorder request</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Run demo / Overview</Link>
            </Button>
          </div>
        }
        fallback={fallback}
        onRetry={refetch}
      >
        {(orders) => {
          const baseList = Array.isArray(orders) ? orders : [];
          const q = String(queryState.q || "").trim().toLowerCase();
          const supplierFilter = String(queryState.supplier || "").trim().toLowerCase();
          const statusFilter = String(queryState.status || "").trim().toLowerCase();
          const list = baseList.filter((order) => {
            if (statusFilter && String(order.status || "").toLowerCase() !== statusFilter) {
              return false;
            }
            if (supplierFilter) {
              const supplierHaystack = `${order.supplierName || ""} ${order.supplierId}`.toLowerCase();
              if (!supplierHaystack.includes(supplierFilter)) {
                return false;
              }
            }
            if (q) {
              const searchHaystack = `${order.poNumber} ${order.supplierName || ""}`.toLowerCase();
              if (!searchHaystack.includes(q)) {
                return false;
              }
            }
            return true;
          });
          return (
          <div className="overflow-x-auto">
          <Table className="min-w-[56rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">PDF</TableHead>
                <TableHead>PO</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((order) => (
                <TableRow
                  key={order.poNumber}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/purchase/${order.poNumber}`)}
                >
                  <TableCell
                    className="text-center"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="Download signable PDF"
                      disabled={exportingPo === order.poNumber}
                      onClick={() => void exportSignedPdfForRow(order.poNumber)}
                    >
                      {exportingPo === order.poNumber ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <FileDown className="h-4 w-4" aria-hidden />
                      )}
                      <span className="sr-only">Download signable PDF for {order.poNumber}</span>
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{order.poNumber}</TableCell>
                  <TableCell>{order.supplierName || `Supplier #${order.supplierId}`}</TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>{formatDate(order.requestedDate)}</TableCell>
                  <TableCell className="text-right">{order.linesCount}</TableCell>
                  <TableCell className="text-right">{order.receivedProgress}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          );
        }}
      </DataState>
      </div>
    </div>
  );
}

function PurchaseOrderDetailView({ po }: { po: string }) {
  const [pathname, setLocation] = useLocation();
  const backToPoList = () => setLocation(pathname.startsWith("/orders") ? "/orders" : "/purchase");
  const { toast } = useToast();
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

  const fetcher = useCallback((): Promise<PurchaseOrderDetail> => fetchPurchaseOrder(po), [po]);
  const { loading, error, data, refetch } = useAsyncResource(fetcher);
  const { data: revisions = [] } = useQuery({
    queryKey: ["/api/purchase-orders/revisions", data?.id],
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
      >("GET", `/api/purchase-orders/${data?.id}/revisions`),
  });
  const { data: approvalHistory = [] } = useQuery({
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
  const { data: purchaseOrderRecord } = useQuery({
    queryKey: ["/api/purchase-orders", data?.id],
    enabled: Boolean(data?.id),
    queryFn: () => fetchPurchaseOrderRecordById(Number(data?.id)),
  });
  const { data: departments = [] } = useQuery({
    queryKey: ["/api/departments"],
    queryFn: () => requestJson<Array<{ id: number; code: string; name: string }>>("GET", "/api/departments"),
  });
  const { data: contracts = [] } = useQuery({
    queryKey: ["/api/contracts"],
    queryFn: () => requestJson<Array<{ id: number; title: string; supplierId: number }>>("GET", "/api/contracts"),
  });
  const { data: paymentTerms = [] } = useQuery({
    queryKey: ["/api/payment-terms"],
    queryFn: () => requestJson<Array<{ id: number; code: string; name: string }>>("GET", "/api/payment-terms"),
  });
  const { data: incoterms = [] } = useQuery({
    queryKey: ["/api/incoterms"],
    queryFn: () => requestJson<Array<{ id: number; code: string; name: string }>>("GET", "/api/incoterms"),
  });
  const { data: approvalPoliciesRaw } = useQuery({
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

  const { data: poApproverSuggestions } = useQuery({
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
      if (!data?.id) throw new Error("Purchase order ID missing");
      return requestJson("PUT", `/api/purchase-orders/${data.id}`, {
        departmentId: departmentId === "none" ? null : Number(departmentId),
        contractId: contractId === "none" ? null : Number(contractId),
        paymentTermsId: paymentTermsId === "none" ? null : Number(paymentTermsId),
        incotermId: incotermId === "none" ? null : Number(incotermId),
      });
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", data?.id] });
      await refetch();
      toast({ title: "PO commercial terms updated" });
    },
    onError: (e) => {
      toast({
        title: "Failed to update PO terms",
        description: e instanceof Error ? e.message : String(e),
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
          action === "approve" ? `/api/purchase/orders/${po}/approve` : `/api/purchase/orders/${po}/send`,
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
    if (receivePayload.length === 0) {
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
      await refetch();
    } catch (receiveError) {
      const err = receiveError as Error & { status?: number };
      toast({
        title: "Receive failed",
        description: formatMutationError("Receive PO", "POST", `/api/purchase/orders/${po}/receive`, err),
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

            <header className="sticky top-0 z-20 -mx-4 mb-6 border-b border-border/80 bg-background/90 px-4 py-3 shadow-sm backdrop-blur-md md:-mx-6 md:px-6 supports-[backdrop-filter]:bg-background/80">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Operations / Purchase orders / {detail.poNumber}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-xl font-semibold tracking-tight">PO {detail.poNumber}</h1>
                    <StatusBadge status={detail.status} />
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
                    onClick={() => void downloadSignedPdf()}
                  >
                    {pdfLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <FileDown className="h-4 w-4" aria-hidden />
                    )}
                    Signable PDF
                  </Button>
                  <Button type="button" variant="outline" className="gap-2" onClick={() => openPurchaseOrderPrintView(detail)}>
                    <Printer className="h-4 w-4" aria-hidden />
                    Quick print
                  </Button>
                  <Can roles={["manager", "planner", "admin"]} reason="Requires Manager, Planner, or Admin">
                    <Button
                      variant="outline"
                      className="gap-2"
                      disabled={!canApprove(detail.status) || statusUpdating}
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
                      disabled={!canSend(detail.status) || statusUpdating}
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
                      <CardContent className="text-lg font-semibold">{detail.progress.percent}%</CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Order total</CardTitle>
                      </CardHeader>
                      <CardContent className="text-lg font-semibold">${detail.totalAmount.toFixed(2)}</CardContent>
                    </Card>
                  </div>
                </section>

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
            />

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
              onSubmitReceive={submitReceive}
            />

            {lastChangeSummary ? <PoLastReceiveSummaryCard summary={lastChangeSummary} /> : null}

            <section id="po-activity" className="scroll-mt-36">
              <EntityActivityPanel entityType="purchase_order" entityId={detail.poNumber} />
            </section>

            <div id="po-revisions" className="scroll-mt-36">
              <PoRevisionHistoryCard revisions={revisions} formatDateTime={formatDateTime} />
            </div>

            {canApprove(detail.status) && (poApprovalPolicies.length > 0 || (poApproverSuggestions?.suggestedApprovers?.length ?? 0) > 0) ? (
              <div id="po-approval-rules" className="scroll-mt-36">
                <PoApprovalPolicyCard
                  policies={poApprovalPolicies}
                  suggestedApprovers={poApproverSuggestions?.suggestedApprovers ?? []}
                />
              </div>
            ) : null}

            <Card id="po-approval-history" className="scroll-mt-36">
              <CardHeader>
                <CardTitle>Approval history</CardTitle>
              </CardHeader>
              <CardContent>
                {approvalHistory.length === 0 ? (
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

            <Card id="po-shipments" className="scroll-mt-36">
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

export default function OrdersPage() {
  const [ordersDetailMatch, ordersDetailParams] = useRoute<{ po: string }>("/orders/:po");
  const [purchaseDetailMatch, purchaseDetailParams] = useRoute<{ po: string }>("/purchase/:po");
  const [location] = useLocation();
  const isPurchaseRoute = location.startsWith("/purchase");

  const po = ordersDetailMatch
    ? ordersDetailParams?.po
    : purchaseDetailMatch
      ? purchaseDetailParams?.po
      : undefined;

  // "requisitions" is a reserved path - don't treat as PO number
  const isRequisitionsPath = po === "requisitions";

  if (po && !isRequisitionsPath) {
    return <PurchaseOrderDetailView po={po} />;
  }

  // On /purchase, show tabbed view: Purchase Orders | Requisitions
  if (isPurchaseRoute) {
    return (
      <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
        <PageHeader
          title="Purchase"
          subtitle="Manage purchase orders and requisitions"
          breadcrumb={<span>Operations / Purchase</span>}
        />
        <Tabs defaultValue="orders" className="w-full">
          <TabsList className="mb-4 grid h-auto w-full grid-cols-1 sm:grid-cols-2">
            <TabsTrigger value="orders" className="gap-2">
              <ShoppingCart className="h-4 w-4" />
              Purchase Orders
            </TabsTrigger>
            <TabsTrigger value="requisitions" className="gap-2">
              <FileText className="h-4 w-4" />
              Requisitions
            </TabsTrigger>
          </TabsList>
          <TabsContent value="orders">
            <PurchaseOrdersList embedded />
          </TabsContent>
          <TabsContent value="requisitions">
            <RequisitionsPage embedded />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // On /orders show tabbed view: Purchase Orders | Requisitions (same as /purchase)
  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
      <PageHeader
        title="Purchase Orders"
        subtitle="Manage purchase orders and requisitions"
        breadcrumb={<span>Operations / Purchase Orders</span>}
      />
      <Tabs defaultValue="orders" className="w-full">
        <TabsList className="mb-4 grid h-auto w-full grid-cols-1 sm:grid-cols-2">
          <TabsTrigger value="orders" className="gap-2">
            <ShoppingCart className="h-4 w-4" />
            Purchase Orders
          </TabsTrigger>
          <TabsTrigger value="requisitions" className="gap-2">
            <FileText className="h-4 w-4" />
            Requisitions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          <PurchaseOrdersList embedded />
        </TabsContent>
        <TabsContent value="requisitions">
          <RequisitionsPage embedded basePath="/requisitions" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
