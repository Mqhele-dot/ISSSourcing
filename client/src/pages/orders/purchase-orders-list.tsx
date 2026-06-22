import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ExternalLink, Eye, FileDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState, type FallbackKind } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useQueryState } from "@/hooks/use-query-state";
import { usePurchaseOrdersEnvelopeQuery, downloadPurchaseOrderSignedPdf } from "@/features/purchase-orders";
import type { PurchaseOrderListItem } from "@/api/types";
import { downloadBlobAsFile } from "@/lib/utils";
import { formatDate } from "./purchase-order-shared";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";
import { useReportingMoney } from "@/hooks/use-reporting-money";

type PoSort =
  | "requested-desc"
  | "requested-asc"
  | "total-desc"
  | "total-asc"
  | "supplier-asc"
  | "progress-asc"
  | "progress-desc";

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "partially_received", label: "Partially received" },
  { value: "received", label: "Received" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

function normalizeStatus(status: string): string {
  return String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function poStatusExplanation(status: string): string {
  const s = normalizeStatus(status);
  if (s === "open") return "PO is awaiting approval.";
  if (s === "approved") return "PO can be sent to the supplier.";
  if (s === "sent") return "PO is with the supplier and can be received when goods arrive.";
  if (s === "partially_received" || s === "partial_received") {
    return "Some goods have been received; remaining quantities need follow-up.";
  }
  if (s === "received") return "Goods have been fully received.";
  if (s === "draft") return "PO is still being prepared before approval.";
  if (s === "closed") return "PO is closed for operational follow-up.";
  if (s === "cancelled") return "PO was cancelled and should not be received.";
  return "Review this PO status before taking action.";
}

function dateMs(value: string | null): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function PurchaseOrdersList({ embedded }: { embedded?: boolean }) {
  const productSetupComplete = useProductSetupComplete();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { formatMoney } = useReportingMoney();
  const [exportingPo, setExportingPo] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<PoSort>("requested-desc");
  const [previewOrder, setPreviewOrder] = useState<PurchaseOrderListItem | null>(null);
  const { queryState, setQueryState } = useQueryState({
    status: "",
    supplier: "",
    q: "",
  });

  const [qInput, setQInput] = useState(String(queryState.q || ""));
  useEffect(() => setQInput(String(queryState.q || "")), [queryState.q]);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (String(queryState.q || "") !== qInput) setQueryState({ q: qInput });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [qInput, queryState.q, setQueryState]);

  const [supplierInput, setSupplierInput] = useState(String(queryState.supplier || ""));
  useEffect(() => setSupplierInput(String(queryState.supplier || "")), [queryState.supplier]);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (String(queryState.supplier || "") !== supplierInput) setQueryState({ supplier: supplierInput });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [supplierInput, queryState.supplier, setQueryState]);

  const [statusInput, setStatusInput] = useState(String(queryState.status || ""));
  useEffect(() => setStatusInput(String(queryState.status || "")), [queryState.status]);

  const poListQuery = usePurchaseOrdersEnvelopeQuery({
    status: String(queryState.status || ""),
    supplier: String(queryState.supplier || ""),
    q: String(queryState.q || ""),
  });
  const envelope = poListQuery.data;
  const loading = poListQuery.isLoading;
  const error =
    poListQuery.error instanceof Error
      ? poListQuery.error
      : poListQuery.error
        ? new Error(String(poListQuery.error))
        : null;
  const refetch = async () => {
    await poListQuery.refetch();
  };
  const data = envelope?.data ?? null;
  const fallbackRaw = envelope?.meta?.fallback as FallbackKind | undefined;
  /** Do not show degraded/timeout empty copy when the list request itself failed. */
  const fallback = error ? undefined : fallbackRaw;
  const activeSearch = String(qInput || "").trim();
  const activeSupplier = String(supplierInput || "").trim();
  const activeStatus = String(statusInput || "").trim();
  const hasActiveFilters = Boolean(activeSearch || activeSupplier || activeStatus);

  const statusLabel = (value: string) =>
    STATUS_OPTIONS.find((option) => option.value === normalizeStatus(value))?.label ?? value;

  const clearFilter = (key: "q" | "supplier" | "status") => {
    if (key === "q") setQInput("");
    if (key === "supplier") setSupplierInput("");
    if (key === "status") setStatusInput("");
    setQueryState({ [key]: "" });
  };

  const exportSignedPdfForRow = async (poNumber: string) => {
    setExportingPo(poNumber);
    try {
      const blob = await downloadPurchaseOrderSignedPdf(poNumber);
      downloadBlobAsFile(blob, `PO-${poNumber}-for-signature.pdf`);
      toast({
        title: "Signable PDF downloaded",
        description: `PO ${poNumber} — includes terms and signature page.`,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Request failed";
      let description = raw;
      if (/not\s*found|po_not_found/i.test(raw)) {
        description = "This purchase order was not found or is no longer available.";
      } else if (/unavailable|503|db_unavailable|timeout/i.test(raw)) {
        description = "The operations database is unavailable. Try again in a moment.";
      }
      toast({
        title: "Could not export PDF",
        description,
        variant: "destructive",
      });
    } finally {
      setExportingPo(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4" data-testid="purchase-orders-page">
      {embedded ? (
        <h1 className="sr-only" data-testid="page-title">
          Purchase orders
        </h1>
      ) : (
        <PageHeader
          title="Purchase Orders"
          subtitle="Operational purchasing workflow"
          breadcrumb={<span>Procurement / Purchase orders</span>}
          titleTestId="page-title"
        />
      )}

      <div data-tour="po-list" className="space-y-4">
        <Toolbar
          sticky
          left={
            <>
              <Input
                data-testid="po-search-input"
                value={qInput}
                onChange={(event) => {
                  setQInput(event.target.value);
                }}
                placeholder="Search PO number or supplier"
                className="w-full sm:w-[260px]"
              />
              <Input
                data-testid="po-supplier-filter"
                value={supplierInput}
                onChange={(event) => {
                  setSupplierInput(event.target.value);
                }}
                placeholder="Supplier id or name"
                className="w-full sm:w-[220px]"
              />
              <Select
                value={statusInput || "all"}
                onValueChange={(value) => {
                  const next = value === "all" ? "" : value;
                  setStatusInput(next);
                  setQueryState({ status: next });
                }}
              >
                <SelectTrigger className="w-full sm:w-[220px]" data-testid="po-status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
          right={
            <>
              <Button asChild variant="default" size="sm">
                <Link href={APP_ROUTES.inventory.reorder}>Create reorder request</Link>
              </Button>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as PoSort)}>
                <SelectTrigger className="w-full sm:w-[210px]" data-testid="po-sort-select">
                  <SelectValue placeholder="Sort purchase orders" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="requested-desc">Requested newest</SelectItem>
                  <SelectItem value="requested-asc">Requested oldest</SelectItem>
                  <SelectItem value="total-desc">Total high to low</SelectItem>
                  <SelectItem value="total-asc">Total low to high</SelectItem>
                  <SelectItem value="supplier-asc">Supplier A-Z</SelectItem>
                  <SelectItem value="progress-asc">Progress low to high</SelectItem>
                  <SelectItem value="progress-desc">Progress high to low</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={refetch}>
                Refresh
              </Button>
              <Button
                type="button"
                variant="ghost"
                data-testid="po-clear-filters-button"
                onClick={() => {
                  setQInput("");
                  setSupplierInput("");
                  setStatusInput("");
                  setQueryState({ q: "", supplier: "", status: "" });
                }}
              >
                Clear filters
              </Button>
            </>
          }
        />

        {hasActiveFilters ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="po-active-filters">
            <span className="text-muted-foreground">Active filters:</span>
            {activeSearch ? (
              <Button variant="secondary" size="sm" className="gap-1" data-testid="po-filter-chip-search" onClick={() => clearFilter("q")}>
                Search: {activeSearch}
                <X className="h-3 w-3" />
              </Button>
            ) : null}
            {activeSupplier ? (
              <Button variant="secondary" size="sm" className="gap-1" data-testid="po-filter-chip-supplier" onClick={() => clearFilter("supplier")}>
                Supplier: {activeSupplier}
                <X className="h-3 w-3" />
              </Button>
            ) : null}
            {activeStatus ? (
              <Button variant="secondary" size="sm" className="gap-1" data-testid="po-filter-chip-status" onClick={() => clearFilter("status")}>
                Status: {statusLabel(activeStatus)}
                <X className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        ) : null}

        <DataState
          loading={loading}
          error={error}
          data={data}
          isEmpty={(orders) => (Array.isArray(orders) ? orders : []).length === 0}
          emptyTitle="No purchase orders found"
          emptyDescription={
            productSetupComplete
              ? "No purchase orders match your filters. POs are formal commitments to suppliers (what, quantity, price, terms); without them, receiving and invoice matching become unclear and spend is harder to control. Start from a requisition or a reorder when stock is low."
              : "Finish product setup first. Purchase orders are formal buying documents; once setup is complete you can create requisitions and approved POs with correct master data."
          }
          emptyAction={
            productSetupComplete ? (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="default" size="sm">
                  <Link href={APP_ROUTES.procurement.requisitionNew}>Create requisition</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={APP_ROUTES.inventory.reorder}>Create reorder request</Link>
                </Button>
              </div>
            ) : (
              <Button asChild variant="default" size="sm">
                <Link href={APP_ROUTES.setup.product}>Continue product setup</Link>
              </Button>
            )
          }
          fallback={fallback}
          onRetry={refetch}
        >
          {(orders) => {
            const baseList = Array.isArray(orders) ? orders : [];
            const q = activeSearch.toLowerCase();
            const supplierFilter = activeSupplier.toLowerCase();
            const statusFilter = normalizeStatus(activeStatus);
            const list = baseList.filter((order) => {
              if (statusFilter && normalizeStatus(order.status) !== statusFilter) {
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
            const sorted = list.slice().sort((a, b) => {
              if (sortBy === "requested-asc") return dateMs(a.requestedDate) - dateMs(b.requestedDate);
              if (sortBy === "total-desc") return Number(b.totalAmount ?? 0) - Number(a.totalAmount ?? 0);
              if (sortBy === "total-asc") return Number(a.totalAmount ?? 0) - Number(b.totalAmount ?? 0);
              if (sortBy === "supplier-asc") return (a.supplierName || "").localeCompare(b.supplierName || "");
              if (sortBy === "progress-asc") return Number(a.receivedProgress ?? 0) - Number(b.receivedProgress ?? 0);
              if (sortBy === "progress-desc") return Number(b.receivedProgress ?? 0) - Number(a.receivedProgress ?? 0);
              return dateMs(b.requestedDate) - dateMs(a.requestedDate);
            });
            const kpis = {
              total: sorted.length,
              open: sorted.filter((order) => normalizeStatus(order.status) === "open").length,
              approved: sorted.filter((order) => normalizeStatus(order.status) === "approved").length,
              sent: sorted.filter((order) => normalizeStatus(order.status) === "sent").length,
              received: sorted.filter((order) => normalizeStatus(order.status) === "received").length,
              totalValue: sorted.reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0),
            };
            return (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  <Card data-testid="po-kpi-total"><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total POs</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{kpis.total}</CardContent></Card>
                  <Card data-testid="po-kpi-open"><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Open / awaiting action</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{kpis.open}</CardContent></Card>
                  <Card data-testid="po-kpi-approved"><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Approved / ready to send</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{kpis.approved}</CardContent></Card>
                  <Card data-testid="po-kpi-sent"><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Sent / awaiting receipt</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{kpis.sent}</CardContent></Card>
                  <Card data-testid="po-kpi-received"><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Received</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{kpis.received}</CardContent></Card>
                  <Card data-testid="po-kpi-total-value"><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total order value</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{formatMoney(kpis.totalValue)}</CardContent></Card>
                </div>
              <div className="overflow-x-auto">
                <Table className="min-w-[72rem]" data-testid="po-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Received progress</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((order) => (
                      <TableRow
                        key={order.poNumber}
                        data-testid={`po-row-${order.poNumber}`}
                        className="cursor-pointer"
                        onClick={() => setPreviewOrder(order)}
                      >
                        <TableCell className="font-medium">{order.poNumber}</TableCell>
                        <TableCell>{order.supplierName || `Supplier #${order.supplierId}`}</TableCell>
                        <TableCell>
                          <StatusBadge status={order.status} />
                        </TableCell>
                        <TableCell>{formatDate(order.requestedDate)}</TableCell>
                        <TableCell className="text-right">{order.linesCount}</TableCell>
                        <TableCell className="text-right">{order.receivedProgress}%</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(order.totalAmount)}</TableCell>
                        <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            data-testid={`po-row-preview-${order.poNumber}`}
                            onClick={() => setPreviewOrder(order)}
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                            <span className="sr-only">Preview {order.poNumber}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            data-testid={`po-row-open-${order.poNumber}`}
                            onClick={() => setLocation(APP_ROUTES.procurement.order(order.poNumber))}
                          >
                            <ExternalLink className="h-4 w-4" aria-hidden />
                            <span className="sr-only">Open {order.poNumber}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            title="Download signable PDF"
                            data-testid={`po-row-pdf-${order.poNumber}`}
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
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              </div>
            );
          }}
        </DataState>
      </div>
      <Dialog open={Boolean(previewOrder)} onOpenChange={(open) => !open && setPreviewOrder(null)}>
        <DialogContent data-testid="po-preview-panel" className="sm:max-w-2xl">
          {previewOrder ? (
            <>
              <DialogHeader>
                <DialogTitle data-testid="po-preview-title">PO {previewOrder.poNumber}</DialogTitle>
                <DialogDescription>{previewOrder.supplierName || `Supplier #${previewOrder.supplierId}`}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Status</div><div data-testid="po-preview-status"><StatusBadge status={previewOrder.status} /></div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Requested</div><div className="font-medium">{formatDate(previewOrder.requestedDate)}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Lines</div><div className="font-medium">{previewOrder.linesCount}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Received progress</div><div className="font-medium">{previewOrder.receivedProgress}%</div></div>
                <div className="rounded-md border p-3 sm:col-span-2"><div className="text-xs text-muted-foreground">Total amount</div><div className="text-xl font-semibold" data-testid="po-preview-total">{formatMoney(previewOrder.totalAmount)}</div></div>
              </div>
              <p className="rounded-md border bg-muted/30 p-3 text-sm">{poStatusExplanation(previewOrder.status)}</p>
              <DialogFooter>
                <Button type="button" variant="outline" data-testid="po-preview-close" onClick={() => setPreviewOrder(null)}>Close</Button>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="po-preview-download-pdf"
                  disabled={exportingPo === previewOrder.poNumber}
                  onClick={() => void exportSignedPdfForRow(previewOrder.poNumber)}
                >
                  Download signable PDF
                </Button>
                <Button type="button" data-testid="po-preview-open-full" onClick={() => setLocation(APP_ROUTES.procurement.order(previewOrder.poNumber))}>
                  Open full PO
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
