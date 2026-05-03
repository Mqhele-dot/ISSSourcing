import { useCallback, useState } from "react";
import { Link, useLocation } from "wouter";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState, type FallbackKind } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { useAsyncResource } from "@/hooks/use-async-resource";
import { downloadPurchaseOrderSignedPdf, fetchPurchaseOrdersEnvelope } from "@/api/client";
import type { PurchaseOrderListItem } from "@/api/types";
import { downloadFile } from "@/lib/utils";
import { formatDate } from "./purchase-order-shared";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";

export function PurchaseOrdersList({ embedded }: { embedded?: boolean }) {
  const productSetupComplete = useProductSetupComplete();
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
  const fallbackRaw = envelope?.meta?.fallback as FallbackKind | undefined;
  /** Do not show degraded/timeout empty copy when the list request itself failed. */
  const fallback = error ? undefined : fallbackRaw;

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
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
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
                        onClick={() => setLocation(APP_ROUTES.procurement.order(order.poNumber))}
                      >
                        <TableCell className="text-center" onClick={(event) => event.stopPropagation()}>
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
