import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useRoute, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, ArrowUpDown, Loader2, Pencil } from "lucide-react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, requestJson } from "@/lib/queryClient";
import { invalidateInventoryDomain } from "@/lib/domain-invalidation";
import { fetchInventoryDetail } from "@/api/client";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type InventoryPosition = {
  warehouseId: number;
  warehouseName: string;
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
  warehouses: Array<{ id: number; name: string }>;
  warehouseQuantity: number;
  unassignedQuantity: number;
  quantityMismatch: boolean;
  location?: string | null;
  description?: string | null;
  categoryId?: number | null;
  price?: number;
  cost?: number | null;
  lowStockThreshold?: number | null;
  barcode?: string | null;
  barcodeType?: string | null;
  unitOfMeasure?: string | null;
  supplierPartNumber?: string | null;
  defaultWarehouseId?: number | null;
  minOrderQuantity?: number | null;
  leadTime?: number | null;
  reorderPoint?: number | null;
  maxStockLevel?: number | null;
  status?: string | null;
};

type InventoryEditForm = {
  name: string;
  sku: string;
  description: string;
  categoryId: string;
  price: string;
  cost: string;
  lowStockThreshold: string;
  location: string;
  unitOfMeasure: string;
  supplierPartNumber: string;
  defaultWarehouseId: string;
  minOrderQuantity: string;
  leadTime: string;
  reorderPoint: string;
  maxStockLevel: string;
  status: string;
};

const emptyEditForm: InventoryEditForm = {
  name: "", sku: "", description: "", categoryId: "", price: "0", cost: "",
  lowStockThreshold: "10", location: "", unitOfMeasure: "each", supplierPartNumber: "",
  defaultWarehouseId: "", minOrderQuantity: "1", leadTime: "", reorderPoint: "",
  maxStockLevel: "", status: "active",
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
  const search = useSearch();
  const [match, params] = useRoute<{ sku: string }>("/inventory/:sku");
  const sku = useMemo(() => {
    const raw = params?.sku ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params?.sku]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustWarehouseId, setAdjustWarehouseId] = useState("");
  const [adjustDelta, setAdjustDelta] = useState<string>("0");
  const [adjustReason, setAdjustReason] = useState(ADJUST_REASONS[0]);
  const [adjustRef, setAdjustRef] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<InventoryEditForm>(emptyEditForm);

  const fetchDetail = useCallback((): Promise<InventoryDetail> => fetchInventoryDetail(sku), [sku]);

  const {
    loading,
    error,
    data,
    refetch,
  } = useAsyncResource(fetchDetail, { immediate: Boolean(match && sku) });

  const warehouseOptions = data?.warehouses ?? [];
  const categoriesQuery = useQuery({
    queryKey: ["/api/categories", "inventory-edit"],
    queryFn: () => requestJson<Array<{ id: number; name: string }>>("GET", "/api/categories"),
  });

  const openEditModal = useCallback((detail: InventoryDetail) => {
    setEditForm({
      name: detail.name ?? "",
      sku: detail.sku ?? "",
      description: detail.description ?? "",
      categoryId: detail.categoryId ? String(detail.categoryId) : "",
      price: String(detail.price ?? 0),
      cost: detail.cost == null ? "" : String(detail.cost),
      lowStockThreshold: String(detail.lowStockThreshold ?? 10),
      location: detail.location ?? "",
      unitOfMeasure: detail.unitOfMeasure ?? "each",
      supplierPartNumber: detail.supplierPartNumber ?? "",
      defaultWarehouseId: detail.defaultWarehouseId ? String(detail.defaultWarehouseId) : "",
      minOrderQuantity: String(detail.minOrderQuantity ?? 1),
      leadTime: detail.leadTime == null ? "" : String(detail.leadTime),
      reorderPoint: detail.reorderPoint == null ? "" : String(detail.reorderPoint),
      maxStockLevel: detail.maxStockLevel == null ? "" : String(detail.maxStockLevel),
      status: detail.status ?? "active",
    });
    setEditError(null);
    setEditOpen(true);
  }, []);

  useEffect(() => {
    if (!data || editOpen) return;
    if (new URLSearchParams(search).get("edit") === "1") {
      setLocation(APP_ROUTES.inventory.item(data.sku), { replace: true });
      openEditModal(data);
    }
  }, [data, editOpen, openEditModal, search, setLocation]);

  const setEditField = (field: keyof InventoryEditForm, value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }));
    setEditError(null);
  };

  const optionalNumber = (value: string): number | null => value.trim() === "" ? null : Number(value);
  const submitItemDetails = async () => {
    if (!data) return;
    if (editForm.name.trim().length < 3 || editForm.sku.trim().length < 2) {
      setEditError("Name must contain at least 3 characters and SKU at least 2 characters.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await requestJson<{ id: number; sku: string; name: string }>("PUT", `/api/inventory/${data.id}`, {
        name: editForm.name.trim(),
        sku: editForm.sku.trim(),
        description: editForm.description.trim() || null,
        categoryId: editForm.categoryId ? Number(editForm.categoryId) : null,
        price: Number(editForm.price),
        cost: optionalNumber(editForm.cost),
        lowStockThreshold: Number(editForm.lowStockThreshold),
        location: editForm.location.trim() || null,
        unitOfMeasure: editForm.unitOfMeasure.trim() || "each",
        supplierPartNumber: editForm.supplierPartNumber.trim() || null,
        defaultWarehouseId: editForm.defaultWarehouseId ? Number(editForm.defaultWarehouseId) : null,
        minOrderQuantity: Number(editForm.minOrderQuantity || 1),
        leadTime: optionalNumber(editForm.leadTime),
        reorderPoint: optionalNumber(editForm.reorderPoint),
        maxStockLevel: optionalNumber(editForm.maxStockLevel),
        status: editForm.status,
      });
      await invalidateInventoryDomain(queryClient);
      setEditOpen(false);
      toast({ title: "Item details updated", description: `${updated.sku} master data was saved. Stock quantities were not changed.` });
      if (updated.sku !== sku) setLocation(APP_ROUTES.inventory.item(updated.sku), { replace: true });
      else await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update inventory item.";
      setEditError(message);
      toast({ title: "Item update failed", description: message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const openAdjustModal = () => {
    const itemDefault = warehouseOptions.find((warehouse) => warehouse.id === data?.defaultWarehouseId);
    setAdjustWarehouseId(itemDefault ? String(itemDefault.id) : warehouseOptions[0] ? String(warehouseOptions[0].id) : "");
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
    const warehouseId = Number(adjustWarehouseId);
    if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
      toast({ title: "Warehouse required", description: "Choose a configured warehouse before adjusting stock.", variant: "destructive" });
      return;
    }

    setAdjusting(true);
    try {
      const response = await apiRequest("POST", `/api/inventory/${encodeURIComponent(sku)}/adjust`, {
        warehouseId,
        delta: numericDelta,
        reason: adjustReason,
        ref: adjustRef || undefined,
      });

      const raw = (await response.json()) as { ok?: boolean; data?: AdjustResponse } | AdjustResponse;
      const payload = raw && typeof raw === "object" && "ok" in raw && raw.ok && raw.data ? raw.data : (raw as AdjustResponse);
      await refetch();
      await invalidateInventoryDomain(queryClient);
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
    <div className="mx-auto max-w-7xl space-y-4" data-testid="inventory-detail-page">
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
            ((summary.onHand ?? 0) - (summary.allocated ?? 0));
          const positions = Array.isArray(detail.positions) ? detail.positions : [];
          const movements = Array.isArray(detail.movements) ? detail.movements : [];
          const defaultWarehouse = detail.warehouses.find((warehouse) => warehouse.id === detail.defaultWarehouseId);
          const stockOutsideDefaultWarehouse = Boolean(
            defaultWarehouse && positions.some((position) => position.onHand !== 0 && position.warehouseId !== defaultWarehouse.id),
          );
          return (
          <>
            <PageHeader
              title={detail.name ?? detail.sku ?? "Item"}
              subtitle={`SKU ${detail.sku ?? "—"}`}
              breadcrumb={<span>Inventory / {detail.sku}</span>}
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => openEditModal(detail)} className="gap-2" data-testid="inventory-edit-item-button">
                    <Pencil className="h-4 w-4" />
                    Edit item details
                  </Button>
                  <Button onClick={openAdjustModal} className="gap-2" disabled={(detail.warehouses?.length ?? 0) === 0}>
                    <ArrowUpDown className="h-4 w-4" />
                    Adjust stock
                  </Button>
                </div>
              }
            />

            {(detail.warehouses?.length ?? 0) === 0 ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Warehouse setup required</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  Stock adjustments require a canonical tenant warehouse. Unassigned master stock remains separate until one is configured.
                  <Button type="button" variant="outline" size="sm" onClick={() => setLocation("/admin/master-data/warehouses")}>Open warehouse administration</Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {Number(detail.unassignedQuantity ?? 0) !== 0 || detail.quantityMismatch ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{detail.quantityMismatch ? "Inventory quantity mismatch" : "Unassigned inventory"}</AlertTitle>
                <AlertDescription>
                  Warehouse stock: {numOrNa(detail.warehouseQuantity)}. Unassigned master stock: {numOrNa(detail.unassignedQuantity)}. Unassigned stock is not treated as warehouse availability.
                </AlertDescription>
              </Alert>
            ) : null}

            {stockOutsideDefaultWarehouse ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Stock is held outside the default warehouse</AlertTitle>
                <AlertDescription>
                  The default warehouse is {defaultWarehouse?.name}, while current canonical positions include other warehouses. This is valid, but receiving defaults do not move existing stock; use Warehouse Operations for an audited transfer.
                </AlertDescription>
              </Alert>
            ) : null}

            {Number(available) < 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Negative available stock</AlertTitle>
                <AlertDescription>
                  This SKU currently has negative available stock and requires operational attention.
                </AlertDescription>
              </Alert>
            ) : null}

            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4"
              data-tour="inventory-detail-summary"
            >
              <Card className="sm:min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">On hand</CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-semibold tabular-nums">{numOrNa(summary.onHand)}</CardContent>
              </Card>
              <Card className="sm:min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Allocated</CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-semibold tabular-nums">{numOrNa(summary.allocated)}</CardContent>
              </Card>
              <Card className="sm:min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Available</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 text-3xl font-semibold tabular-nums">
                  <span>{numOrNa(available)}</span>
                  <StatusBadge
                    status={Number(available) < 0 ? "error" : Number(available) === 0 ? "low" : "active"}
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Item master data</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><p className="text-muted-foreground">Description</p><p className="font-medium break-words">{detail.description || "Not provided"}</p></div>
                <div><p className="text-muted-foreground">Category</p><p className="font-medium">{categoriesQuery.data?.find((category) => category.id === detail.categoryId)?.name ?? "Uncategorised"}</p></div>
                <div><p className="text-muted-foreground">Selling price</p><p className="font-medium tabular-nums">{numOrNa(detail.price)}</p></div>
                <div><p className="text-muted-foreground">Unit cost</p><p className="font-medium tabular-nums">{numOrNa(detail.cost)}</p></div>
                <div><p className="text-muted-foreground">Unit of measure</p><p className="font-medium">{detail.unitOfMeasure || "each"}</p></div>
                <div><p className="text-muted-foreground">Low-stock threshold</p><p className="font-medium tabular-nums">{numOrNa(detail.lowStockThreshold)}</p></div>
                <div><p className="text-muted-foreground">Supplier part number</p><p className="font-medium">{detail.supplierPartNumber || "Not provided"}</p></div>
                <div><p className="text-muted-foreground">Status</p><p className="font-medium capitalize">{detail.status || "active"}</p></div>
                <div><p className="text-muted-foreground">Primary barcode</p><p className="font-mono text-xs break-all">{detail.barcode || "Generated identity unavailable"}</p></div>
                <div><p className="text-muted-foreground">Item default warehouse</p><p className="font-medium">{defaultWarehouse?.name ?? "Not assigned"}</p></div>
                <div><p className="text-muted-foreground">Reorder point / maximum</p><p className="font-medium tabular-nums">{numOrNa(detail.reorderPoint)} / {numOrNa(detail.maxStockLevel)}</p></div>
                <div><p className="text-muted-foreground">Lead time</p><p className="font-medium">{detail.leadTime == null ? "Not provided" : `${detail.leadTime} days`}</p></div>
              </CardContent>
            </Card>

            <Card data-tour="inventory-positions">
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit inventory item</DialogTitle>
            <DialogDescription>Update catalogue and planning information. Use Adjust stock for quantity changes so movements remain auditable.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="item-edit-name">Item name *</Label><Input id="item-edit-name" value={editForm.name} onChange={(e) => setEditField("name", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-sku">SKU *</Label><Input id="item-edit-sku" value={editForm.sku} onChange={(e) => setEditField("sku", e.target.value)} className="font-mono" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="item-edit-description">Description</Label><Textarea id="item-edit-description" value={editForm.description} onChange={(e) => setEditField("description", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-category">Category</Label><Select value={editForm.categoryId || "none"} onValueChange={(value) => setEditField("categoryId", value === "none" ? "" : value)}><SelectTrigger id="item-edit-category" aria-label="Inventory item category"><SelectValue placeholder="No category" /></SelectTrigger><SelectContent><SelectItem value="none">No category</SelectItem>{categoriesQuery.data?.map((category) => <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="item-edit-status">Status</Label><Select value={editForm.status} onValueChange={(value) => setEditField("status", value)}><SelectTrigger id="item-edit-status" aria-label="Inventory item status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="discontinued">Discontinued</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="item-edit-price">Selling price</Label><Input id="item-edit-price" type="number" min="0" step="0.01" value={editForm.price} onChange={(e) => setEditField("price", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-cost">Unit cost</Label><Input id="item-edit-cost" type="number" min="0" step="0.01" value={editForm.cost} onChange={(e) => setEditField("cost", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-location">Default location</Label><Input id="item-edit-location" value={editForm.location} onChange={(e) => setEditField("location", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-default-warehouse">Item default warehouse</Label><Select value={editForm.defaultWarehouseId || "none"} onValueChange={(value) => setEditField("defaultWarehouseId", value === "none" ? "" : value)}><SelectTrigger id="item-edit-default-warehouse" aria-label="Item default warehouse"><SelectValue placeholder="Not assigned" /></SelectTrigger><SelectContent><SelectItem value="none">Not assigned</SelectItem>{warehouseOptions.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="item-edit-uom">Unit of measure</Label><Input id="item-edit-uom" value={editForm.unitOfMeasure} onChange={(e) => setEditField("unitOfMeasure", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-supplier-part">Supplier part number</Label><Input id="item-edit-supplier-part" value={editForm.supplierPartNumber} onChange={(e) => setEditField("supplierPartNumber", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-threshold">Low-stock threshold</Label><Input id="item-edit-threshold" type="number" min="0" step="1" value={editForm.lowStockThreshold} onChange={(e) => setEditField("lowStockThreshold", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-min-order">Minimum order quantity</Label><Input id="item-edit-min-order" type="number" min="1" step="1" value={editForm.minOrderQuantity} onChange={(e) => setEditField("minOrderQuantity", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-reorder">Reorder point</Label><Input id="item-edit-reorder" type="number" min="0" step="1" value={editForm.reorderPoint} onChange={(e) => setEditField("reorderPoint", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-maximum">Maximum stock level</Label><Input id="item-edit-maximum" type="number" min="0" step="1" value={editForm.maxStockLevel} onChange={(e) => setEditField("maxStockLevel", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-lead-time">Lead time (days)</Label><Input id="item-edit-lead-time" type="number" min="0" step="1" value={editForm.leadTime} onChange={(e) => setEditField("leadTime", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="item-edit-barcode">Primary barcode</Label><Input id="item-edit-barcode" value={data?.barcode ?? "Generated automatically"} readOnly /><p className="text-xs text-muted-foreground">Barcode identity is managed automatically and remains linked to this item.</p></div>
          </div>
          {editError ? <Alert variant="destructive"><AlertTitle>Cannot save item</AlertTitle><AlertDescription>{editError}</AlertDescription></Alert> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>Cancel</Button>
            <Button type="button" onClick={() => void submitItemDetails()} disabled={editSaving || !editForm.name.trim() || !editForm.sku.trim()} data-testid="inventory-save-item-button">{editSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save item details</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Label htmlFor="adjust-warehouse">Adjustment warehouse</Label>
              <Select value={adjustWarehouseId} onValueChange={setAdjustWarehouseId}>
                <SelectTrigger id="adjust-warehouse">
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouseOptions.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                      {warehouse.name}
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
            <Button onClick={submitAdjustment} disabled={adjusting || !adjustWarehouseId}>
              {adjusting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Apply adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
