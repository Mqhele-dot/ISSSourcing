import { useState, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, requestJson } from "@/lib/queryClient";
import type { PurchaseRequisition, PurchaseRequisitionItem, Supplier, InventoryItem } from "@shared/schema";

interface ReqItem {
  itemId: number;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

/** Parse requisition form route: /requisitions/:id, /purchase/requisitions/:id, or /orders/requisitions/:id */
function useRequisitionFormRoute(): { id: number | null; isNew: boolean; listPath: string } {
  const [path] = useLocation();
  const [, paramsReq] = useRoute<{ id: string }>("/requisitions/:id");
  const [, paramsPurchase] = useRoute<{ id: string }>("/purchase/requisitions/:id");
  const [, paramsOrders] = useRoute<{ id: string }>("/orders/requisitions/:id");
  const params = paramsReq ?? paramsPurchase ?? paramsOrders;
  const idParam = params?.id;
  const id = idParam && idParam !== "new" ? parseInt(idParam, 10) : null;
  const isNew = !idParam || idParam === "new";
  const listPath = path.startsWith("/orders") ? "/orders/requisitions" : path.startsWith("/purchase") ? "/purchase/requisitions" : "/requisitions";
  return { id: id != null && !isNaN(id) ? id : null, isNew, listPath };
}

export default function RequisitionFormPage() {
  const { id, isNew, listPath } = useRequisitionFormRoute();
  const [, setLocation] = useLocation();

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [requiredDate, setRequiredDate] = useState("");
  const [items, setItems] = useState<ReqItem[]>([{ itemId: 0, quantity: 1, unitPrice: 0 }]);

  const { data: requisition, isLoading } = useQuery({
    queryKey: ["/api/purchase-requisitions", id],
    queryFn: () => requestJson<PurchaseRequisition & { items?: (PurchaseRequisitionItem & { itemName?: string; sku?: string })[] }>("GET", `/api/purchase-requisitions/${id}`),
    enabled: !!id && !isNew,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: () => requestJson<Supplier[]>("GET", "/api/suppliers"),
  });

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: () => requestJson<InventoryItem[]>("GET", "/api/inventory"),
  });

  useEffect(() => {
    if (requisition) {
      setNotes(requisition.notes ?? "");
      setSupplierId(requisition.supplierId ?? "");
      setRequiredDate(requisition.requiredDate ? new Date(requisition.requiredDate).toISOString().slice(0, 10) : "");
      if (requisition.items?.length) {
        setItems(
          requisition.items.map((i) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            notes: i.notes ?? undefined,
          }))
        );
      }
    }
  }, [requisition]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        notes: notes || undefined,
        supplierId: supplierId || undefined,
        requiredDate: requiredDate ? new Date(requiredDate).toISOString() : undefined,
        items: items
          .filter((i) => i.itemId > 0 && i.quantity > 0)
          .map((i) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            notes: i.notes,
          })),
      };
      const res = await apiRequest("POST", "/api/purchase-requisitions", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition created", variant: "default" });
      setLocation(listPath);
    },
    onError: (e) => {
      toast({ title: "Create failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const body = {
        notes: notes || undefined,
        supplierId: supplierId || undefined,
        requiredDate: requiredDate ? new Date(requiredDate).toISOString() : undefined,
      };
      await apiRequest("PUT", `/api/purchase-requisitions/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition updated", variant: "default" });
    },
    onError: (e) => {
      toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const addItem = () => setItems((prev) => [...prev, { itemId: 0, quantity: 1, unitPrice: 0 }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof ReqItem, value: number | string) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleSubmit = () => {
    if (items.filter((i) => i.itemId > 0 && i.quantity > 0).length === 0) {
      toast({ title: "Add at least one item", variant: "destructive" });
      return;
    }
    if (isNew) createMutation.mutate();
    else updateMutation.mutate();
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={isNew ? "New Requisition" : `Edit ${requisition?.requisitionNumber ?? ""}`}
        subtitle={isNew ? "Create a purchase requisition" : "Update requisition details"}
        breadcrumb={
          <Link href={listPath} className="text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Requisitions
          </Link>
        }
      />

      {!isNew && isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Select value={String(supplierId)} onValueChange={(v) => setSupplierId(v ? Number(v) : "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Required date</Label>
              <Input
                type="date"
                value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          {isNew && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Items</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add item
                </Button>
              </div>
              <div className="space-y-4">
                {items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-end">
                    <div className="flex-1 space-y-2">
                      <Label>Item</Label>
                      <Select
                        value={item.itemId ? String(item.itemId) : ""}
                        onValueChange={(v) => updateItem(idx, "itemId", v ? Number(v) : 0)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select item..." />
                        </SelectTrigger>
                        <SelectContent>
                          {inventoryItems.map((i) => (
                            <SelectItem key={i.id} value={String(i.id)}>
                              {i.name} ({i.sku})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24 space-y-2">
                      <Label>Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                      />
                    </div>
                    <div className="w-28 space-y-2">
                      <Label>Unit price</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.unitPrice}
                        onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                      />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isNew ? "Create" : "Update"}
            </Button>
            <Button variant="outline" asChild>
              <Link href={listPath}>Cancel</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
