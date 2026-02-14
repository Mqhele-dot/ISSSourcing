import { useState } from "react";
import { useLocation, useRoute } from "wouter";
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
import { useToast } from "@/hooks/use-toast";
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { Can } from "@/components/auth/can";
import {
  fetchShipment,
  fetchShipments,
  updateShipmentStatus,
  type ShipmentDetail,
  type ShipmentListItem,
} from "@/api/client";

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function ShipmentListView() {
  const [, setLocation] = useLocation();
  const { queryState, setQueryState } = useQueryState({
    status: "",
    po: "",
    carrier: "",
    risk: "",
  });

  const fetcher = async (): Promise<ShipmentListItem[]> =>
    fetchShipments({
      status: String(queryState.status || ""),
      po: String(queryState.po || ""),
      carrier: String(queryState.carrier || ""),
      risk: String(queryState.risk || ""),
    });

  const { loading, error, data, refetch } = useAsyncResource(fetcher);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Logistics"
        subtitle="Shipment tracking and status management"
        breadcrumb={<span>Operations / Logistics</span>}
      />

      <Toolbar
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
          <Button variant="outline" onClick={refetch}>
            Refresh
          </Button>
        }
      />

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={(shipments) => shipments.length === 0}
        emptyTitle="No shipments found"
        emptyDescription="Try broadening your filters."
        onRetry={refetch}
      >
        {(shipments) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>PO</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.map((shipment) => (
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
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

  const fetcher = async (): Promise<ShipmentDetail> => fetchShipment(shipmentId);
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
      toast({
        title: "Shipment updated",
        description: `Status moved to ${toStatus}`,
      });
    } catch (statusError) {
      toast({
        title: "Update failed",
        description: statusError instanceof Error ? statusError.message : "Request failed",
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
