import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient, requestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { type Supplier, type SupplierLogo } from "@shared/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import TutorialStep from "@/components/ui/tutorial-button";
import { Can } from "@/components/auth/can";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/page-header";
import { useSuppliersCoreQueries } from "@/pages/suppliers/use-suppliers-core-queries";
import { SuppliersListCard } from "@/pages/suppliers/suppliers-list-card";
import { SupplierLogoDialogs, type SupplierLogoForm } from "@/pages/suppliers/supplier-logo-dialogs";
import { SupplierFormSheet } from "@/pages/suppliers/supplier-form-sheet";
import {
  supplierFormSchema,
  type SupplierFormValues,
  emptySupplierFormValues,
} from "@/pages/suppliers/supplier-form-types";

export default function SuppliersPage() {
  const { toast } = useToast();
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [deleteConfirmSupplier, setDeleteConfirmSupplier] = useState<Supplier | null>(null);
  const [removeLogoConfirm, setRemoveLogoConfirm] = useState(false);
  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false);

  const { suppliersQuery, paymentTermsQuery, currenciesQuery, performanceQuery } = useSuppliersCoreQueries();
  const { data: suppliers, isLoading, isError, error, refetch } = suppliersQuery;
  const { data: paymentTerms = [] } = paymentTermsQuery;
  const { data: currencies = [] } = currenciesQuery;
  const { data: performance = [] } = performanceQuery;

  // Get logo for selected supplier
  const { data: selectedLogo, isLoading: isLogoLoading } = useQuery<SupplierLogo | null>({
    queryKey: ['/api/suppliers', selectedSupplierId, 'logo'],
    queryFn: async () => {
      if (!selectedSupplierId) {
        return null;
      }
      try {
        return await requestJson<SupplierLogo>("GET", `/api/suppliers/${selectedSupplierId}/logo`);
      } catch {
        return null;
      }
    },
    enabled: !!selectedSupplierId,
    retry: 0,
  });

  // Create supplier
  const createSupplier = useMutation({
    mutationFn: (supplier: SupplierFormValues) => 
      requestJson<Supplier>('POST', '/api/suppliers', supplier),
    onSuccess: () => {
      toast({
        title: "Supplier created",
        description: "The supplier has been added successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      setSupplierSheetOpen(false);
    },
    onError: (error, data) => {
      toast({
        title: "Error creating supplier",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: data && (
          <ToastAction altText="Retry" onClick={() => createSupplier.mutate(data)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  // Update supplier
  const updateSupplier = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SupplierFormValues> }) => 
      requestJson<Supplier>('PATCH', `/api/suppliers/${id}`, data),
    onSuccess: (_, variables) => {
      toast({
        title: "Supplier updated",
        description: "The supplier has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.id] });
      setSupplierSheetOpen(false);
    },
    onError: (error, vars) => {
      toast({
        title: "Error updating supplier",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: vars && (
          <ToastAction altText="Retry" onClick={() => updateSupplier.mutate(vars)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  // Delete supplier
  const deleteSupplier = useMutation({
    mutationFn: (id: number) => 
      requestJson<{ success: boolean }>('DELETE', `/api/suppliers/${id}`),
    onSuccess: () => {
      toast({
        title: "Supplier deleted",
        description: "The supplier has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      setSelectedSupplierId(null);
    },
    onError: (error, id) => {
      toast({
        title: "Error deleting supplier",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: id != null ? (
          <ToastAction altText="Retry" onClick={() => deleteSupplier.mutate(id)}>
            Retry
          </ToastAction>
        ) : undefined,
      });
    },
  });

  // Create logo
  const createLogo = useMutation({
    mutationFn: ({ supplierId, logoUrl }: { supplierId: number; logoUrl: string }) => 
      requestJson<SupplierLogo>('POST', `/api/suppliers/${supplierId}/logo`, { logoUrl }),
    onSuccess: (_, variables) => {
      toast({
        title: "Logo added",
        description: "The supplier logo has been added successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.supplierId, 'logo'] });
      setLogoDialogOpen(false);
    },
    onError: (error, vars) => {
      toast({
        title: "Error adding logo",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: vars && (
          <ToastAction altText="Retry" onClick={() => createLogo.mutate(vars)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  // Update logo
  const updateLogo = useMutation({
    mutationFn: ({ supplierId, logoUrl }: { supplierId: number; logoUrl: string }) => 
      requestJson<SupplierLogo>('PUT', `/api/suppliers/${supplierId}/logo`, { logoUrl }),
    onSuccess: (_, variables) => {
      toast({
        title: "Logo updated",
        description: "The supplier logo has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.supplierId, 'logo'] });
      setLogoDialogOpen(false);
    },
    onError: (error, vars) => {
      toast({
        title: "Error updating logo",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: vars && (
          <ToastAction altText="Retry" onClick={() => updateLogo.mutate(vars)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  // Delete logo
  const deleteLogo = useMutation({
    mutationFn: (supplierId: number) => 
      requestJson<{ success: boolean }>('DELETE', `/api/suppliers/${supplierId}/logo`),
    onSuccess: (_, supplierId) => {
      toast({
        title: "Logo removed",
        description: "The supplier logo has been removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', supplierId, 'logo'] });
    },
    onError: (error, supplierId) => {
      toast({
        title: "Error removing logo",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: supplierId != null ? (
          <ToastAction altText="Retry" onClick={() => deleteLogo.mutate(supplierId)}>
            Retry
          </ToastAction>
        ) : undefined,
      });
    },
  });

  // Create or update supplier form
  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: emptySupplierFormValues(),
  });

  // Logo form
  const logoForm = useForm<SupplierLogoForm>({
    defaultValues: {
      logoUrl: "",
    },
  });

  // Edit supplier
  const openCreateSupplierSheet = () => {
    setSelectedSupplierId(null);
    form.reset(emptySupplierFormValues());
    setSupplierSheetOpen(true);
  };

  const handleEditSupplier = (supplier: Supplier) => {
    form.reset({
      name: supplier.name,
      contactName: supplier.contactName || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
      taxIdentificationNumber: (supplier as { taxIdentificationNumber?: string }).taxIdentificationNumber || "",
      bankName: (supplier as { bankName?: string | null }).bankName || "",
      bankAccountNumber: (supplier as { bankAccountNumber?: string | null }).bankAccountNumber || "",
      bankSwift: (supplier as { bankSwift?: string | null }).bankSwift || "",
      paymentTermsId: (supplier as { paymentTermsId?: number | null }).paymentTermsId ?? null,
      defaultCurrencyCode: (supplier as { defaultCurrencyCode?: string | null }).defaultCurrencyCode || "",
      insuranceExpiry: ((supplier as { insuranceExpiry?: Date | string | null }).insuranceExpiry
        ? new Date((supplier as { insuranceExpiry?: Date | string | null }).insuranceExpiry as Date | string)
            .toISOString()
            .slice(0, 10)
        : ""),
      complianceNotes: (supplier as { complianceNotes?: string | null }).complianceNotes || "",
      notes: supplier.notes || "",
    });
    setSelectedSupplierId(supplier.id);
    setSupplierSheetOpen(true);
  };

  const toSupplierPayload = (data: SupplierFormValues): SupplierFormValues => ({
    ...data,
    contactName: data.contactName?.trim() || null,
    email: data.email?.trim() || null,
    phone: data.phone?.trim() || null,
    address: data.address?.trim() || null,
    taxIdentificationNumber: data.taxIdentificationNumber?.trim() || null,
    bankName: data.bankName?.trim() || null,
    bankAccountNumber: data.bankAccountNumber?.trim() || null,
    bankSwift: data.bankSwift?.trim() || null,
    paymentTermsId: data.paymentTermsId ?? null,
    defaultCurrencyCode: data.defaultCurrencyCode?.trim() || null,
    insuranceExpiry: data.insuranceExpiry?.trim() || null,
    complianceNotes: data.complianceNotes?.trim() || null,
    notes: data.notes?.trim() || null,
  });

  // Create supplier
  const handleCreateSupplier = (data: SupplierFormValues) => {
    createSupplier.mutate(toSupplierPayload(data));
    form.reset();
  };

  // Update supplier
  const handleUpdateSupplier = (data: SupplierFormValues) => {
    if (selectedSupplierId) {
      updateSupplier.mutate({ id: selectedSupplierId, data: toSupplierPayload(data) });
    }
  };

  // Delete supplier (confirmation via AlertDialog)
  const handleDeleteSupplier = (supplier: Supplier) => {
    setDeleteConfirmSupplier(supplier);
  };
  const confirmDeleteSupplier = () => {
    if (!deleteConfirmSupplier) return;
    deleteSupplier.mutate(deleteConfirmSupplier.id, {
      onSettled: () => setDeleteConfirmSupplier(null),
    });
  };

  // Handle logo form submission
  const handleLogoSubmit = (data: SupplierLogoForm) => {
    if (!selectedSupplierId) return;
    
    if (selectedLogo) {
      updateLogo.mutate({ supplierId: selectedSupplierId, logoUrl: data.logoUrl });
    } else {
      createLogo.mutate({ supplierId: selectedSupplierId, logoUrl: data.logoUrl });
    }
  };

  // Open logo dialog
  const handleOpenLogoDialog = (supplier: Supplier) => {
    setSelectedSupplierId(supplier.id);
    setLogoDialogOpen(true);
    
    // Reset form with existing logo URL if available
    if (selectedLogo) {
      logoForm.reset({ logoUrl: selectedLogo.logoUrl });
    } else {
      logoForm.reset({ logoUrl: "" });
    }
  };

  const paymentTermsById = new Map(paymentTerms.map((term) => [term.id, `${term.code} - ${term.name}`]));
  const performanceBySupplier = new Map(performance.map((row) => [row.supplierId, row]));

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Manage your suppliers and their information"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add suppliers">
              <Button type="button" onClick={openCreateSupplierSheet}>
                <Plus className="mr-2 h-4 w-4" />
                Add supplier
              </Button>
            </Can>
            <TutorialStep page="suppliers" />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6">
        <SuppliersListCard
          isLoading={isLoading}
          isError={isError}
          error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
          suppliers={suppliers}
          refetch={refetch}
          selectedSupplierId={selectedSupplierId}
          selectedLogo={selectedLogo ?? null}
          paymentTermsById={paymentTermsById}
          performanceBySupplier={performanceBySupplier}
          onAddSupplier={openCreateSupplierSheet}
          onEditSupplier={handleEditSupplier}
          onDeleteSupplier={handleDeleteSupplier}
          onOpenLogoDialog={handleOpenLogoDialog}
        />
      </div>

      <SupplierFormSheet
        open={supplierSheetOpen}
        onOpenChange={setSupplierSheetOpen}
        selectedSupplierId={selectedSupplierId}
        setSelectedSupplierId={setSelectedSupplierId}
        form={form}
        paymentTerms={paymentTerms}
        currencies={currencies}
        onCreate={handleCreateSupplier}
        onUpdate={handleUpdateSupplier}
        createPending={createSupplier.isPending}
        updatePending={updateSupplier.isPending}
      />

      <SupplierLogoDialogs
        removeLogoConfirm={removeLogoConfirm}
        setRemoveLogoConfirm={setRemoveLogoConfirm}
        selectedSupplierId={selectedSupplierId}
        deleteLogo={deleteLogo}
        setLogoDialogOpen={setLogoDialogOpen}
        logoDialogOpen={logoDialogOpen}
        selectedLogo={selectedLogo ?? undefined}
        logoForm={logoForm}
        handleLogoSubmit={handleLogoSubmit}
      />

      {/* Delete supplier confirmation */}
      <AlertDialog open={!!deleteConfirmSupplier} onOpenChange={(open) => !open && setDeleteConfirmSupplier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmSupplier
                ? `This will permanently remove "${deleteConfirmSupplier.name}". This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteSupplier}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}