import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DataState } from "@/components/ui/data-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/hooks/use-settings";
import { useReportingMoney } from "@/hooks/use-reporting-money";
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
import { errorMessageWithRequestId, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { invalidateInvoiceDomain } from "@/lib/domain-invalidation";
import {
  parseExportFailureMessage,
  isLikelyCsvResponse,
  sniffBlobExportKind,
  messageIfBlobLooksLikeJsonError,
  invoiceExportMagicMatchesFormat,
} from "@/lib/export-download";
import { downloadFile } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download } from "lucide-react";
import type { InventoryItem } from "@shared/schema";
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";
import { PanelInlineError } from "@/components/panel-inline-error";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { procurementPoRecordItemsUrl, PROCUREMENT_PURCHASE_ORDER_RECORDS_PATH } from "@/api/procurement-purchase-order-paths";
import { Separator } from "@/components/ui/separator";

function queryErrorDetail(e: unknown): string {
  if (e == null) return "";
  const err = e as Error & { requestId?: string };
  const rid = typeof err.requestId === "string" ? err.requestId.trim() : "";
  const msg = err instanceof Error && err.message ? err.message : String(e);
  return rid ? `${msg} Request ID: ${rid}.` : msg;
}

type Invoice = {
  id: number;
  invoiceNumber: string;
  supplierId: number | null;
  purchaseOrderId: number | null;
  status: string;
  totalAmount: number | null;
  dueDate: string | null;
};

type Supplier = { id: number; name: string };
type PurchaseOrder = { id: number; orderNumber: string; supplierId: number; status: string };
type PurchaseOrderItem = {
  id: number;
  itemId: number;
  quantity: number;
  unitPrice: number;
  receivedQuantity?: number | null;
};
type TaxCode = { id: number; code: string; name: string; rate: number };

type MatchResult = {
  matched: boolean;
  status: string;
  mismatches: Array<{ type: string; itemId: number; message: string }>;
};

function normalizeInvoiceMatchResult(raw: unknown): MatchResult | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const matched = Boolean(r.matched);
  const matchResult =
    r.matchResult && typeof r.matchResult === "object"
      ? (r.matchResult as Record<string, unknown>)
      : null;
  const status =
    (typeof matchResult?.status === "string" ? matchResult.status : null) ??
    (matched ? "MATCHED" : "EXCEPTION");
  const mismatchesRaw = Array.isArray(r.mismatches) ? r.mismatches : [];
  const mismatches = mismatchesRaw.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return { type: "UNKNOWN", itemId: 0, message: "Invalid mismatch entry" };
    }
    const o = entry as Record<string, unknown>;
    const type =
      typeof o.type === "string" ? o.type : typeof o.code === "string" ? o.code : "MISMATCH";
    const itemId = typeof o.itemId === "number" ? o.itemId : Number(o.itemId) || 0;
    const message = typeof o.message === "string" ? o.message : "Mismatch";
    return { type, itemId, message };
  });
  return { matched, status, mismatches };
}

type InvoiceLineRow = {
  id: number;
  invoiceId: number;
  itemId: number;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  totalPrice: number;
};

function invoiceLineTotals(qty: number, unitPrice: number, taxRatePct: number) {
  const lineSubtotal = qty * unitPrice;
  const taxAmount = (lineSubtotal * taxRatePct) / 100;
  return { taxAmount, totalPrice: lineSubtotal + taxAmount };
}

function isInvoiceLinesLocked(status: string) {
  const s = String(status).toUpperCase();
  return s === "PAID" || s === "CANCELLED" || s === "VOID";
}

export default function InvoicesPage() {
  const { settings } = useSettings();
  const { formatMoney, currencyCode } = useReportingMoney();
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState<string>("none");
  const [purchaseOrderId, setPurchaseOrderId] = useState<string>("none");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [taxCodeId, setTaxCodeId] = useState<string>("none");
  const [matchResults, setMatchResults] = useState<Record<number, MatchResult>>({});
  const [activeInvoiceId, setActiveInvoiceId] = useState<number | null>(null);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editDue, setEditDue] = useState("");
  const [deleteInvoice, setDeleteInvoice] = useState<Invoice | null>(null);
  const [linesEditInvoice, setLinesEditInvoice] = useState<Invoice | null>(null);
  const [lineDrafts, setLineDrafts] = useState<
    Record<number, { quantity: string; unitPrice: string; taxRate: string }>
  >({});
  const [newLineItemId, setNewLineItemId] = useState<string>("none");
  const [newLineQty, setNewLineQty] = useState("1");
  const [newLineUnitPrice, setNewLineUnitPrice] = useState("");
  const [newLineTaxRate, setNewLineTaxRate] = useState("0");
  const [invoiceExporting, setInvoiceExporting] = useState(false);

  const exportInvoices = async (format: "pdf" | "csv" | "excel" | "docx") => {
    if (invoiceExporting) return;
    setInvoiceExporting(true);
    try {
      const qs = new URLSearchParams();
      if (format === "pdf") qs.set("template", "standard");
      const q = qs.toString();
      const url = `/api/export/invoices/${format}${q ? `?${q}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        const detail =
          response.status === 403
            ? "Exports are disabled for this organization or you do not have access."
            : await parseExportFailureMessage(response);
        throw new Error(detail);
      }
      const ct = (response.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const detail = await parseExportFailureMessage(response);
        throw new Error(detail || "Export failed: server returned JSON instead of a file.");
      }
      const declaredFormat = response.headers.get("X-Export-Format");
      if (declaredFormat && declaredFormat !== format) {
        throw new Error(
          `Export format mismatch (requested ${format}, server declared ${declaredFormat}). Try again or contact support.`,
        );
      }
      const ctOk =
        format === "pdf"
          ? ct.includes("application/pdf")
          : format === "csv"
            ? isLikelyCsvResponse(response)
            : format === "excel"
              ? ct.includes("spreadsheetml") || ct.includes("application/vnd.ms-excel")
              : ct.includes("wordprocessingml") || ct.includes("application/msword");
      const blob = await response.blob();
      const jsonErr = await messageIfBlobLooksLikeJsonError(blob);
      if (jsonErr) {
        throw new Error(jsonErr);
      }
      const sniff = await sniffBlobExportKind(blob);
      if (!ctOk) {
        const magicOk = invoiceExportMagicMatchesFormat(format, sniff);
        const dev = Boolean(import.meta.env?.DEV);
        if (!magicOk && dev) {
          throw new Error(
            `Invoice export (${format}) returned an unexpected content type (${ct || "none"}); blob signature: ${sniff}.`,
          );
        }
        if (!magicOk && !dev && (format === "pdf" || format === "excel" || format === "docx")) {
          throw new Error(
            `Invoice export (${format}) did not return a valid file. Try again or contact support.`,
          );
        }
      }
      const ext = format === "excel" ? "xlsx" : format;
      downloadFile(blob, `invoices-report.${ext}`);
      toast({
        title: "Export ready",
        description: `Invoices exported as ${format === "excel" ? "XLSX" : format.toUpperCase()}.`,
      });
    } catch (e) {
      toast({
        title: "Invoice export failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setInvoiceExporting(false);
    }
  };

  const {
    data: invoices = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: () => requestJson<Invoice[]>("GET", "/api/invoices"),
  });
  const suppliersQuery = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: () => requestJson<Supplier[]>("GET", "/api/suppliers"),
    throwOnError: false,
  });
  const purchaseOrdersQuery = useQuery({
    queryKey: ["/api/procurement/purchase-orders/records"],
    queryFn: () => requestJson<PurchaseOrder[]>("GET", PROCUREMENT_PURCHASE_ORDER_RECORDS_PATH),
    throwOnError: false,
  });
  const taxCodesQuery = useQuery({
    queryKey: ["/api/tax-codes"],
    queryFn: () => requestJson<TaxCode[]>("GET", "/api/tax-codes"),
    throwOnError: false,
  });
  const inventoryLinesQuery = useQuery({
    queryKey: ["/api/inventory", "invoice-lines"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/inventory");
      return normalizeApiList<InventoryItem>(raw);
    },
    enabled: !!linesEditInvoice,
    throwOnError: false,
  });
  const poItemsQuery = useQuery({
    queryKey: ["/api/procurement/purchase-orders/records/items", purchaseOrderId],
    enabled: purchaseOrderId !== "none",
    queryFn: () =>
      requestJson<PurchaseOrderItem[]>("GET", procurementPoRecordItemsUrl(Number(purchaseOrderId))),
    throwOnError: false,
  });

  const suppliers = suppliersQuery.data ?? [];
  const purchaseOrders = purchaseOrdersQuery.data ?? [];
  const taxCodes = taxCodesQuery.data ?? [];
  const inventoryForLines = inventoryLinesQuery.data ?? [];
  const selectedPoItems = poItemsQuery.data ?? [];

  const refetchAllInvoiceFormReferences = () => {
    void suppliersQuery.refetch();
    void purchaseOrdersQuery.refetch();
    void taxCodesQuery.refetch();
  };

  const selectedSupplierId = supplierId === "none" ? null : Number(supplierId);
  const filteredPurchaseOrders = useMemo(
    () =>
      purchaseOrders.filter((order) =>
        selectedSupplierId == null ? true : order.supplierId === selectedSupplierId,
      ),
    [purchaseOrders, selectedSupplierId],
  );
  const selectedTaxCode = useMemo(
    () => taxCodes.find((code) => String(code.id) === taxCodeId),
    [taxCodes, taxCodeId],
  );

  const poById = useMemo(() => {
    const m = new Map<number, PurchaseOrder>();
    for (const o of purchaseOrders) m.set(o.id, o);
    return m;
  }, [purchaseOrders]);

  const editSupplier = editInvoice ? suppliers.find((s) => s.id === editInvoice.supplierId) : undefined;
  const editPo =
    editInvoice?.purchaseOrderId != null ? poById.get(editInvoice.purchaseOrderId) ?? null : null;
  const editMatch = editInvoice ? matchResults[editInvoice.id] : undefined;

  const createInvoice = useMutation({
    mutationFn: () => {
      if (supplierId === "none" || purchaseOrderId === "none") {
        throw new Error("Supplier and purchase order are required");
      }
      if (selectedPoItems.length === 0) {
        throw new Error("Selected purchase order has no items");
      }
      if (dueDate && new Date(dueDate) < new Date(issueDate)) {
        throw new Error("Due date cannot be earlier than issue date");
      }

      const lines = selectedPoItems.map((item) => {
        const qty = Number(item.quantity ?? 0);
        const unitPrice = Number(item.unitPrice ?? 0);
        if (qty <= 0 || unitPrice <= 0) {
          throw new Error("PO items must have quantity and unit price greater than zero");
        }
        const lineTotal = qty * unitPrice;
        const taxRate = Number(selectedTaxCode?.rate ?? 0);
        const taxAmount = (lineTotal * taxRate) / 100;
        return {
          itemId: item.itemId,
          quantity: qty,
          unitPrice,
          taxRate,
          taxAmount,
          lineTotal: lineTotal + taxAmount,
        };
      });

      const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      const totalTax = lines.reduce((sum, line) => sum + line.taxAmount, 0);
      const totalAmount = subtotal + totalTax;
      const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

      return requestJson("POST", "/api/invoices", {
        invoiceNumber,
        supplierId: Number(supplierId),
        purchaseOrderId: Number(purchaseOrderId),
        issueDate,
        dueDate: dueDate || undefined,
        status: "DRAFT",
        subtotal,
        totalTax,
        totalAmount,
        balanceDue: totalAmount,
        currency: currencyCode || settings.currencyCode,
        items: lines,
      });
    },
    onSuccess: () => {
      void invalidateInvoiceDomain(queryClient);
      setPurchaseOrderId("none");
      toast({ title: "Invoice created" });
    },
    onError: (e) => {
      toast({
        title: "Failed to create invoice",
        description: errorMessageWithRequestId(e),
        variant: "destructive",
      });
    },
  });

  const patchInvoice = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { status?: string; dueDate?: string | null } }) =>
      requestJson("PATCH", `/api/invoices/${id}`, body),
    onSuccess: () => {
      void invalidateInvoiceDomain(queryClient);
      setEditInvoice(null);
      toast({ title: "Invoice updated" });
    },
    onError: (e) => {
      toast({
        title: "Update failed",
        description: errorMessageWithRequestId(e),
        variant: "destructive",
      });
    },
  });

  const deleteInvoiceMut = useMutation({
    mutationFn: (id: number) => requestJson("DELETE", `/api/invoices/${id}`),
    onSuccess: () => {
      void invalidateInvoiceDomain(queryClient);
      setDeleteInvoice(null);
      toast({ title: "Invoice removed" });
    },
    onError: (e) => {
      const msg = errorMessageWithRequestId(e);
      const lower = msg.toLowerCase();
      const constrained =
        lower.includes("foreign") ||
        lower.includes("constraint") ||
        lower.includes("reference") ||
        lower.includes("violat");
      toast({
        title: "Delete failed",
        description: constrained
          ? `${errorMessageWithRequestId(e)} Remove related payments or other records that reference this invoice, then try again.`
          : errorMessageWithRequestId(e),
        variant: "destructive",
      });
    },
  });

  const invoiceLinesQuery = useQuery({
    queryKey: ["/api/invoices", linesEditInvoice?.id, "items"],
    enabled: !!linesEditInvoice,
    queryFn: () => requestJson<InvoiceLineRow[]>("GET", `/api/invoices/${linesEditInvoice!.id}/items`),
    throwOnError: false,
  });
  const invoiceLineRows = invoiceLinesQuery.data ?? [];
  const refetchInvoiceLines = invoiceLinesQuery.refetch;
  const invoiceLinesLoading = invoiceLinesQuery.isPending;
  const invoiceLinesFailed = invoiceLinesQuery.isError;

  useEffect(() => {
    if (!linesEditInvoice) {
      setLineDrafts({});
      return;
    }
    if (invoiceLinesQuery.isError || !invoiceLinesQuery.data) {
      return;
    }
    const next: Record<number, { quantity: string; unitPrice: string; taxRate: string }> = {};
    for (const row of invoiceLinesQuery.data) {
      next[row.id] = {
        quantity: String(row.quantity),
        unitPrice: String(row.unitPrice),
        taxRate: String(row.taxRate ?? 0),
      };
    }
    setLineDrafts(next);
  }, [linesEditInvoice, invoiceLinesQuery.isError, invoiceLinesQuery.data]);

  const saveInvoiceLine = useMutation({
    mutationFn: async ({
      invoiceId,
      line,
      body,
    }: {
      invoiceId: number;
      line: InvoiceLineRow;
      body: { quantity: number; unitPrice: number; taxRate: number; taxAmount: number; totalPrice: number };
    }) => requestJson("PATCH", `/api/invoices/${invoiceId}/items/${line.id}`, body),
    onSuccess: () => {
      void invalidateInvoiceDomain(queryClient);
      void refetchInvoiceLines();
      toast({ title: "Line updated" });
    },
    onError: (e) => {
      toast({
        title: "Line save failed",
        description: errorMessageWithRequestId(e),
        variant: "destructive",
      });
    },
  });

  const addInvoiceLine = useMutation({
    mutationFn: async (payload: {
      invoiceId: number;
      itemId: number;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number;
      taxAmount: number;
      totalPrice: number;
    }) =>
      requestJson("POST", `/api/invoices/${payload.invoiceId}/items`, {
        itemId: payload.itemId,
        description: payload.description,
        quantity: payload.quantity,
        unitPrice: payload.unitPrice,
        taxRate: payload.taxRate,
        taxAmount: payload.taxAmount,
        totalPrice: payload.totalPrice,
      }),
    onSuccess: () => {
      void invalidateInvoiceDomain(queryClient);
      void refetchInvoiceLines();
      setNewLineItemId("none");
      setNewLineQty("1");
      setNewLineUnitPrice("");
      setNewLineTaxRate("0");
      toast({ title: "Line added" });
    },
    onError: (e) => {
      toast({
        title: "Add line failed",
        description: errorMessageWithRequestId(e),
        variant: "destructive",
      });
    },
  });

  const deleteInvoiceLine = useMutation({
    mutationFn: async ({ invoiceId, lineId }: { invoiceId: number; lineId: number }) =>
      requestJson("DELETE", `/api/invoices/${invoiceId}/items/${lineId}`),
    onSuccess: () => {
      void invalidateInvoiceDomain(queryClient);
      void refetchInvoiceLines();
      toast({ title: "Line removed" });
    },
    onError: (e) => {
      toast({
        title: "Delete line failed",
        description: errorMessageWithRequestId(e),
        variant: "destructive",
      });
    },
  });

  const runMatch = useMutation({
    mutationFn: (invoiceId: number) => requestJson<unknown>("POST", `/api/invoices/${invoiceId}/match`),
    onSuccess: (raw, invoiceId) => {
      void invalidateInvoiceDomain(queryClient);
      const result = normalizeInvoiceMatchResult(raw);
      if (!result) {
        toast({
          title: "3-way match incomplete",
          description: "The server returned an unexpected response. Try again or check invoice and PO links.",
          variant: "destructive",
        });
        return;
      }
      setMatchResults((current) => ({ ...current, [invoiceId]: result }));
      toast({
        title: result.matched ? "3-way match passed" : "3-way match found mismatches",
        description: result.matched
          ? "Invoice matched PO and receipts."
          : `${result.mismatches.length} mismatch(es) detected.`,
        variant: result.matched ? "default" : "destructive",
      });
    },
    onError: (e) => {
      toast({
        title: "3-way match failed",
        description: errorMessageWithRequestId(e),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-6">
      <PageHeader
        title="Invoices"
        subtitle="Create supplier invoices linked to POs and run 3-way match checks."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={invoiceExporting}>
                <Download className="mr-2 h-4 w-4" />
                {invoiceExporting ? "Exporting…" : "Export"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void exportInvoices("pdf")}>PDF</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportInvoices("csv")}>CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportInvoices("excel")}>Excel</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportInvoices("docx")}>Word</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {suppliersQuery.isError ? (
        <PanelInlineError
          title="Suppliers reference data failed to load"
          description={queryErrorDetail(suppliersQuery.error)}
          onRetry={() => void suppliersQuery.refetch()}
        />
      ) : null}
      {purchaseOrdersQuery.isError ? (
        <PanelInlineError
          title="Purchase orders reference data failed to load"
          description={`${queryErrorDetail(purchaseOrdersQuery.error)} If you see PO_NOT_FOUND, restart the server after pulling latest (records list route must register before operational /:po).`}
          onRetry={() => void purchaseOrdersQuery.refetch()}
        />
      ) : null}
      {taxCodesQuery.isError ? (
        <PanelInlineError
          title="Tax codes reference data failed to load"
          description={queryErrorDetail(taxCodesQuery.error)}
          onRetry={() => void taxCodesQuery.refetch()}
        />
      ) : null}
      {(suppliersQuery.isError || purchaseOrdersQuery.isError || taxCodesQuery.isError) ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => void refetchAllInvoiceFormReferences()}>
            Retry all references
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create invoice</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {purchaseOrderId !== "none" && poItemsQuery.isError ? (
            <div className="md:col-span-3">
              <PanelInlineError
                title="Could not load purchase order lines"
                description="Choose another PO or retry."
                onRetry={() => void poItemsQuery.refetch()}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="invoice-supplier">Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="invoice-supplier">
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select supplier</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={String(supplier.id)}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="invoice-po">Purchase order</Label>
            <Select value={purchaseOrderId} onValueChange={setPurchaseOrderId}>
              <SelectTrigger id="invoice-po">
                <SelectValue placeholder="Select purchase order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select purchase order</SelectItem>
                {filteredPurchaseOrders.map((order) => (
                  <SelectItem key={order.id} value={String(order.id)}>
                    {order.orderNumber} ({order.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="invoice-tax-code">Tax code</Label>
            <Select value={taxCodeId} onValueChange={setTaxCodeId}>
              <SelectTrigger id="invoice-tax-code">
                <SelectValue placeholder="Optional tax code" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No tax code</SelectItem>
                {taxCodes.map((taxCode) => (
                  <SelectItem key={taxCode.id} value={String(taxCode.id)}>
                    {taxCode.code} - {taxCode.name} ({taxCode.rate}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="invoice-issue-date">Issue date</Label>
            <Input id="invoice-issue-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invoice-due-date">Due date</Label>
            <Input id="invoice-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={() => createInvoice.mutate()} disabled={createInvoice.isPending}>
              Create from PO items
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice list</CardTitle>
        </CardHeader>
        <CardContent>
          <DataState
            loading={isLoading}
            error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
            data={invoices}
            isEmpty={(rows) => rows.length === 0}
            emptyTitle="No invoices yet"
            emptyDescription="Create an invoice from a purchase order above."
            onRetry={refetch}
          >
            {(rows) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((invoice) => {
                    const match = matchResults[invoice.id];
                    const poLabel =
                      invoice.purchaseOrderId != null
                        ? poById.get(invoice.purchaseOrderId)?.orderNumber ?? `PO #${invoice.purchaseOrderId}`
                        : "-";
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell>{invoice.invoiceNumber}</TableCell>
                        <TableCell>{poLabel}</TableCell>
                        <TableCell>{match?.status ?? invoice.status}</TableCell>
                        <TableCell>{formatMoney(Number(invoice.totalAmount ?? 0))}</TableCell>
                        <TableCell>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "-"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runMatch.mutate(invoice.id)}
                            disabled={runMatch.isPending || !invoice.purchaseOrderId}
                          >
                            Run 3-way match
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="ml-2"
                            onClick={() => {
                              setEditInvoice(invoice);
                              setEditStatus(invoice.status);
                              setEditDue(invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : "");
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-2"
                            onClick={() => setLinesEditInvoice(invoice)}
                          >
                            Lines
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-2"
                            onClick={() => setActiveInvoiceId(invoice.id)}
                          >
                            Documents
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-2 text-destructive"
                            onClick={() => setDeleteInvoice(invoice)}
                          >
                            Delete
                          </Button>
                          {match && match.mismatches.length > 0 ? (
                            <div className="mt-1 text-xs text-destructive">
                              {match.mismatches.length} mismatch(es): {match.mismatches[0]?.message}
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button size="sm" variant="link" className="h-auto p-0 pl-1 text-xs">
                                    Details
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>3-way match review</DialogTitle>
                                  </DialogHeader>
                                  <p className="text-sm text-muted-foreground mb-3">
                                    Compare invoice lines to the purchase order and received quantities. Each row explains
                                    why the invoice may be marked DISPUTED.
                                  </p>
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Mismatch type</TableHead>
                                        <TableHead>Invoice line</TableHead>
                                        <TableHead>Explanation</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {match.mismatches.map((m, i) => (
                                        <TableRow key={`${m.type}-${m.itemId}-${i}`}>
                                          <TableCell className="font-mono text-xs">{m.type}</TableCell>
                                          <TableCell className="whitespace-nowrap">#{m.itemId}</TableCell>
                                          <TableCell className="text-sm">{m.message}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </DialogContent>
                              </Dialog>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </DataState>
        </CardContent>
      </Card>

      <Dialog open={!!editInvoice} onOpenChange={(o) => !o && setEditInvoice(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit invoice {editInvoice?.invoiceNumber}</DialogTitle>
          </DialogHeader>

          {editInvoice ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Supplier</p>
                    <p className="font-medium">
                      {editSupplier?.name ??
                        (editInvoice.supplierId != null ? `ID ${editInvoice.supplierId}` : "—")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Linked purchase order</p>
                    <p className="font-medium">
                      {editPo ? `${editPo.orderNumber} (${editPo.status})` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Invoice total</p>
                    <p className="font-medium">{formatMoney(Number(editInvoice.totalAmount ?? 0))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">3-way match (last run)</p>
                    <p className="font-medium">
                      {editMatch
                        ? `${editMatch.status}${editMatch.matched ? " · matched" : ""}`
                        : "Not run on this session"}
                    </p>
                    {editMatch && editMatch.mismatches.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {editMatch.mismatches.length} mismatch(es) — open Lines to review.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {editInvoice.supplierId != null ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={APP_ROUTES.procurement.supplier(editInvoice.supplierId)}>Open supplier</Link>
                    </Button>
                  ) : null}
                  {editPo ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={APP_ROUTES.procurement.order(editPo.orderNumber)}>Open PO</Link>
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const inv = editInvoice;
                      setEditInvoice(null);
                      setLinesEditInvoice(inv);
                    }}
                  >
                    View / edit lines
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-xs font-medium text-muted-foreground">Editable fields</p>
                  <p className="text-xs text-muted-foreground">
                    Only status and due date are updated here; use Lines for row-level detail and 3-way match from the
                    table.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Input
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    placeholder="DRAFT, SENT, PAID…"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Due date</Label>
                  <Input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} />
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditInvoice(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editInvoice) return;
                patchInvoice.mutate({
                  id: editInvoice.id,
                  body: {
                    status: editStatus || undefined,
                    dueDate: editDue ? new Date(editDue).toISOString() : null,
                  },
                });
              }}
              disabled={patchInvoice.isPending}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteInvoice} onOpenChange={(o) => !o && setDeleteInvoice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {deleteInvoice?.invoiceNumber} and related lines if the server allows it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteInvoice && deleteInvoiceMut.mutate(deleteInvoice.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!linesEditInvoice}
        onOpenChange={(o) => {
          if (!o) {
            setLinesEditInvoice(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice lines — {linesEditInvoice?.invoiceNumber}</DialogTitle>
          </DialogHeader>
          {inventoryLinesQuery.isError ? (
            <PanelInlineError
              title="Could not load inventory catalog"
              onRetry={() => void inventoryLinesQuery.refetch()}
            />
          ) : null}
          {invoiceLinesFailed ? (
            <PanelInlineError
              title="Could not load invoice lines"
              description="Line totals and edits need the latest rows from the server."
              onRetry={() => void refetchInvoiceLines()}
            />
          ) : null}
          {linesEditInvoice && isInvoiceLinesLocked(linesEditInvoice.status) ? (
            <p className="text-sm text-muted-foreground">
              This invoice cannot be edited in its current status ({linesEditInvoice.status}).
            </p>
          ) : null}
          {linesEditInvoice && !isInvoiceLinesLocked(linesEditInvoice.status) ? (
            <div className="space-y-4">
              {invoiceLinesLoading && !invoiceLinesFailed ? (
                <p className="text-sm text-muted-foreground">Loading lines…</p>
              ) : null}
              {!invoiceLinesLoading && !invoiceLinesFailed ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-24">Qty</TableHead>
                      <TableHead className="w-28">Unit ({currencyCode})</TableHead>
                      <TableHead className="w-24">Tax %</TableHead>
                      <TableHead className="text-right w-28">Line total</TableHead>
                      <TableHead className="text-right w-36">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoiceLineRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-muted-foreground text-sm">
                          No lines yet. Add one below.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {invoiceLineRows.map((line) => {
                      const draft = lineDrafts[line.id] ?? {
                        quantity: String(line.quantity),
                        unitPrice: String(line.unitPrice),
                        taxRate: String(line.taxRate ?? 0),
                      };
                      const qty = Number(draft.quantity);
                      const up = Number(draft.unitPrice);
                      const tr = Number(draft.taxRate);
                      const { totalPrice } = invoiceLineTotals(
                        Number.isFinite(qty) ? qty : 0,
                        Number.isFinite(up) ? up : 0,
                        Number.isFinite(tr) ? tr : 0,
                      );
                      const inv = inventoryForLines.find((i) => i.id === line.itemId);
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="text-sm">
                            <div className="font-medium">{inv?.name ?? `Item #${line.itemId}`}</div>
                            <div className="text-xs text-muted-foreground">{inv?.sku ?? line.description}</div>
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-8"
                              value={draft.quantity}
                              onChange={(e) =>
                                setLineDrafts((d) => ({
                                  ...d,
                                  [line.id]: { ...draft, quantity: e.target.value },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-8"
                              value={draft.unitPrice}
                              onChange={(e) =>
                                setLineDrafts((d) => ({
                                  ...d,
                                  [line.id]: { ...draft, unitPrice: e.target.value },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-8"
                              value={draft.taxRate}
                              onChange={(e) =>
                                setLineDrafts((d) => ({
                                  ...d,
                                  [line.id]: { ...draft, taxRate: e.target.value },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatMoney(totalPrice)}</TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={saveInvoiceLine.isPending}
                              onClick={() => {
                                if (!linesEditInvoice) return;
                                const q = Number(draft.quantity);
                                const u = Number(draft.unitPrice);
                                const t = Number(draft.taxRate);
                                if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(u) || u < 0) {
                                  toast({
                                    title: "Invalid line",
                                    description: "Quantity and unit price must be valid numbers.",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                                const { taxAmount, totalPrice: tp } = invoiceLineTotals(q, u, t);
                                saveInvoiceLine.mutate({
                                  invoiceId: linesEditInvoice.id,
                                  line,
                                  body: {
                                    quantity: q,
                                    unitPrice: u,
                                    taxRate: t,
                                    taxAmount,
                                    totalPrice: tp,
                                  },
                                });
                              }}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={deleteInvoiceLine.isPending}
                              onClick={() => {
                                if (!linesEditInvoice) return;
                                deleteInvoiceLine.mutate({
                                  invoiceId: linesEditInvoice.id,
                                  lineId: line.id,
                                });
                              }}
                            >
                              Delete
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : null}

              <div
                className={`rounded-md border p-3 space-y-2 ${invoiceLinesFailed || invoiceLinesLoading ? "opacity-60 pointer-events-none" : ""}`}
              >
                <div className="text-sm font-medium">Add line</div>
                {invoiceLinesFailed || invoiceLinesLoading ? (
                  <p className="text-xs text-muted-foreground">Load invoice lines above before adding new ones.</p>
                ) : null}
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="space-y-1 min-w-[200px]">
                    <Label>Inventory item</Label>
                    <Select value={newLineItemId} onValueChange={setNewLineItemId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Select item</SelectItem>
                        {inventoryForLines.map((it) => (
                          <SelectItem key={it.id} value={String(it.id)}>
                            {it.sku} — {it.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 w-24">
                    <Label>Qty</Label>
                    <Input value={newLineQty} onChange={(e) => setNewLineQty(e.target.value)} />
                  </div>
                  <div className="space-y-1 w-28">
                    <Label>Unit ({currencyCode})</Label>
                    <Input value={newLineUnitPrice} onChange={(e) => setNewLineUnitPrice(e.target.value)} />
                  </div>
                  <div className="space-y-1 w-24">
                    <Label>Tax %</Label>
                    <Input value={newLineTaxRate} onChange={(e) => setNewLineTaxRate(e.target.value)} />
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    disabled={
                      addInvoiceLine.isPending || newLineItemId === "none" || invoiceLinesFailed || invoiceLinesLoading
                    }
                    onClick={() => {
                      if (!linesEditInvoice) return;
                      const itemId = Number(newLineItemId);
                      const q = Number(newLineQty);
                      const u = Number(newLineUnitPrice);
                      const t = Number(newLineTaxRate);
                      const picked = inventoryForLines.find((i) => i.id === itemId);
                      if (!picked || !Number.isFinite(q) || q <= 0 || !Number.isFinite(u) || u < 0) {
                        toast({
                          title: "Invalid new line",
                          description: "Pick an item and enter valid quantity and unit price.",
                          variant: "destructive",
                        });
                        return;
                      }
                      const { taxAmount, totalPrice: tp } = invoiceLineTotals(q, u, t);
                      addInvoiceLine.mutate({
                        invoiceId: linesEditInvoice.id,
                        itemId,
                        description: `${picked.sku} — ${picked.name}`,
                        quantity: q,
                        unitPrice: u,
                        taxRate: t,
                        taxAmount,
                        totalPrice: tp,
                      });
                    }}
                  >
                    Add line
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <EntityDocumentsCard
        entityType="invoice"
        entityId={activeInvoiceId}
        title="Invoice Documents"
      />
    </div>
  );
}
