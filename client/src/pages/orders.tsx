import { useCallback, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, CheckCircle2, Printer, Send, Truck } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
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
import { apiRequest, requestJson } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import TutorialButton from "@/components/ui/tutorial-button";
import { useAuth } from "@/hooks/use-auth";

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
  const normalized = status.toLowerCase();
  return normalized === "open" || normalized === "draft";
}

function canSend(status: string) {
  return status.toLowerCase() === "approved";
}

function canReceive(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "approved" || normalized === "sent" || normalized === "partially_received";
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

function PurchaseOrdersList() {
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
      <PageHeader
        title="Purchase Orders"
        subtitle="Operational purchasing workflow"
        breadcrumb={<span>Operations / Purchase Orders</span>}
      />

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
                <CardTitle>Commercial & legal summary</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Order reference</p>
                  <p className="font-medium">{detail.poNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Counterparty</p>
                  <p className="font-medium">{detail.supplierName || `Supplier #${detail.supplierId}`}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fulfilment status</p>
                  <p className="font-medium">{detail.progress.qtyReceived}/{detail.progress.qtyOrdered} units received</p>
                </div>
                <p className="text-xs text-muted-foreground md:col-span-3">
                  This order record is system-generated for procurement audit and goods receipt reconciliation.
                  Please attach signed terms and supplier confirmations in your contract module for legal enforceability.
                </p>
              </CardContent>
            </Card>

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

type Requisition = {
  id: number;
  requisitionNumber: string;
  status: string;
  requiredDate: string | null;
  notes: string | null;
  supplierId: number | null;
  totalAmount?: number;
};

type RequisitionMeta = {
  currency?: string;
  exchangeRate?: number;
  paymentTerms?: string;
  shippingTerms?: string;
  billingAddress?: string;
  deliveryAddress?: string;
  legalTerms?: string;
};

const META_PREFIX = "INVTRACK_PR_META:";

function parseRequisitionMeta(notes: string | null): { description: string; meta: RequisitionMeta } {
  if (!notes) return { description: "", meta: {} };
  if (!notes.startsWith(META_PREFIX)) return { description: notes, meta: {} };
  const payload = notes.slice(META_PREFIX.length);
  try {
    const parsed = JSON.parse(payload) as { description?: string; meta?: RequisitionMeta };
    return {
      description: parsed.description ?? "",
      meta: parsed.meta ?? {},
    };
  } catch {
    return { description: notes, meta: {} };
  }
}

function composeRequisitionNotes(description: string, meta: RequisitionMeta): string {
  return `${META_PREFIX}${JSON.stringify({ description, meta })}`;
}

function PurchaseRequisitionsPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    supplierId: "",
    requiredDate: "",
    notes: "",
    itemId: "",
    quantity: "1",
    unitPrice: "0",
    currency: "USD",
    exchangeRate: "1",
    paymentTerms: "Net 30",
    shippingTerms: "FOB destination",
    billingAddress: "",
    deliveryAddress: "",
    legalTerms: "Subject to supplier contract and local procurement law.",
  });
  const [editing, setEditing] = useState<Requisition | null>(null);
  const [sharedWith, setSharedWith] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem("requisition-share-list") || "{}"); } catch { return {}; }
  });

  const { data: requisitions = [] } = useQuery<Requisition[]>({ queryKey: ["/api/purchase-requisitions"], queryFn: () => requestJson("GET", "/api/purchase-requisitions") });
  const { data: suppliers = [] } = useQuery<Array<{ id: number; name: string }>>({ queryKey: ["/api/suppliers"], queryFn: () => requestJson("GET", "/api/suppliers") });
  const { data: inventory = [] } = useQuery<Array<{ id: number; name: string; sku: string }>>({ queryKey: ["/api/inventory"], queryFn: () => requestJson("GET", "/api/inventory") });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const notes = composeRequisitionNotes(form.notes, {
        currency: form.currency,
        exchangeRate: Number(form.exchangeRate || 1),
        paymentTerms: form.paymentTerms,
        shippingTerms: form.shippingTerms,
        billingAddress: form.billingAddress,
        deliveryAddress: form.deliveryAddress,
        legalTerms: form.legalTerms,
      });
      if (editing) {
        return (await apiRequest("PUT", `/api/purchase-requisitions/${editing.id}`, {
          supplierId: form.supplierId ? Number(form.supplierId) : null,
          requiredDate: form.requiredDate ? new Date(form.requiredDate) : null,
          notes,
        })).json();
      }
      return (await apiRequest("POST", "/api/purchase-requisitions", {
        requestorId: user?.id ?? null,
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        requiredDate: form.requiredDate ? new Date(form.requiredDate) : null,
        notes,
        status: "PENDING",
        items: [{
          itemId: Number(form.itemId),
          quantity: Number(form.quantity),
          unitPrice: Number(form.unitPrice),
          totalPrice: Number(form.quantity) * Number(form.unitPrice),
        }],
      })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase/orders"] });
      setOpen(false);
      setEditing(null);
      setForm({ supplierId: "", requiredDate: "", notes: "", itemId: "", quantity: "1", unitPrice: "0", currency: "USD", exchangeRate: "1", paymentTerms: "Net 30", shippingTerms: "FOB destination", billingAddress: "", deliveryAddress: "", legalTerms: "Subject to supplier contract and local procurement law." });
      toast({ title: "Requisition saved" });
    },
    onError: (error) => {
      toast({ title: "Unable to save requisition", description: String(error), variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/purchase-requisitions/${id}/approve`, { approverId: user?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition approved" });
    },
    onError: (error) => toast({ title: "Approval failed", description: String(error), variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/purchase-requisitions/${id}/convert`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase/orders"] });
      toast({ title: "Converted to purchase order" });
    },
    onError: (error) => toast({ title: "Conversion failed", description: String(error), variant: "destructive" }),
  });

  const openEdit = (req: Requisition) => {
    const parsed = parseRequisitionMeta(req.notes);
    setEditing(req);
    setForm({
      supplierId: req.supplierId ? String(req.supplierId) : "",
      requiredDate: req.requiredDate ? new Date(req.requiredDate).toISOString().slice(0, 10) : "",
      notes: parsed.description ?? "",
      itemId: "",
      quantity: "1",
      unitPrice: "0",
      currency: parsed.meta.currency ?? "USD",
      exchangeRate: String(parsed.meta.exchangeRate ?? 1),
      paymentTerms: parsed.meta.paymentTerms ?? "Net 30",
      shippingTerms: parsed.meta.shippingTerms ?? "FOB destination",
      billingAddress: parsed.meta.billingAddress ?? "",
      deliveryAddress: parsed.meta.deliveryAddress ?? "",
      legalTerms: parsed.meta.legalTerms ?? "Subject to supplier contract and local procurement law.",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Procurement starts with requisitions. Approve and convert to compliant purchase orders.</p>
        <div className="flex gap-2">
          <TutorialButton page="purchase" />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">New Requisition</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit" : "Create"} Purchase Requisition</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <select className="w-full rounded-md border px-3 py-2" value={form.supplierId} onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}>
                    <option value="">Select supplier</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Required date</Label>
                  <Input type="date" value={form.requiredDate} onChange={(e) => setForm((f) => ({ ...f, requiredDate: e.target.value }))} />
                </div>
                {!editing && <>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Requested item</Label>
                    <select className="w-full rounded-md border px-3 py-2" value={form.itemId} onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}>
                      <option value="">Select item</option>
                      {inventory.map((i) => <option key={i.id} value={i.id}>{i.sku} - {i.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2"><Label>Quantity</Label><Input value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Unit price</Label><Input value={form.unitPrice} onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))} /></div>
                </>}
                <div className="space-y-2"><Label>Currency</Label><Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} /></div>
                <div className="space-y-2"><Label>Exchange rate</Label><Input value={form.exchangeRate} onChange={(e) => setForm((f) => ({ ...f, exchangeRate: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Payment terms</Label><Input value={form.paymentTerms} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Shipping terms</Label><Input value={form.shippingTerms} onChange={(e) => setForm((f) => ({ ...f, shippingTerms: e.target.value }))} /></div>
                <div className="space-y-2 md:col-span-2"><Label>Billing address</Label><Textarea value={form.billingAddress} onChange={(e) => setForm((f) => ({ ...f, billingAddress: e.target.value }))} /></div>
                <div className="space-y-2 md:col-span-2"><Label>Delivery address</Label><Textarea value={form.deliveryAddress} onChange={(e) => setForm((f) => ({ ...f, deliveryAddress: e.target.value }))} /></div>
                <div className="space-y-2 md:col-span-2"><Label>Legal / compliance terms</Label><Textarea value={form.legalTerms} onChange={(e) => setForm((f) => ({ ...f, legalTerms: e.target.value }))} /></div>
                <div className="space-y-2 md:col-span-2"><Label>Business justification</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
                <div className="md:col-span-2"><Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || (!editing && !form.itemId)}>Save Requisition</Button></div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Requisition</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Required</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Share With</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requisitions.map((req) => {
            const parsed = parseRequisitionMeta(req.notes);
            return (
            <TableRow key={req.id}>
              <TableCell>
                <div className="font-medium">{req.requisitionNumber}</div>
                <div className="text-xs text-muted-foreground">{parsed.meta.paymentTerms || "Net 30"}</div>
              </TableCell>
              <TableCell><StatusBadge status={req.status.toLowerCase()} /></TableCell>
              <TableCell>{formatDate(req.requiredDate)}</TableCell>
              <TableCell className="text-right">{parsed.meta.currency || "USD"} {(req.totalAmount ?? 0).toFixed(2)}</TableCell>
              <TableCell>
                <Input
                  placeholder="user@company.com"
                  value={sharedWith[req.id] ?? ""}
                  onChange={(e) => {
                    const next = { ...sharedWith, [req.id]: e.target.value };
                    setSharedWith(next);
                    localStorage.setItem("requisition-share-list", JSON.stringify(next));
                  }}
                />
              </TableCell>
              <TableCell className="space-x-2 text-right">
                <Button variant="outline" size="sm" onClick={() => openEdit(req)}>Edit</Button>
                <Button size="sm" onClick={() => approveMutation.mutate(req.id)} disabled={req.status.toUpperCase() === "APPROVED"}>Approve</Button>
                <Button variant="secondary" size="sm" onClick={() => convertMutation.mutate(req.id)} disabled={req.status.toUpperCase() !== "APPROVED"}>Convert to PO</Button>
              </TableCell>
            </TableRow>
          )})}
        </TableBody>
      </Table>
    </div>
  );
}

export default function OrdersPage() {
  const [ordersDetailMatch, ordersDetailParams] = useRoute<{ po: string }>("/orders/:po");
  const [purchaseDetailMatch, purchaseDetailParams] = useRoute<{ po: string }>("/purchase/:po");

  const po = ordersDetailMatch
    ? ordersDetailParams?.po
    : purchaseDetailMatch
      ? purchaseDetailParams?.po
      : undefined;

  if (po) {
    return <PurchaseOrderDetailView po={po} />;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Tabs defaultValue="orders" className="space-y-4">
        <TabsList>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="requisitions">Purchase Requisitions</TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          <PurchaseOrdersList />
        </TabsContent>
        <TabsContent value="requisitions">
          <PurchaseRequisitionsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
