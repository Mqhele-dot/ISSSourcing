import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient, requestJson, unwrapOperationalResponse } from "@/lib/queryClient";
import { invalidateMasterDataDomain } from "@/lib/domain-invalidation";
import type { Warehouse, BinLocation, FormData, WarehousePayload } from "@/pages/warehouses/warehouse-types";
import {
  emptyWarehouseForm,
  validateWarehouseForm,
  warehouseFormToPayload,
} from "@/pages/warehouses/warehouse-types";

export function useWarehouseCrud() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyWarehouseForm());

  const { data: warehousesRaw, isLoading, isError, error, refetch } = useQuery<
    Warehouse[] | { data: Warehouse[]; meta: { fallback?: string } }
  >({
    queryKey: ["/api/warehouses"],
    queryFn: () => requestJson<Warehouse[] | { data: Warehouse[]; meta: { fallback?: string } }>("GET", "/api/warehouses"),
  });
  const { data: warehouseList, fallback: listFallback } = unwrapOperationalResponse(warehousesRaw ?? []);
  if (import.meta.env.DEV && warehouseList != null && !Array.isArray(warehouseList)) {
    console.warn("[useWarehouseCrud] /api/warehouses returned non-array data; showing empty list.");
  }
  const list = Array.isArray(warehouseList) ? warehouseList : [];

  const createWarehouse = useMutation<unknown, Error, WarehousePayload>({
    mutationFn: async (data: WarehousePayload) => requestJson("POST", "/api/warehouses", data),
    onSuccess: (_data, variables) => {
      const createdName = variables.name.trim();
      void invalidateMasterDataDomain(queryClient, "warehouses");
      setIsCreateDialogOpen(false);
      resetForm();
      toast({
        title: "Warehouse created",
        description: "Warehouse has been created successfully",
      });
      queryClient
        .fetchQuery({ queryKey: ["/api/warehouses"] })
        .then((fetched: unknown) => {
          const arr = Array.isArray(fetched) ? fetched : [];
          if (!arr.some((w: { name?: string }) => w.name === createdName)) {
            toast({
              variant: "destructive",
              title: "Created but not visible yet",
              description: "Check backend persistence.",
            });
          }
        })
        .catch(() => {});
    },
    onError: (err: Error, data: WarehousePayload | undefined) => {
      toast({
        variant: "destructive",
        title: "Failed to create warehouse (POST /api/warehouses)",
        description: err.message,
        action:
          data != null ? (
            <ToastAction altText="Retry" onClick={() => createWarehouse.mutate(data)}>
              Retry
            </ToastAction>
          ) : undefined,
      });
    },
  });

  const updateWarehouse = useMutation<unknown, Error, { id: number; data: WarehousePayload }>({
    mutationFn: async ({ id, data }: { id: number; data: WarehousePayload }) =>
      requestJson("PATCH", `/api/warehouses/${id}`, data),
    onSuccess: () => {
      void invalidateMasterDataDomain(queryClient, "warehouses");
      setIsEditDialogOpen(false);
      setSelectedWarehouse(null);
      toast({
        title: "Warehouse updated",
        description: "Warehouse has been updated successfully",
      });
    },
    onError: (err: Error, vars: { id: number; data: WarehousePayload } | undefined) => {
      toast({
        variant: "destructive",
        title: `Failed to update warehouse (PATCH /api/warehouses/${vars?.id ?? selectedWarehouse?.id ?? "?"})`,
        description: err.message,
        action: vars ? (
          <ToastAction altText="Retry" onClick={() => updateWarehouse.mutate(vars)}>
            Retry
          </ToastAction>
        ) : undefined,
      });
    },
  });

  const deleteWarehouse = useMutation<boolean, Error, number>({
    mutationFn: async (id: number) => {
      await requestJson("DELETE", `/api/warehouses/${id}`);
      return true;
    },
    onSuccess: () => {
      void invalidateMasterDataDomain(queryClient, "warehouses");
      setIsDeleteDialogOpen(false);
      setSelectedWarehouse(null);
      toast({
        title: "Warehouse deleted",
        description: "Warehouse has been deleted successfully",
      });
    },
    onError: (err: Error, id: number | undefined) => {
      toast({
        variant: "destructive",
        title: `Failed to delete warehouse (DELETE /api/warehouses/${id ?? selectedWarehouse?.id ?? "?"})`,
        description: err.message,
        action:
          id != null ? (
            <ToastAction altText="Retry" onClick={() => deleteWarehouse.mutate(id)}>
              Retry
            </ToastAction>
          ) : undefined,
      });
    },
  });

  const resetForm = () => {
    setFormData(emptyWarehouseForm());
  };

  const handleCreateSubmit = () => {
    const err = validateWarehouseForm(formData);
    if (err) {
      toast({ variant: "destructive", title: "Validation", description: err });
      return;
    }
    createWarehouse.mutate(warehouseFormToPayload(formData));
  };

  const handleEditSubmit = () => {
    if (!selectedWarehouse) return;
    const err = validateWarehouseForm(formData);
    if (err) {
      toast({ variant: "destructive", title: "Validation", description: err });
      return;
    }
    updateWarehouse.mutate({
      id: selectedWarehouse.id,
      data: warehouseFormToPayload(formData),
    });
  };

  const handleDeleteConfirm = () => {
    if (selectedWarehouse) {
      deleteWarehouse.mutate(selectedWarehouse.id);
    }
  };

  const openEditDialog = (warehouse: Warehouse) => {
    setSelectedWarehouse(warehouse);
    const aislesList = warehouse.aisles ?? [];
    const details = warehouse.locationDetails;
    setFormData({
      name: warehouse.name,
      address: warehouse.address || "",
      location: warehouse.location || "",
      contactPerson: warehouse.contactPerson || "",
      contactPhone: warehouse.contactPhone || "",
      isDefault: warehouse.isDefault || false,
      aisles: Array.isArray(aislesList) ? aislesList.join(", ") : "",
      bins: (warehouse.bins ?? []).map((b) =>
        typeof b === "object" ? b : { code: String(b), aisle: "", row: "", shelf: "" },
      ),
      locationDetails:
        details && typeof details === "object"
          ? JSON.stringify(details, null, 2)
          : typeof details === "string"
            ? details
            : "",
    });
    setIsEditDialogOpen(true);
  };

  const addBin = () => {
    setFormData({ ...formData, bins: [...formData.bins, { code: "", aisle: "", row: "", shelf: "" }] });
  };

  const updateBin = (index: number, field: keyof BinLocation, value: string) => {
    const next = [...formData.bins];
    next[index] = { ...next[index], [field]: value };
    setFormData({ ...formData, bins: next });
  };

  const removeBin = (index: number) => {
    setFormData({ ...formData, bins: formData.bins.filter((_, i) => i !== index) });
  };

  const openDeleteDialog = (warehouse: Warehouse) => {
    setSelectedWarehouse(warehouse);
    setIsDeleteDialogOpen(true);
  };

  return {
    list,
    listFallback,
    isLoading,
    isError,
    error,
    refetch,
    formData,
    setFormData,
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    selectedWarehouse,
    createWarehouse,
    updateWarehouse,
    deleteWarehouse,
    resetForm,
    openEditDialog,
    openDeleteDialog,
    addBin,
    updateBin,
    removeBin,
    handleCreateSubmit,
    handleEditSubmit,
    handleDeleteConfirm,
  };
}
