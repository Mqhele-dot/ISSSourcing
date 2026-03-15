import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { queryClient, requestJson } from "@/lib/queryClient";
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";

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

export default function InvoicesPage() {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState<string>("none");
  const [purchaseOrderId, setPurchaseOrderId] = useState<string>("none");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [taxCodeId, setTaxCodeId] = useState<string>("none");
  const [matchResults, setMatchResults] = useState<Record<number, MatchResult>>({});
  const [activeInvoiceId, setActiveInvoiceId] = useState<number | null>(null);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: () => requestJson<Invoice[]>("GET", "/api/invoices"),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: () => requestJson<Supplier[]>("GET", "/api/suppliers"),
  });
  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ["/api/purchase-orders"],
    queryFn: () => requestJson<PurchaseOrder[]>("GET", "/api/purchase-orders"),
  });
  const { data: taxCodes = [] } = useQuery({
    queryKey: ["/api/tax-codes"],
    queryFn: () => requestJson<TaxCode[]>("GET", "/api/tax-codes"),
  });
  const { data: selectedPoItems = [] } = useQuery({
    queryKey: ["/api/purchase-orders/items", purchaseOrderId],
    enabled: purchaseOrderId !== "none",
    queryFn: () => requestJson<PurchaseOrderItem[]>("GET", `/api/purchase-orders/${purchaseOrderId}/items`),
  });

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

  const createInvoice = useMutation({
    mutationFn: () => {
      if (supplierId === "none" || purchaseOrderId === "none") {
        throw new Error("Supplier and purchase order are required");
      }
      if (selectedPoItems.length === 0) {
        throw new Error("Selected purchase order has no items");
      }

      const lines = selectedPoItems.map((item) => {
        const qty = Number(item.quantity ?? 0);
        const unitPrice = Number(item.unitPrice ?? 0);
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
        currency: "USD",
        items: lines,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setPurchaseOrderId("none");
      toast({ title: "Invoice created" });
    },
    onError: (e) => {
      toast({
        title: "Failed to create invoice",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const runMatch = useMutation({
    mutationFn: (invoiceId: number) => requestJson<MatchResult>("POST", `/api/invoices/${invoiceId}/match`),
    onSuccess: (result, invoiceId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
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
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Invoices"
        subtitle="Create supplier invoices linked to POs and run 3-way match checks."
      />

      <Card>
        <CardHeader>
          <CardTitle>Create invoice</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
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
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading invoices...</div>
          ) : invoices.length === 0 ? (
            <div className="text-sm text-muted-foreground">No invoices created yet.</div>
          ) : (
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
                {invoices.map((invoice) => {
                  const match = matchResults[invoice.id];
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell>{invoice.invoiceNumber}</TableCell>
                      <TableCell>{invoice.purchaseOrderId ? `PO #${invoice.purchaseOrderId}` : "-"}</TableCell>
                      <TableCell>{match?.status ?? invoice.status}</TableCell>
                      <TableCell>${Number(invoice.totalAmount ?? 0).toFixed(2)}</TableCell>
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
                          variant="ghost"
                          className="ml-2"
                          onClick={() => setActiveInvoiceId(invoice.id)}
                        >
                          Documents
                        </Button>
                        {match && match.mismatches.length > 0 ? (
                          <div className="mt-1 text-xs text-destructive">
                            {match.mismatches.length} mismatch(es): {match.mismatches[0]?.message}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EntityDocumentsCard
        entityType="invoice"
        entityId={activeInvoiceId}
        title="Invoice Documents"
      />
    </div>
  );
}
