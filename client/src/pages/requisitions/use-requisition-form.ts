import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, normalizeApiList, requestJson } from "@/lib/queryClient";
import type { PurchaseRequisition, PurchaseRequisitionItem, Supplier, InventoryItem } from "@shared/schema";
import { invalidateRequisitionDomain } from "@/lib/domain-invalidation";
import { inventoryCatalogQueryKey } from "@/lib/query-keys";
import type { ReqLineDraft } from "@/pages/requisitions/requisition-lines-editor";

export type RequisitionFieldErrors = Partial<
  Record<"supplierId" | "departmentId" | "requiredDate" | "items" | "projectId", string>
>;

const LOCKED_REQUISITION_STATUSES = new Set(["APPROVED", "CONVERTED", "CLOSED", "CANCELLED"]);

function lockedReasonForStatus(status: unknown): string {
  const normalized = String(status || "").trim().toUpperCase();
  if (!LOCKED_REQUISITION_STATUSES.has(normalized)) return "";
  if (normalized === "APPROVED") return "This requisition is approved and locked to preserve approval history.";
  if (normalized === "CONVERTED") return "This requisition has been converted to a purchase order and can no longer be edited.";
  if (normalized === "CLOSED") return "This requisition is closed and no longer accepts changes.";
  return "This requisition is cancelled and no longer accepts changes.";
}

export function useRequisitionForm(params: {
  id: number | null;
  isNew: boolean;
  listPath: string;
  setLocation: (path: string) => void;
}) {
  const { id, isNew, listPath, setLocation } = params;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [notes, setNotes] = useState("");
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [justification, setJustification] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [items, setItems] = useState<ReqLineDraft[]>([{ itemId: 0, quantity: 1, unitPrice: 0 }]);
  const [fieldErrors, setFieldErrors] = useState<RequisitionFieldErrors>({});

  const { data: requisition, isLoading } = useQuery({
    queryKey: ["/api/purchase-requisitions", id],
    queryFn: () =>
      requestJson<
        PurchaseRequisition & { items?: (PurchaseRequisitionItem & { itemName?: string; sku?: string })[] }
      >("GET", `/api/purchase-requisitions/${id}`),
    enabled: !!id && !isNew,
  });
  const lockedReason = !isNew ? lockedReasonForStatus(requisition?.status) : "";
  const isLocked = Boolean(lockedReason);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/suppliers");
      return normalizeApiList<Supplier>(raw);
    },
  });

  const { data: inventoryItems = [] } = useQuery({
    queryKey: inventoryCatalogQueryKey,
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

  const { data: extensionProjects = [] } = useQuery({
    queryKey: ["/api/extensions/projects"],
    queryFn: async () => {
      try {
        const raw = await requestJson<unknown>("GET", "/api/extensions/projects");
        return normalizeApiList<{ id: number; code: string; name: string }>(raw);
      } catch {
        return [];
      }
    },
    retry: false,
  });

  const { data: currencies = [] } = useQuery({
    queryKey: ["/api/currencies"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/currencies");
      return normalizeApiList<{ code: string; name: string }>(raw);
    },
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ["/api/contracts"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/contracts");
      return normalizeApiList<{ id: number; title: string; supplierId: number }>(raw);
    },
  });

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ["/api/payment-terms"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/payment-terms");
      return normalizeApiList<{ id: number; code: string; name: string }>(raw);
    },
  });

  const { data: incoterms = [] } = useQuery({
    queryKey: ["/api/incoterms"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/incoterms");
      return normalizeApiList<{ id: number; code: string; name: string }>(raw);
    },
  });

  const { data: taxCodes = [] } = useQuery({
    queryKey: ["/api/tax-codes"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/tax-codes");
      return normalizeApiList<{ id: number; code: string; name: string }>(raw);
    },
  });

  const contractsForSupplier = useMemo(() => {
    if (supplierId === "") return [];
    return contracts.filter((c) => c.supplierId === supplierId);
  }, [contracts, supplierId]);

  const departmentLabel = useMemo(() => {
    if (departmentId === "") return undefined;
    const d = departments.find((x) => x.id === departmentId);
    return d ? `${d.code} — ${d.name}` : undefined;
  }, [departments, departmentId]);

  useEffect(() => {
    if (requisition) {
      setNotes(requisition.notes ?? "");
      setSupplierId(requisition.supplierId ?? "");
      setDepartmentId((requisition as PurchaseRequisition & { departmentId?: number | null }).departmentId ?? "");
      setJustification((requisition as PurchaseRequisition & { justification?: string | null }).justification ?? "");
      setRequiredDate(requisition.requiredDate ? new Date(requisition.requiredDate).toISOString().slice(0, 10) : "");
      setProjectId((requisition as PurchaseRequisition & { projectId?: number | null }).projectId ?? "");
      if (requisition.items?.length) {
        setItems(
          requisition.items.map((i) => ({
            id: i.id,
            itemId: i.itemId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            notes: i.notes ?? undefined,
          })),
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
        projectId: projectId === "" ? undefined : Number(projectId),
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
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      await invalidateRequisitionDomain(queryClient);
      toast({ title: "Requisition created", variant: "default" });
      setLocation(listPath);
    },
    onError: (e) => {
      toast({ title: "Create failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (isLocked) {
        throw new Error(lockedReason || "This requisition is locked.");
      }
      const validItems = items
        .filter((i) => i.itemId > 0 && i.quantity > 0 && Number(i.unitPrice) > 0)
        .map((i) => ({
          id: i.id,
          itemId: i.itemId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          notes: i.notes,
        }));
      const body = {
        notes: notes || undefined,
        supplierId: supplierId || undefined,
        departmentId: departmentId || undefined,
        justification: justification || undefined,
        requiredDate: requiredDate ? new Date(requiredDate).toISOString() : undefined,
        projectId: projectId === "" ? undefined : Number(projectId),
        items: validItems,
        revisionReason: "Line revision saved from requisition edit form",
      };
      await apiRequest("PUT", `/api/purchase-requisitions/${id}`, body);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      await invalidateRequisitionDomain(queryClient);
      toast({ title: "Requisition updated", variant: "default" });
    },
    onError: (e) => {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  const addItem = useCallback(() => setItems((prev) => [...prev, { itemId: 0, quantity: 1, unitPrice: 0 }]), []);
  const removeItem = useCallback((idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx)), []);
  const updateItem = useCallback((idx: number, field: keyof ReqLineDraft, value: number | string) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (isLocked) {
      toast({
        title: "Requisition is locked",
        description: lockedReason,
        variant: "destructive",
      });
      return;
    }
    const nextErrors: RequisitionFieldErrors = {};
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
  }, [supplierId, departmentId, requiredDate, items, isNew, createMutation, updateMutation, toast, isLocked, lockedReason]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  return {
    requisition,
    isLoading,
    suppliers,
    inventoryItems,
    departments,
    extensionProjects,
    projectId,
    setProjectId,
    notes,
    setNotes,
    supplierId,
    setSupplierId,
    departmentId,
    setDepartmentId,
    justification,
    setJustification,
    requiredDate,
    setRequiredDate,
    items,
    fieldErrors,
    addItem,
    removeItem,
    updateItem,
    handleSubmit,
    isPending,
    isLocked,
    lockedReason,
    currencies,
    contractsForSupplier,
    paymentTerms,
    incoterms,
    taxCodes,
    departmentLabel,
  };
}
