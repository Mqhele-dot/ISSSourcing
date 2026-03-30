import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { AlertTriangle, ArrowLeft, Download, FileDown, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useToast } from "@/hooks/use-toast";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { Can } from "@/components/auth/can";
import { EntityActivityPanel } from "@/components/activity/entity-activity-panel";
import {
  createShipment,
  deleteShipment,
  fetchShipment,
  fetchShipmentsEnvelope,
  patchShipmentMeta,
  updateShipmentStatus,
  type ShipmentDetail,
  type ShipmentListItem,
} from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";
import { queryClient, requestJson } from "@/lib/queryClient";
import { downloadFile } from "@/lib/utils";

async function downloadShipmentDeliveryNote(shipmentId: number): Promise<void> {
  const res = await fetch(`/api/logistics/shipments/${shipmentId}/delivery-note.pdf`, {
    credentials: "include",
  });
  if (!res.ok) {
    let detail = `Download failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) detail = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  downloadFile(blob, `delivery-note-${shipmentId}.pdf`);
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Carrier = {
  id: number;
  code: string;
  name: string;
  contact?: string | null;
  active?: boolean | null;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function ShipmentListView() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { queryState, setQueryState } = useQueryState({
    status: "",
    po: "",
    carrier: "",
    risk: "",
  });

  const fetcher = useCallback(
    () =>
      fetchShipmentsEnvelope({
        status: String(queryState.status || ""),
        po: String(queryState.po || ""),
        carrier: String(queryState.carrier || ""),
        risk: String(queryState.risk || ""),
      }),
    [queryState.status, queryState.po, queryState.carrier, queryState.risk],
  );

  const { loading, error, data: envelope, refetch } = useAsyncResource(fetcher);
  const [newPoNumber, setNewPoNumber] = useState("");
  const [newCarrier, setNewCarrier] = useState("");
  const [newEta, setNewEta] = useState("");
  const [newTracking, setNewTracking] = useState("");
  const [carrierCode, setCarrierCode] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [carrierContact, setCarrierContact] = useState("");
  const [carrierEditId, setCarrierEditId] = useState<number | null>(null);
  const [shipmentExporting, setShipmentExporting] = useState(false);
  const {
    data: carriers = [],
    error: carriersError,
  } = useQuery({
    queryKey: ["/api/carriers"],
    queryFn: () => requestJson<Carrier[]>("GET", "/api/carriers"),
  });
  const upsertCarrier = useMutation({
    mutationFn: () =>
      carrierEditId
        ? requestJson("PATCH", `/api/carriers/${carrierEditId}`, {
            code: carrierCode,
            name: carrierName,
            contact: carrierContact || null,
          })
        : requestJson("POST", "/api/carriers", {
            code: carrierCode,
            name: carrierName,
            contact: carrierContact || null,
          }),
    onSuccess: async () => {
      setCarrierCode("");
      setCarrierName("");
      setCarrierContact("");
      setCarrierEditId(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/carriers"] });
    },
    onError: (error) => {
      toast({
        title: "Carrier save failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
  const removeCarrier = useMutation({
    mutationFn: (id: number) => requestJson("DELETE", `/api/carriers/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/carriers"] });
    },
    onError: (error) => {
      toast({
        title: "Carrier delete failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
  const data = envelope?.data ?? null;
  const fallback = envelope?.meta?.fallback as FallbackKind | undefined;
  const {
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    lastRefreshedAt,
    lastRefreshedLabel,
    refreshNow,
    markRefreshed,
  } = useAutoRefresh(refetch);

  useEffect(() => {
    if (data && !lastRefreshedAt) {
      markRefreshed();
    }
  }, [data, lastRefreshedAt, markRefreshed]);

  const exportShipments = async (format: "pdf" | "csv" | "excel" | "docx") => {
    if (shipmentExporting) return;
    setShipmentExporting(true);
    try {
      const qs = new URLSearchParams();
      if (format === "pdf") qs.set("template", "standard");
      const st = String(queryState.status || "").trim();
      if (st) qs.set("status", st);
      const po = String(queryState.po || "").trim();
      if (po) qs.set("po", po);
      const carrier = String(queryState.carrier || "").trim();
      if (carrier) qs.set("carrier", carrier);
      const risk = String(queryState.risk || "").trim();
      if (risk) qs.set("risk", risk);
      const q = qs.toString();
      const url = `/api/export/shipments/${format}${q ? `?${q}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        let detail = `Export failed (${response.status})`;
        try {
          const errBody = (await response.json()) as { message?: string };
          if (errBody?.message) detail = errBody.message;
        } catch {
          /* not JSON */
        }
        throw new Error(detail);
      }
      const blob = await response.blob();
      const ext = format === "excel" ? "xlsx" : format;
      downloadFile(blob, `shipments-report.${ext}`);
      toast({
        title: "Export ready",
        description: `Shipments exported as ${format === "excel" ? "XLSX" : format.toUpperCase()}.`,
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setShipmentExporting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
      <PageHeader
        title="Logistics"
        subtitle="Shipment tracking and status management"
        breadcrumb={<span>Operations / Logistics</span>}
      />

      <div data-tour="shipments-list" className="space-y-4">
      <div
        data-tour="logistics-toolbar"
        className="sticky top-16 z-20 space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="ship-filter-status" className="text-xs text-muted-foreground">
              Status contains
            </Label>
            <Input
              id="ship-filter-status"
              value={String(queryState.status || "")}
              onChange={(event) => setQueryState({ status: event.target.value })}
              placeholder="e.g. in_transit"
              className="w-full min-w-0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ship-filter-po" className="text-xs text-muted-foreground">
              PO number
            </Label>
            <Input
              id="ship-filter-po"
              value={String(queryState.po || "")}
              onChange={(event) => setQueryState({ po: event.target.value })}
              placeholder="Filter by PO"
              className="w-full min-w-0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ship-filter-carrier" className="text-xs text-muted-foreground">
              Carrier
            </Label>
            <Input
              id="ship-filter-carrier"
              value={String(queryState.carrier || "")}
              onChange={(event) => setQueryState({ carrier: event.target.value })}
              placeholder="Carrier name"
              className="w-full min-w-0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ship-filter-risk" className="text-xs text-muted-foreground">
              Risk
            </Label>
            <Select
              value={String(queryState.risk || "") || "all"}
              onValueChange={(value) => setQueryState({ risk: value === "all" ? "" : value })}
            >
              <SelectTrigger id="ship-filter-risk" className="w-full min-w-0">
                <SelectValue placeholder="Risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All risk</SelectItem>
                <SelectItem value="late">Late risk</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={shipmentExporting} className="shrink-0">
                <Download className="mr-2 h-4 w-4" />
                {shipmentExporting ? "Exporting…" : "Export"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => void exportShipments("pdf")}>PDF</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportShipments("csv")}>CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportShipments("excel")}>Excel</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportShipments("docx")}>Word</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant={autoRefreshEnabled ? "default" : "outline"}
            size="sm"
            className="shrink-0"
            onClick={() => setAutoRefreshEnabled((current) => !current)}
          >
            Auto-refresh: {autoRefreshEnabled ? "On" : "Off"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={refreshNow}>
            Refresh
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">Last refreshed: {lastRefreshedLabel}</span>
        </div>

        <Can roles={["manager", "admin"]}>
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground">New shipment</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid w-full min-w-[8rem] max-w-xs flex-1 gap-1.5">
                <Label htmlFor="ship-new-po" className="text-xs">
                  PO number
                </Label>
                <Input
                  id="ship-new-po"
                  value={newPoNumber}
                  onChange={(event) => setNewPoNumber(event.target.value)}
                  placeholder="Required"
                  className="min-w-0"
                />
              </div>
              {carriersError ? (
                <div className="grid w-full min-w-[8rem] max-w-xs flex-1 gap-1.5">
                  <Label htmlFor="ship-new-carrier-txt" className="text-xs">
                    Carrier
                  </Label>
                  <Input
                    id="ship-new-carrier-txt"
                    value={newCarrier}
                    onChange={(event) => setNewCarrier(event.target.value)}
                    placeholder="Carrier name"
                    className="min-w-0"
                  />
                </div>
              ) : (
                <div className="grid w-full min-w-[8rem] max-w-xs flex-1 gap-1.5">
                  <Label htmlFor="ship-new-carrier-sel" className="text-xs">
                    Carrier
                  </Label>
                  <Select value={newCarrier || "none"} onValueChange={(value) => setNewCarrier(value === "none" ? "" : value)}>
                    <SelectTrigger id="ship-new-carrier-sel" className="min-w-0">
                      <SelectValue placeholder="Select carrier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select carrier</SelectItem>
                      {carriers.map((carrier) => (
                        <SelectItem key={carrier.id} value={carrier.name}>
                          {carrier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid w-full min-w-[8rem] max-w-[10rem] gap-1.5">
                <Label htmlFor="ship-new-eta" className="text-xs">
                  ETA
                </Label>
                <Input
                  id="ship-new-eta"
                  value={newEta}
                  onChange={(event) => setNewEta(event.target.value)}
                  type="date"
                  className="min-w-0"
                />
              </div>
              <div className="grid min-w-[10rem] flex-1 gap-1.5 sm:max-w-md">
                <Label htmlFor="ship-new-trk" className="text-xs">
                  Tracking #
                </Label>
                <Input
                  id="ship-new-trk"
                  value={newTracking}
                  onChange={(event) => setNewTracking(event.target.value)}
                  placeholder="Optional"
                  className="min-w-0"
                />
              </div>
              <Button
                type="button"
                className="shrink-0"
                onClick={async () => {
                  try {
                    await createShipment({
                      poNumber: newPoNumber,
                      carrier: newCarrier || undefined,
                      eta: newEta || undefined,
                      trackingNumber: newTracking.trim() || undefined,
                    });
                    setNewPoNumber("");
                    setNewCarrier("");
                    setNewEta("");
                    setNewTracking("");
                    await refreshNow();
                  } catch (createError) {
                    toast({
                      title: "Create shipment failed",
                      description: createError instanceof Error ? createError.message : "Unknown error",
                      variant: "destructive",
                    });
                  }
                }}
                disabled={!newPoNumber.trim()}
              >
                Add shipment
              </Button>
            </div>
          </div>
        </Can>
      </div>

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={(shipments) => (Array.isArray(shipments) ? shipments : []).length === 0}
        emptyTitle="No shipments found"
        emptyDescription="Shipments are created from purchase orders. Create a PO or run the demo."
        emptyAction={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="default" size="sm">
              <Link href="/purchase">View purchase orders</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Overview / Demo</Link>
            </Button>
          </div>
        }
        fallback={fallback}
        onRetry={refreshNow}
      >
        {(shipments) => {
          const list = Array.isArray(shipments) ? shipments : [];
          return (
          <div data-tour="shipments-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>PO</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((shipment) => (
                <TableRow
                  key={shipment.id}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/logistics/${shipment.id}`)}
                >
                  <TableCell className="font-medium">{shipment.id}</TableCell>
                  <TableCell>{shipment.poNumber}</TableCell>
                  <TableCell>{shipment.carrier || "-"}</TableCell>
                  <TableCell>
                    <StatusBadge status={shipment.status} />
                  </TableCell>
                  <TableCell>{formatDate(shipment.eta)}</TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs">
                    {shipment.trackingNumber?.trim() || "—"}
                  </TableCell>
                  <TableCell>{shipment.atRisk ? "Late risk" : "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={(event) => {
                          event.stopPropagation();
                          void downloadShipmentDeliveryNote(shipment.id).catch((err) => {
                            toast({
                              title: "Delivery note failed",
                              description: err instanceof Error ? err.message : String(err),
                              variant: "destructive",
                            });
                          });
                        }}
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        Delivery PDF
                      </Button>
                      <Can roles={["manager", "admin"]}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async (event) => {
                            event.stopPropagation();
                            try {
                              await deleteShipment(shipment.id);
                              await refreshNow();
                            } catch (deleteError) {
                              toast({
                                title: "Delete shipment failed",
                                description: deleteError instanceof Error ? deleteError.message : "Unknown error",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          );
        }}
      </DataState>
      </div>

      {carriersError ? (
        <Alert variant="destructive">
          <AlertTitle>Carrier service unavailable</AlertTitle>
          <AlertDescription>
            Could not load carriers from <code>/api/carriers</code>. You can still create shipments by typing the carrier name manually.
          </AlertDescription>
        </Alert>
      ) : null}

      <Can roles={["manager", "admin"]}>
        <Card>
          <CardHeader>
            <CardTitle>Carriers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-4">
              <Input placeholder="Code" value={carrierCode} onChange={(event) => setCarrierCode(event.target.value)} />
              <Input placeholder="Name" value={carrierName} onChange={(event) => setCarrierName(event.target.value)} />
              <Input
                placeholder="Contact"
                value={carrierContact}
                onChange={(event) => setCarrierContact(event.target.value)}
              />
              <Button
                onClick={() => upsertCarrier.mutate()}
                disabled={upsertCarrier.isPending || !carrierCode.trim() || !carrierName.trim()}
              >
                {carrierEditId ? "Update" : "Add"} carrier
              </Button>
            </div>
            <div className="space-y-2">
              {carriers.map((carrier) => (
                <div key={carrier.id} className="rounded border p-2 text-sm flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{carrier.code} - {carrier.name}</div>
                    <div className="text-muted-foreground">{carrier.contact || "-"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCarrierEditId(carrier.id);
                        setCarrierCode(carrier.code);
                        setCarrierName(carrier.name);
                        setCarrierContact(carrier.contact ?? "");
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeCarrier.mutate(carrier.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              {carriers.length === 0 ? (
                <div className="text-sm text-muted-foreground">No carriers configured yet.</div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </Can>
    </div>
  );
}

function ShipmentDetailView({ shipmentId }: { shipmentId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [toStatus, setToStatus] = useState("in_transit");
  const [note, setNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [metaCarrier, setMetaCarrier] = useState("");
  const [metaEta, setMetaEta] = useState("");
  const [metaTracking, setMetaTracking] = useState("");
  const [metaSaving, setMetaSaving] = useState(false);
  const [deliveryPdfLoading, setDeliveryPdfLoading] = useState(false);

  const fetcher = useCallback(
    (): Promise<ShipmentDetail> => fetchShipment(shipmentId),
    [shipmentId],
  );
  const { loading, error, data, refetch } = useAsyncResource(fetcher);

  // Sync form from server when shipment changes or server row updates (e.g. after PATCH refetch).
  useEffect(() => {
    if (!data) return;
    setMetaCarrier(data.carrier ?? "");
    setMetaEta(
      data.eta
        ? typeof data.eta === "string"
          ? data.eta.slice(0, 10)
          : new Date(data.eta).toISOString().slice(0, 10)
        : "",
    );
    setMetaTracking(data.trackingNumber?.trim() ?? "");
  }, [
    data?.id,
    data?.updatedAt,
    data?.carrier,
    data?.eta,
    data?.trackingNumber,
  ]);

  const submitMeta = async () => {
    setMetaSaving(true);
    try {
      await patchShipmentMeta({
        id: shipmentId,
        carrier: metaCarrier.trim() || null,
        eta: metaEta.trim() || null,
        trackingNumber: metaTracking.trim() || null,
      });
      await refetch();
      toast({ title: "Shipment details updated" });
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setMetaSaving(false);
    }
  };

  const submitStatus = async () => {
    setUpdating(true);
    try {
      await updateShipmentStatus({
        id: shipmentId,
        toStatus,
        note,
      });
      setNote("");
      await refetch();
    } catch (statusError) {
      console.error("Shipment status update failed:", statusError);
      const err = statusError as Error & { status?: number };
      const msg =
        err.status === 503
          ? "Service unavailable (operations degraded)"
          : err.status === 408 || (err.message && String(err.message).toLowerCase().includes("timeout"))
            ? "Timed out — DB may be down"
            : err.message || "Shipment status update failed";
      toast({
        title: "Status update failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
      <Button variant="ghost" onClick={() => setLocation("/logistics")} className="w-fit">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to logistics
      </Button>

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={() => false}
        emptyTitle="Shipment detail unavailable"
        onRetry={refetch}
      >
        {(shipment) => (
          <>
            <PageHeader
              title={`Shipment #${shipment.id}`}
              subtitle={`PO ${shipment.poNumber}`}
              breadcrumb={<span>Operations / Logistics / {shipment.id}</span>}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={deliveryPdfLoading}
                  onClick={() => {
                    setDeliveryPdfLoading(true);
                    void downloadShipmentDeliveryNote(shipment.id)
                      .catch((err) => {
                        toast({
                          title: "Delivery note failed",
                          description: err instanceof Error ? err.message : String(err),
                          variant: "destructive",
                        });
                      })
                      .finally(() => setDeliveryPdfLoading(false));
                  }}
                >
                  {deliveryPdfLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <FileDown className="h-4 w-4" aria-hidden />
                  )}
                  Delivery PDF
                </Button>
              }
            />

            {shipment.atRisk ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Late shipment risk</AlertTitle>
                <AlertDescription>
                  ETA is in the past and shipment is not yet delivered.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBadge status={shipment.status} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">ETA</CardTitle>
                </CardHeader>
                <CardContent>{formatDate(shipment.eta)}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Drift</CardTitle>
                </CardHeader>
                <CardContent>{shipment.driftMinutes} min</CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Carrier, ETA & tracking</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor={`sh-carrier-${shipment.id}`}>Carrier</Label>
                    <Input
                      id={`sh-carrier-${shipment.id}`}
                      value={metaCarrier}
                      onChange={(e) => setMetaCarrier(e.target.value)}
                      placeholder="Carrier name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sh-eta-${shipment.id}`}>ETA</Label>
                    <Input
                      id={`sh-eta-${shipment.id}`}
                      type="date"
                      value={metaEta}
                      onChange={(e) => setMetaEta(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sh-trk-${shipment.id}`}>Tracking #</Label>
                    <Input
                      id={`sh-trk-${shipment.id}`}
                      value={metaTracking}
                      onChange={(e) => setMetaTracking(e.target.value)}
                      placeholder="PRO…"
                    />
                  </div>
                </div>
                <Can roles={["manager", "planner", "admin"]} reason="Requires Manager, Planner, or Admin">
                  <Button onClick={() => void submitMeta()} disabled={metaSaving}>
                    Save carrier / ETA / tracking
                  </Button>
                </Can>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Status transition</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[220px_1fr_auto]">
                  <Select value={toStatus} onValueChange={setToStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_transit">in_transit</SelectItem>
                      <SelectItem value="delayed">delayed</SelectItem>
                      <SelectItem value="delivered">delivered</SelectItem>
                      <SelectItem value="cancelled">cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Optional note"
                  />
                  <Can roles={["planner", "admin"]} reason="Requires Planner/Admin">
                    <Button onClick={submitStatus} disabled={updating}>
                      Update
                    </Button>
                  </Can>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shipment.timeline.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>{formatDate(event.eventAt)}</TableCell>
                        <TableCell>
                          <StatusBadge status={event.status} />
                        </TableCell>
                        <TableCell>{event.note || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <EntityActivityPanel entityType="shipment" entityId={shipment.id} />
          </>
        )}
      </DataState>
    </div>
  );
}

export default function LogisticsPage() {
  const [detailMatch, detailParams] = useRoute<{ id: string }>("/logistics/:id");

  if (detailMatch && detailParams?.id) {
    return <ShipmentDetailView shipmentId={detailParams.id} />;
  }

  return <ShipmentListView />;
}
