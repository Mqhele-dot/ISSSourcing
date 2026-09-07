import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Download,
  FilePlus2,
  PackagePlus,
  Pencil,
  Plus,
  ScanLine,
  Send,
  Trash2,
} from "lucide-react";
import { BarcodeScanner } from "@/components/barcode/barcode-scanner";
import { PageHeader } from "@/components/page-header";
import { PageDataState, PageShell } from "@/components/page-shell";
import { SearchableRecordCombobox } from "@/components/searchable-record-combobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { ScanResult } from "@/hooks/use-barcode-scanner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { queryClient, requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type Currency = {
  id: number;
  code: string;
  name?: string;
  symbol?: string;
  exchangeRateToZar: number;
};
type Uom = { id: number; code: string; name: string; symbol?: string };
type Tax = { id: number; code: string; name: string; rate: number };
type InventoryRef = {
  id: number;
  sku: string;
  name: string;
  price: number;
  unitOfMeasureId?: number | null;
  unitOfMeasure?: string;
  defaultTaxCodeId?: number | null;
};
type SupplierRef = {
  id: number;
  name: string;
  legalName?: string | null;
  supplierCode?: string | null;
  onboardingStatus?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  billingAddress?: string | null;
  deliverySite?: string | null;
  registrationNumber?: string | null;
  taxIdentificationNumber?: string | null;
  defaultCurrencyCode?: string | null;
  paymentTermsId?: number | null;
  incotermId?: number | null;
};
type Context = {
  defaultCurrencyCode: string;
  currencies: Currency[];
  unitsOfMeasure: Uom[];
  taxCodes: Tax[];
  items: InventoryRef[];
  paymentTerms: Array<{ id: number; code: string; name: string }>;
  incoterms: Array<{ id: number; code: string; name: string }>;
  organizationDefaults: { taxCodeId?: number | null };
  branding: {
    displayName: string;
    legalName: string;
    logoUrl?: string | null;
    address?: string | null;
    registrationNumber?: string | null;
    taxNumber?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    website?: string | null;
    reportFooter: string;
  };
  template?: { termsText?: string | null; footerText?: string | null } | null;
};
type DraftLine = {
  key: string;
  lineType: "CATALOG" | "NON_STOCK" | "SERVICE";
  inventoryItemId: number | null;
  description: string;
  quantity: string;
  unitOfMeasureId: number;
  unitPrice: string;
  discountPercent: string;
  taxCodeId: number | null;
};
type Quote = {
  id: number;
  version: number;
  quotationNumber: string;
  status: string;
  recipientSource?: "SUPPLIER_MASTER" | "MANUAL";
  recipientSupplierId?: number | null;
  recipientCompany: string;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  recipientAddress?: string | null;
  recipientRegistrationNumber?: string | null;
  recipientTaxNumber?: string | null;
  recipientPhysicalAddress?: string | null;
  recipientBillingAddress?: string | null;
  recipientDeliveryAddress?: string | null;
  supplierLegalName?: string | null;
  supplierRegistrationNumber?: string | null;
  supplierTaxNumber?: string | null;
  supplierPhysicalAddress?: string | null;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  supplierWebsite?: string | null;
  partyEvidenceSource?: "quotation" | "current_profile_fallback";
  currencyCode: string;
  reportingCurrencyCode: string;
  total: number;
  reportingTotal: number;
  validUntil: string;
  lineCount?: number;
  acceptanceTerms?: string;
  legalTerms?: string | null;
  acceptanceMethod?: string;
  paymentTermsId?: number | null;
  incotermId?: number | null;
  paymentTerms?: string | null;
  incoterm?: string | null;
  notes?: string | null;
  acceptedByName?: string | null;
  acceptedAt?: string | null;
  acceptanceReference?: string | null;
  rejectedByName?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  rejectionReference?: string | null;
  evidenceSource?: "quotation" | "audit_log";
  createdAt: string;
};
type Detail = {
  quotation: Quote & Record<string, unknown>;
  lines: Array<Record<string, any>>;
};
type QuotePage = {
  items: Quote[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  summary: { reportingTotal: number };
};

const key = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const money = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
};
const futureDate = (days = 30) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

function PartyDetails({
  title,
  name,
  registrationNumber,
  taxNumber,
  physicalAddress,
  billingAddress,
  deliveryAddress,
  email,
  phone,
  website,
}: {
  title: string;
  name: string;
  registrationNumber?: string | null;
  taxNumber?: string | null;
  physicalAddress?: string | null;
  billingAddress?: string | null;
  deliveryAddress?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{title}</p>
      <p className="mt-2 font-semibold">{name}</p>
      {registrationNumber ? <p className="text-sm text-muted-foreground">Registration: {registrationNumber}</p> : null}
      {taxNumber ? <p className="text-sm text-muted-foreground">Tax/VAT: {taxNumber}</p> : null}
      <p className="mt-2 whitespace-pre-wrap text-sm">{physicalAddress || "Physical address not recorded on this historical quotation"}</p>
      {billingAddress && billingAddress !== physicalAddress ? <p className="mt-2 whitespace-pre-wrap text-sm"><span className="font-medium">Billing:</span> {billingAddress}</p> : null}
      {deliveryAddress ? <p className="mt-2 whitespace-pre-wrap text-sm"><span className="font-medium">Delivery/service:</span> {deliveryAddress}</p> : null}
      {[email, phone, website].filter(Boolean).length ? (
        <p className="mt-2 break-words text-sm text-muted-foreground">{[email, phone, website].filter(Boolean).join(" | ")}</p>
      ) : null}
    </div>
  );
}

function NewInventoryDialog({
  context,
  onCreated,
}: {
  context: Context;
  onCreated: (item: InventoryRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");
  const [uom, setUom] = useState("");
  const { toast } = useToast();
  useEffect(() => {
    if (!uom && context.unitsOfMeasure[0])
      setUom(context.unitsOfMeasure[0].code);
  }, [context.unitsOfMeasure, uom]);
  const mutation = useMutation<InventoryRef>({
    mutationFn: () =>
      requestJson("POST", "/api/inventory", {
        sku: sku.trim(),
        name: name.trim(),
        quantity: 0,
        price: Number(price || 0),
        lowStockThreshold: 0,
        unitOfMeasure: uom,
        location: location.trim() || undefined,
        status: "active",
      }),
    onSuccess: async (item) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/commercial-quotations/context"],
      });
      onCreated(item);
      setOpen(false);
      setSku("");
      setName("");
      setPrice("");
      setLocation("");
      toast({
        title: "Inventory item created",
        description: `${item.sku} is selected on the quotation line.`,
      });
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <PackagePlus className="mr-2 h-4 w-4" />
          Create inventory item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create inventory item</DialogTitle>
          <DialogDescription>
            This explicitly adds a reusable active item to Inventory. Non-stock
            and service quotation lines do not create inventory records.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="new-item-sku">SKU</Label>
            <Input
              id="new-item-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-item-name">Name</Label>
            <Input
              id="new-item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-item-price">Default selling price</Label>
            <Input
              id="new-item-price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-item-uom">Unit of measure</Label>
            <Select value={uom} onValueChange={setUom}>
              <SelectTrigger id="new-item-uom">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {context.unitsOfMeasure.map((row) => (
                  <SelectItem key={row.id} value={row.code}>
                    {row.code} — {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="new-item-location">
              Location (when required by Inventory Settings)
            </Label>
            <Input
              id="new-item-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
        </div>
        {mutation.error ? (
          <p className="text-sm text-destructive">{mutation.error.message}</p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              sku.trim().length < 2 ||
              name.trim().length < 3 ||
              !uom ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Creating…" : "Create and select"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuotationBarcodeDialog({
  onResolved,
}: {
  onResolved: (item: InventoryRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const { toast } = useToast();
  const resolveScan = useCallback(
    async (rawValue: string) => {
      const normalized = rawValue.trim();
      if (!normalized || resolvingRef.current) return;
      resolvingRef.current = true;
      setResolving(true);
      setError("");
      try {
        const item = await requestJson<InventoryRef>(
          "GET",
          `/api/commercial-quotations/scan-item?value=${encodeURIComponent(normalized)}`,
        );
        onResolved(item);
        toast({
          title: "Item added to quotation",
          description: `${item.sku} — ${item.name}`,
        });
        setValue("");
        setOpen(false);
      } catch (scanError) {
        setError(
          scanError instanceof Error
            ? scanError.message
            : "The scanned item could not be resolved.",
        );
      } finally {
        resolvingRef.current = false;
        setResolving(false);
      }
    },
    [onResolved, toast],
  );
  const handleScan = useCallback(
    (result: ScanResult) => void resolveScan(result.text),
    [resolveScan],
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <ScanLine className="mr-2 h-4 w-4" />
          Scan item
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Scan Inventory item</DialogTitle>
          <DialogDescription>
            Scan an item barcode or QR code to add it to this quotation. A USB
            scanner can enter its value in the manual field below.
          </DialogDescription>
        </DialogHeader>
        <BarcodeScanner onScan={handleScan} />
        <div className="space-y-2">
          <Label htmlFor="quotation-scan-value">Barcode, QR value, or SKU</Label>
          <div className="flex gap-2">
            <Input
              id="quotation-scan-value"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void resolveScan(value);
                }
              }}
              placeholder="Scan or enter an item code"
            />
            <Button
              type="button"
              disabled={!value.trim() || resolving}
              onClick={() => void resolveScan(value)}
            >
              {resolving ? "Resolving…" : "Add item"}
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Builder({ editId }: { editId?: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const query = useQuery<Context>({
    queryKey: ["/api/commercial-quotations/context"],
    queryFn: () => requestJson("GET", "/api/commercial-quotations/context"),
  });
  const editQuery = useQuery<Detail>({
    queryKey: ["/api/commercial-quotations", editId],
    queryFn: () =>
      requestJson("GET", `/api/commercial-quotations/${editId}`),
    enabled: Boolean(editId),
  });
  const hydratedVersion = useRef("");
  const [recipientSource, setRecipientSource] = useState<"SUPPLIER_MASTER" | "MANUAL">("SUPPLIER_MASTER");
  const [recipientSupplierId, setRecipientSupplierId] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const debouncedSupplierSearch = useDebouncedValue(supplierSearch, 250);
  const suppliersQuery = useQuery<{ items: SupplierRef[] }>({
    queryKey: ["/api/v2/suppliers", "commercial-quotation-recipient", debouncedSupplierSearch],
    queryFn: () => requestJson("GET", `/api/v2/suppliers?page=1&pageSize=25&q=${encodeURIComponent(debouncedSupplierSearch)}&status=active&sort=name_asc`),
    enabled: recipientSource === "SUPPLIER_MASTER",
    placeholderData: (previous) => previous,
  });
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [physicalAddress, setPhysicalAddress] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [currency, setCurrency] = useState("");
  const [validUntil, setValidUntil] = useState(futureDate());
  const [paymentTermsId, setPaymentTermsId] = useState(0);
  const [incotermId, setIncotermId] = useState(0);
  const [acceptanceMethod, setAcceptanceMethod] = useState<
    "SIGNATURE" | "PURCHASE_ORDER" | "EMAIL_CONFIRMATION"
  >("SIGNATURE");
  const [acceptanceTerms, setAcceptanceTerms] = useState("");
  const [legalTerms, setLegalTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [scannedItems, setScannedItems] = useState<InventoryRef[]>([]);
  useEffect(() => {
    if (!query.data) return;
    setCurrency((v) => v || query.data!.defaultCurrencyCode);
    setAcceptanceTerms(
      (v) =>
        v ||
        query.data!.template?.termsText ||
        "Acceptance confirms agreement to the quoted scope, prices, taxes, validity period, payment terms, delivery conditions, and incorporated terms. Any change requires a revised written quotation.",
    );
  }, [query.data]);
  useEffect(() => {
    const detail = editQuery.data;
    if (!editId || !query.data || !detail) return;
    const quotation = detail.quotation;
    const hydrationKey = `${editId}:${quotation.version}`;
    if (hydratedVersion.current === hydrationKey) return;
    if (quotation.status !== "DRAFT") return;
    hydratedVersion.current = hydrationKey;
    setRecipientSource(quotation.recipientSource ?? "MANUAL");
    setRecipientSupplierId(quotation.recipientSupplierId ? String(quotation.recipientSupplierId) : "");
    setCompany(quotation.recipientCompany);
    setContact(quotation.recipientName ?? "");
    setEmail(quotation.recipientEmail ?? "");
    setPhone(quotation.recipientPhone ?? "");
    setRegistrationNumber(quotation.recipientRegistrationNumber ?? "");
    setTaxNumber(quotation.recipientTaxNumber ?? "");
    setPhysicalAddress(quotation.recipientPhysicalAddress ?? quotation.recipientAddress ?? "");
    setBillingAddress(quotation.recipientBillingAddress ?? "");
    setDeliveryAddress(quotation.recipientDeliveryAddress ?? "");
    setCurrency(quotation.currencyCode);
    setValidUntil(new Date(quotation.validUntil).toISOString().slice(0, 10));
    setPaymentTermsId(Number(quotation.paymentTermsId ?? 0));
    setIncotermId(Number(quotation.incotermId ?? 0));
    setAcceptanceMethod(
      (quotation.acceptanceMethod ?? "SIGNATURE") as
        | "SIGNATURE"
        | "PURCHASE_ORDER"
        | "EMAIL_CONFIRMATION",
    );
    setAcceptanceTerms(quotation.acceptanceTerms ?? "");
    setLegalTerms(quotation.legalTerms ?? "");
    setNotes(quotation.notes ?? "");
    const editLines = detail.lines.map((line) => ({
      key: key(),
      lineType: line.lineType as DraftLine["lineType"],
      inventoryItemId:
        line.inventoryItemId == null ? null : Number(line.inventoryItemId),
      description: String(line.description ?? ""),
      quantity: String(line.quantity ?? 1),
      unitOfMeasureId: Number(line.unitOfMeasureId ?? 0),
      unitPrice: String(line.unitPrice ?? 0),
      discountPercent: String(line.discountPercent ?? 0),
      taxCodeId: line.taxCodeId == null ? null : Number(line.taxCodeId),
    }));
    setLines(editLines);
    setScannedItems(
      detail.lines
        .filter((line) => line.inventoryItemId != null)
        .map((line) => ({
          id: Number(line.inventoryItemId),
          sku: String(line.sku ?? ""),
          name: String(line.description ?? "Inventory item"),
          price: Number(line.unitPrice ?? 0),
          unitOfMeasureId: Number(line.unitOfMeasureId ?? 0) || null,
          defaultTaxCodeId:
            line.taxCodeId == null ? null : Number(line.taxCodeId),
        })),
    );
  }, [editId, editQuery.data, query.data]);
  const supplierRows = suppliersQuery.data?.items ?? [];
  const supplierOptions = supplierRows.map((supplier) => ({
    value: String(supplier.id),
    label: `${supplier.legalName || supplier.name}${supplier.supplierCode ? ` — ${supplier.supplierCode}` : ""}`,
    keywords: [supplier.name, supplier.legalName, supplier.supplierCode, supplier.registrationNumber, supplier.taxIdentificationNumber].filter(Boolean).join(" "),
  }));
  if (recipientSupplierId && !supplierOptions.some((option) => option.value === recipientSupplierId) && company) {
    supplierOptions.unshift({ value: recipientSupplierId, label: company, keywords: company });
  }
  const selectSupplier = (value: string) => {
    setRecipientSupplierId(value);
    const supplier = supplierRows.find((row) => String(row.id) === value);
    if (!supplier) return;
    setCompany(supplier.legalName || supplier.name);
    setContact(supplier.contactName ?? "");
    setEmail(supplier.email ?? "");
    setPhone(supplier.phone ?? "");
    setRegistrationNumber(supplier.registrationNumber ?? "");
    setTaxNumber(supplier.taxIdentificationNumber ?? "");
    setPhysicalAddress(supplier.address ?? "");
    setBillingAddress(supplier.billingAddress ?? "");
    setDeliveryAddress(supplier.deliverySite ?? "");
    if (supplier.defaultCurrencyCode && query.data?.currencies.some((row) => row.code === supplier.defaultCurrencyCode)) setCurrency(supplier.defaultCurrencyCode);
    if (supplier.paymentTermsId) setPaymentTermsId(Number(supplier.paymentTermsId));
    if (supplier.incotermId) setIncotermId(Number(supplier.incotermId));
  };
  const addLine = useCallback(
    (
      type: DraftLine["lineType"] = "CATALOG",
      item?: InventoryRef,
    ) => {
      if (!query.data) return;
      const uom = item?.unitOfMeasureId ?? query.data.unitsOfMeasure[0]?.id ?? 0;
      setLines((current) => [
        ...current,
        {
          key: key(),
          lineType: type,
          inventoryItemId: item?.id ?? null,
          description: item?.name ?? "",
          quantity: "1",
          unitOfMeasureId: uom,
          unitPrice: String(item?.price ?? 0),
          discountPercent: "0",
          taxCodeId:
            item?.defaultTaxCodeId ??
            query.data.organizationDefaults.taxCodeId ??
            null,
        },
      ]);
    },
    [query.data],
  );
  const addScannedItem = useCallback(
    (item: InventoryRef) => {
      setScannedItems((current) =>
        current.some((entry) => entry.id === item.id)
          ? current
          : [...current, item],
      );
      addLine("CATALOG", item);
    },
    [addLine],
  );
  const update = (row: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, index) =>
        index === row ? { ...line, ...patch } : line,
      ),
    );
  const totals = useMemo(
    () =>
      lines.reduce(
        (out, line) => {
          const gross =
            Number(line.quantity || 0) * Number(line.unitPrice || 0);
          const discount = (gross * Number(line.discountPercent || 0)) / 100;
          const net = gross - discount;
          const rate =
            query.data?.taxCodes.find((t) => t.id === line.taxCodeId)?.rate ??
            0;
          const tax = (net * rate) / 100;
          return {
            subtotal: out.subtotal + gross,
            discount: out.discount + discount,
            tax: out.tax + tax,
            total: out.total + net + tax,
          };
        },
        { subtotal: 0, discount: 0, tax: 0, total: 0 },
      ),
    [lines, query.data?.taxCodes],
  );
  const fx =
    query.data?.currencies.find((row) => row.code === currency)
      ?.exchangeRateToZar ?? 0;
  const reporting =
    query.data?.defaultCurrencyCode === currency
      ? totals.total
      : totals.total * fx;
  const invalid =
    (recipientSource === "SUPPLIER_MASTER" && !recipientSupplierId) ||
    !company.trim() ||
    !query.data?.branding.address?.trim() ||
    physicalAddress.trim().length < 5 ||
    !currency ||
    fx <= 0 ||
    !validUntil ||
    acceptanceTerms.trim().length < 20 ||
    lines.length === 0 ||
    lines.some(
      (line) =>
        !line.description.trim() ||
        Number(line.quantity) <= 0 ||
        Number(line.unitPrice) < 0 ||
        !line.unitOfMeasureId ||
        (line.lineType === "CATALOG" && !line.inventoryItemId),
    );
  const mutation = useMutation<Detail>({
    mutationFn: () =>
      requestJson(
        editId ? "PUT" : "POST",
        editId
          ? `/api/commercial-quotations/${editId}`
          : "/api/commercial-quotations",
        {
        recipientSource,
        recipientSupplierId: recipientSource === "SUPPLIER_MASTER" ? Number(recipientSupplierId) : null,
        recipientCompany: company,
        recipientName: contact || null,
        recipientEmail: email || null,
        recipientPhone: phone || null,
        recipientAddress: physicalAddress,
        recipientRegistrationNumber: registrationNumber || null,
        recipientTaxNumber: taxNumber || null,
        recipientPhysicalAddress: physicalAddress,
        recipientBillingAddress: billingAddress || null,
        recipientDeliveryAddress: deliveryAddress || null,
        currencyCode: currency,
        validUntil,
        paymentTermsId: paymentTermsId || null,
        incotermId: incotermId || null,
        acceptanceMethod,
        acceptanceTerms,
        legalTerms: legalTerms || null,
        notes: notes || null,
        lines: lines.map((line) => ({
          ...line,
          key: undefined,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountPercent: Number(line.discountPercent),
          taxCodeId: line.taxCodeId || null,
        })),
        ...(editId
          ? { expectedVersion: editQuery.data?.quotation.version }
          : {}),
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        ["/api/commercial-quotations", result.quotation.id],
        result,
      );
      await queryClient.invalidateQueries({
        queryKey: ["/api/v2/commercial-quotations"],
      });
      toast({
        title: editId
          ? "Quotation draft updated"
          : "Quotation draft created",
        description:
          "Amounts and reporting-currency conversion were recalculated and locked by the server.",
      });
      navigate(APP_ROUTES.procurement.commercialQuotation(result.quotation.id));
    },
  });
  if (query.isLoading || (editId && editQuery.isLoading))
    return (
      <PageShell>
        <div className="py-16 text-center text-muted-foreground">
          {editId ? "Loading quotation draft…" : "Loading Master Data and company branding…"}
        </div>
      </PageShell>
    );
  if (query.error || !query.data || (editId && editQuery.error))
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertTitle>Quotation setup unavailable</AlertTitle>
          <AlertDescription>
            {query.error?.message ?? editQuery.error?.message ?? "Master Data could not be loaded."}
            <Button
              className="ml-3"
              variant="outline"
              size="sm"
              onClick={() => {
                void query.refetch();
                if (editId) void editQuery.refetch();
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  const context = query.data;
  if (editId && editQuery.data?.quotation.status !== "DRAFT")
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertTitle>Quotation is no longer editable</AlertTitle>
          <AlertDescription>
            Issued, accepted, and rejected quotations are immutable audit
            evidence. Return to the quotation and create a revision if needed.
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  const availableItems = [
    ...context.items,
    ...scannedItems.filter(
      (item) => !context.items.some((entry) => entry.id === item.id),
    ),
  ];
  const itemOptions = availableItems.map((item) => ({
    value: String(item.id),
    label: `${item.sku} — ${item.name}`,
    keywords: item.name,
  }));
  return (
    <PageShell variant="wide-form" data-testid="commercial-quotation-builder">
      <PageHeader
        title={editId ? `Edit ${editQuery.data?.quotation.quotationNumber}` : "Build commercial quotation"}
        subtitle={editId ? "Update this draft before it enters the approval workflow." : "Create a branded customer-facing offer from live Master Data, Inventory, tax, and exchange rates."}
        breadcrumb={
          <Link href={APP_ROUTES.procurement.commercialQuotations}>
            Commercial quotations
          </Link>
        }
      />
      <Alert>
        <AlertTitle>Authoritative pricing and terms</AlertTitle>
        <AlertDescription>
          Inventory and Master Data references are validated by the server. The
          saved quotation snapshots descriptions, taxes, FX, terms, and totals
          for audit stability. Acceptance wording is organization-managed
          commercial content and should be reviewed by your legal adviser.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Company branding</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-5">
          {context.branding.logoUrl ? (
            <img
              src={context.branding.logoUrl.startsWith("/uploads/company-logos/") ? "/api/organization/company-logo" : context.branding.logoUrl}
              alt={`${context.branding.displayName} logo`}
              className="h-16 w-32 object-contain"
            />
          ) : (
            <div className="flex h-16 w-32 items-center justify-center rounded border text-xs text-muted-foreground">
              No company logo
            </div>
          )}
          <div>
            <p className="text-lg font-semibold">
              {context.branding.displayName}
            </p>
            {context.branding.legalName.trim() !==
            context.branding.displayName.trim() ? (
              <p className="text-sm text-muted-foreground">
                {context.branding.legalName}
              </p>
            ) : null}
            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              <p>{context.branding.address || "Physical address required in Company Setup"}</p>
              {context.branding.registrationNumber ? <p>Registration: {context.branding.registrationNumber}</p> : null}
              {context.branding.taxNumber ? <p>Tax/VAT: {context.branding.taxNumber}</p> : null}
              {[context.branding.contactEmail, context.branding.contactPhone, context.branding.website].filter(Boolean).length ? (
                <p>{[context.branding.contactEmail, context.branding.contactPhone, context.branding.website].filter(Boolean).join(" | ")}</p>
              ) : null}
            </div>
            {context.branding.reportFooter.trim() &&
            ![
              context.branding.displayName.trim(),
              context.branding.legalName.trim(),
            ].includes(context.branding.reportFooter.trim()) ? (
              <p className="text-xs text-muted-foreground">
                {context.branding.reportFooter}
              </p>
            ) : null}
          </div>
          <Button className="ml-auto" variant="outline" asChild>
            <Link href={APP_ROUTES.admin.companySetup}>Company Setup</Link>
          </Button>
        </CardContent>
      </Card>
      {!context.branding.address?.trim() ? (
        <Alert variant="destructive">
          <AlertTitle>Issuing company physical address required</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Complete the issuing company's physical address before saving a legally identifiable quotation.</span>
            <Button variant="outline" size="sm" asChild><Link href={APP_ROUTES.admin.companySetup}>Open Company Setup</Link></Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Quotation recipient and validity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recipient-source">Recipient source</Label>
              <Select value={recipientSource} onValueChange={(value: "SUPPLIER_MASTER" | "MANUAL") => {
                setRecipientSource(value);
                if (value === "MANUAL") setRecipientSupplierId("");
              }}>
                <SelectTrigger id="recipient-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SUPPLIER_MASTER">Onboarded supplier</SelectItem>
                  <SelectItem value="MANUAL">Supplier not onboarded</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {recipientSource === "SUPPLIER_MASTER" ? (
              <div className="space-y-2">
                <Label htmlFor="recipient-supplier">Supplier *</Label>
                <SearchableRecordCombobox
                  id="recipient-supplier"
                  value={recipientSupplierId}
                  options={supplierOptions}
                  onValueChange={selectSupplier}
                  onSearchChange={setSupplierSearch}
                  serverFiltered
                  maxSuggestions={25}
                  placeholder={suppliersQuery.isLoading ? "Loading suppliers…" : "Select supplier"}
                  searchPlaceholder="Search supplier name, code, registration, or VAT…"
                  emptyMessage={suppliersQuery.isError ? "Supplier search failed. Retry below." : "No active supplier matches this search."}
                  disabled={suppliersQuery.isLoading && !suppliersQuery.data}
                  ariaLabel="Select onboarded quotation recipient"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Legal and contact details are refreshed from Suppliers when you save.</span>
                  <div className="flex items-center gap-2">
                    {recipientSupplierId ? <Link className="underline" href={`/procurement/suppliers/${recipientSupplierId}`}>Open supplier record</Link> : null}
                    {suppliersQuery.isError ? <Button type="button" size="sm" variant="outline" onClick={() => void suppliersQuery.refetch()}>Retry supplier search</Button> : null}
                  </div>
                </div>
              </div>
            ) : (
              <Alert>
                <AlertTitle>Supplier not onboarded</AlertTitle>
                <AlertDescription>Enter the recipient details manually. The saved quotation will preserve them as a one-document snapshot and will not silently create a Supplier record.</AlertDescription>
              </Alert>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="recipient-company">Registered supplier name *</Label>
            <Input
              id="recipient-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={recipientSource === "SUPPLIER_MASTER"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipient-contact">Contact person</Label>
            <Input
              id="recipient-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              disabled={recipientSource === "SUPPLIER_MASTER"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipient-email">Email</Label>
            <Input
              id="recipient-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={recipientSource === "SUPPLIER_MASTER"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipient-phone">Phone</Label>
            <Input
              id="recipient-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={recipientSource === "SUPPLIER_MASTER"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipient-registration">Registration / company number</Label>
            <Input id="recipient-registration" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} disabled={recipientSource === "SUPPLIER_MASTER"} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipient-tax">Tax / VAT number</Label>
            <Input id="recipient-tax" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} disabled={recipientSource === "SUPPLIER_MASTER"} />
          </div>
          <div className="space-y-2 lg:col-span-3">
            <Label htmlFor="recipient-physical-address">Supplier physical address *</Label>
            <Textarea
              id="recipient-physical-address"
              rows={2}
              value={physicalAddress}
              onChange={(e) => setPhysicalAddress(e.target.value)}
              placeholder="Street, suburb/district, city, postal code, country"
              disabled={recipientSource === "SUPPLIER_MASTER"}
            />
          </div>
          <div className="space-y-2 lg:col-span-3">
            <Label htmlFor="recipient-billing-address">Billing address (only if different)</Label>
            <Textarea
              id="recipient-billing-address"
              rows={2}
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              placeholder="Leave blank to use the physical address"
              disabled={recipientSource === "SUPPLIER_MASTER"}
            />
          </div>
          <div className="space-y-2 lg:col-span-3">
            <Label htmlFor="recipient-delivery-address">Delivery / service address (if applicable)</Label>
            <Textarea
              id="recipient-delivery-address"
              rows={2}
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Where goods will be delivered or services performed"
              disabled={recipientSource === "SUPPLIER_MASTER"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quote-currency">Quotation currency *</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="quote-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {context.currencies.map((row) => (
                  <SelectItem
                    key={row.id}
                    value={row.code}
                    disabled={row.exchangeRateToZar <= 0}
                  >
                    {row.code} — {row.name}
                    {row.exchangeRateToZar <= 0 ? " (rate required)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quote-valid">Valid until *</Label>
            <Input
              id="quote-valid"
              type="date"
              min={futureDate(0)}
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
          <div className="rounded-md border p-3 text-sm">
            <p className="text-muted-foreground">Reporting conversion</p>
            <p className="font-semibold">
              1 {currency} = {fx || "rate required"}{" "}
              {context.defaultCurrencyCode}
            </p>
          </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Quotation items</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick catalog items, explicitly create an Inventory item, or quote
              a non-stock/service line.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuotationBarcodeDialog onResolved={addScannedItem} />
            <NewInventoryDialog
              context={context}
              onCreated={addScannedItem}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => addLine("NON_STOCK")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Non-stock
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => addLine("SERVICE")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Service
            </Button>
            <Button type="button" onClick={() => addLine("CATALOG")}>
              <Plus className="mr-2 h-4 w-4" />
              Inventory item
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-36">Type</TableHead>
                  <TableHead className="min-w-72">Item / description</TableHead>
                  <TableHead className="min-w-28">Qty</TableHead>
                  <TableHead className="min-w-40">UOM</TableHead>
                  <TableHead className="min-w-32">Unit price</TableHead>
                  <TableHead className="min-w-28">Discount %</TableHead>
                  <TableHead className="min-w-40">Tax</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const gross =
                    Number(line.quantity || 0) * Number(line.unitPrice || 0);
                  const net =
                    gross * (1 - Number(line.discountPercent || 0) / 100);
                  const taxRate =
                    context.taxCodes.find((t) => t.id === line.taxCodeId)
                      ?.rate ?? 0;
                  return (
                    <TableRow key={line.key}>
                      <TableCell>
                        <Select
                          value={line.lineType}
                          onValueChange={(value: DraftLine["lineType"]) =>
                            update(index, {
                              lineType: value,
                              inventoryItemId:
                                value === "CATALOG"
                                  ? line.inventoryItemId
                                  : null,
                            })
                          }
                        >
                          <SelectTrigger aria-label={`Line ${index + 1} type`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CATALOG">Catalog</SelectItem>
                            <SelectItem value="NON_STOCK">Non-stock</SelectItem>
                            <SelectItem value="SERVICE">Service</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {line.lineType === "CATALOG" ? (
                          <SearchableRecordCombobox
                            value={
                              line.inventoryItemId
                                ? String(line.inventoryItemId)
                                : ""
                            }
                            options={itemOptions}
                            placeholder="Search Inventory"
                            searchPlaceholder="Search SKU or item name"
                            maxSuggestions={25}
                            ariaLabel={`Inventory item for line ${index + 1}`}
                            onValueChange={(value) => {
                              const item = availableItems.find(
                                (row) => row.id === Number(value),
                              );
                              if (item)
                                update(index, {
                                  inventoryItemId: item.id,
                                  description: item.name,
                                  unitPrice: String(item.price ?? 0),
                                  unitOfMeasureId:
                                    item.unitOfMeasureId ??
                                    line.unitOfMeasureId,
                                  taxCodeId:
                                    item.defaultTaxCodeId ?? line.taxCodeId,
                                });
                            }}
                          />
                        ) : (
                          <Input
                            aria-label={`Description for line ${index + 1}`}
                            value={line.description}
                            onChange={(e) =>
                              update(index, { description: e.target.value })
                            }
                            placeholder={
                              line.lineType === "SERVICE"
                                ? "Service description"
                                : "Non-stock description"
                            }
                          />
                        )}{" "}
                        {line.lineType === "CATALOG" && line.inventoryItemId ? (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {
                              availableItems.find(
                                (item) => item.id === line.inventoryItemId,
                              )?.sku
                            }{" "}
                            — {line.description}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Quantity for line ${index + 1}`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={line.quantity}
                          onChange={(e) =>
                            update(index, { quantity: e.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={
                            line.unitOfMeasureId
                              ? String(line.unitOfMeasureId)
                              : ""
                          }
                          onValueChange={(value) =>
                            update(index, { unitOfMeasureId: Number(value) })
                          }
                        >
                          <SelectTrigger
                            aria-label={`UOM for line ${index + 1}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {context.unitsOfMeasure.map((row) => (
                              <SelectItem key={row.id} value={String(row.id)}>
                                {row.code} — {row.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Unit price for line ${index + 1}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) =>
                            update(index, { unitPrice: e.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Discount for line ${index + 1}`}
                          type="number"
                          min="0"
                          max="100"
                          value={line.discountPercent}
                          onChange={(e) =>
                            update(index, { discountPercent: e.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={
                            line.taxCodeId ? String(line.taxCodeId) : "none"
                          }
                          onValueChange={(value) =>
                            update(index, {
                              taxCodeId:
                                value === "none" ? null : Number(value),
                            })
                          }
                        >
                          <SelectTrigger
                            aria-label={`Tax code for line ${index + 1}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No tax</SelectItem>
                            {context.taxCodes.map((row) => (
                              <SelectItem key={row.id} value={String(row.id)}>
                                {row.code} — {row.rate}%
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="font-medium">
                        {money(net * (1 + taxRate / 100), currency)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove quotation line ${index + 1}`}
                          onClick={() =>
                            setLines((current) =>
                              current.filter((_, row) => row !== index),
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="h-28 text-center text-muted-foreground"
                    >
                      Add an Inventory, non-stock, or service item to begin.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>Commercial and acceptance rules</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="payment-terms">Payment terms</Label>
              <Select
                value={paymentTermsId ? String(paymentTermsId) : "none"}
                onValueChange={(v) =>
                  setPaymentTermsId(v === "none" ? 0 : Number(v))
                }
              >
                <SelectTrigger id="payment-terms">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {context.paymentTerms.map((row) => (
                    <SelectItem key={row.id} value={String(row.id)}>
                      {row.code} — {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="incoterm">Delivery / Incoterm</Label>
              <Select
                value={incotermId ? String(incotermId) : "none"}
                onValueChange={(v) =>
                  setIncotermId(v === "none" ? 0 : Number(v))
                }
              >
                <SelectTrigger id="incoterm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {context.incoterms.map((row) => (
                    <SelectItem key={row.id} value={String(row.id)}>
                      {row.code} — {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="accept-method">Acceptance evidence</Label>
              <Select
                value={acceptanceMethod}
                onValueChange={(v: typeof acceptanceMethod) =>
                  setAcceptanceMethod(v)
                }
              >
                <SelectTrigger id="accept-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SIGNATURE">Signed quotation</SelectItem>
                  <SelectItem value="PURCHASE_ORDER">
                    Customer purchase order
                  </SelectItem>
                  <SelectItem value="EMAIL_CONFIRMATION">
                    Written email confirmation
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-notes">Internal / customer notes</Label>
              <Input
                id="quote-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="accept-terms">Rules of acceptance *</Label>
              <Textarea
                id="accept-terms"
                rows={5}
                value={acceptanceTerms}
                onChange={(e) => setAcceptanceTerms(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                State what constitutes acceptance, expiry, revision control,
                price/tax scope, and incorporated conditions.
              </p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="legal-terms">
                Additional legal / commercial conditions
              </Label>
              <Textarea
                id="legal-terms"
                rows={5}
                value={legalTerms}
                onChange={(e) => setLegalTerms(e.target.value)}
                placeholder="Warranty, exclusions, delivery risk, governing law, privacy, or organization-approved standard clauses"
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <strong>{money(totals.subtotal, currency)}</strong>
            </div>
            <div className="flex justify-between">
              <span>Discount</span>
              <strong>-{money(totals.discount, currency)}</strong>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <strong>{money(totals.tax, currency)}</strong>
            </div>
            <div className="flex justify-between border-t pt-3 text-lg">
              <span>Total</span>
              <strong>{money(totals.total, currency)}</strong>
            </div>
            <div className="rounded bg-muted p-3">
              <p className="text-muted-foreground">Reporting value</p>
              <p className="text-lg font-semibold">
                {money(reporting, context.defaultCurrencyCode)}
              </p>
              <p className="text-xs text-muted-foreground">
                Locked at {fx} {context.defaultCurrencyCode} per {currency} when
                saved.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      {mutation.error ? (
        <Alert variant="destructive">
          <AlertTitle>Quotation could not be saved</AlertTitle>
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() =>
            navigate(
              editId
                ? APP_ROUTES.procurement.commercialQuotation(editId)
                : APP_ROUTES.procurement.commercialQuotations,
            )
          }
        >
          Cancel
        </Button>
        <Button
          data-testid="save-commercial-quotation"
          disabled={invalid || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending
            ? "Validating and saving…"
            : editId
              ? "Update quotation draft"
              : "Save quotation draft"}
        </Button>
      </div>
    </PageShell>
  );
}

function ListPage() {
  const [page, setPage] = useState(1);
  const query = useQuery<QuotePage>({
    queryKey: ["/api/v2/commercial-quotations", page],
    queryFn: () =>
      requestJson(
        "GET",
        `/api/v2/commercial-quotations?page=${page}&pageSize=25`,
      ),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.items ?? [];
  return (
    <PageShell variant="wide-table" data-testid="commercial-quotations-page">
      <PageHeader
        title="Commercial quotations"
        subtitle="Build, approve, issue, and record acceptance of customer-facing quotations."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={APP_ROUTES.procurement.quotations}>
                Supplier responses
              </Link>
            </Button>
            <Button asChild>
              <Link href={APP_ROUTES.procurement.quotationNew}>
                <FilePlus2 className="mr-2 h-4 w-4" />
                Build quotation
              </Link>
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent className="p-0">
          <PageDataState
            isLoading={query.isLoading}
            error={query.error}
            isEmpty={rows.length === 0}
            onRetry={() => void query.refetch()}
            emptyView={
              <div className="p-12 text-center">
                <p className="font-medium">No commercial quotations yet</p>
                <p className="text-sm text-muted-foreground">
                  Build the first branded quotation from Inventory and Master
                  Data.
                </p>
              </div>
            }
          >
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quotation</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead>Quote total</TableHead>
                      <TableHead>Reporting total</TableHead>
                      <TableHead>Valid until</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">
                          {row.quotationNumber}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.recipientCompany}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.status === "ACCEPTED"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{row.lineCount}</TableCell>
                        <TableCell>
                          {money(row.total, row.currencyCode)}
                        </TableCell>
                        <TableCell>
                          {money(row.reportingTotal, row.reportingCurrencyCode)}
                        </TableCell>
                        <TableCell>
                          {new Date(row.validUntil).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" asChild>
                            <Link
                              href={APP_ROUTES.procurement.commercialQuotation(
                                row.id,
                              )}
                            >
                              Review
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between border-t p-3 text-sm">
                <span>{query.data?.total ?? 0} quotations</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((v) => v - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!query.data?.hasNext}
                    onClick={() => setPage((v) => v + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          </PageDataState>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function DetailPage({ id }: { id: number }) {
  const { toast } = useToast();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [acceptedByName, setAcceptedByName] = useState("");
  const [acceptanceReference, setAcceptanceReference] = useState("");
  const [rejectedByName, setRejectedByName] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionReference, setRejectionReference] = useState("");
  const query = useQuery<Detail>({
    queryKey: ["/api/commercial-quotations", id],
    queryFn: () => requestJson("GET", `/api/commercial-quotations/${id}`),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const action = useMutation<
    Detail,
    { message: string },
    { name: string; payload?: Record<string, unknown> }
  >({
    mutationFn: ({ name, payload }) =>
      requestJson(
        "POST",
        `/api/commercial-quotations/${id}/${name}`,
        payload ??
          (name === "approve" ? { reason: "Commercial terms reviewed" } : {}),
      ),
    onSuccess: async (result, variables) => {
      queryClient.setQueryData(["/api/commercial-quotations", id], result);
      await queryClient.invalidateQueries({
        queryKey: ["/api/commercial-quotations", id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/v2/commercial-quotations"],
      });
      if (variables.name === "accept") {
        setAcceptOpen(false);
        setAcceptedByName("");
        setAcceptanceReference("");
      }
      if (variables.name === "reject") {
        setRejectOpen(false);
        setRejectedByName("");
        setRejectionReason("");
        setRejectionReference("");
      }
      toast({ title: "Quotation status updated" });
    },
  });
  if (query.isLoading)
    return (
      <PageShell>
        <div className="py-16 text-center">Loading quotation…</div>
      </PageShell>
    );
  if (query.error || !query.data)
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertTitle>Quotation unavailable</AlertTitle>
          <AlertDescription>{query.error?.message}</AlertDescription>
        </Alert>
      </PageShell>
    );
  const q = query.data.quotation;
  return (
    <PageShell variant="wide-table" data-testid="commercial-quotation-detail">
      <PageHeader
        title={q.quotationNumber}
        subtitle={`Commercial quotation for ${q.recipientCompany}`}
        breadcrumb={
          <Link href={APP_ROUTES.procurement.commercialQuotations}>
            Commercial quotations
          </Link>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a
                href={`/api/commercial-quotations/${id}/document.pdf`}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="mr-2 h-4 w-4" />
                Preview PDF
              </a>
            </Button>
            {q.status === "DRAFT" ? (
              <>
                <Button variant="outline" asChild>
                  <Link href={APP_ROUTES.procurement.commercialQuotationEdit(id)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit draft
                  </Link>
                </Button>
                <Button onClick={() => action.mutate({ name: "submit" })}>
                  Submit for approval
                </Button>
              </>
            ) : null}
            {q.status === "PENDING_APPROVAL" ? (
              <Button onClick={() => action.mutate({ name: "approve" })}>
                Approve
              </Button>
            ) : null}
            {q.status === "APPROVED" ? (
              <Button onClick={() => action.mutate({ name: "issue" })}>
                <Send className="mr-2 h-4 w-4" />
                Mark issued
              </Button>
            ) : null}
            {q.status === "ISSUED" ? (
              <>
                <Button variant="outline" onClick={() => setRejectOpen(true)}>
                  Record rejection
                </Button>
                <Button onClick={() => setAcceptOpen(true)}>
                  Record acceptance
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex min-h-24 flex-col justify-between gap-2 p-4">
            <p className="text-sm text-muted-foreground">Status</p>
            <Badge className="w-fit">{q.status}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex min-h-24 flex-col justify-between gap-2 p-4">
            <p className="text-sm text-muted-foreground">Quote value</p>
            <p className="font-semibold tabular-nums">{money(q.total, q.currencyCode)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex min-h-24 flex-col justify-between gap-2 p-4">
            <p className="text-sm text-muted-foreground">Reporting value</p>
            <p className="font-semibold tabular-nums">
              {money(q.reportingTotal, q.reportingCurrencyCode)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex min-h-24 flex-col justify-between gap-2 p-4">
            <p className="text-sm text-muted-foreground">Valid until</p>
            <p className="font-semibold tabular-nums">
              {new Date(q.validUntil).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Document parties</CardTitle>
            <Badge variant="outline">
              {q.recipientSource === "SUPPLIER_MASTER" ? "Supplier workspace snapshot" : "Not-onboarded supplier snapshot"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <PartyDetails
            title="Customer / issuer"
            name={q.supplierLegalName || "Issuing organization"}
            registrationNumber={q.supplierRegistrationNumber}
            taxNumber={q.supplierTaxNumber}
            physicalAddress={q.supplierPhysicalAddress}
            email={q.supplierEmail}
            phone={q.supplierPhone}
            website={q.supplierWebsite}
          />
          <PartyDetails
            title="Supplier / quote to"
            name={q.recipientCompany}
            registrationNumber={q.recipientRegistrationNumber}
            taxNumber={q.recipientTaxNumber}
            physicalAddress={q.recipientPhysicalAddress || q.recipientAddress}
            billingAddress={q.recipientBillingAddress}
            deliveryAddress={q.recipientDeliveryAddress}
            email={q.recipientEmail}
            phone={q.recipientPhone}
          />
        </CardContent>
        {q.partyEvidenceSource === "current_profile_fallback" ? (
          <CardContent className="pt-0 text-xs text-amber-700 dark:text-amber-300">
            This historical quotation predates party snapshots. Issuing-company details shown here come from the current Company Setup profile; create a revision before reissuing it.
          </CardContent>
        ) : null}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Quotation lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Unit price</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.lineNumber}</TableCell>
                    <TableCell>{line.lineType}</TableCell>
                    <TableCell>{line.sku || "—"}</TableCell>
                    <TableCell>{line.description}</TableCell>
                    <TableCell>
                      {line.quantity} {line.unitOfMeasureCode}
                    </TableCell>
                    <TableCell>
                      {money(Number(line.unitPrice), q.currencyCode)}
                    </TableCell>
                    <TableCell>
                      {line.taxCode || "None"} ({line.taxRate}%)
                    </TableCell>
                    <TableCell className="font-medium">
                      {money(Number(line.lineTotal), q.currencyCode)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Acceptance and legal conditions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">
              Acceptance evidence:{" "}
              {String(q.acceptanceMethod).replaceAll("_", " ")}
            </p>
            <p className="mt-1 whitespace-pre-wrap">
              {String(q.acceptanceTerms)}
            </p>
          </div>
          {q.legalTerms ? (
            <div>
              <p className="font-medium">Additional conditions</p>
              <p className="mt-1 whitespace-pre-wrap">{String(q.legalTerms)}</p>
            </div>
          ) : null}
          {q.status === "ACCEPTED" ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="font-medium">Recorded acceptance</p>
              <p className="mt-1">
                Accepted by {String(q.acceptedByName || "Not recorded")}
              </p>
              <p className="text-muted-foreground">
                Evidence: {String(q.acceptanceReference || "Not recorded")}
              </p>
            </div>
          ) : null}
          {q.status === "REJECTED" ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="font-medium">Recorded rejection</p>
              <p className="mt-1">
                Rejected by {String(q.rejectedByName || "Not recorded")}
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                Reason: {String(q.rejectionReason || "Not recorded")}
              </p>
              <p className="text-muted-foreground">
                Evidence: {String(q.rejectionReference || "Not supplied")}
              </p>
              {q.evidenceSource === "audit_log" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Recovered from the immutable audit trail.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      {action.error ? (
        <Alert variant="destructive">
          <AlertTitle>Status update failed</AlertTitle>
          <AlertDescription>{action.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record customer acceptance</DialogTitle>
            <DialogDescription>
              Record the real customer or authorized contact and an auditable
              evidence reference. This permanently changes the quotation to
              Accepted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="accepted-by-name">Accepted by *</Label>
              <Input
                id="accepted-by-name"
                value={acceptedByName}
                onChange={(event) => setAcceptedByName(event.target.value)}
                placeholder="Customer name or authorized contact"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acceptance-reference">
                Evidence reference *
              </Label>
              <Input
                id="acceptance-reference"
                value={acceptanceReference}
                onChange={(event) => setAcceptanceReference(event.target.value)}
                placeholder="Signed document, PO number, or email reference"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAcceptOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                acceptedByName.trim().length < 2 ||
                acceptanceReference.trim().length < 3 ||
                action.isPending
              }
              onClick={() =>
                action.mutate({
                  name: "accept",
                  payload: {
                    acceptedByName: acceptedByName.trim(),
                    acceptanceReference: acceptanceReference.trim(),
                  },
                })
              }
            >
              {action.isPending ? "Recording…" : "Record acceptance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record customer rejection</DialogTitle>
            <DialogDescription>
              Save the rejecting party, reason, and any external evidence. This
              permanently changes the issued quotation to Rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rejected-by-name">Rejected by *</Label>
              <Input
                id="rejected-by-name"
                value={rejectedByName}
                onChange={(event) => setRejectedByName(event.target.value)}
                placeholder="Customer name or authorized contact"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rejection-reason">Reason *</Label>
              <Textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Why the customer rejected this quotation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rejection-reference">Evidence reference</Label>
              <Input
                id="rejection-reference"
                value={rejectionReference}
                onChange={(event) => setRejectionReference(event.target.value)}
                placeholder="Email, meeting note, or document reference"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                rejectedByName.trim().length < 2 ||
                rejectionReason.trim().length < 5 ||
                action.isPending
              }
              onClick={() =>
                action.mutate({
                  name: "reject",
                  payload: {
                    rejectedByName: rejectedByName.trim(),
                    rejectionReason: rejectionReason.trim(),
                    rejectionReference: rejectionReference.trim() || null,
                  },
                })
              }
            >
              {action.isPending ? "Recording…" : "Record rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

export default function CommercialQuotationsPage() {
  const [location] = useLocation();
  const [isEdit, editParams] = useRoute(
    `${APP_ROUTES.procurement.commercialQuotations}/:id/edit`,
  );
  const [isDetail, params] = useRoute(
    `${APP_ROUTES.procurement.commercialQuotations}/:id`,
  );
  if (location === APP_ROUTES.procurement.quotationNew) return <Builder />;
  if (isEdit && Number(editParams?.id) > 0)
    return <Builder editId={Number(editParams!.id)} />;
  if (isDetail && Number(params?.id) > 0)
    return <DetailPage id={Number(params!.id)} />;
  return <ListPage />;
}
