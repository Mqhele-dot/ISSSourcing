import { useEffect, useState } from "react";
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
import { PanelInlineError } from "@/components/panel-inline-error";
import { useSuppliersCoreQueries } from "@/pages/suppliers/use-suppliers-core-queries";
import { SuppliersListCard } from "@/pages/suppliers/suppliers-list-card";
import { SupplierLogoDialogs, type SupplierLogoForm } from "@/pages/suppliers/supplier-logo-dialogs";
import { SupplierFormSheet } from "@/pages/suppliers/supplier-form-sheet";
import {
  supplierFormSchema,
  type SupplierFormValues,
  emptySupplierFormValues,
} from "@/pages/suppliers/supplier-form-types";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
import { invalidateSupplierDomain } from "@/lib/domain-invalidation";

function queryErrorDetail(e: unknown): string {
  if (e == null) return "";
  const err = e as Error & { requestId?: string };
  const rid = typeof err.requestId === "string" ? err.requestId.trim() : "";
  const msg = err instanceof Error && err.message ? err.message : String(e);
  return rid ? `${msg} Request ID: ${rid}.` : msg;
}

export default function SuppliersPage() {
  const { toast } = useToast();
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [deleteConfirmSupplier, setDeleteConfirmSupplier] = useState<Supplier | null>(null);
  const [removeLogoConfirm, setRemoveLogoConfirm] = useState(false);
  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false);

  const productSetupComplete = useProductSetupComplete();
  const {
    suppliersQuery,
    paymentTermsQuery,
    currenciesQuery,
    carriersQuery,
    taxCodesQuery,
    incotermsQuery,
    departmentsQuery,
    contractsQuery,
    performanceQuery,
  } = useSuppliersCoreQueries();
  const { data: suppliers, isLoading, isError, error, refetch } = suppliersQuery;
  const {
    data: paymentTerms = [],
    isError: paymentTermsError,
    error: paymentTermsErr,
    refetch: refetchPaymentTerms,
  } = paymentTermsQuery;
  const {
    data: currencies = [],
    isError: currenciesError,
    error: currenciesErr,
    refetch: refetchCurrencies,
  } = currenciesQuery;
  const {
    data: carriers = [],
    isError: carriersError,
    error: carriersErr,
    refetch: refetchCarriers,
  } = carriersQuery;
  const { data: taxCodes = [], isError: taxCodesError, refetch: refetchTaxCodes } = taxCodesQuery;
  const { data: incoterms = [], isError: incotermsError, refetch: refetchIncoterms } = incotermsQuery;
  const { data: departments = [], isError: departmentsError, refetch: refetchDepartments } = departmentsQuery;
  const { data: contracts = [], isError: contractsError, refetch: refetchContracts } = contractsQuery;
  const {
    data: performance = [],
    isError: performanceError,
    error: performanceErr,
    refetch: refetchPerformance,
  } = performanceQuery;

  const suppliersAuxError =
    paymentTermsError ||
    currenciesError ||
    carriersError ||
    taxCodesError ||
    incotermsError ||
    departmentsError ||
    contractsError ||
    performanceError;
  const refetchSuppliersAux = () => {
    void refetchPaymentTerms();
    void refetchCurrencies();
    void refetchCarriers();
    void refetchTaxCodes();
    void refetchIncoterms();
    void refetchDepartments();
    void refetchContracts();
    void refetchPerformance();
  };

  const {
    data: selectedLogo,
    isLoading: isLogoLoading,
    isFetching: isLogoFetching,
    isError: logoQueryError,
    refetch: refetchLogo,
  } = useQuery<SupplierLogo | null>({
    queryKey: ["/api/suppliers", selectedSupplierId, "logo"],
    queryFn: async () => {
      if (!selectedSupplierId) return null;
      const res = await fetch(`/api/suppliers/${selectedSupplierId}/logo`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SupplierLogo;
    },
    enabled: !!selectedSupplierId,
    retry: 0,
    throwOnError: false,
  });

  const createSupplier = useMutation({
    mutationFn: (supplier: SupplierFormValues) => requestJson<Supplier>("POST", "/api/suppliers", supplier),
    onSuccess: async () => {
      toast({ title: "Supplier created", description: "The supplier has been added successfully" });
      await invalidateSupplierDomain(queryClient);
      setSupplierSheetOpen(false);
    },
    onError: (error, data) => {
      toast({
        title: "Error creating supplier",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: data && <ToastAction altText="Retry" onClick={() => createSupplier.mutate(data)}>Retry</ToastAction>,
      });
    },
  });

  const updateSupplier = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SupplierFormValues> }) => requestJson<Supplier>("PATCH", `/api/suppliers/${id}`, data),
    onSuccess: async (_, variables) => {
      toast({ title: "Supplier updated", description: "The supplier has been updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", variables.id] });
      await invalidateSupplierDomain(queryClient);
      setSupplierSheetOpen(false);
    },
    onError: (error, vars) => {
      toast({
        title: "Error updating supplier",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: vars && <ToastAction altText="Retry" onClick={() => updateSupplier.mutate(vars)}>Retry</ToastAction>,
      });
    },
  });

  const deleteSupplier = useMutation({
    mutationFn: (id: number) => requestJson<{ success: boolean }>("DELETE", `/api/suppliers/${id}`),
    onSuccess: async (_, deletedId) => {
      toast({ title: "Supplier deleted", description: "The supplier has been deleted successfully" });
      await invalidateSupplierDomain(queryClient);
      if (selectedSupplierId === deletedId) {
        setSelectedSupplierId(null);
        setLogoDialogOpen(false);
        setRemoveLogoConfirm(false);
      }
    },
  });

  const createLogo = useMutation({
    mutationFn: ({ supplierId, logoUrl }: { supplierId: number; logoUrl: string }) => requestJson<SupplierLogo>("POST", `/api/suppliers/${supplierId}/logo`, { logoUrl }),
    onSuccess: (_, variables) => {
      toast({ title: "Logo added", description: "The supplier logo has been added successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", variables.supplierId, "logo"] });
      setLogoDialogOpen(false);
    },
  });

  const updateLogo = useMutation({
    mutationFn: ({ supplierId, logoUrl }: { supplierId: number; logoUrl: string }) => requestJson<SupplierLogo>("PUT", `/api/suppliers/${supplierId}/logo`, { logoUrl }),
    onSuccess: (_, variables) => {
      toast({ title: "Logo updated", description: "The supplier logo has been updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", variables.supplierId, "logo"] });
      setLogoDialogOpen(false);
    },
  });

  const deleteLogo = useMutation({
    mutationFn: (supplierId: number) => requestJson<{ success: boolean }>("DELETE", `/api/suppliers/${supplierId}/logo`),
    onSuccess: (_, supplierId) => {
      toast({ title: "Logo removed", description: "The supplier logo has been removed successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", supplierId, "logo"] });
    },
  });

  const form = useForm<SupplierFormValues>({ resolver: zodResolver(supplierFormSchema), defaultValues: emptySupplierFormValues() });
  const logoForm = useForm<SupplierLogoForm>({ defaultValues: { logoUrl: "" } });

  const openCreateSupplierSheet = () => {
    setSelectedSupplierId(null);
    form.reset(emptySupplierFormValues());
    setSupplierSheetOpen(true);
  };

  const handleEditSupplier = (supplier: Supplier) => {
    form.reset({
      ...emptySupplierFormValues(),
      name: supplier.name,
      supplierCode: (supplier as { supplierCode?: string | null }).supplierCode || "",
      legalName: (supplier as { legalName?: string | null }).legalName || "",
      supplierType: (supplier as { supplierType?: string | null }).supplierType || "",
      status: (supplier as { status?: string | null }).status || "active",
      registrationNumber: (supplier as { registrationNumber?: string | null }).registrationNumber || "",
      category: (supplier as { category?: string | null }).category || "",
      contactName: supplier.contactName || "",
      financeContactName: (supplier as { financeContactName?: string | null }).financeContactName || "",
      logisticsContactName: (supplier as { logisticsContactName?: string | null }).logisticsContactName || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
      billingAddress: (supplier as { billingAddress?: string | null }).billingAddress || "",
      remitToAddress: (supplier as { remitToAddress?: string | null }).remitToAddress || "",
      pickupSite: (supplier as { pickupSite?: string | null }).pickupSite || "",
      deliverySite: (supplier as { deliverySite?: string | null }).deliverySite || "",
      taxIdentificationNumber: (supplier as { taxIdentificationNumber?: string }).taxIdentificationNumber || "",
      bankName: (supplier as { bankName?: string | null }).bankName || "",
      bankAccountNumber: (supplier as { bankAccountNumber?: string | null }).bankAccountNumber || "",
      bankSwift: (supplier as { bankSwift?: string | null }).bankSwift || "",
      paymentTermsId: (supplier as { paymentTermsId?: number | null }).paymentTermsId ?? null,
      defaultCurrencyCode: (supplier as { defaultCurrencyCode?: string | null }).defaultCurrencyCode || "",
      taxCodeId: (supplier as { taxCodeId?: number | null }).taxCodeId ?? null,
      incotermId: (supplier as { incotermId?: number | null }).incotermId ?? null,
      defaultDepartmentId: (supplier as { defaultDepartmentId?: number | null }).defaultDepartmentId ?? null,
      defaultContractId: (supplier as { defaultContractId?: number | null }).defaultContractId ?? null,
      defaultCarrierId: (supplier as { defaultCarrierId?: number | null }).defaultCarrierId ?? null,
      defaultTransportMode: (supplier as { defaultTransportMode?: string | null }).defaultTransportMode || "",
      billControlPolicy: (supplier as { billControlPolicy?: string | null }).billControlPolicy || "standard",
      allowCurrencyOverride: Boolean((supplier as { allowCurrencyOverride?: boolean | null }).allowCurrencyOverride),
      requireApprovalForOverride: (supplier as { requireApprovalForOverride?: boolean | null }).requireApprovalForOverride !== false,
      riskStatus: (supplier as { riskStatus?: string | null }).riskStatus || "unknown",
      complianceStatus: (supplier as { complianceStatus?: string | null }).complianceStatus || "unknown",
      blockedReason: (supplier as { blockedReason?: string | null }).blockedReason || "",
      insuranceExpiry: ((supplier as { insuranceExpiry?: Date | string | null }).insuranceExpiry
        ? new Date((supplier as { insuranceExpiry?: Date | string | null }).insuranceExpiry as Date | string).toISOString().slice(0, 10)
        : ""),
      complianceNotes: (supplier as { complianceNotes?: string | null }).complianceNotes || "",
      notes: supplier.notes || "",
    });
    setSelectedSupplierId(supplier.id);
    setSupplierSheetOpen(true);
  };

  const toSupplierPayload = (data: SupplierFormValues): SupplierFormValues => ({
    ...data,
    supplierCode: data.supplierCode?.trim() || null,
    legalName: data.legalName?.trim() || null,
    supplierType: data.supplierType?.trim() || null,
    status: data.status?.trim() || "active",
    registrationNumber: data.registrationNumber?.trim() || null,
    category: data.category?.trim() || null,
    contactName: data.contactName?.trim() || null,
    financeContactName: data.financeContactName?.trim() || null,
    logisticsContactName: data.logisticsContactName?.trim() || null,
    email: data.email?.trim() || null,
    phone: data.phone?.trim() || null,
    address: data.address?.trim() || null,
    billingAddress: data.billingAddress?.trim() || null,
    remitToAddress: data.remitToAddress?.trim() || null,
    pickupSite: data.pickupSite?.trim() || null,
    deliverySite: data.deliverySite?.trim() || null,
    taxIdentificationNumber: data.taxIdentificationNumber?.trim() || null,
    bankName: data.bankName?.trim() || null,
    bankAccountNumber: data.bankAccountNumber?.trim() || null,
    bankSwift: data.bankSwift?.trim() || null,
    paymentTermsId: data.paymentTermsId ?? null,
    defaultCurrencyCode: data.defaultCurrencyCode?.trim() || null,
    taxCodeId: data.taxCodeId ?? null,
    incotermId: data.incotermId ?? null,
    defaultDepartmentId: data.defaultDepartmentId ?? null,
    defaultContractId: data.defaultContractId ?? null,
    defaultCarrierId: data.defaultCarrierId ?? null,
    defaultTransportMode: data.defaultTransportMode?.trim() || null,
    billControlPolicy: data.billControlPolicy?.trim() || "standard",
    allowCurrencyOverride: Boolean(data.allowCurrencyOverride),
    requireApprovalForOverride: data.requireApprovalForOverride !== false,
    riskStatus: data.riskStatus?.trim() || "unknown",
    complianceStatus: data.complianceStatus?.trim() || "unknown",
    blockedReason: data.blockedReason?.trim() || null,
    insuranceExpiry: data.insuranceExpiry?.trim() || null,
    complianceNotes: data.complianceNotes?.trim() || null,
    notes: data.notes?.trim() || null,
  });

  const handleCreateSupplier = (data: SupplierFormValues) => {
    createSupplier.mutate(toSupplierPayload(data));
    form.reset();
  };

  const handleUpdateSupplier = (data: SupplierFormValues) => {
    if (selectedSupplierId) updateSupplier.mutate({ id: selectedSupplierId, data: toSupplierPayload(data) });
  };

  const handleDeleteSupplier = (supplier: Supplier) => setDeleteConfirmSupplier(supplier);
  const confirmDeleteSupplier = () => {
    if (!deleteConfirmSupplier) return;
    deleteSupplier.mutate(deleteConfirmSupplier.id, { onSuccess: () => setDeleteConfirmSupplier(null) });
  };

  const handleLogoSubmit = (data: SupplierLogoForm) => {
    if (!selectedSupplierId) return;
    if (selectedLogo) updateLogo.mutate({ supplierId: selectedSupplierId, logoUrl: data.logoUrl });
    else createLogo.mutate({ supplierId: selectedSupplierId, logoUrl: data.logoUrl });
  };

  const handleOpenLogoDialog = (supplier: Supplier) => {
    setSelectedSupplierId(supplier.id);
    logoForm.reset({ logoUrl: "" });
    setLogoDialogOpen(true);
  };

  useEffect(() => {
    if (!logoDialogOpen || !selectedSupplierId || isLogoLoading || isLogoFetching) return;
    logoForm.reset({ logoUrl: selectedLogo?.logoUrl ?? "" });
  }, [logoDialogOpen, selectedSupplierId, isLogoLoading, isLogoFetching, selectedLogo, logoForm]);

  const paymentTermsById = new Map(paymentTerms.map((term) => [term.id, `${term.code} - ${term.name}`]));
  const carriersById = new Map(carriers.map((carrier) => [carrier.id, carrier.code ? `${carrier.code} - ${carrier.name}` : carrier.name]));
  const performanceBySupplier = new Map(performance.map((row) => [row.supplierId, row]));

  return (
    <div data-testid="suppliers-page">
      <PageHeader
        title="Suppliers"
        description="Manage your suppliers and their information"
        actions={<div className="flex flex-wrap items-center gap-2"><Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add suppliers"><Button type="button" onClick={openCreateSupplierSheet}><Plus className="mr-2 h-4 w-4" />Add supplier</Button></Can><TutorialStep page="suppliers" /></div>}
      />

      <div className="px-4 md:px-6"><ModuleTrainingPanel moduleId="suppliers" /></div>
      {paymentTermsError ? <PanelInlineError title="Payment terms failed to load" description={queryErrorDetail(paymentTermsErr)} onRetry={() => void refetchPaymentTerms()} /> : null}
      {currenciesError ? <PanelInlineError title="Currencies failed to load" description={queryErrorDetail(currenciesErr)} onRetry={() => void refetchCurrencies()} /> : null}
      {carriersError ? <PanelInlineError title="Carriers failed to load" description={queryErrorDetail(carriersErr)} onRetry={() => void refetchCarriers()} /> : null}
      {performanceError ? <PanelInlineError title="Supplier performance metrics failed to load" description={queryErrorDetail(performanceErr)} onRetry={() => void refetchPerformance()} /> : null}
      {suppliersAuxError ? <div className="mb-4 flex justify-end px-4 md:px-6"><Button type="button" variant="outline" size="sm" onClick={() => void refetchSuppliersAux()}>Retry all supplier reference data</Button></div> : null}

      <div className="grid grid-cols-1 gap-6">
        <SuppliersListCard isLoading={isLoading} isError={isError} error={isError ? (error instanceof Error ? error : new Error(String(error))) : null} suppliers={suppliers} refetch={refetch} selectedSupplierId={selectedSupplierId} selectedLogo={selectedLogo ?? null} paymentTermsById={paymentTermsById} carriersById={carriersById} performanceBySupplier={performanceBySupplier} productSetupComplete={productSetupComplete} onAddSupplier={openCreateSupplierSheet} onEditSupplier={handleEditSupplier} onDeleteSupplier={handleDeleteSupplier} onOpenLogoDialog={handleOpenLogoDialog} />
      </div>

      <SupplierFormSheet open={supplierSheetOpen} onOpenChange={setSupplierSheetOpen} selectedSupplierId={selectedSupplierId} setSelectedSupplierId={setSelectedSupplierId} form={form} paymentTerms={paymentTerms} currencies={currencies} carriers={carriers} taxCodes={taxCodes} incoterms={incoterms} departments={departments} contracts={contracts} onCreate={handleCreateSupplier} onUpdate={handleUpdateSupplier} createPending={createSupplier.isPending} updatePending={updateSupplier.isPending} />

      <SupplierLogoDialogs removeLogoConfirm={removeLogoConfirm} setRemoveLogoConfirm={setRemoveLogoConfirm} selectedSupplierId={selectedSupplierId} deleteLogo={deleteLogo} setLogoDialogOpen={setLogoDialogOpen} logoDialogOpen={logoDialogOpen} selectedLogo={selectedLogo ?? undefined} logoQueryError={logoQueryError} onRetryLogo={() => void refetchLogo()} logoForm={logoForm} handleLogoSubmit={handleLogoSubmit} />

      <AlertDialog open={!!deleteConfirmSupplier} onOpenChange={(open) => !open && setDeleteConfirmSupplier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete supplier?</AlertDialogTitle><AlertDialogDescription>{deleteConfirmSupplier ? `This will permanently remove "${deleteConfirmSupplier.name}". This action cannot be undone.` : "This action cannot be undone."}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDeleteSupplier}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
