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
import { apiRequest, normalizeApiList, requestJson } from "@/lib/queryClient";
import type { PurchaseRequisition, PurchaseRequisitionItem, Supplier, InventoryItem } from "@shared/schema";
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";

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
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [justification, setJustification] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [items, setItems] = useState<ReqItem[]>([{ itemId: 0, quantity: 1, unitPrice: 0 }]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"supplierId" | "departmentId" | "requiredDate" | "items", string>>>({});

  const { data: requisition, isLoading } = useQuery({
    queryKey: ["/api/purchase-requisitions", id],
    queryFn: () => requestJson<PurchaseRequisition & { items?: (PurchaseRequisitionItem & { itemName?: string; sku?: string })[] }>("GET", `/api/purchase-requisitions/${id}`),
    enabled: !!id && !isNew,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/suppliers");
      return normalizeApiList<Supplier>(raw);
    },
  });

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/inventory");
      return normalizeApiList<InventoryItem>(raw);
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["/api/departments"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/departments");
      return normalizeApiList<{ id: number; code: string; name: string }>(raw);
    },
  });

  useEffect(() => {
    if (requisition) {
      setNotes(requisition.notes ?? "");
      setSupplierId(requisition.supplierId ?? "");
      setDepartmentId((requisition as PurchaseRequisition & { departmentId?: number | null }).departmentId ?? "");
      setJustification((requisition as PurchaseRequisition & { justification?: string | null }).justification ?? "");
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
        departmentId: departmentId || undefined,
        justification: justification || undefined,
        requiredDate: requiredDate ? new Date(requiredDate).toISOString() : undefined,
        items: items
          .filter((i) => i.itemId > 0 && i.quantity > 0 && Number(i.unitPrice) > 0)
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
      toast({ title: "Create failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const body = {
        notes: notes || undefined,
        supplierId: supplierId || undefined,
        departmentId: departmentId || undefined,
        justification: justification || undefined,
        requiredDate: requiredDate ? new Date(requiredDate).toISOString() : undefined,
      };
      await apiRequest("PUT", `/api/purchase-requisitions/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition updated", variant: "default" });
    },
    onError: (e) => {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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
    const nextErrors: Partial<Record<"supplierId" | "departmentId" | "requiredDate" | "items", string>> = {};
    if (!supplierId) nextErrors.supplierId = "Supplier is required";
    if (!departmentId) nextErrors.departmentId = "Department is required";
    if (!requiredDate) nextErrors.requiredDate = "Required date is required";
    const validItems = items.filter((i) => i.itemId > 0 && i.quantity > 0 && Number(i.unitPrice) > 0);
    if (validItems.length === 0) {
      nextErrors.items = "Add at least one valid item with qty > 0 and unit price > 0";
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.items) {
        toast({ title: nextErrors.items, variant: "destructive" });
      } else {
        toast({ title: "Please fix highlighted fields", variant: "destructive" });
      }
      return;
    }
    if (validItems.length === 0) {
      const hasItems = items.some((i) => i.itemId > 0);
      if (!hasItems) {
        toast({ title: "Add at least one item", variant: "destructive" });
      } else if (items.some((i) => i.itemId > 0 && i.quantity <= 0)) {
        toast({ title: "Quantity must be greater than zero for each item", variant: "destructive" });
      } else {
        toast({ title: "Unit price must be greater than zero for each item", variant: "destructive" });
      }
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
        <div className="space-y-6" role="form" aria-label="Purchase requisition form">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="req-supplier">Supplier *</Label>
              <Select value={String(supplierId)} onValueChange={(v) => setSupplierId(v ? Number(v) : "")}>
                <SelectTrigger id="req-supplier" aria-label="Select supplier">
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
              {fieldErrors.supplierId ? <p className="text-xs text-destructive">{fieldErrors.supplierId}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="req-department">Department</Label>
              <Select value={String(departmentId)} onValueChange={(v) => setDepartmentId(v ? Number(v) : "")}>
                <SelectTrigger id="req-department" aria-label="Select department">
                  <SelectValue placeholder="Select department..." />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.code} - {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.departmentId ? <p className="text-xs text-destructive">{fieldErrors.departmentId}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="req-required-date">Required date *</Label>
              <Input
                id="req-required-date"
                aria-label="Required date"
                type="date"
                value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)}
              />
              {fieldErrors.requiredDate ? <p className="text-xs text-destructive">{fieldErrors.requiredDate}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="req-justification">Justification</Label>
            <Textarea
              id="req-justification"
              aria-label="Requisition justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="req-notes">Notes</Label>
            <Textarea id="req-notes" aria-label="Requisition notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          {isNew && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label id="req-items-label">Items</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem} aria-label="Add item row">
                  <Plus className="mr-2 h-4 w-4" />
                  Add item
                </Button>
              </div>
              <div className="space-y-4" role="group" aria-labelledby="req-items-label">
                {items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-end">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor={"req-item-" + idx}>Item *</Label>
                      <Select
                        value={item.itemId ? String(item.itemId) : ""}
                        onValueChange={(v) => updateItem(idx, "itemId", v ? Number(v) : 0)}
                      >
                        <SelectTrigger id={"req-item-" + idx} aria-label={"Select item for line " + (idx + 1)}>
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
                      <Label htmlFor={"req-qty-" + idx}>Qty *</Label>
                      <Input
                        id={"req-qty-" + idx}
                        aria-label={"Quantity for line " + (idx + 1)}
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                      />
                    </div>
                    <div className="w-28 space-y-2">
                      <Label htmlFor={"req-unitprice-" + idx}>Unit price *</Label>
                      <Input
                        id={"req-unitprice-" + idx}
                        aria-label={"Unit price for line " + (idx + 1)}
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.unitPrice}
                        onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                      />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} aria-label={"Remove item line " + (idx + 1)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              {fieldErrors.items ? <p className="text-xs text-destructive">{fieldErrors.items}</p> : null}
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
          {!isNew && id ? (
            <EntityDocumentsCard
              entityType="requisition"
              entityId={id}
              title="Requisition Attachments"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
