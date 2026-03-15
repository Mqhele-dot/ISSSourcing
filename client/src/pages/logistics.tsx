import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  updateShipmentStatus,
  type ShipmentDetail,
  type ShipmentListItem,
} from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";

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

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Logistics"
        subtitle="Shipment tracking and status management"
        breadcrumb={<span>Operations / Logistics</span>}
      />

      <Toolbar
        sticky
        left={
          <>
            <Input
              value={String(queryState.status || "")}
              onChange={(event) => setQueryState({ status: event.target.value })}
              placeholder="Status"
              className="w-40"
            />
            <Input
              value={String(queryState.po || "")}
              onChange={(event) => setQueryState({ po: event.target.value })}
              placeholder="PO"
              className="w-52"
            />
            <Input
              value={String(queryState.carrier || "")}
              onChange={(event) => setQueryState({ carrier: event.target.value })}
              placeholder="Carrier"
              className="w-52"
            />
            <Select
              value={String(queryState.risk || "") || "all"}
              onValueChange={(value) => setQueryState({ risk: value === "all" ? "" : value })}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All risk</SelectItem>
                <SelectItem value="late">Late risk</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefreshEnabled ? "default" : "outline"}
              onClick={() => setAutoRefreshEnabled((current) => !current)}
            >
              Auto-refresh: {autoRefreshEnabled ? "On" : "Off"}
            </Button>
            <Button variant="outline" onClick={refreshNow}>
              Refresh
            </Button>
            <Can roles={["manager", "admin"]}>
              <div className="flex items-center gap-2">
                <Input
                  value={newPoNumber}
                  onChange={(event) => setNewPoNumber(event.target.value)}
                  placeholder="PO number"
                  className="w-36"
                />
                <Input
                  value={newCarrier}
                  onChange={(event) => setNewCarrier(event.target.value)}
                  placeholder="Carrier"
                  className="w-28"
                />
                <Input
                  value={newEta}
                  onChange={(event) => setNewEta(event.target.value)}
                  type="date"
                  className="w-36"
                />
                <Button
                  onClick={async () => {
                    try {
                      await createShipment({
                        poNumber: newPoNumber,
                        carrier: newCarrier || undefined,
                        eta: newEta || undefined,
                      });
                      setNewPoNumber("");
                      setNewCarrier("");
                      setNewEta("");
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
            </Can>
            <span className="text-xs text-muted-foreground">
              Last refreshed: {lastRefreshedLabel}
            </span>
          </div>
        }
      />

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>PO</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ETA</TableHead>
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
                  <TableCell>{shipment.atRisk ? "Late risk" : "-"}</TableCell>
                  <TableCell className="text-right">
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
                  </TableCell>
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

function ShipmentDetailView({ shipmentId }: { shipmentId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [toStatus, setToStatus] = useState("in_transit");
  const [note, setNote] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetcher = useCallback(
    (): Promise<ShipmentDetail> => fetchShipment(shipmentId),
    [shipmentId],
  );
  const { loading, error, data, refetch } = useAsyncResource(fetcher);

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
    <div className="mx-auto max-w-7xl space-y-4">
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
