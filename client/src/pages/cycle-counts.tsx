import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CycleCount = {
  id: number;
  warehouseId: number;
  zone: string | null;
  status: string;
  countDate: string;
  countedBy: number | null;
  variance: number | null;
};

type CycleCountLine = {
  id: number;
  cycleCountId: number;
  itemId: number;
  location: string | null;
  systemQuantity: number;
  countedQuantity: number;
  variance: number;
};

export default function CycleCountsPage() {
  const { toast } = useToast();
  const [warehouseId, setWarehouseId] = useState("none");
  const [zone, setZone] = useState("");
  const [selectedCountId, setSelectedCountId] = useState<number | null>(null);
  const [itemId, setItemId] = useState("none");
  const [location, setLocation] = useState("");
  const [systemQuantity, setSystemQuantity] = useState("0");
  const [countedQuantity, setCountedQuantity] = useState("0");

  const { data: cycleCounts = [] } = useQuery({
    queryKey: ["/api/cycle-counts"],
    queryFn: () => requestJson<CycleCount[]>("GET", "/api/cycle-counts"),
  });
  const { data: cycleCountLines = [] } = useQuery({
    queryKey: ["/api/cycle-count-lines", selectedCountId],
    queryFn: async () => {
      const all = await requestJson<CycleCountLine[]>("GET", "/api/cycle-count-lines");
      return selectedCountId ? all.filter((line) => line.cycleCountId === selectedCountId) : [];
    },
    enabled: selectedCountId != null,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ["/api/warehouses"],
    queryFn: () => requestJson<Array<{ id: number; name: string }>>("GET", "/api/warehouses"),
  });
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/inventory");
      return normalizeApiList<{ id: number; sku: string; name: string }>(raw);
    },
  });

  const createCycleCount = useMutation({
    mutationFn: () => {
      if (warehouseId === "none") throw new Error("Warehouse is required");
      return requestJson<CycleCount>("POST", "/api/cycle-counts", {
        warehouseId: Number(warehouseId),
        zone: zone.trim() || null,
        status: "planned",
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cycle-counts"] });
      setSelectedCountId(created.id);
      toast({ title: "Cycle count created" });
    },
    onError: (e) => {
      toast({
        title: "Failed to create cycle count",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const addLine = useMutation({
    mutationFn: () => {
      if (!selectedCountId) throw new Error("Select a cycle count first");
      if (itemId === "none") throw new Error("Item is required");
      const system = Number(systemQuantity);
      const counted = Number(countedQuantity);
      if (!Number.isFinite(system) || !Number.isFinite(counted)) {
        throw new Error("System and counted quantities must be valid numbers");
      }
      return requestJson("POST", "/api/cycle-count-lines", {
        cycleCountId: selectedCountId,
        itemId: Number(itemId),
        location: location.trim() || null,
        systemQuantity: system,
        countedQuantity: counted,
        variance: counted - system,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cycle-count-lines", selectedCountId] });
      toast({ title: "Cycle count line added" });
    },
    onError: (e) => {
      toast({
        title: "Failed to add line",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const startCount = useMutation({
    mutationFn: (id: number) =>
      requestJson("PATCH", `/api/cycle-counts/${id}`, { status: "in_progress" }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cycle-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cycle-count-lines", id] });
      toast({ title: "Count started", description: "Status set to in progress — capture lines, then post." });
    },
    onError: (e) => {
      toast({
        title: "Could not start count",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const lineDiscrepancySummary = useMemo(() => {
    if (!cycleCountLines.length) {
      return { total: 0, withVariance: 0, netVariance: 0, absVariance: 0 };
    }
    let withVariance = 0;
    let netVariance = 0;
    let absVariance = 0;
    for (const line of cycleCountLines) {
      const v = Number(line.variance ?? 0);
      netVariance += v;
      absVariance += Math.abs(v);
      if (v !== 0) withVariance += 1;
    }
    return {
      total: cycleCountLines.length,
      withVariance,
      netVariance,
      absVariance,
    };
  }, [cycleCountLines]);

  const postCount = useMutation({
    mutationFn: (id: number) => requestJson("POST", `/api/cycle-counts/${id}/post`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cycle-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cycle-count-lines", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Cycle count posted", description: "Inventory adjusted for variances." });
    },
    onError: (e) => {
      toast({
        title: "Failed to post cycle count",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Alert>
        <AlertTitle>Cycle count workflow</AlertTitle>
        <AlertDescription className="text-sm">
          Create a count → add lines (system vs counted qty) → <strong>Start</strong> to set{" "}
          <code>in_progress</code> → <strong>Post</strong> to book variances to inventory.
        </AlertDescription>
      </Alert>
      <PageHeader
        title="Cycle Counts"
        subtitle="Workflow: create a count → Start (in progress) → add lines → Post adjustments. Planned counts can be opened and edited before posting."
      />

      <Card>
        <CardHeader>
          <CardTitle>Create cycle count</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="cycle-warehouse">Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger id="cycle-warehouse">
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select warehouse</SelectItem>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cycle-zone">Zone</Label>
            <Input id="cycle-zone" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Optional zone/aisle" />
          </div>
          <div className="flex items-end">
            <Button onClick={() => createCycleCount.mutate()} disabled={createCycleCount.isPending}>
              Create count
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cycle counts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycleCounts.map((count) => (
                <TableRow key={count.id}>
                  <TableCell>#{count.id}</TableCell>
                  <TableCell>
                    {warehouses.find((w) => w.id === count.warehouseId)?.name ?? `#${count.warehouseId}`}
                  </TableCell>
                  <TableCell>{count.status}</TableCell>
                  <TableCell>{count.variance ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedCountId(count.id)}>
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => startCount.mutate(count.id)}
                        disabled={
                          startCount.isPending || count.status === "completed" || count.status === "in_progress"
                        }
                      >
                        Start
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => postCount.mutate(count.id)}
                        disabled={postCount.isPending || count.status === "completed"}
                      >
                        Post
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedCountId ? (
        <Card>
          <CardHeader>
            <CardTitle>Cycle count lines (#{selectedCountId})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cycleCountLines.length > 0 ? (
              <div className="rounded-md border p-4 grid gap-2 sm:grid-cols-2 md:grid-cols-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Lines</div>
                  <div className="text-lg font-semibold">{lineDiscrepancySummary.total}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">With discrepancy</div>
                  <div className="text-lg font-semibold flex items-center gap-2">
                    {lineDiscrepancySummary.withVariance}
                    {lineDiscrepancySummary.withVariance > 0 ? (
                      <Badge variant="secondary">Review before post</Badge>
                    ) : (
                      <Badge variant="outline">Balanced</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Net variance (sum)</div>
                  <div className="text-lg font-semibold">{lineDiscrepancySummary.netVariance}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Total |variance|</div>
                  <div className="text-lg font-semibold">{lineDiscrepancySummary.absVariance}</div>
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-5">
              <div className="space-y-1">
                <Label htmlFor="cycle-item">Item</Label>
                <Select value={itemId} onValueChange={setItemId}>
                  <SelectTrigger id="cycle-item">
                    <SelectValue placeholder="Select item" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select item</SelectItem>
                    {inventoryItems.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.sku} - {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cycle-location">Location</Label>
                <Input id="cycle-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bin/location" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cycle-system">System qty</Label>
                <Input id="cycle-system" type="number" value={systemQuantity} onChange={(e) => setSystemQuantity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cycle-counted">Counted qty</Label>
                <Input id="cycle-counted" type="number" value={countedQuantity} onChange={(e) => setCountedQuantity(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button onClick={() => addLine.mutate()} disabled={addLine.isPending}>
                  Add line
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>System</TableHead>
                  <TableHead>Counted</TableHead>
                  <TableHead>Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cycleCountLines.map((line) => (
                  <TableRow
                    key={line.id}
                    className={Number(line.variance ?? 0) !== 0 ? "bg-amber-50/80 dark:bg-amber-950/25" : undefined}
                  >
                    <TableCell>{line.itemId}</TableCell>
                    <TableCell>{line.location || "-"}</TableCell>
                    <TableCell>{line.systemQuantity}</TableCell>
                    <TableCell>{line.countedQuantity}</TableCell>
                    <TableCell>{line.variance}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
