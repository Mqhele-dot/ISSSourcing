import { useCallback, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, CheckCircle2, FileText, Printer, Send, ShoppingCart, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
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
import { formatMutationError } from "@/lib/queryClient";
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { Can } from "@/components/auth/can";
import { EntityActivityPanel } from "@/components/activity/entity-activity-panel";
import {
  approvePurchaseOrder,
  fetchPurchaseOrder,
  fetchPurchaseOrdersEnvelope,
  receivePurchaseOrder,
  sendPurchaseOrder,
  type PurchaseOrderDetail,
  type PurchaseOrderListItem,
  type PurchaseReceiveResult,
} from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RequisitionsPage from "@/pages/requisitions";

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

function PurchaseOrdersList({ embedded }: { embedded?: boolean }) {
  const [, setLocation] = useLocation();
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

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {!embedded && (
        <PageHeader
          title="Purchase Orders"
          subtitle="Operational purchasing workflow"
          breadcrumb={<span>Operations / Purchase Orders</span>}
        />
      )}

      <Toolbar
        sticky
        left={
          <>
            <Input
              value={String(queryState.q || "")}
              onChange={(event) => setQueryState({ q: event.target.value })}
              placeholder="Search PO number or supplier"
              className="w-[260px]"
            />
            <Input
              value={String(queryState.supplier || "")}
              onChange={(event) => setQueryState({ supplier: event.target.value })}
              placeholder="Supplier id or name"
              className="w-[220px]"
            />
            <Input
              value={String(queryState.status || "")}
              onChange={(event) => setQueryState({ status: event.target.value })}
              placeholder="Status (draft/open/approved/sent/received)"
              className="w-[250px]"
            />
          </>
        }
        right={
          <>
            <Button asChild variant="default" size="sm">
              <Link href="/reorder">Create reorder request</Link>
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
              <Link href="/reorder">Create reorder request</Link>
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
          const list = Array.isArray(orders) ? orders : [];
          return (
          <Table>
            <TableHeader>
              <TableRow>
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
          );
        }}
      </DataState>
    </div>
  );
}

function PurchaseOrderDetailView({ po }: { po: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [receiving, setReceiving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [receiveState, setReceiveState] = useState<Record<string, number>>({});
  const [lastChangeSummary, setLastChangeSummary] = useState<PurchaseReceiveResult | null>(null);

  const fetcher = useCallback((): Promise<PurchaseOrderDetail> => fetchPurchaseOrder(po), [po]);
  const { loading, error, data, refetch } = useAsyncResource(fetcher);

  const receivePayload = useMemo(
    () =>
      Object.entries(receiveState)
        .filter(([, qty]) => qty > 0)
        .map(([sku, qty]) => ({ sku, qtyReceivedNow: qty })),
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
        description: formatMutationError(actionLabel, "POST", `/api/purchase/orders/${po}/transition`, err),
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
      const result = await receivePurchaseOrder(po, receivePayload);
      setLastChangeSummary(result);
      setReceiveState({});
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
    <div className="mx-auto max-w-7xl space-y-4">
      <Button variant="ghost" onClick={() => setLocation("/purchase")} className="w-fit">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to purchase orders
      </Button>

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={() => false}
        emptyTitle="PO detail unavailable"
        onRetry={refetch}
      >
        {(detail) => (
          <>
            <PageHeader
              title={`PO ${detail.poNumber}`}
              subtitle={detail.supplierName || `Supplier #${detail.supplierId}`}
              breadcrumb={<span>Operations / Purchase Orders / {detail.poNumber}</span>}
              actions={
                <>
                  <Button variant="outline" className="gap-2" onClick={() => openPurchaseOrderPrintView(detail)}>
                    <Printer className="h-4 w-4" />
                    Print view
                  </Button>
                  <Can roles={["planner", "admin"]} reason="Requires Planner/Admin">
                    <Button
                      variant="outline"
                      className="gap-2"
                      disabled={!canApprove(detail.status) || statusUpdating}
                      onClick={() => updateStatus("approve")}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve
                    </Button>
                  </Can>
                  <Can roles={["planner", "admin"]} reason="Requires Planner/Admin">
                    <Button
                      variant="outline"
                      className="gap-2"
                      disabled={!canSend(detail.status) || statusUpdating}
                      onClick={() => updateStatus("send")}
                    >
                      <Send className="h-4 w-4" />
                      Send
                    </Button>
                  </Can>
                </>
              }
            />

            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBadge status={detail.status} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Requested</CardTitle>
                </CardHeader>
                <CardContent>{formatDate(detail.requestedDate)}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Progress</CardTitle>
                </CardHeader>
                <CardContent>{detail.progress.percent}%</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Total</CardTitle>
                </CardHeader>
                <CardContent>${detail.totalAmount.toFixed(2)}</CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Receive panel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Receive now</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">{line.sku}</TableCell>
                        <TableCell>{line.itemName}</TableCell>
                        <TableCell className="text-right">{line.qtyOrdered}</TableCell>
                        <TableCell className="text-right">{line.qtyReceived}</TableCell>
                        <TableCell className="text-right">{line.expectedRemaining}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            className="ml-auto w-28 text-right"
                            type="number"
                            min={0}
                            step={1}
                            value={receiveState[line.sku] ?? 0}
                            onChange={(event) =>
                              setReceiveState((current) => ({
                                ...current,
                                [line.sku]: Number(event.target.value),
                              }))
                            }
                            disabled={!canReceive(detail.status)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex justify-end">
                  <Can roles={["planner", "admin"]} reason="Requires Planner/Admin">
                    <Button onClick={submitReceive} disabled={!canReceive(detail.status) || receiving}>
                      <Truck className="mr-2 h-4 w-4" />
                      Receive selected
                    </Button>
                  </Can>
                </div>
              </CardContent>
            </Card>

            {lastChangeSummary ? (
              <Card>
                <CardHeader>
                  <CardTitle>What changed</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Inventory deltas</Label>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead className="text-right">Delta</TableHead>
                          <TableHead className="text-right">On hand</TableHead>
                          <TableHead className="text-right">Available</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lastChangeSummary.inventoryChanges.map((change, index) => (
                          <TableRow key={`${change.sku}-${index}`}>
                            <TableCell>{change.sku}</TableCell>
                            <TableCell>{change.location}</TableCell>
                            <TableCell className="text-right">+{change.delta}</TableCell>
                            <TableCell className="text-right">{change.onHand}</TableCell>
                            <TableCell className="text-right">{change.available}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <Label>Shipment updates</Label>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Shipment ID</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lastChangeSummary.shipmentUpdates.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-sm text-muted-foreground">
                              No linked shipment changes
                            </TableCell>
                          </TableRow>
                        ) : (
                          lastChangeSummary.shipmentUpdates.map((update) => (
                            <TableRow key={update.shipmentId}>
                              <TableCell>{update.shipmentId}</TableCell>
                              <TableCell>{update.toStatus}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <EntityActivityPanel entityType="purchase_order" entityId={detail.poNumber} />

            <Card>
              <CardHeader>
                <CardTitle>Linked shipments</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Carrier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>ETA</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.shipments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-sm text-muted-foreground">
                          No linked shipments
                        </TableCell>
                      </TableRow>
                    ) : (
                      detail.shipments.map((shipment) => (
                        <TableRow key={shipment.id}>
                          <TableCell>{shipment.id}</TableCell>
                          <TableCell>{shipment.carrier || "-"}</TableCell>
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
          </>
        )}
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
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Purchase"
          subtitle="Manage purchase orders and requisitions"
          breadcrumb={<span>Operations / Purchase</span>}
        />
        <Tabs defaultValue="orders" className="w-full">
          <TabsList className="mb-4">
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
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Purchase Orders"
        subtitle="Manage purchase orders and requisitions"
        breadcrumb={<span>Operations / Purchase Orders</span>}
      />
      <Tabs defaultValue="orders" className="w-full">
        <TabsList className="mb-4">
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
