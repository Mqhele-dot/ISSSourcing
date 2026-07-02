import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Download,
  FileDown,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
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
  fetchActivityEnvelope,
  patchShipmentMeta,
  updateShipmentStatus,
  type ShipmentDetail,
  type ShipmentListItem,
} from "@/api/client";
import type { ActivityRecord, ShipmentTimelineEvent } from "@/api/types";
import type { FallbackKind } from "@/components/ui/data-state";
import { queryClient, requestJson } from "@/lib/queryClient";
import { invalidateLogisticsAndPurchaseOrders } from "@/lib/domain-invalidation";
import { downloadFile } from "@/lib/utils";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { normalizeShipmentFilters, type ShipmentListFiltersNormalized } from "@shared/logistics-shipment-filters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

function LogisticsV1ExclusionNotice() {
  return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-950">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle>Non-production v1 route</AlertTitle>
      <AlertDescription>
        Logistics remains excluded from production approval until route-specific browser proof, permission proof, and
        audit evidence are complete. Use this workspace for connected review only, not as an approved production
        dispatch workflow.
      </AlertDescription>
    </Alert>
  );
}

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

function shipmentRiskBucketLabel(bucket: string | undefined) {
  switch (bucket) {
    case "late":
      return "Late (past ETA)";
    case "no_eta":
      return "No ETA";
    case "due_soon":
      return "Due soon";
    case "exception":
      return "Exception / delayed status";
    case "on_time":
      return "On time";
    default:
      return "—";
  }
}

type LogisticsListFiltersState = ShipmentListFiltersNormalized;

function logisticsListFiltersNormalized(q: LogisticsListFiltersState): LogisticsListFiltersState {
  return normalizeShipmentFilters(q);
}

function logisticsListQueryKeyTuple(n: LogisticsListFiltersState): (readonly [string, string])[] {
  const keys = [
    "carrier",
    "direction",
    "etaFrom",
    "etaTo",
    "po",
    "risk",
    "sourceType",
    "status",
    "supplier",
    "tracking",
  ] as const;
  return keys.map((k) => [k, n[k]] as const);
}

function logisticsListHasActiveFilters(n: LogisticsListFiltersState): boolean {
  return Object.values(n).some((v) => v.length > 0);
}

function LogisticsCarriersPanel() {
  const { toast } = useToast();
  const [carrierCode, setCarrierCode] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [carrierContact, setCarrierContact] = useState("");
  const [carrierEditId, setCarrierEditId] = useState<number | null>(null);
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
      await invalidateLogisticsAndPurchaseOrders(queryClient);
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
      await invalidateLogisticsAndPurchaseOrders(queryClient);
    },
    onError: (error) => {
      toast({
        title: "Carrier delete failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      {carriersError ? (
        <Alert variant="destructive">
          <AlertTitle>Carrier service unavailable</AlertTitle>
          <AlertDescription>
            Could not load carriers from <code>/api/carriers</code>.
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
                    <div className="font-medium">
                      {carrier.code} - {carrier.name}
                      {carrier.active === false ? (
                        <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>
                      ) : null}
                    </div>
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
    </>
  );
}

function LogisticsActivityTab() {
  const {
    data: envelope,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/activity", "logistics-page", 100],
    queryFn: () => fetchActivityEnvelope({ limit: 100 }),
    staleTime: 15_000,
  });
  const rows = envelope?.data ?? [];
  const err = isError ? (error instanceof Error ? error : new Error(String(error))) : null;

  return (
    <DataState
      loading={isLoading}
      error={err}
      data={rows}
      isEmpty={(d) => (Array.isArray(d) ? d : []).length === 0}
      emptyTitle="No recent activity"
      emptyDescription="System and user actions will appear here as they are recorded."
      onRetry={() => void refetch()}
    >
      {(activity: ActivityRecord[]) => (
        <div data-testid="logistics-activity-tab">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {row.createdAt ? formatDate(row.createdAt) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{row.actor || "—"}</TableCell>
                  <TableCell className="text-sm">{row.action}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.entityType} #{row.entityId}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </DataState>
  );
}

function ShipmentListView({ listScope = "all" }: { listScope?: "all" | "inbound" }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { queryState, setQueryState } = useQueryState({
    status: "",
    po: "",
    supplier: "",
    carrier: "",
    risk: "",
    etaFrom: "",
    etaTo: "",
    tracking: "",
    direction: "",
    sourceType: "",
  });

  const debouncedQuery = useDebouncedValue(queryState, 350);
  const debouncedNorm = logisticsListFiltersNormalized(debouncedQuery);
  const effectiveNorm = useMemo((): LogisticsListFiltersState => {
    if (listScope === "inbound") {
      return { ...debouncedNorm, direction: "inbound" };
    }
    return debouncedNorm;
  }, [debouncedNorm, listScope]);

  const filterChipEntries = useMemo(() => {
    const n = effectiveNorm;
    const entries: { key: keyof LogisticsListFiltersState; label: string; value: string }[] = [];
    if (n.status) entries.push({ key: "status", label: "Status", value: n.status });
    if (n.po) entries.push({ key: "po", label: "PO", value: n.po });
    if (n.supplier) entries.push({ key: "supplier", label: "Supplier", value: n.supplier });
    if (n.carrier) entries.push({ key: "carrier", label: "Carrier", value: n.carrier });
    if (n.risk) {
      const riskLabel = shipmentRiskBucketLabel(n.risk);
      entries.push({ key: "risk", label: "Risk", value: riskLabel });
    }
    if (n.etaFrom) entries.push({ key: "etaFrom", label: "ETA from", value: n.etaFrom });
    if (n.etaTo) entries.push({ key: "etaTo", label: "ETA to", value: n.etaTo });
    if (n.tracking) entries.push({ key: "tracking", label: "Tracking", value: n.tracking });
    if (n.direction) entries.push({ key: "direction", label: "Direction", value: n.direction });
    if (n.sourceType) entries.push({ key: "sourceType", label: "Source", value: n.sourceType });
    return entries;
  }, [effectiveNorm]);

  const clearLogisticsFilters = useCallback(() => {
    setQueryState({
      status: "",
      po: "",
      supplier: "",
      carrier: "",
      risk: "",
      etaFrom: "",
      etaTo: "",
      tracking: "",
      direction: "",
      sourceType: "",
    });
  }, [setQueryState]);

  const {
    data: envelope,
    isLoading: loading,
    isError,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["/api/logistics/shipments", ...logisticsListQueryKeyTuple(effectiveNorm), listScope],
    queryFn: () => fetchShipmentsEnvelope(effectiveNorm),
    staleTime: 10_000,
  });

  const error = isError ? (queryError instanceof Error ? queryError : new Error(String(queryError))) : null;
  const [newPoNumber, setNewPoNumber] = useState("");
  const [newCarrierId, setNewCarrierId] = useState("");
  const [newCarrierFreeText, setNewCarrierFreeText] = useState("");
  const [newEta, setNewEta] = useState("");
  const [newTracking, setNewTracking] = useState("");
  const [newTransportMode, setNewTransportMode] = useState("");
  const [newFreightCost, setNewFreightCost] = useState("");
  const [newDeliveryNoteRef, setNewDeliveryNoteRef] = useState("");
  const [newVehicle, setNewVehicle] = useState("");
  const [newDriver, setNewDriver] = useState("");
  const [shipmentExporting, setShipmentExporting] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [createShipmentDialogOpen, setCreateShipmentDialogOpen] = useState(false);
  const [createShipmentExtrasOpen, setCreateShipmentExtrasOpen] = useState(false);
  const {
    data: carriers = [],
    error: carriersError,
  } = useQuery({
    queryKey: ["/api/carriers"],
    queryFn: () => requestJson<Carrier[]>("GET", "/api/carriers"),
  });
  const data = envelope?.data ?? null;
  const fallback = envelope?.meta?.fallback as FallbackKind | undefined;

  const refetchShipmentsList = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const {
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    lastRefreshedAt,
    lastRefreshedLabel,
    refreshNow,
    markRefreshed,
  } = useAutoRefresh(refetchShipmentsList);

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
      const ex = logisticsListFiltersNormalized({
        status: String(queryState.status ?? ""),
        po: String(queryState.po ?? ""),
        supplier: String(queryState.supplier ?? ""),
        carrier: String(queryState.carrier ?? ""),
        risk: String(queryState.risk ?? ""),
        etaFrom: String(queryState.etaFrom ?? ""),
        etaTo: String(queryState.etaTo ?? ""),
        tracking: String(queryState.tracking ?? ""),
        direction: String(queryState.direction ?? ""),
        sourceType: String(queryState.sourceType ?? ""),
      });
      const exEffective =
        listScope === "inbound" ? { ...ex, direction: "inbound" } : ex;
      if (exEffective.status) qs.set("status", exEffective.status);
      if (exEffective.po) qs.set("po", exEffective.po);
      if (exEffective.supplier) qs.set("supplier", exEffective.supplier);
      if (exEffective.carrier) qs.set("carrier", exEffective.carrier);
      if (exEffective.risk) qs.set("risk", exEffective.risk);
      if (exEffective.etaFrom) qs.set("etaFrom", exEffective.etaFrom);
      if (exEffective.etaTo) qs.set("etaTo", exEffective.etaTo);
      if (exEffective.tracking) qs.set("tracking", exEffective.tracking);
      if (exEffective.direction) qs.set("direction", exEffective.direction);
      if (exEffective.sourceType) qs.set("sourceType", exEffective.sourceType);
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

  const submitNewShipment = async () => {
    try {
      const trimmedFr = newFreightCost.trim();
      const freightParsed = Number(trimmedFr);
      const freightCost =
        trimmedFr === "" ? undefined : Number.isFinite(freightParsed) ? freightParsed : undefined;
      const active = carriers.filter((c) => c.active !== false);
      const needsId = !carriersError && active.length > 0;
      const cid = needsId && newCarrierId && newCarrierId !== "none" ? Number(newCarrierId) : NaN;
      await createShipment({
        poNumber: newPoNumber.trim(),
        ...(Number.isFinite(cid) && cid > 0
          ? { carrierId: cid }
          : { carrier: newCarrierFreeText.trim() || undefined }),
        eta: newEta || undefined,
        trackingNumber: newTracking.trim() || undefined,
        transportMode: newTransportMode.trim() || undefined,
        freightCost,
        deliveryNoteRef: newDeliveryNoteRef.trim() || undefined,
        vehicle: newVehicle.trim() || undefined,
        driver: newDriver.trim() || undefined,
      });
      setNewPoNumber("");
      setNewCarrierId("");
      setNewCarrierFreeText("");
      setNewEta("");
      setNewTracking("");
      setNewTransportMode("");
      setNewFreightCost("");
      setNewDeliveryNoteRef("");
      setNewVehicle("");
      setNewDriver("");
      setCreateShipmentExtrasOpen(false);
      setCreateShipmentDialogOpen(false);
      await refreshNow();
      await invalidateLogisticsAndPurchaseOrders(queryClient);
      toast({ title: "Shipment created" });
    } catch (createError) {
      toast({
        title: "Create shipment failed",
        description: createError instanceof Error ? createError.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const newShipmentDisabled = (() => {
    const active = carriers.filter((c) => c.active !== false);
    const needsFreeText = carriersError || active.length === 0;
    const needsId = !carriersError && active.length > 0;
    return (
      !newPoNumber.trim() ||
      (needsId && (!newCarrierId || newCarrierId === "none")) ||
      (needsFreeText && !newCarrierFreeText.trim())
    );
  })();

  const advancedFiltersActive = Boolean(
    String(queryState.supplier ?? "").trim() ||
      String(queryState.etaFrom ?? "").trim() ||
      String(queryState.etaTo ?? "").trim() ||
      String(queryState.sourceType ?? "").trim() ||
      (listScope !== "inbound" && String(queryState.direction ?? "").trim()),
  );

  const shipmentsFilteredEmpty = logisticsListHasActiveFilters(effectiveNorm);

  return (
    <div className="space-y-4">
      {listScope === "inbound" ? (
        <p className="text-xs text-muted-foreground" data-testid="logistics-inbound-scope-hint">
          Showing <span className="font-medium text-foreground">inbound</span> only — use the Overview tab for all
          directions.
        </p>
      ) : null}

      <div data-tour="shipments-list" className="space-y-3">
        <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
          <div
            data-tour="logistics-toolbar"
            className="sticky top-16 z-20 space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm"
          >
            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-6">
              <div className="space-y-1">
                <Label htmlFor="ship-filter-po" className="text-xs text-muted-foreground">
                  PO number
                </Label>
                <Input
                  id="ship-filter-po"
                  data-testid="logistics-po-filter"
                  value={String(queryState.po || "")}
                  onChange={(event) => setQueryState({ po: event.target.value })}
                  placeholder="Filter by PO"
                  className="h-9 min-w-0"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ship-filter-status" className="text-xs text-muted-foreground">
                  Status
                </Label>
                <Input
                  id="ship-filter-status"
                  data-testid="logistics-status-filter"
                  value={String(queryState.status || "")}
                  onChange={(event) => setQueryState({ status: event.target.value })}
                  placeholder="e.g. in_transit"
                  className="h-9 min-w-0"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ship-filter-carrier" className="text-xs text-muted-foreground">
                  Carrier
                </Label>
                <Input
                  id="ship-filter-carrier"
                  data-testid="logistics-carrier-filter"
                  value={String(queryState.carrier || "")}
                  onChange={(event) => setQueryState({ carrier: event.target.value })}
                  placeholder="Name contains"
                  className="h-9 min-w-0"
                />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label htmlFor="ship-filter-tracking" className="text-xs text-muted-foreground">
                  Tracking #
                </Label>
                <Input
                  id="ship-filter-tracking"
                  data-testid="logistics-tracking-filter"
                  value={String(queryState.tracking || "")}
                  onChange={(event) => setQueryState({ tracking: event.target.value })}
                  placeholder="Contains…"
                  className="h-9 min-w-0 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ship-filter-risk" className="text-xs text-muted-foreground">
                  Risk
                </Label>
                <Select
                  value={String(queryState.risk || "") || "all"}
                  onValueChange={(value) => setQueryState({ risk: value === "all" ? "" : value })}
                >
                  <SelectTrigger id="ship-filter-risk" data-testid="logistics-risk-filter" className="h-9 min-w-0">
                    <SelectValue placeholder="Risk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="late">Late</SelectItem>
                    <SelectItem value="due_soon">Due soon</SelectItem>
                    <SelectItem value="no_eta">No ETA</SelectItem>
                    <SelectItem value="exception">Exception</SelectItem>
                    <SelectItem value="on_time">On time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

        {filterChipEntries.length > 0 ? (
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="logistics-active-filters"
            aria-label="Active filters"
          >
            <span className="text-xs text-muted-foreground">Active:</span>
            {filterChipEntries.map((entry) => (
              <Badge key={entry.key} variant="secondary" className="gap-1 pr-1 font-normal">
                <span className="max-w-[14rem] truncate">
                  {entry.label}: {entry.value}
                </span>
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label={`Remove ${entry.label} filter`}
                  onClick={() => setQueryState({ [entry.key]: "" } as Partial<LogisticsListFiltersState>)}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}

            <CollapsibleContent className="space-y-2 border-t border-border pt-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-1">
                  <Label htmlFor="ship-filter-supplier" className="text-xs text-muted-foreground">
                    Supplier contains
                  </Label>
                  <Input
                    id="ship-filter-supplier"
                    data-testid="logistics-supplier-filter"
                    value={String(queryState.supplier || "")}
                    onChange={(event) => setQueryState({ supplier: event.target.value })}
                    placeholder="Supplier name"
                    className="h-9 min-w-0"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ship-filter-direction" className="text-xs text-muted-foreground">
                    Direction
                  </Label>
                  <Select
                    value={
                      listScope === "inbound"
                        ? "inbound"
                        : String(queryState.direction || "") || "all"
                    }
                    disabled={listScope === "inbound"}
                    onValueChange={(value) => setQueryState({ direction: value === "all" ? "" : value })}
                  >
                    <SelectTrigger
                      id="ship-filter-direction"
                      data-testid="logistics-direction-filter"
                      className="h-9 min-w-0"
                    >
                      <SelectValue placeholder="Direction" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All directions</SelectItem>
                      <SelectItem value="inbound">Inbound</SelectItem>
                      <SelectItem value="outbound">Outbound</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                      <SelectItem value="return">Return</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ship-filter-source" className="text-xs text-muted-foreground">
                    Source type
                  </Label>
                  <Select
                    value={String(queryState.sourceType || "") || "all"}
                    onValueChange={(value) => setQueryState({ sourceType: value === "all" ? "" : value })}
                  >
                    <SelectTrigger id="ship-filter-source" data-testid="logistics-source-filter" className="h-9 min-w-0">
                      <SelectValue placeholder="Source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      <SelectItem value="purchase_order">Purchase order</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 xl:col-span-2">
                  <Label htmlFor="ship-filter-eta-from" className="text-xs text-muted-foreground">
                    ETA from
                  </Label>
                  <Input
                    id="ship-filter-eta-from"
                    data-testid="logistics-eta-from"
                    type="datetime-local"
                    value={String(queryState.etaFrom || "")}
                    onChange={(event) => setQueryState({ etaFrom: event.target.value })}
                    className="h-9 min-w-0"
                  />
                </div>
                <div className="space-y-1 xl:col-span-2">
                  <Label htmlFor="ship-filter-eta-to" className="text-xs text-muted-foreground">
                    ETA to
                  </Label>
                  <Input
                    id="ship-filter-eta-to"
                    data-testid="logistics-eta-to"
                    type="datetime-local"
                    value={String(queryState.etaTo || "")}
                    onChange={(event) => setQueryState({ etaTo: event.target.value })}
                    className="h-9 min-w-0"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link
                  href={APP_ROUTES.operations.exceptions}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  Operational exceptions →
                </Link>
              </div>
            </CollapsibleContent>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={shipmentExporting}
                className="shrink-0"
                data-testid="logistics-export-button"
              >
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
            data-testid="logistics-auto-refresh"
            onClick={() => setAutoRefreshEnabled((current) => !current)}
          >
            Auto-refresh: {autoRefreshEnabled ? "On" : "Off"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            data-testid="logistics-refresh-button"
            onClick={refreshNow}
          >
            Refresh
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            data-testid="logistics-clear-filters"
            disabled={!logisticsListHasActiveFilters(queryState)}
            onClick={clearLogisticsFilters}
          >
            Clear filters
          </Button>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant={advancedFiltersActive ? "secondary" : "outline"}
              size="sm"
              className="shrink-0 gap-1"
              data-testid="logistics-more-filters"
            >
              More filters
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform ${advancedFiltersOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>
          <Can roles={["manager", "admin"]}>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="shrink-0 gap-1"
              onClick={() => setCreateShipmentDialogOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden />
              New shipment
            </Button>
          </Can>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums text-right">
            <span className="mr-2 inline-block">
              Results:{" "}
              <span data-testid="logistics-results-count">
                {loading ? "—" : envelope?.meta?.resultCount ?? 0}
              </span>
            </span>
            · Last refreshed: {lastRefreshedLabel}
            {envelope?.meta?.queryMs != null ? ` · ${Math.round(Number(envelope.meta.queryMs))}ms` : ""}
            {envelope?.meta?.generatedAt ? ` · data: ${new Date(envelope.meta.generatedAt).toLocaleTimeString()}` : ""}
            {isFetching ? " · updating…" : ""}
          </span>
        </div>
          </div>
        </Collapsible>

        <Dialog open={createShipmentDialogOpen} onOpenChange={setCreateShipmentDialogOpen}>
          <DialogContent className="max-h-[min(90vh,40rem)] overflow-y-auto sm:max-w-lg" data-testid="logistics-create-shipment-dialog">
            <DialogHeader>
              <DialogTitle>New inbound shipment</DialogTitle>
              <DialogDescription>
                Requires an existing purchase order number. Carrier is saved as master data selection or label.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ship-new-po" className="text-xs">
                  PO number
                </Label>
                <Input
                  id="ship-new-po"
                  value={newPoNumber}
                  onChange={(event) => setNewPoNumber(event.target.value)}
                  placeholder="Required (must exist)"
                  className="min-w-0"
                />
              </div>
              {carriersError ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="ship-new-carrier-txt" className="text-xs">
                    Carrier label
                  </Label>
                  <Input
                    id="ship-new-carrier-txt"
                    value={newCarrierFreeText}
                    onChange={(event) => setNewCarrierFreeText(event.target.value)}
                    placeholder="Carrier name"
                    className="min-w-0"
                  />
                </div>
              ) : carriers.filter((c) => c.active !== false).length === 0 ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="ship-new-carrier-txt" className="text-xs">
                    Carrier label
                  </Label>
                  <Input
                    id="ship-new-carrier-txt"
                    value={newCarrierFreeText}
                    onChange={(event) => setNewCarrierFreeText(event.target.value)}
                    placeholder="No active carriers — type name"
                    className="min-w-0"
                  />
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="ship-new-carrier-sel" className="text-xs">
                    Carrier (master)
                  </Label>
                  <Select
                    value={newCarrierId || "none"}
                    onValueChange={(value) => setNewCarrierId(value === "none" ? "" : value)}
                  >
                    <SelectTrigger id="ship-new-carrier-sel" className="min-w-0">
                      <SelectValue placeholder="Select carrier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select carrier</SelectItem>
                      {carriers
                        .filter((c) => c.active !== false)
                        .map((carrier) => (
                          <SelectItem key={carrier.id} value={String(carrier.id)}>
                            {carrier.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
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
                <div className="grid gap-1.5">
                  <Label htmlFor="ship-new-trk" className="text-xs">
                    Tracking #
                  </Label>
                  <Input
                    id="ship-new-trk"
                    value={newTracking}
                    onChange={(event) => setNewTracking(event.target.value)}
                    placeholder="Optional"
                    className="min-w-0 font-mono text-xs"
                  />
                </div>
              </div>
              {!carriersError ? (
                <p className="text-xs text-muted-foreground">
                  {carriers.filter((c) => c.active !== false).length > 0
                    ? "Select an active carrier; the server snapshots the name on the shipment."
                    : "No active carriers in master — enter a label for this shipment."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Carrier API unavailable — enter a label for this shipment.
                </p>
              )}
              <Collapsible open={createShipmentExtrasOpen} onOpenChange={setCreateShipmentExtrasOpen}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="w-fit gap-1">
                    Extra fields (transport, freight, …)
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${createShipmentExtrasOpen ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 border-t pt-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="ship-new-tm" className="text-xs">
                        Transport mode
                      </Label>
                      <Input
                        id="ship-new-tm"
                        value={newTransportMode}
                        onChange={(event) => setNewTransportMode(event.target.value)}
                        placeholder="e.g. LTL"
                        className="min-w-0"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="ship-new-fr" className="text-xs">
                        Freight cost
                      </Label>
                      <Input
                        id="ship-new-fr"
                        value={newFreightCost}
                        onChange={(event) => setNewFreightCost(event.target.value)}
                        placeholder="0"
                        type="number"
                        className="min-w-0"
                      />
                    </div>
                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor="ship-new-dn" className="text-xs">
                        Delivery note ref
                      </Label>
                      <Input
                        id="ship-new-dn"
                        value={newDeliveryNoteRef}
                        onChange={(event) => setNewDeliveryNoteRef(event.target.value)}
                        placeholder="Optional"
                        className="min-w-0"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="ship-new-veh" className="text-xs">
                        Vehicle
                      </Label>
                      <Input
                        id="ship-new-veh"
                        value={newVehicle}
                        onChange={(event) => setNewVehicle(event.target.value)}
                        className="min-w-0"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="ship-new-drv" className="text-xs">
                        Driver
                      </Label>
                      <Input
                        id="ship-new-drv"
                        value={newDriver}
                        onChange={(event) => setNewDriver(event.target.value)}
                        className="min-w-0"
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setCreateShipmentDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                data-testid="logistics-create-shipment-button"
                disabled={newShipmentDisabled}
                onClick={() => void submitNewShipment()}
              >
                Add shipment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={(shipments) => (Array.isArray(shipments) ? shipments : []).length === 0}
        emptyTitle={shipmentsFilteredEmpty ? "No shipments match these filters" : "No shipments found"}
        emptyDescription={
          shipmentsFilteredEmpty
            ? "Active filters may be hiding all rows. Try Clear filters, remove chips above, or widen the ETA range."
            : "Shipments are created from purchase orders or receiving activity. Create a PO, configure carrier defaults, or post a receipt to start tracking shipments."
        }
        emptyAction={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="default" size="sm">
              <Link href={APP_ROUTES.procurement.orders}>View purchase orders</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Open operations overview</Link>
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
                <TableHead>Direction</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Freight</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((shipment) => (
                <TableRow
                  key={shipment.id}
                  data-testid="logistics-shipment-row"
                  className="cursor-pointer"
                  onClick={() => setLocation(APP_ROUTES.operations.shipment(shipment.id))}
                >
                  <TableCell className="font-medium">{shipment.id}</TableCell>
                  <TableCell>{shipment.poNumber}</TableCell>
                  <TableCell className="text-sm capitalize">{shipment.direction || "inbound"}</TableCell>
                  <TableCell>{shipment.carrier || "-"}</TableCell>
                  <TableCell>
                    <StatusBadge status={shipment.status} />
                  </TableCell>
                  <TableCell>{formatDate(shipment.eta)}</TableCell>
                  <TableCell className="tabular-nums text-sm">
                    {shipment.freightCost != null && Number.isFinite(Number(shipment.freightCost))
                      ? Number(shipment.freightCost).toLocaleString()
                      : "—"}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs">
                    {shipment.trackingNumber?.trim() || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{shipmentRiskBucketLabel(shipment.riskBucket)}</span>
                      {shipment.atRisk ? (
                        <span className="text-xs text-destructive" data-testid="logistics-row-at-risk-flag">
                          Operational late flag
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={(event: MouseEvent<HTMLButtonElement>) => {
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
                          onClick={async (event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            try {
                              await deleteShipment(shipment.id);
                              await refreshNow();
                              await invalidateLogisticsAndPurchaseOrders(queryClient);
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
  const [metaCarrierId, setMetaCarrierId] = useState<string>("none");
  const [metaEta, setMetaEta] = useState("");
  const [metaTracking, setMetaTracking] = useState("");
  const [metaTransportMode, setMetaTransportMode] = useState("");
  const [metaFreightCost, setMetaFreightCost] = useState("");
  const [metaVehicle, setMetaVehicle] = useState("");
  const [metaDriver, setMetaDriver] = useState("");
  const [metaDeliveryNoteRef, setMetaDeliveryNoteRef] = useState("");
  const [metaGrnNumber, setMetaGrnNumber] = useState("");
  const [metaSaving, setMetaSaving] = useState(false);
  const [deliveryPdfLoading, setDeliveryPdfLoading] = useState(false);

  const fetcher = useCallback(
    (): Promise<ShipmentDetail> => fetchShipment(shipmentId),
    [shipmentId],
  );
  const { loading, error, data, refetch } = useAsyncResource(fetcher);

  const { data: carriers = [] } = useQuery({
    queryKey: ["/api/carriers"],
    queryFn: () => requestJson<Carrier[]>("GET", "/api/carriers"),
  });

  // Sync form from server when shipment changes or server row updates (e.g. after PATCH refetch).
  useEffect(() => {
    if (!data) return;
    setMetaCarrier(data.carrier ?? "");
    setMetaCarrierId(
      data.carrierId != null && Number.isFinite(Number(data.carrierId)) && Number(data.carrierId) > 0
        ? String(data.carrierId)
        : "none",
    );
    setMetaEta(
      data.eta
        ? typeof data.eta === "string"
          ? data.eta.slice(0, 10)
          : new Date(data.eta).toISOString().slice(0, 10)
        : "",
    );
    setMetaTracking(data.trackingNumber?.trim() ?? "");
    setMetaTransportMode(data.transportMode?.trim() ?? "");
    setMetaFreightCost(
      data.freightCost != null && Number.isFinite(Number(data.freightCost)) ? String(data.freightCost) : "",
    );
    setMetaVehicle(data.vehicle?.trim() ?? "");
    setMetaDriver(data.driver?.trim() ?? "");
    setMetaDeliveryNoteRef(data.deliveryNoteRef?.trim() ?? "");
    setMetaGrnNumber(data.grnNumber?.trim() ?? "");
  }, [data]);

  const submitMeta = async () => {
    setMetaSaving(true);
    try {
      const trimmedFr = metaFreightCost.trim();
      const freightParsed = Number(trimmedFr);
      const freightCost =
        trimmedFr === "" ? null : Number.isFinite(freightParsed) ? freightParsed : null;
      await patchShipmentMeta({
        id: shipmentId,
        carrierId:
          metaCarrierId === "none" || !metaCarrierId.trim()
            ? null
            : Number(metaCarrierId) > 0
              ? Number(metaCarrierId)
              : null,
        carrier: metaCarrier.trim() || null,
        eta: metaEta.trim() || null,
        trackingNumber: metaTracking.trim() || null,
        transportMode: metaTransportMode.trim() || null,
        freightCost,
        vehicle: metaVehicle.trim() || null,
        driver: metaDriver.trim() || null,
        deliveryNoteRef: metaDeliveryNoteRef.trim() || null,
        grnNumber: metaGrnNumber.trim() || null,
      });
      await refetch();
      await invalidateLogisticsAndPurchaseOrders(queryClient);
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
      await invalidateLogisticsAndPurchaseOrders(queryClient);
      toast({ title: "Status updated" });
    } catch (statusError) {
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
      <Button variant="ghost" onClick={() => setLocation(APP_ROUTES.operations.logistics)} className="w-fit">
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
            <LogisticsV1ExclusionNotice />

            {shipment.atRisk ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Late shipment risk</AlertTitle>
                <AlertDescription>
                  ETA is in the past and shipment is not yet delivered.
                </AlertDescription>
              </Alert>
            ) : null}

            {shipment.freightApNote ? (
              <Alert>
                <AlertTitle>Freight and accounts payable</AlertTitle>
                <AlertDescription>{shipment.freightApNote}</AlertDescription>
              </Alert>
            ) : null}

            <Card data-testid="logistics-detail-summary">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Shipment overview</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Shipment ID</p>
                  <p className="font-medium tabular-nums">{shipment.id}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Purchase order</p>
                  <Link
                    href={APP_ROUTES.procurement.order(shipment.poNumber)}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {shipment.poNumber}
                  </Link>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Supplier</p>
                  {shipment.supplierId != null && shipment.supplierName?.trim() ? (
                    <Link
                      href={APP_ROUTES.procurement.supplier(shipment.supplierId)}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {shipment.supplierName}
                    </Link>
                  ) : (
                    <p className="font-medium">{shipment.supplierName?.trim() || "—"}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Direction / source</p>
                  <p className="font-medium">
                    <span className="capitalize">{shipment.direction || "inbound"}</span>
                    <span className="text-muted-foreground"> · </span>
                    <span>{shipment.sourceType || "purchase_order"}</span>
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Carrier</p>
                  <p className="font-medium">{shipment.carrier?.trim() || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Freight (planning)</p>
                  <p className="font-medium tabular-nums">
                    {shipment.freightCost != null && Number.isFinite(Number(shipment.freightCost))
                      ? Number(shipment.freightCost).toLocaleString()
                      : "—"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">GRN</p>
                  <p className="font-medium font-mono text-sm">{shipment.grnNumber?.trim() || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Tracking</p>
                  <p className="font-mono text-sm">{shipment.trackingNumber?.trim() || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Risk</p>
                  <p className="font-medium">{shipmentRiskBucketLabel(shipment.riskBucket)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Last updated</p>
                  <p className="font-medium">
                    {formatDate(shipment.updatedAtFormatted ?? shipment.updatedAt ?? null)}
                  </p>
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                  <p className="text-xs text-muted-foreground">Related operational exception</p>
                  {shipment.relatedException ? (
                    <Link
                      href={`${APP_ROUTES.operations.exceptions}/${shipment.relatedException.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      #{shipment.relatedException.id} · {shipment.relatedException.title} (
                      {shipment.relatedException.status})
                    </Link>
                  ) : (
                    <p className="text-muted-foreground">None linked</p>
                  )}
                </div>
              </CardContent>
            </Card>

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
                <CardTitle>Shipment metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor={`sh-carrier-id-${shipment.id}`}>Carrier (master)</Label>
                    <Select value={metaCarrierId} onValueChange={setMetaCarrierId}>
                      <SelectTrigger id={`sh-carrier-id-${shipment.id}`}>
                        <SelectValue placeholder="Carrier" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No master link (label only)</SelectItem>
                        {carriers
                          .filter((c) => c.active !== false)
                          .map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sh-carrier-${shipment.id}`}>Carrier label</Label>
                    <Input
                      id={`sh-carrier-${shipment.id}`}
                      value={metaCarrier}
                      onChange={(e) => setMetaCarrier(e.target.value)}
                      placeholder="Displayed carrier text"
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
                  <div className="space-y-1">
                    <Label htmlFor={`sh-tm-${shipment.id}`}>Transport mode</Label>
                    <Input
                      id={`sh-tm-${shipment.id}`}
                      value={metaTransportMode}
                      onChange={(e) => setMetaTransportMode(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sh-fr-${shipment.id}`}>Freight cost</Label>
                    <Input
                      id={`sh-fr-${shipment.id}`}
                      type="number"
                      value={metaFreightCost}
                      onChange={(e) => setMetaFreightCost(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sh-veh-${shipment.id}`}>Vehicle</Label>
                    <Input
                      id={`sh-veh-${shipment.id}`}
                      value={metaVehicle}
                      onChange={(e) => setMetaVehicle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sh-drv-${shipment.id}`}>Driver</Label>
                    <Input
                      id={`sh-drv-${shipment.id}`}
                      value={metaDriver}
                      onChange={(e) => setMetaDriver(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sh-dn-${shipment.id}`}>Delivery note ref</Label>
                    <Input
                      id={`sh-dn-${shipment.id}`}
                      value={metaDeliveryNoteRef}
                      onChange={(e) => setMetaDeliveryNoteRef(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sh-grn-${shipment.id}`}>GRN #</Label>
                    <Input
                      id={`sh-grn-${shipment.id}`}
                      value={metaGrnNumber}
                      onChange={(e) => setMetaGrnNumber(e.target.value)}
                    />
                  </div>
                </div>
                <Can roles={["manager", "planner", "admin"]} reason="Requires Manager, Planner, or Admin">
                  <Button onClick={() => void submitMeta()} disabled={metaSaving}>
                    Save metadata
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
                    {shipment.timeline.map((event: ShipmentTimelineEvent) => (
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
  const [detailMatch, detailParams] = useRoute<{ id: string }>(
    `${APP_ROUTES.operations.logistics}/:id`,
  );

  if (detailMatch && detailParams?.id) {
    return <ShipmentDetailView shipmentId={detailParams.id} />;
  }

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
      <PageHeader
        title="Logistics"
        subtitle="Shipment tracking, inbound receive links, carriers, and activity"
        breadcrumb={<span>Operations / Logistics</span>}
      />
      <LogisticsV1ExclusionNotice />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="inbound">Inbound</TabsTrigger>
          <TabsTrigger value="outbound">Outbound</TabsTrigger>
          <TabsTrigger value="carriers">Carriers</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <ShipmentListView listScope="all" />
        </TabsContent>
        <TabsContent value="inbound" className="space-y-4">
          <ShipmentListView listScope="inbound" />
        </TabsContent>
        <TabsContent value="outbound" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Outbound dispatch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Outbound logistics is not yet tied to inventory issue documents. Use stock movements from inventory
                operations for ISSUE flows until dispatch documents are linked here.
              </p>
              <Button type="button" variant="secondary" disabled data-testid="logistics-outbound-v1-excluded">
                Outbound dispatch excluded from v1
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="carriers" className="space-y-4">
          <LogisticsCarriersPanel />
        </TabsContent>
        <TabsContent value="activity" className="space-y-4">
          <LogisticsActivityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
