import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, normalizeApiList, requestJson } from "@/lib/queryClient";
import type { PurchaseRequisition, PurchaseRequisitionItem, Supplier, InventoryItem } from "@shared/schema";
import { invalidateRequisitionDomain } from "@/lib/domain-invalidation";
import type { ReqLineDraft } from "@/pages/requisitions/requisition-lines-editor";

export type RequisitionFieldErrors = Partial<
  Record<"supplierId" | "departmentId" | "requiredDate" | "items" | "projectId" | "currencyCode", string>
>;

type MdmRequisitionContext = {
  defaultCurrencyCode: string;
  currencies: Array<{
    code: string;
    name: string;
    symbol?: string | null;
    exchangeRateToZar?: number | null;
    active?: boolean | null;
  }>;
  departments: Array<{ id: number; code: string; name: string; active?: boolean | null }>;
  costCentres: Array<{ id: number; code: string; name: string; departmentId?: number | null; active?: boolean | null }>;
  taxCodes: Array<{ id: number; code: string; name: string; active?: boolean | null }>;
  unitsOfMeasure: Array<{ id: number; code: string; name: string; symbol?: string | null; active?: boolean | null }>;
  suppliers: Supplier[];
  items: Array<InventoryItem & { defaultTaxCodeId?: number | null; glAccountCode?: string | null }>;
  approvalRules: Array<{ id: number; code: string; name: string; minLocalValue?: number | null; approverRole?: string | null }>;
  contracts?: Array<{ id: number; title: string; supplierId: number }>;
  paymentTerms?: Array<{ id: number; code: string; name: string }>;
  incoterms?: Array<{ id: number; code: string; name: string }>;
  organizationDefaults?: {
    taxCodeId?: number | null;
  };
  rules: {
    requiresDepartment: boolean;
    requiresCostCentre: boolean;
    requiresTaxCode: boolean;
    requiresUom: boolean;
    requiresCurrency: boolean;
    onceOffItemRequiresReason: boolean;
    approvalValueCurrency: string;
  };
};

function defaultRequiredDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const LOCKED_REQUISITION_STATUSES = new Set(["APPROVED", "CONVERTED", "CLOSED", "CANCELLED"]);

function isValidRequisitionLine(line: ReqLineDraft): boolean {
  const commercialValuesAreValid = line.quantity > 0 && Number(line.unitPrice) > 0;
  if (!commercialValuesAreValid) return false;
  if (line.lineType === "CATALOG") return Number(line.itemId) > 0;
  return Boolean(line.description?.trim() && line.manualEntryReason?.trim());
}

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
  const [requiredDate, setRequiredDate] = useState(() => (isNew ? defaultRequiredDate() : ""));
  const [projectId, setProjectId] = useState<number | "">("");
  const [currencyCode, setCurrencyCode] = useState("ZAR");
  const [items, setItems] = useState<ReqLineDraft[]>([{ itemId: null, lineType: "CATALOG", quantity: 1, unitPrice: 0 }]);
  const [fieldErrors, setFieldErrors] = useState<RequisitionFieldErrors>({});
  const organizationCurrencyInitialized = useRef(false);

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

  const { data: mdmContext } = useQuery({
    queryKey: ["/api/mdm/defaults/requisition-context"],
    queryFn: () => requestJson<MdmRequisitionContext>("GET", "/api/mdm/defaults/requisition-context"),
    retry: false,
    staleTime: 60_000,
  });
  const reportingCurrencyCode = String(mdmContext?.defaultCurrencyCode ?? "ZAR").trim().toUpperCase();

  useEffect(() => {
    if (!isNew || !mdmContext?.defaultCurrencyCode || organizationCurrencyInitialized.current) return;
    organizationCurrencyInitialized.current = true;
    setCurrencyCode(reportingCurrencyCode);
  }, [isNew, mdmContext?.defaultCurrencyCode, reportingCurrencyCode]);

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

  const effectiveSuppliers = useMemo(
    () =>
      (mdmContext?.suppliers ?? []).filter((supplier) => {
        const governed = supplier as Supplier & { onboardingStatus?: string | null };
        return String(supplier.status).toLowerCase() === "active" && String(governed.onboardingStatus ?? "approved").toLowerCase() === "approved";
      }),
    [mdmContext?.suppliers],
  );

  const effectiveInventoryItems = useMemo(
    () => mdmContext?.items ?? [],
    [mdmContext?.items],
  );

  const effectiveDepartments = useMemo(
    () => mdmContext?.departments?.filter((department) => department.active !== false) ?? [],
    [mdmContext?.departments],
  );

  const effectiveCurrencies = useMemo(
    () => mdmContext?.currencies?.filter((currency) => currency.active !== false) ?? [],
    [mdmContext?.currencies],
  );
  const effectiveUnitsOfMeasure = useMemo(
    () => mdmContext?.unitsOfMeasure?.filter((uom) => uom.active !== false) ?? [],
    [mdmContext?.unitsOfMeasure],
  );
  const effectiveCostCentres = useMemo(
    () => mdmContext?.costCentres?.filter((costCentre) => costCentre.active !== false) ?? [],
    [mdmContext?.costCentres],
  );

  const selectedSupplier = useMemo(
    () => (supplierId === "" ? undefined : effectiveSuppliers.find((supplier) => supplier.id === supplierId)),
    [effectiveSuppliers, supplierId],
  );

  const selectedCurrency = useMemo(
    () => effectiveCurrencies.find((currency) => currency.code === currencyCode),
    [effectiveCurrencies, currencyCode],
  );

  // The database field retains its legacy name, but the rate now targets the
  // active legal entity's reporting currency rather than always targeting ZAR.
  const exchangeRateToZar = Number(
    selectedCurrency?.exchangeRateToZar ?? (currencyCode === reportingCurrencyCode ? 1 : 0),
  );

  const requisitionTotals = useMemo(() => {
    const orderTotal = items.reduce((sum, item) => {
      const qty = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      return Number.isFinite(qty) && Number.isFinite(unitPrice) ? sum + qty * unitPrice : sum;
    }, 0);
    const reportingTotal = orderTotal * (Number.isFinite(exchangeRateToZar) && exchangeRateToZar > 0 ? exchangeRateToZar : 0);
    return {
      orderTotal,
      reportingTotal,
      zarTotal: reportingTotal,
    };
  }, [exchangeRateToZar, items]);

  useEffect(() => {
    if (!isNew || !selectedSupplier) return;
    const supplierCurrency = String((selectedSupplier as Supplier & { defaultCurrencyCode?: string | null }).defaultCurrencyCode ?? "")
      .trim()
      .toUpperCase();
    if (!supplierCurrency || supplierCurrency === currencyCode) return;
    if (effectiveCurrencies.some((currency) => currency.code === supplierCurrency)) {
      setCurrencyCode(supplierCurrency);
    }
  }, [effectiveCurrencies, currencyCode, isNew, selectedSupplier]);

  const effectiveTaxCodes = useMemo(
    () => mdmContext?.taxCodes?.filter((taxCode) => taxCode.active !== false) ?? [],
    [mdmContext?.taxCodes],
  );

  const contracts = mdmContext?.contracts ?? [];
  const paymentTerms = mdmContext?.paymentTerms ?? [];
  const incoterms = mdmContext?.incoterms ?? [];

  const contractsForSupplier = useMemo(() => {
    if (supplierId === "") return [];
    return contracts.filter((c) => c.supplierId === supplierId);
  }, [contracts, supplierId]);

  const departmentLabel = useMemo(() => {
    if (departmentId === "") return undefined;
    const d = effectiveDepartments.find((x) => x.id === departmentId);
    return d ? `${d.code} — ${d.name}` : undefined;
  }, [departmentId, effectiveDepartments]);

  useEffect(() => {
    if (requisition) {
      setNotes(requisition.notes ?? "");
      setSupplierId(requisition.supplierId ?? "");
      setCurrencyCode(
        ((requisition as PurchaseRequisition & { currencyCode?: string | null }).currencyCode ?? reportingCurrencyCode).toUpperCase(),
      );
      setDepartmentId((requisition as PurchaseRequisition & { departmentId?: number | null }).departmentId ?? "");
      setJustification((requisition as PurchaseRequisition & { justification?: string | null }).justification ?? "");
      setRequiredDate(requisition.requiredDate ? new Date(requisition.requiredDate).toISOString().slice(0, 10) : "");
      setProjectId((requisition as PurchaseRequisition & { projectId?: number | null }).projectId ?? "");
      if (requisition.items?.length) {
        setItems(
          requisition.items.map((i) => ({
            id: i.id,
            itemId: i.itemId ?? null,
            lineType: (i.lineType as ReqLineDraft["lineType"]) ?? "CATALOG",
            description: i.description ?? "",
            manualEntryReason: i.manualEntryReason ?? "",
            receiptRequired: i.receiptRequired !== false,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            unitOfMeasureId: (i as PurchaseRequisitionItem & { unitOfMeasureId?: number | null }).unitOfMeasureId ?? null,
            taxCodeId: (i as PurchaseRequisitionItem & { taxCodeId?: number | null }).taxCodeId ?? null,
            costCentreId: (i as PurchaseRequisitionItem & { costCentreId?: number | null }).costCentreId ?? null,
            glAccountCode: (i as PurchaseRequisitionItem & { glAccountCode?: string | null }).glAccountCode ?? null,
            notes: i.notes ?? undefined,
          })),
        );
      }
    }
  }, [requisition, reportingCurrencyCode]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        notes: notes || undefined,
        supplierId: supplierId || undefined,
        currencyCode,
        exchangeRateToZar,
        departmentId: departmentId || undefined,
        justification: justification || undefined,
        requiredDate: requiredDate ? new Date(requiredDate).toISOString() : undefined,
        projectId: projectId === "" ? undefined : Number(projectId),
        items: items
          .filter(isValidRequisitionLine)
          .map((i) => ({
            itemId: i.itemId,
            lineType: i.lineType,
            description: i.description || undefined,
            manualEntryReason: i.manualEntryReason || undefined,
            receiptRequired: i.receiptRequired !== false,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            unitOfMeasureId: i.unitOfMeasureId ?? undefined,
            taxCodeId: i.taxCodeId ?? undefined,
            costCentreId: i.costCentreId ?? undefined,
            glAccountCode: i.glAccountCode || undefined,
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

  const createSupplierMutation = useMutation({
    mutationFn: async (payload: { name: string; email?: string; phone?: string }) => {
      const res = await apiRequest("POST", "/api/suppliers", {
        name: payload.name,
        email: payload.email || undefined,
        phone: payload.phone || undefined,
        status: "prospective",
        defaultCurrencyCode: currencyCode,
      });
      return res.json() as Promise<Supplier>;
    },
    onSuccess: async (supplier) => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({
        title: "Prospective supplier created",
        description: `${supplier.name} must complete supplier onboarding and independent approval before it can be used on a requisition or PO.`,
      });
    },
    onError: (e) => {
      toast({ title: "Supplier create failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (isLocked) {
        throw new Error(lockedReason || "This requisition is locked.");
      }
      const validItems = items
        .filter(isValidRequisitionLine)
        .map((i) => ({
          id: i.id,
          itemId: i.itemId,
          lineType: i.lineType,
          description: i.description || undefined,
          manualEntryReason: i.manualEntryReason || undefined,
          receiptRequired: i.receiptRequired !== false,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          unitOfMeasureId: i.unitOfMeasureId ?? undefined,
          taxCodeId: i.taxCodeId ?? undefined,
          costCentreId: i.costCentreId ?? undefined,
          glAccountCode: i.glAccountCode || undefined,
          notes: i.notes,
        }));
      const body = {
        notes: notes || undefined,
        supplierId: supplierId || undefined,
        currencyCode,
        exchangeRateToZar,
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

  const addItem = useCallback(() => setItems((prev) => [...prev, { itemId: null, lineType: "CATALOG", receiptRequired: true, quantity: 1, unitPrice: 0, lineCurrencyCode: currencyCode }]), [currencyCode]);
  const removeItem = useCallback((idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx)), []);
  const updateItem = useCallback((idx: number, field: keyof ReqLineDraft, value: number | string | boolean | null) => {
    setItems((prev) => {
      const next = [...prev];
      const current = { ...next[idx], [field]: value };
      if (field === "lineType") {
        current.itemId = value === "CATALOG" ? current.itemId : null;
        current.description = value === "CATALOG" ? "" : current.description;
        current.manualEntryReason = value === "CATALOG" ? "" : current.manualEntryReason;
        current.receiptRequired = true;
      }
      if (field === "itemId") {
        const selected = effectiveInventoryItems.find((item) => Number(item.id) === Number(value)) as
          | (InventoryItem & { supplierPartNumber?: string | null; defaultTaxCodeId?: number | null; glAccountCode?: string | null })
          | undefined;
        const itemTaxCodeId = Number((selected as { taxCodeId?: number | null } | undefined)?.taxCodeId ?? 0) || null;
        const categoryTaxCodeId = Number(selected?.defaultTaxCodeId ?? 0) || null;
        const supplierTaxCodeId =
          supplierId === ""
            ? null
            : Number((effectiveSuppliers.find((supplier) => Number(supplier.id) === Number(supplierId)) as Supplier & { taxCodeId?: number | null } | undefined)?.taxCodeId ?? 0) || null;
        const organizationTaxCodeId = Number(mdmContext?.organizationDefaults?.taxCodeId ?? 0) || null;
        const resolvedTaxCodeId = itemTaxCodeId ?? categoryTaxCodeId ?? supplierTaxCodeId ?? organizationTaxCodeId;
        current.unitPrice = Number(selected?.price ?? current.unitPrice ?? 0);
        current.unitOfMeasureId = selected?.unitOfMeasureId ?? current.unitOfMeasureId ?? null;
        current.taxCodeId = selected?.taxable === false ? null : current.taxCodeId ?? resolvedTaxCodeId;
        current.supplierItemCode = selected?.supplierPartNumber ?? current.supplierItemCode ?? null;
        current.baseUomId = selected?.unitOfMeasureId ?? current.baseUomId ?? null;
        current.conversionFactor = selected?.unitOfMeasureId ? 1 : current.conversionFactor ?? null;
        current.glAccountCode = selected?.glAccountCode ?? current.glAccountCode ?? null;
        current.lineCurrencyCode = currencyCode;
      }
      if (field === "costCentreId") {
        const selectedCostCentre = effectiveCostCentres.find(
          (costCentre) => Number(costCentre.id) === Number(value),
        ) as (typeof effectiveCostCentres)[number] & { glAccountCode?: string | null } | undefined;
        current.glAccountCode = selectedCostCentre?.glAccountCode ?? current.glAccountCode ?? null;
      }
      next[idx] = current;
      return next;
    });
  }, [
    currencyCode,
    effectiveCostCentres,
    effectiveInventoryItems,
    effectiveSuppliers,
    mdmContext?.organizationDefaults?.taxCodeId,
    supplierId,
  ]);

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
    if (!currencyCode) nextErrors.currencyCode = "Currency is required";
    if (!Number.isFinite(exchangeRateToZar) || exchangeRateToZar <= 0) {
      nextErrors.currencyCode = `Selected currency needs a positive ${reportingCurrencyCode} exchange rate in Master Data`;
    }
    if (mdmContext?.rules.requiresDepartment && !departmentId) nextErrors.departmentId = "Department is required";
    if (!requiredDate) nextErrors.requiredDate = "Required date is required";
    const validItems = items.filter(isValidRequisitionLine);
    if (validItems.length === 0) {
      nextErrors.items = "Add a valid catalogue or manual line with quantity, price, and required details";
    } else {
      const missingUom = validItems.findIndex((item) => !item.unitOfMeasureId);
      const missingTax = validItems.findIndex((item) => item.taxCodeId == null);
      const missingCostCentre = validItems.findIndex((item) => !item.costCentreId);
      if (mdmContext?.rules.requiresCostCentre && missingCostCentre >= 0) {
        nextErrors.items = `Line ${missingCostCentre + 1}: cost centre is required by procurement policy`;
      } else if (mdmContext?.rules.requiresTaxCode && missingTax >= 0) {
        nextErrors.items = `Line ${missingTax + 1}: tax code is required by procurement policy`;
      } else if (mdmContext?.rules.requiresUom && missingUom >= 0) {
        nextErrors.items = `Line ${missingUom + 1}: purchase UOM is required`;
      }
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
      const hasItems = items.some((i) => i.lineType !== "CATALOG" || Number(i.itemId) > 0);
      if (!hasItems) {
        toast({ title: "Add at least one item", variant: "destructive" });
      } else if (items.some((i) => (i.lineType !== "CATALOG" || Number(i.itemId) > 0) && i.quantity <= 0)) {
        toast({ title: "Quantity must be greater than zero for each item", variant: "destructive" });
      } else {
        toast({ title: "Unit price must be greater than zero for each item", variant: "destructive" });
      }
      return;
    }
    if (isNew) createMutation.mutate();
    else updateMutation.mutate();
  }, [supplierId, currencyCode, exchangeRateToZar, reportingCurrencyCode, departmentId, requiredDate, items, mdmContext?.rules, isNew, createMutation, updateMutation, toast, isLocked, lockedReason]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  return {
    requisition,
    isLoading,
    suppliers: effectiveSuppliers,
    inventoryItems: effectiveInventoryItems,
    departments: effectiveDepartments,
    extensionProjects,
    projectId,
    setProjectId,
    notes,
    setNotes,
    supplierId,
    setSupplierId,
    createSupplier: createSupplierMutation.mutate,
    isCreatingSupplier: createSupplierMutation.isPending,
    selectedSupplier,
    currencyCode,
    setCurrencyCode,
    selectedCurrency,
    exchangeRateToZar,
    reportingCurrencyCode,
    requisitionTotals,
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
    currencies: effectiveCurrencies,
    mdmContext,
    contractsForSupplier,
    paymentTerms,
    incoterms,
    taxCodes: effectiveTaxCodes,
    unitsOfMeasure: effectiveUnitsOfMeasure,
    costCentres: effectiveCostCentres,
    departmentLabel,
  };
}
