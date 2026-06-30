import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Truck, ChevronRight, Package, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { PageHeader } from "@/components/page-header";
import { DataState } from "@/components/ui/data-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Can } from "@/components/auth/can";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { requestJson } from "@/lib/queryClient";
import { fetchPurchaseOrdersEnvelope } from "@/features/purchase-orders";
import {
  normalizeBatchInput,
  normalizeSerialTokensCsv,
  usePurchaseOrderOperationalDetailQuery,
  useReceivePurchaseOrderMutation,
  validateReceiveLines,
  validateReceivePutaway,
  type ReceiveLineFieldError,
  type ReceivePutawayWarehouse,
} from "@/features/purchase-orders";
import type { PurchaseOrderListItem } from "@/api/types";

function useReceivePoFromLocation() {
  const [loc] = useLocation();
  const match = loc.match(/^\/m\/receive\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function MobileReceivePage() {
  const poNumber = useReceivePoFromLocation();
  return poNumber ? <MobileReceiveDetailPage poNumber={poNumber} /> : <MobileReceiveQueuePage />;
}

function MobileReceiveQueuePage() {
  const fetcher = async (signal: AbortSignal) => {
    const envApproved = await fetchPurchaseOrdersEnvelope({ status: "approved" }, { signal });
    const envSent = await fetchPurchaseOrdersEnvelope({ status: "sent" }, { signal });
    const envPartial = await fetchPurchaseOrdersEnvelope({ status: "partially_received" }, { signal });
    const map = new Map<string, PurchaseOrderListItem>();
    for (const order of [...(envApproved.data ?? []), ...(envSent.data ?? []), ...(envPartial.data ?? [])]) {
      map.set(order.poNumber, order);
    }
    const merged = Array.from(map.values()).sort((a, b) => b.poNumber.localeCompare(a.poNumber));
    return { data: merged };
  };

  const { loading, error, data: bundle, refetch } = useAsyncResource(fetcher, { abortable: true });
  const rows = bundle?.data ?? [];

  return (
    <div className="mx-auto max-w-lg px-3 pb-24 pt-2 md:max-w-2xl" data-testid="mobile-receive-queue">
      <PageHeader
        title="Receive on mobile"
        subtitle="Choose a PO, then capture dockside receipts with touch-first quantity, batch, and bin controls."
        breadcrumb={<Link href={APP_ROUTES.operations.mobileHub}>Back</Link>}
      />

      <p className="mb-4 text-xs text-muted-foreground md:text-sm">
        Queue includes approved, sent, and partially received purchase orders. Open one to post a real goods receipt.
      </p>

      <DataState
        loading={loading}
        error={error}
        data={rows}
        isEmpty={(list) => list.length === 0}
        emptyTitle="No POs ready for receipt"
        emptyDescription="Approve and send purchase orders first. This queue only shows real purchase orders eligible for receipt."
        emptyAction={
          <Link
            href={APP_ROUTES.procurement.orders}
            className="text-primary text-sm font-medium underline underline-offset-2"
          >
            Go to purchase orders
          </Link>
        }
        onRetry={refetch}
      >
        {(list) => (
          <ul className="flex flex-col gap-2">
            {list.map((po) => (
              <li key={po.poNumber}>
                <Link
                  href={APP_ROUTES.operations.mobileReceivePo(po.poNumber)}
                  className="flex min-h-[68px] items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm active:bg-accent/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Package className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-semibold">{po.poNumber}</span>
                      <Badge variant="outline" className="capitalize">
                        {po.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {po.supplierName ?? `Supplier #${po.supplierId}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {po.receivedProgress ?? 0}% received · {po.qtyReceived ?? 0}/{po.qtyOrdered ?? 0} units
                    </p>
                  </div>
                  <ChevronRight className="h-6 w-6 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </div>
  );
}

function MobileReceiveDetailPage({ poNumber }: { poNumber: string }) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const detailQuery = usePurchaseOrderOperationalDetailQuery(poNumber);
  const receiveMutation = useReceivePurchaseOrderMutation(poNumber);
  const [receiverName, setReceiverName] = useState("");
  const [grnNumber, setGrnNumber] = useState("");
  const [receiveState, setReceiveState] = useState<Record<string, number>>({});
  const [batchState, setBatchState] = useState<Record<string, string>>({});
  const [serialState, setSerialState] = useState<Record<string, string>>({});
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [receiveLineIssues, setReceiveLineIssues] = useState<ReceiveLineFieldError[]>([]);
  const [receivePutaway, setReceivePutaway] = useState<{ warehouseId: number | null; aisle: string; binCode: string }>({
    warehouseId: null,
    aisle: "",
    binCode: "",
  });

  const { data: warehousesForReceive = [] } = useQuery({
    queryKey: ["/api/warehouses"],
    queryFn: () =>
      requestJson<
        Array<{
          id: number;
          name: string;
          isDefault?: boolean | null;
          aisles?: string[] | null;
          bins?: Array<{ code: string; aisle?: string | null }> | null;
        }>
      >("GET", "/api/warehouses"),
  });

  const receiveWarehouses = useMemo(
    (): ReceivePutawayWarehouse[] =>
      warehousesForReceive.map((warehouse) => ({
        id: warehouse.id,
        name: warehouse.name,
        isDefault: warehouse.isDefault,
        aisles: warehouse.aisles ?? null,
        bins: warehouse.bins ?? null,
      })),
    [warehousesForReceive],
  );

  useEffect(() => {
    if (receiveWarehouses.length === 0) return;
    setReceivePutaway((current) => {
      if (current.warehouseId != null) return current;
      const defaultWarehouse = receiveWarehouses.find((warehouse) => warehouse.isDefault) ?? receiveWarehouses[0];
      return { ...current, warehouseId: defaultWarehouse?.id ?? null };
    });
  }, [receiveWarehouses]);

  useEffect(() => {
    setReceiveLineIssues([]);
    setReceiveError(null);
  }, [receiveState, batchState, serialState, receivePutaway, receiverName, grnNumber]);

  const detail = detailQuery.data ?? null;
  const receivableLines = useMemo(
    () => detail?.lines.filter((line) => Number(line.expectedRemaining ?? 0) > 0) ?? [],
    [detail?.lines],
  );

  const receivePayload = useMemo(
    () =>
      Object.entries(receiveState)
        .filter(([, qty]) => qty > 0)
        .map(([sku, qty]) => {
          const batchNumber = normalizeBatchInput(batchState[sku]);
          const serialNumbers = serialState[sku] ? normalizeSerialTokensCsv(serialState[sku]) : undefined;
          return {
            sku,
            qtyReceivedNow: qty,
            ...(batchNumber ? { batchNumber } : {}),
            ...(serialNumbers?.length ? { serialNumbers } : {}),
          };
        }),
    [batchState, receiveState, serialState],
  );

  const submitReceive = () => {
    if (!detail) return;

    const putawayCheck = validateReceivePutaway(receiveWarehouses, receivePutaway);
    if (!putawayCheck.ok) {
      setReceiveLineIssues([]);
      setReceiveError(putawayCheck.message);
      toast({
        title: "Putaway required",
        description: putawayCheck.message,
        variant: "destructive",
      });
      return;
    }

    const lineCheck = validateReceiveLines(detail, receivePayload);
    if (!lineCheck.ok) {
      setReceiveLineIssues(lineCheck.errors);
      const description = lineCheck.errors.map((issue) => (issue.sku ? `${issue.sku}: ${issue.message}` : issue.message)).join(" ");
      setReceiveError(description || "Receive validation failed.");
      toast({
        title: "Receive validation failed",
        description: description || "Check quantities, batch, and serial inputs.",
        variant: "destructive",
      });
      return;
    }

    receiveMutation.mutate(
      {
        lines: receivePayload,
        receiveOptions: {
          receiverUserId: typeof user?.id === "number" ? user.id : undefined,
          receiverName: receiverName.trim() || undefined,
          warehouseId: receivePutaway.warehouseId ?? undefined,
          aisle: receivePutaway.aisle.trim() || undefined,
          binCode: receivePutaway.binCode.trim() || undefined,
          warehouseLocation: [receivePutaway.aisle.trim(), receivePutaway.binCode.trim()].filter(Boolean).join("/") || undefined,
          grnNumber: grnNumber.trim() || undefined,
        },
      },
      {
        onSuccess: (result) => {
          setReceiveState({});
          setBatchState({});
          setSerialState({});
          setReceiveLineIssues([]);
          setReceiveError(null);
          toast({
            title: "Receipt posted",
            description: `${result.changed.inventoryChanges} inventory updates recorded for ${result.order.poNumber}.`,
          });
        },
        onError: (error) => {
          const description = error instanceof Error ? error.message : String(error);
          setReceiveError(description);
          toast({
            title: "Could not post receipt",
            description,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-lg px-3 pb-24 pt-2 md:max-w-2xl" data-testid="mobile-receive-detail">
      <PageHeader
        title={poNumber}
        subtitle="Capture a real dock receipt without switching back to the desktop purchase detail."
        breadcrumb={
          <button
            type="button"
            className="text-sm text-primary underline underline-offset-2"
            onClick={() => navigate(APP_ROUTES.operations.mobileReceive)}
          >
            Back to receive queue
          </button>
        }
      />

      <DataState
        loading={detailQuery.isLoading}
        error={detailQuery.error instanceof Error ? detailQuery.error : detailQuery.error ? new Error(String(detailQuery.error)) : null}
        data={detail}
        isEmpty={(value) => !value}
        emptyTitle="Purchase order not found"
        emptyDescription="The selected PO is unavailable or you do not have access to it."
        onRetry={() => void detailQuery.refetch()}
      >
        {(value) => {
          const selectedWarehouse = receiveWarehouses.find((warehouse) => warehouse.id === receivePutaway.warehouseId);
          const aisles = selectedWarehouse?.aisles ?? [];
          const binOptions =
            selectedWarehouse?.bins?.filter((bin) => !receivePutaway.aisle || (bin.aisle ?? "") === receivePutaway.aisle) ?? [];
          const canPost = ["approved", "sent", "partially_received"].includes(String(value.status).toLowerCase());

          return (
            <div className="space-y-4">
              <Card>
                <CardContent className="grid grid-cols-2 gap-3 p-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Supplier</p>
                    <p className="font-medium">{value.supplierName ?? `Supplier #${value.supplierId}`}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <Badge variant="outline" className="mt-1 capitalize">
                      {value.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Progress</p>
                    <p className="font-medium">
                      {value.progress.qtyReceived}/{value.progress.qtyOrdered} units
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Open lines</p>
                    <p className="font-medium">{receivableLines.length}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Receive metadata</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label htmlFor="mobile-receive-receiver">Receiver name</Label>
                    <Input
                      id="mobile-receive-receiver"
                      placeholder="Who is receiving this shipment?"
                      value={receiverName}
                      onChange={(event) => setReceiverName(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="mobile-receive-grn">GRN number</Label>
                    <Input
                      id="mobile-receive-grn"
                      placeholder="Optional goods receipt note"
                      value={grnNumber}
                      onChange={(event) => setGrnNumber(event.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label>Warehouse</Label>
                      <Select
                        value={receivePutaway.warehouseId != null ? String(receivePutaway.warehouseId) : undefined}
                        onValueChange={(next) =>
                          setReceivePutaway({
                            warehouseId: Number(next),
                            aisle: "",
                            binCode: "",
                          })
                        }
                      >
                        <SelectTrigger data-testid="mobile-receive-warehouse-select">
                          <SelectValue placeholder="Select warehouse" />
                        </SelectTrigger>
                        <SelectContent>
                          {receiveWarehouses.map((warehouse) => (
                            <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                              {warehouse.name}
                              {warehouse.isDefault ? " (default)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Aisle</Label>
                      <Select
                        value={receivePutaway.aisle || undefined}
                        onValueChange={(next) => setReceivePutaway((current) => ({ ...current, aisle: next, binCode: "" }))}
                        disabled={aisles.length === 0}
                      >
                        <SelectTrigger data-testid="mobile-receive-aisle-select">
                          <SelectValue placeholder={aisles.length ? "Select aisle" : "No aisles"} />
                        </SelectTrigger>
                        <SelectContent>
                          {aisles.map((aisle) => (
                            <SelectItem key={aisle} value={aisle}>
                              {aisle}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Bin</Label>
                      <Select
                        value={receivePutaway.binCode || undefined}
                        onValueChange={(next) => setReceivePutaway((current) => ({ ...current, binCode: next }))}
                        disabled={binOptions.length === 0}
                      >
                        <SelectTrigger data-testid="mobile-receive-bin-select">
                          <SelectValue placeholder={binOptions.length ? "Select bin" : "No bins"} />
                        </SelectTrigger>
                        <SelectContent>
                          {binOptions.map((bin) => (
                            <SelectItem key={bin.code} value={bin.code}>
                              {bin.code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Receive lines</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {receivableLines.length === 0 ? (
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-900">
                      <div className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        This PO has no remaining quantity to receive.
                      </div>
                    </div>
                  ) : (
                    receivableLines.map((line) => (
                      <Card key={line.id} className="border-dashed">
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold">{line.sku}</p>
                              <p className="text-sm text-muted-foreground">{line.itemName}</p>
                            </div>
                            <Badge variant="outline">{line.expectedRemaining} left</Badge>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>Ordered {line.qtyOrdered}</div>
                            <div>Received {line.qtyReceived}</div>
                            <div>Remaining {line.expectedRemaining}</div>
                          </div>
                          <div>
                            <Label htmlFor={`qty-${line.sku}`}>Receive now</Label>
                            <Input
                              id={`qty-${line.sku}`}
                              data-testid={`mobile-receive-qty-${line.sku}`}
                              inputMode="numeric"
                              type="number"
                              min={0}
                              step={1}
                              value={receiveState[line.sku] ?? 0}
                              onChange={(event) =>
                                setReceiveState((current) => ({
                                  ...current,
                                  [line.sku]: Number.isFinite(Number(event.target.value)) ? Math.trunc(Number(event.target.value)) : 0,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label htmlFor={`batch-${line.sku}`}>Batch</Label>
                            <Input
                              id={`batch-${line.sku}`}
                              data-testid={`mobile-receive-batch-${line.sku}`}
                              placeholder="Optional batch number"
                              value={batchState[line.sku] ?? ""}
                              onChange={(event) =>
                                setBatchState((current) => ({
                                  ...current,
                                  [line.sku]: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label htmlFor={`serial-${line.sku}`}>Serial numbers</Label>
                            <Input
                              id={`serial-${line.sku}`}
                              data-testid={`mobile-receive-serial-${line.sku}`}
                              placeholder={line.serialTrackingRequired ? "Required, comma separated" : "Optional, comma separated"}
                              value={serialState[line.sku] ?? ""}
                              onChange={(event) =>
                                setSerialState((current) => ({
                                  ...current,
                                  [line.sku]: event.target.value,
                                }))
                              }
                            />
                          </div>
                          {receiveLineIssues
                            .filter((issue) => issue.sku === line.sku)
                            .map((issue, index) => (
                              <p key={`${issue.field}-${index}`} className="text-xs text-destructive">
                                {issue.message}
                              </p>
                            ))}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </CardContent>
              </Card>

              {receiveError ? (
                <div
                  className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  data-testid="mobile-receive-error"
                >
                  {receiveError}
                </div>
              ) : null}

              {!canPost ? (
                <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
                  This PO is in <span className="font-medium">{value.status}</span>. Only approved, sent, or partially received
                  POs can accept a mobile receipt.
                </div>
              ) : null}

              <Can
                roles={["warehouse_staff", "manager", "planner", "admin"]}
                reason="Requires Warehouse Staff, Manager, Planner, or Admin"
              >
                <Button
                  className="min-h-12 w-full"
                  data-testid="mobile-receive-post-button"
                  onClick={submitReceive}
                  disabled={!canPost || receivableLines.length === 0 || receiveMutation.isPending}
                >
                  <Truck className="mr-2 h-4 w-4" />
                  {receiveMutation.isPending ? "Posting receipt..." : "Post mobile receipt"}
                </Button>
              </Can>
            </div>
          );
        }}
      </DataState>
    </div>
  );
}
