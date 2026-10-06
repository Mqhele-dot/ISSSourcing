import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, normalizeApiList, requestJson } from "@/lib/queryClient";
import type { PurchaseRequisition, PurchaseRequisitionItem, PurchaseOrder, PurchaseOrderItem, Supplier, InventoryItem } from "@shared/schema";
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

const LOCKED_REQUISITION_STATUSES = new Set([
  "SUBMITTED",
  "PENDING",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
  "CONVERTED_TO_RFQ",
  "CONVERTED_TO_PO",
  "CLOSED",
  "CANCELLED",
]);

function isValidRequisitionLine(line: ReqLineDraft): boolean {
  const commercialValuesAreValid = line.quantity > 0 && Number(line.unitPrice) > 0;
  if (!commercialValuesAreValid) return false;
  if (line.lineType === "CATALOG") return Number(line.itemId) > 0;
  return Boolean(line.description?.trim() && line.manualEntryReason?.trim());
}

type RequisitionValidationRules = MdmRequisitionContext["rules"] | undefined;

function validateRequisitionDraft(input: {
  supplierId: number | "";
  currencyCode: string;
  exchangeRateToZar: number;
  reportingCurrencyCode: string;
  departmentId: number | "";
  requiredDate: string;
  items: ReqLineDraft[];
  rules: RequisitionValidationRules;
}): RequisitionFieldErrors {
  const errors: RequisitionFieldErrors = {};
  if (!input.supplierId) errors.supplierId = "Supplier is required";
  if (!input.currencyCode) errors.currencyCode = "Currency is required";
  if (!Number.isFinite(input.exchangeRateToZar) || input.exchangeRateToZar <= 0) {
    errors.currencyCode = `Selected currency needs a positive ${input.reportingCurrencyCode} exchange rate in Master Data`;
  }
  if (input.rules?.requiresDepartment && !input.departmentId) errors.departmentId = "Department is required";
  if (!input.requiredDate) errors.requiredDate = "Required date is required";
  const validItems = input.items.filter(isValidRequisitionLine);
  if (validItems.length === 0) {
    errors.items = "Add a valid catalogue or manual line with quantity, price, and required details";
    return errors;
  }
  const missingCostCentre = validItems.findIndex((item) => !item.costCentreId);
  const missingTax = validItems.findIndex((item) => item.taxCodeId == null);
  const missingUom = validItems.findIndex((item) => !item.unitOfMeasureId);
  const missingGl = validItems.findIndex((item) => !item.glAccountCode?.trim());
  if (input.rules?.requiresCostCentre && missingCostCentre >= 0) {
    errors.items = `Line ${missingCostCentre + 1}: cost centre is required by procurement policy`;
  } else if (input.rules?.requiresTaxCode && missingTax >= 0) {
    errors.items = `Line ${missingTax + 1}: tax code is required by procurement policy`;
  } else if (input.rules?.requiresUom && missingUom >= 0) {
    errors.items = `Line ${missingUom + 1}: purchase UOM is required`;
  } else if (missingGl >= 0) {
    errors.items = `Line ${missingGl + 1}: GL mapping is required before this requisition can be saved`;
  }
  return errors;
}

function lockedReasonForStatus(status: unknown): string {
  const normalized = String(status || "").trim().toUpperCase();
  if (!LOCKED_REQUISITION_STATUSES.has(normalized)) return "";
  if (normalized === "SUBMITTED" || normalized === "PENDING" || normalized === "PENDING_APPROVAL") {
    return "This requisition is submitted for approval and its commercial details are locked.";
  }
  if (normalized === "APPROVED") return "This requisition is approved and locked to preserve approval history.";
  if (normalized === "REJECTED") return "This requisition is rejected and its reviewed version can no longer be edited.";
  if (normalized === "CONVERTED_TO_RFQ") return "This requisition has been converted to an RFQ and can no longer be edited.";
  if (normalized === "CONVERTED" || normalized === "CONVERTED_TO_PO") return "This requisition has been converted to a purchase order and can no longer be edited.";
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
  const copySourceId = isNew && typeof window !== "undefined" ? Number(new URLSearchParams(window.location.search).get("copyFrom")) : 0;
  const copyPoSourceId = isNew && typeof window !== "undefined" ? Number(new URLSearchParams(window.location.search).get("copyPoFrom")) : 0;
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
  const copySourceQuery = useQuery({
    queryKey: ["/api/purchase-requisitions", "copy-source", copySourceId],
    queryFn: () => requestJson<PurchaseRequisition & { items?: PurchaseRequisitionItem[] }>("GET", `/api/purchase-requisitions/${copySourceId}`),
    enabled: isNew && Number.isSafeInteger(copySourceId) && copySourceId > 0,
  });
  const copyPoQuery = useQuery({
    queryKey: ["/api/purchase-orders", "copy-source", copyPoSourceId],
    queryFn: () => requestJson<PurchaseOrder & { items?: PurchaseOrderItem[] }>("GET", `/api/purchase-orders/${copyPoSourceId}`),
    enabled: isNew && Number.isSafeInteger(copyPoSourceId) && copyPoSourceId > 0,
  });
  const appliedCopySource = useRef<string | null>(null);
  const lockedReason = !isNew ? lockedReasonForStatus(requisition?.status) : "";
  const isLocked = Boolean(lockedReason);

  const { data: mdmContext, isLoading: isMdmLoading, error: mdmError, refetch: refetchMdm } = useQuery({
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

  const paymentTerms = mdmContext?.paymentTerms ?? [];
  const incoterms = mdmContext?.incoterms ?? [];

  const contractsForSupplier = useMemo(() => {
    if (supplierId === "") return [];
    return (mdmContext?.contracts ?? []).filter((c) => c.supplierId === supplierId);
  }, [mdmContext?.contracts, supplierId]);

  const departmentLabel = useMemo(() => {
    if (departmentId === "") return undefined;
    const d = effectiveDepartments.find((x) => x.id === departmentId);
    return d ? `${d.code} — ${d.name}` : undefined;
  }, [departmentId, effectiveDepartments]);

  useEffect(() => {
    const source = requisition ?? (isNew ? copySourceQuery.data ?? copyPoQuery.data : undefined);
    const sourceKey = source ? `${"orderNumber" in source ? "po" : "pr"}:${source.id}` : null;
    if (source && (!isNew || appliedCopySource.current !== sourceKey)) {
      if (isNew) appliedCopySource.current = sourceKey;
      setNotes(source.notes ?? "");
      setSupplierId(source.supplierId ?? "");
      setCurrencyCode(
        ((source as PurchaseRequisition & { currencyCode?: string | null }).currencyCode ?? reportingCurrencyCode).toUpperCase(),
      );
      setDepartmentId((source as PurchaseRequisition & { departmentId?: number | null }).departmentId ?? "");
      setJustification((source as PurchaseRequisition & { justification?: string | null }).justification ?? "");
      const sourceDate = "requiredDate" in source ? source.requiredDate : source.expectedDeliveryDate;
      setRequiredDate(sourceDate ? new Date(sourceDate).toISOString().slice(0, 10) : "");
      setProjectId((source as PurchaseRequisition & { projectId?: number | null }).projectId ?? "");
      if (source.items?.length) {
        setItems(
          source.items.map((i) => ({
            id: isNew ? undefined : i.id,
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
  }, [requisition, copySourceQuery.data, copyPoQuery.data, isNew, reportingCurrencyCode]);

  const copyWarnings = useMemo(() => {
    if (!isNew || (!copySourceQuery.data && !copyPoQuery.data) || !mdmContext) return [];
    const warnings: string[] = [];
    if (supplierId !== "" && !effectiveSuppliers.some((row) => row.id === supplierId)) warnings.push("The original supplier is not currently approved. Choose an active supplier.");
    if (departmentId !== "" && !effectiveDepartments.some((row) => row.id === departmentId)) warnings.push("The original department is inactive. Choose an active department.");
    if (!effectiveCurrencies.some((row) => row.code === currencyCode)) warnings.push("The original currency is unavailable. Choose an active currency.");
    if (items.some((row) => row.lineType === "CATALOG" && !effectiveInventoryItems.some((item) => item.id === row.itemId))) warnings.push("At least one original item is no longer available. Replace it before saving.");
    if (items.some((row) => row.taxCodeId && !mdmContext.taxCodes.some((tax) => tax.id === row.taxCodeId && tax.active !== false))) warnings.push("A copied tax code is inactive. Select an active tax code.");
    if (items.some((row) => row.unitOfMeasureId && !effectiveUnitsOfMeasure.some((uom) => uom.id === row.unitOfMeasureId))) warnings.push("A copied unit of measure is inactive. Select an active unit.");
    if (items.some((row) => row.costCentreId && !effectiveCostCentres.some((centre) => centre.id === row.costCentreId))) warnings.push("A copied cost centre is inactive. Select an active cost centre.");
    if (requiredDate && new Date(requiredDate).getTime() < Date.now() - 86_400_000) warnings.push("The copied required date has passed. Choose a future date.");
    return warnings;
  }, [isNew, copySourceQuery.data, copyPoQuery.data, mdmContext, supplierId, departmentId, currencyCode, items, requiredDate, effectiveSuppliers, effectiveDepartments, effectiveCurrencies, effectiveInventoryItems, effectiveUnitsOfMeasure, effectiveCostCentres]);

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

  const validationErrors = useMemo(() => validateRequisitionDraft({
    supplierId,
    currencyCode,
    exchangeRateToZar,
    reportingCurrencyCode,
    departmentId,
    requiredDate,
    items,
    rules: mdmContext?.rules,
  }), [supplierId, currencyCode, exchangeRateToZar, reportingCurrencyCode, departmentId, requiredDate, items, mdmContext?.rules]);
  const submitBlockers = isMdmLoading
    ? ["Loading authoritative procurement Master Data"]
    : mdmError
      ? ["Procurement Master Data could not be loaded"]
      : [...Object.values(validationErrors).filter((message): message is string => Boolean(message)), ...copyWarnings];
  const canSubmit = !isLocked && submitBlockers.length === 0;

  const handleSubmit = useCallback(() => {
    if (copyWarnings.length) {
      toast({ title: "Review copied values", description: copyWarnings[0], variant: "destructive" });
      return;
    }
    if (isLocked) {
      toast({
        title: "Requisition is locked",
        description: lockedReason,
        variant: "destructive",
      });
      return;
    }
    const nextErrors = validationErrors;
    const validItems = items.filter(isValidRequisitionLine);
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
  }, [validationErrors, items, isNew, createMutation, updateMutation, toast, isLocked, lockedReason, copyWarnings]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  return {
    requisition,
    copySource: copySourceQuery.data,
    copyPoSource: copyPoQuery.data,
    copyWarnings,
    copySourceError: copySourceQuery.isError || copyPoQuery.isError,
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
    canSubmit,
    submitBlockers,
    isLocked,
    lockedReason,
    currencies: effectiveCurrencies,
    mdmContext,
    isMdmLoading,
    mdmError,
    refetchMdm,
    contractsForSupplier,
    paymentTerms,
    incoterms,
    taxCodes: effectiveTaxCodes,
    unitsOfMeasure: effectiveUnitsOfMeasure,
    costCentres: effectiveCostCentres,
    departmentLabel,
  };
}
