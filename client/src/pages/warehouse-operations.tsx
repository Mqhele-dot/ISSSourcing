import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatMutationError, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { fetchInventory } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";

type WarehouseInvRow = {
  id: number;
  itemId: number;
  warehouseId: number;
  quantity: number;
  location: string | null;
  aisle: string | null;
  bin: string | null;
};

type AllocationRow = {
  id: number;
  itemId: number;
  warehouseId: number | null;
  quantity: number;
  orderId: number | null;
  requisitionId: number | null;
  status: string;
};

type BatchRow = {
  id: number;
  itemId: number;
  warehouseId: number | null;
  batchNumber: string;
  quantityOnHand: number;
};

type SerialRow = {
  id: number;
  itemId: number;
  warehouseId: number | null;
  serialNumber: string;
  status: string;
};

export default function WarehouseOperationsPage() {
  const productSetupComplete = useProductSetupComplete();
  const { toast } = useToast();
  const [putAwayWarehouse, setPutAwayWarehouse] = useState("none");

  const [allocItem, setAllocItem] = useState("none");
  const [allocWh, setAllocWh] = useState("none");
  const [allocQty, setAllocQty] = useState("1");
  const [allocOrder, setAllocOrder] = useState("");
  const [allocReq, setAllocReq] = useState("");

  const [batchItem, setBatchItem] = useState("none");
  const [batchWh, setBatchWh] = useState("none");
  const [batchNumber, setBatchNumber] = useState("");
  const [batchQty, setBatchQty] = useState("1");

  const [serialItem, setSerialItem] = useState("none");
  const [serialWh, setSerialWh] = useState("none");
  const [serialNumber, setSerialNumber] = useState("");

  const [issueBatchId, setIssueBatchId] = useState("none");
  const [issueBatchQty, setIssueBatchQty] = useState("1");
  const [issueSerialId, setIssueSerialId] = useState("none");

  const {
    data: warehouses = [],
    isError: warehousesError,
    error: warehousesErr,
    refetch: refetchWarehouses,
  } = useQuery({
    queryKey: ["/api/warehouses"],
    queryFn: () => requestJson<Array<{ id: number; name: string }>>("GET", "/api/warehouses"),
    throwOnError: false,
  });

  const {
    data: inventoryItems = [],
    isError: inventoryError,
    error: inventoryErr,
    refetch: refetchInventory,
  } = useQuery({
    queryKey: ["/api/inventory", "warehouse-ops"],
    queryFn: () => fetchInventory(),
    throwOnError: false,
  });

  const {
    data: allocations = [],
    isLoading: allocLoading,
    isError: allocError,
    error: allocErr,
    refetch: refetchAllocations,
  } = useQuery({
    queryKey: ["/api/inventory-allocations"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/inventory-allocations");
      return normalizeApiList<AllocationRow>(raw);
    },
    throwOnError: false,
  });

  const {
    data: whInventory = [],
    isLoading: whInvLoading,
    isError: whInvError,
    error: whInvErr,
    refetch: refetchWhInventory,
  } = useQuery({
    queryKey: ["/api/warehouse-inventory", putAwayWarehouse],
    queryFn: () => requestJson<WarehouseInvRow[]>("GET", `/api/warehouse-inventory/${putAwayWarehouse}`),
    enabled: putAwayWarehouse !== "none",
    throwOnError: false,
  });

  const {
    data: batchRows = [],
    isError: batchError,
    error: batchErr,
    refetch: refetchBatches,
  } = useQuery({
    queryKey: ["/api/inventory-batches", "warehouse-ops"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/inventory-batches");
      return normalizeApiList<BatchRow>(raw);
    },
    throwOnError: false,
  });

  const {
    data: serialRows = [],
    isError: serialError,
    error: serialErr,
    refetch: refetchSerials,
  } = useQuery({
    queryKey: ["/api/inventory-serials", "warehouse-ops"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/inventory-serials");
      return normalizeApiList<SerialRow>(raw);
    },
    throwOnError: false,
  });

  const issuableBatches = useMemo(
    () => batchRows.filter((b) => (b.quantityOnHand ?? 0) > 0),
    [batchRows],
  );
  const issuableSerials = useMemo(
    () =>
      serialRows.filter((s) =>
        ["available", "allocated"].includes(String(s.status ?? "").toLowerCase()),
      ),
    [serialRows],
  );

  const itemLabel = useMemo(() => {
    const m = new Map<number, string>();
    for (const it of inventoryItems) {
      if (typeof it.id === "number") {
        const stock = `oh ${it.onHand ?? it.quantity ?? 0} / av ${it.available ?? 0}`;
        m.set(it.id, `${it.sku} — ${it.name} (${stock})`);
      }
    }
    return m;
  }, [inventoryItems]);

  const whName = useMemo(() => {
    const m = new Map<number, string>();
    for (const w of warehouses) m.set(w.id, w.name);
    return m;
  }, [warehouses]);

  const createAlloc = useMutation({
    mutationFn: () => {
      if (allocItem === "none") throw new Error("Item is required");
      const qty = Number(allocQty);
      if (!Number.isFinite(qty) || qty < 1) throw new Error("Quantity must be ≥ 1");
      let orderId: number | null = null;
      if (allocOrder.trim()) {
        const n = Number(allocOrder);
        if (!Number.isFinite(n) || n < 1) throw new Error("PO id must be a positive integer");
        orderId = Math.trunc(n);
      }
      let requisitionId: number | null = null;
      if (allocReq.trim()) {
        const n = Number(allocReq);
        if (!Number.isFinite(n) || n < 1) throw new Error("Requisition id must be a positive integer");
        requisitionId = Math.trunc(n);
      }
      return requestJson("POST", "/api/inventory-allocations", {
        itemId: Number(allocItem),
        warehouseId: allocWh === "none" ? null : Number(allocWh),
        quantity: qty,
        orderId,
        requisitionId,
        status: "reserved",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-allocations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Allocation created" });
    },
    onError: (e) => {
      toast({
        title: "Allocation failed",
        description: formatMutationError("Create allocation", "POST", "/api/inventory-allocations", e),
        variant: "destructive",
      });
    },
  });

  const savePutAway = useMutation({
    mutationFn: (row: WarehouseInvRow & { location: string; aisle: string; bin: string }) =>
      requestJson("PUT", `/api/warehouse-inventory/${row.id}`, {
        location: row.location || null,
        aisle: row.aisle || null,
        bin: row.bin || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory", putAwayWarehouse] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Put-away saved" });
    },
    onError: (e) => {
      toast({
        title: "Save failed",
        description: formatMutationError("Put-away", "PUT", "/api/warehouse-inventory/:id", e),
        variant: "destructive",
      });
    },
  });

  const createBatch = useMutation({
    mutationFn: () => {
      if (batchItem === "none" || !batchNumber.trim()) throw new Error("Item and batch number required");
      const q = Number(batchQty);
      if (!Number.isFinite(q) || q < 1 || !Number.isInteger(q)) {
        throw new Error("Quantity must be a positive whole number");
      }
      return requestJson("POST", "/api/inventory-batches", {
        itemId: Number(batchItem),
        warehouseId: batchWh === "none" ? null : Number(batchWh),
        batchNumber: batchNumber.trim(),
        quantityReceived: q,
        quantityOnHand: q,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-batches"] });
      toast({ title: "Batch registered" });
      setBatchNumber("");
    },
    onError: (e) => {
      toast({
        title: "Batch failed",
        description: formatMutationError("Create batch", "POST", "/api/inventory-batches", e),
        variant: "destructive",
      });
    },
  });

  const createSerial = useMutation({
    mutationFn: () => {
      if (serialItem === "none" || !serialNumber.trim()) throw new Error("Item and serial required");
      return requestJson("POST", "/api/inventory-serials", {
        itemId: Number(serialItem),
        warehouseId: serialWh === "none" ? null : Number(serialWh),
        serialNumber: serialNumber.trim(),
        status: "available",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-serials"] });
      toast({ title: "Serial registered" });
      setSerialNumber("");
    },
    onError: (e) => {
      toast({
        title: "Serial failed",
        description: formatMutationError("Create serial", "POST", "/api/inventory-serials", e),
        variant: "destructive",
      });
    },
  });

  const issueBatch = useMutation({
    mutationFn: () => {
      if (issueBatchId === "none") throw new Error("Select a batch");
      const q = Number(issueBatchQty);
      if (!Number.isFinite(q) || q < 1) throw new Error("Quantity must be ≥ 1");
      return requestJson("POST", `/api/inventory-batches/${issueBatchId}/issue`, { quantity: q });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-allocations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-movements"] });
      toast({ title: "Issued from batch", description: "Stock and trace records were updated." });
    },
    onError: (e) => {
      toast({
        title: "Batch issue failed",
        description: formatMutationError("Issue batch", "POST", "/api/inventory-batches/:id/issue", e),
        variant: "destructive",
      });
    },
  });

  const issueSerial = useMutation({
    mutationFn: () => {
      if (issueSerialId === "none") throw new Error("Select a serial");
      return requestJson("POST", `/api/inventory-serials/${issueSerialId}/issue`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-serials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-allocations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-movements"] });
      toast({ title: "Serial issued", description: "Unit marked issued and stock decremented." });
    },
    onError: (e) => {
      toast({
        title: "Serial issue failed",
        description: formatMutationError("Issue serial", "POST", "/api/inventory-serials/:id/issue", e),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6" data-testid="warehouse-operations-page">
      <PageHeader
        title="Warehouse operations"
        subtitle="Allocations, put-away, batch/serial registration, and trace-based issue (decrement batch/serial + master stock + ISSUE movement). PO receive with batch/serial remains on the PO screen."
        breadcrumb={
          <Link href={APP_ROUTES.inventory.warehouses} className="text-sm text-muted-foreground hover:text-foreground">
            ← Warehouses
          </Link>
        }
      />

      <ModuleTrainingPanel moduleId="warehouse-operations" />

      {warehousesError || inventoryError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load core warehouse data</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              {warehousesError && warehousesErr instanceof Error ? warehousesErr.message : null}
              {warehousesError && inventoryError ? " · " : null}
              {inventoryError && inventoryErr instanceof Error ? inventoryErr.message : null}
            </span>
            <div className="flex flex-wrap gap-2">
              {warehousesError ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void refetchWarehouses()}>
                  Retry warehouses
                </Button>
              ) : null}
              {inventoryError ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void refetchInventory()}>
                  Retry inventory
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {warehouses.length === 0 ? (
        <Alert>
          <AlertTitle>No warehouses yet</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              {productSetupComplete
                ? "Configure at least one warehouse before allocations and put-away are meaningful."
                : "Finish product setup to create your first warehouse."}
            </span>
            <Button asChild size="sm" variant="secondary" className="shrink-0">
              <Link href={productSetupComplete ? APP_ROUTES.inventory.warehouses : APP_ROUTES.setup.product}>
                {productSetupComplete ? "Manage warehouses" : "Continue product setup"}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Inventory allocations</CardTitle>
          <p className="text-sm text-muted-foreground">
            Reserved quantities against orders or requisitions (available = on-hand minus allocated in ops DB).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {allocError ? (
            <Alert variant="destructive">
              <AlertTitle>Allocations unavailable</AlertTitle>
              <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>{allocErr instanceof Error ? allocErr.message : String(allocErr)}</span>
                <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void refetchAllocations()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label>Item</Label>
              <Select value={allocItem} onValueChange={setAllocItem}>
                <SelectTrigger>
                  <SelectValue placeholder="Item" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select item</SelectItem>
                  {inventoryItems
                    .filter((it) => typeof it.id === "number")
                    .map((it) => (
                    <SelectItem key={it.id} value={String(it.id)}>
                      {it.sku}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Warehouse</Label>
              <Select value={allocWh} onValueChange={setAllocWh}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="alloc-qty">Qty</Label>
              <Input id="alloc-qty" type="number" min={1} value={allocQty} onChange={(e) => setAllocQty(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="alloc-po">PO id (opt)</Label>
              <Input id="alloc-po" value={allocOrder} onChange={(e) => setAllocOrder(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="alloc-req">Req id (opt)</Label>
              <Input id="alloc-req" value={allocReq} onChange={(e) => setAllocReq(e.target.value)} placeholder="e.g. 5" />
            </div>
          </div>
          <Button
            onClick={() => createAlloc.mutate()}
            disabled={createAlloc.isPending || allocItem === "none"}
          >
            Reserve (create allocation)
          </Button>

          {allocLoading ? (
            <p className="text-sm text-muted-foreground">Loading allocations…</p>
          ) : allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No allocation rows.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>PO / Req</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.id}</TableCell>
                    <TableCell className="text-xs">{itemLabel.get(a.itemId) ?? a.itemId}</TableCell>
                    <TableCell>
                      {a.warehouseId != null ? whName.get(a.warehouseId) ?? a.warehouseId : "—"}
                    </TableCell>
                    <TableCell>{a.quantity}</TableCell>
                    <TableCell className="text-xs">
                      {a.orderId != null ? `PO #${a.orderId}` : "—"} /{" "}
                      {a.requisitionId != null ? `Req #${a.requisitionId}` : "—"}
                    </TableCell>
                    <TableCell>{a.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Put-away</CardTitle>
          <p className="text-sm text-muted-foreground">
            Set location / aisle / bin on existing warehouse inventory rows (after receipt into a warehouse).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-1">
            <Label>Warehouse</Label>
            <Select value={putAwayWarehouse} onValueChange={setPutAwayWarehouse}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select warehouse</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {putAwayWarehouse !== "none" && whInvError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load warehouse stock rows</AlertTitle>
              <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>{whInvErr instanceof Error ? whInvErr.message : String(whInvErr)}</span>
                <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void refetchWhInventory()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {putAwayWarehouse === "none" ? (
            <p className="text-sm text-muted-foreground">Choose a warehouse to edit locations.</p>
          ) : whInvLoading ? (
            <p className="text-sm text-muted-foreground">Loading stock rows…</p>
          ) : whInventory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock rows for this warehouse.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Aisle</TableHead>
                  <TableHead>Bin</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {whInventory.map((row) => (
                  <PutAwayRow
                    key={row.id}
                    row={row}
                    itemLabel={itemLabel.get(row.itemId) ?? String(row.itemId)}
                    onSave={(patch) => savePutAway.mutate({ ...row, ...patch })}
                    busy={savePutAway.isPending && savePutAway.variables?.id === row.id}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Register batch</CardTitle>
            <p className="text-sm text-muted-foreground">Creates an inventory_batches row for traceability.</p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {batchError ? (
              <Alert variant="destructive">
                <AlertTitle>Batches list failed</AlertTitle>
                <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>{batchErr instanceof Error ? batchErr.message : String(batchErr)}</span>
                  <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void refetchBatches()}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <Select value={batchItem} onValueChange={setBatchItem}>
              <SelectTrigger>
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Item</SelectItem>
                {inventoryItems
                  .filter((it) => typeof it.id === "number")
                  .map((it) => (
                  <SelectItem key={it.id} value={String(it.id)}>
                    {it.sku}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={batchWh} onValueChange={setBatchWh}>
              <SelectTrigger>
                <SelectValue placeholder="Warehouse (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Batch number" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
            <Input
              type="number"
              min={0}
              placeholder="Qty on hand"
              value={batchQty}
              onChange={(e) => setBatchQty(e.target.value)}
            />
            <Button onClick={() => createBatch.mutate()} disabled={createBatch.isPending}>
              Save batch
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Register serial</CardTitle>
            <p className="text-sm text-muted-foreground">Creates an inventory_serials row (unique serial).</p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {serialError ? (
              <Alert variant="destructive">
                <AlertTitle>Serials list failed</AlertTitle>
                <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>{serialErr instanceof Error ? serialErr.message : String(serialErr)}</span>
                  <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void refetchSerials()}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <Select value={serialItem} onValueChange={setSerialItem}>
              <SelectTrigger>
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Item</SelectItem>
                {inventoryItems
                  .filter((it) => typeof it.id === "number")
                  .map((it) => (
                  <SelectItem key={it.id} value={String(it.id)}>
                    {it.sku}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={serialWh} onValueChange={setSerialWh}>
              <SelectTrigger>
                <SelectValue placeholder="Warehouse (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Serial number" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
            <Button onClick={() => createSerial.mutate()} disabled={createSerial.isPending}>
              Save serial
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issue from batch / serial (traceability)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Consumes on-hand batch quantity or marks a serial as <strong>issued</strong>, aligns warehouse + master item
            quantities, and posts an <strong>ISSUE</strong> stock movement (reference on serial movement).
          </p>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">Issue from batch</p>
            <div className="space-y-1">
              <Label>Batch</Label>
              <Select value={issueBatchId} onValueChange={setIssueBatchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select batch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select batch</SelectItem>
                  {issuableBatches.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      #{b.id} · {b.batchNumber} · on-hand {b.quantityOnHand} · item {itemLabel.get(b.itemId) ?? b.itemId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="issue-batch-qty">Quantity</Label>
              <Input
                id="issue-batch-qty"
                type="number"
                min={1}
                value={issueBatchQty}
                onChange={(e) => setIssueBatchQty(e.target.value)}
              />
            </div>
            <Button onClick={() => issueBatch.mutate()} disabled={issueBatch.isPending || issuableBatches.length === 0}>
              Issue from batch
            </Button>
          </div>
          <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">Issue serial (single unit)</p>
            <div className="space-y-1">
              <Label>Serial</Label>
              <Select value={issueSerialId} onValueChange={setIssueSerialId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select serial" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select serial</SelectItem>
                  {issuableSerials.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.serialNumber} · {itemLabel.get(s.itemId) ?? s.itemId} · {s.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => issueSerial.mutate()} disabled={issueSerial.isPending || issuableSerials.length === 0}>
              Issue serial
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PutAwayRow({
  row,
  itemLabel,
  onSave,
  busy,
}: {
  row: WarehouseInvRow;
  itemLabel: string;
  onSave: (patch: { location: string; aisle: string; bin: string }) => void;
  busy: boolean;
}) {
  const [location, setLocation] = useState(row.location ?? "");
  const [aisle, setAisle] = useState(row.aisle ?? "");
  const [bin, setBin] = useState(row.bin ?? "");

  useEffect(() => {
    setLocation(row.location ?? "");
    setAisle(row.aisle ?? "");
    setBin(row.bin ?? "");
  }, [row.id, row.location, row.aisle, row.bin]);

  return (
    <TableRow>
      <TableCell className="max-w-[180px] truncate text-xs">{itemLabel}</TableCell>
      <TableCell>{row.quantity}</TableCell>
      <TableCell>
        <Input className="h-8" value={location} onChange={(e) => setLocation(e.target.value)} />
      </TableCell>
      <TableCell>
        <Input className="h-8" value={aisle} onChange={(e) => setAisle(e.target.value)} />
      </TableCell>
      <TableCell>
        <Input className="h-8" value={bin} onChange={(e) => setBin(e.target.value)} />
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave({ location, aisle, bin })}>
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}
