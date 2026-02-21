import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { AlertTriangle, ArrowLeft, ArrowUpDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataState } from "@/components/ui/data-state";
import { EntityActivityPanel } from "@/components/activity/entity-activity-panel";
import { useToast } from "@/hooks/use-toast";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { apiRequest } from "@/lib/queryClient";
import { fetchInventoryDetail } from "@/api/client";

type InventoryPosition = {
  location: string;
  onHand: number;
  allocated: number;
  available: number;
  updatedAt: string | null;
};

type InventoryMovement = {
  id: number;
  location: string;
  delta: number;
  reason: string;
  ref: string | null;
  createdBy: string | null;
  createdAt: string | null;
};

type InventoryDetail = {
  id: number;
  sku: string;
  name: string;
  summary: {
    onHand: number;
    allocated: number;
    available: number;
  };
  positions: InventoryPosition[];
  movements: InventoryMovement[];
  location?: string | null;
};

type AdjustResponse = {
  summary: {
    onHand: number;
    allocated: number;
    available: number;
  };
  exception: null | {
    id: number;
    created: boolean;
  };
};

const ADJUST_REASONS = [
  "Adjust",
  "Count correction",
  "Damage",
  "Transfer",
  "Receipt correction",
];

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function numOrNa(value: unknown): string | number {
  if (value === null || value === undefined) return "N/A";
  const n = Number(value);
  return Number.isFinite(n) ? n : "N/A";
}

export default function InventoryDetailPage() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute<{ sku: string }>("/inventory/:sku");
  const sku = params?.sku ?? "";
  const { toast } = useToast();

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustLocation, setAdjustLocation] = useState("");
  const [adjustDelta, setAdjustDelta] = useState<string>("0");
  const [adjustReason, setAdjustReason] = useState(ADJUST_REASONS[0]);
  const [adjustRef, setAdjustRef] = useState("");

  const fetchDetail = (): Promise<InventoryDetail> => fetchInventoryDetail(sku);

  const {
    loading,
    error,
    data,
    refetch,
  } = useAsyncResource(fetchDetail, { immediate: Boolean(match && sku) });

  const locationOptions = useMemo(() => {
    const options = new Set<string>();
    for (const position of data?.positions ?? []) {
      if (position.location) {
        options.add(position.location);
      }
    }
    if (data?.location) {
      options.add(data.location);
    }
    if (options.size === 0) {
      options.add("Main Warehouse");
    }
    return Array.from(options);
  }, [data?.location, data?.positions]);

  const openAdjustModal = () => {
    const defaultLocation = locationOptions[0] ?? data?.location ?? "";
    setAdjustLocation(defaultLocation);
    setAdjustDelta("0");
    setAdjustReason(ADJUST_REASONS[0]);
    setAdjustRef("");
    setAdjustOpen(true);
  };

  const submitAdjustment = async () => {
    const numericDelta = Number(adjustDelta);
    if (!Number.isFinite(numericDelta) || numericDelta === 0) {
      toast({
        title: "Invalid adjustment",
        description: "Delta must be a non-zero number.",
        variant: "destructive",
      });
      return;
    }

    setAdjusting(true);
    try {
      const response = await apiRequest("POST", `/api/inventory/${sku}/adjust`, {
        location: adjustLocation,
        delta: numericDelta,
        reason: adjustReason,
        ref: adjustRef || undefined,
      });

      const raw = (await response.json()) as { ok?: boolean; data?: AdjustResponse } | AdjustResponse;
      const payload = raw && typeof raw === "object" && "ok" in raw && raw.ok && raw.data ? raw.data : (raw as AdjustResponse);
      await refetch();
      setAdjustOpen(false);

      const avail = payload?.summary?.available ?? (payload?.summary as { available?: number } | undefined)?.available;
      toast({
        title: "Inventory updated",
        description: typeof avail === "number" ? `New available stock: ${avail}` : "Stock updated.",
      });

      if (payload.exception?.created) {
        toast({
          title: "Exception created",
          description: "A shortage exception was created for this SKU.",
          variant: "destructive",
        });
      }
    } catch (adjustError) {
      toast({
        title: "Adjustment failed",
        description:
          adjustError instanceof Error ? adjustError.message : "Failed to apply adjustment",
        variant: "destructive",
      });
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Button variant="ghost" onClick={() => setLocation("/inventory")} className="w-fit">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to inventory
      </Button>

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={() => false}
        emptyTitle="Inventory detail unavailable"
        onRetry={refetch}
        errorAction={
          <Button variant="outline" size="sm" onClick={() => setLocation("/inventory")}>
            Go back
          </Button>
        }
      >
        {(detail) => {
          const summary = detail.summary ?? { onHand: 0, allocated: 0, available: 0 };
          const available =
            summary.available ??
            Math.max((summary.onHand ?? 0) - (summary.allocated ?? 0), 0);
          const positions = Array.isArray(detail.positions) ? detail.positions : [];
          const movements = Array.isArray(detail.movements) ? detail.movements : [];
          return (
          <>
            <PageHeader
              title={detail.name ?? detail.sku ?? "Item"}
              subtitle={`SKU ${detail.sku ?? "—"}`}
              breadcrumb={<span>Operations / Inventory / {detail.sku}</span>}
              actions={
                <Button onClick={openAdjustModal} className="gap-2">
                  <ArrowUpDown className="h-4 w-4" />
                  Adjust stock
                </Button>
              }
            />

            {Number(available) < 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Negative available stock</AlertTitle>
                <AlertDescription>
                  This SKU currently has negative available stock and requires operational attention.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">On hand</CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-semibold">{numOrNa(summary.onHand)}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Allocated</CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-semibold">{numOrNa(summary.allocated)}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Available</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-3 text-3xl font-semibold">
                  <span>{numOrNa(available)}</span>
                  <StatusBadge
                    status={Number(available) < 0 ? "error" : Number(available) === 0 ? "low" : "active"}
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Positions by location</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Allocated</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((position) => (
                      <TableRow key={`${detail.sku}-${position.location}`}>
                        <TableCell>{position.location ?? "N/A"}</TableCell>
                        <TableCell className="text-right">{numOrNa(position.onHand)}</TableCell>
                        <TableCell className="text-right">{numOrNa(position.allocated)}</TableCell>
                        <TableCell className="text-right">{numOrNa(position.available)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatDate(position.updatedAt ?? null)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Movement timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Delta</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>User</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell>{formatDate(movement.createdAt ?? null)}</TableCell>
                        <TableCell>{movement.location ?? "N/A"}</TableCell>
                        <TableCell className="text-right">
                          {typeof movement.delta === "number"
                            ? movement.delta > 0
                              ? `+${movement.delta}`
                              : movement.delta
                            : numOrNa(movement.delta)}
                        </TableCell>
                        <TableCell>{movement.reason ?? "N/A"}</TableCell>
                        <TableCell>{movement.ref ?? "-"}</TableCell>
                        <TableCell>{movement.createdBy ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <EntityActivityPanel entityType="inventory" entityId={detail.sku} />
          </>
          );
        }}
      </DataState>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>
              Record a stock adjustment for SKU {sku}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adjust-location">Location</Label>
              <Select value={adjustLocation} onValueChange={setAdjustLocation}>
                <SelectTrigger id="adjust-location">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjust-delta">Delta</Label>
              <Input
                id="adjust-delta"
                type="number"
                value={adjustDelta}
                onChange={(event) => setAdjustDelta(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjust-reason">Reason</Label>
              <Select value={adjustReason} onValueChange={setAdjustReason}>
                <SelectTrigger id="adjust-reason">
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {ADJUST_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjust-ref">Reference (optional)</Label>
              <Textarea
                id="adjust-ref"
                value={adjustRef}
                onChange={(event) => setAdjustRef(event.target.value)}
                placeholder="Ticket, count sheet, transfer ref..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjusting}>
              Cancel
            </Button>
            <Button onClick={submitAdjustment} disabled={adjusting}>
              {adjusting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Apply adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
