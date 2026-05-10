import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { confirmSupplierPortalOrder, fetchSupplierPortalInvoices, fetchSupplierPortalOrders, updateSupplierPortalDelivery, uploadDocumentFile } from "@/api/client";
import { requestJson } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageShell } from "@/components/page-shell";

export default function SupplierPortalPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [etaByOrder, setEtaByOrder] = useState<Record<number, string>>({});
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [invoicePoId, setInvoicePoId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [invoiceCurrency, setInvoiceCurrency] = useState("ZAR");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const role = String(user?.role ?? "");
  const canChooseSupplier = role === "admin" || role === "manager";
  const supplierScopeId =
    canChooseSupplier && selectedSupplierId ? Number(selectedSupplierId) : undefined;
  const supplierSelected = !canChooseSupplier || supplierScopeId != null;

  const { data: supplierOptions = [] } = useQuery({
    queryKey: ["/api/suppliers", "portal-options"],
    enabled: canChooseSupplier,
    queryFn: () => requestJson<Array<{ id: number; name: string }>>("GET", "/api/suppliers"),
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["/api/supplier/orders", supplierScopeId ?? "self"],
    queryFn: () => fetchSupplierPortalOrders(supplierScopeId),
    enabled: !canChooseSupplier || supplierScopeId != null,
  });

  const { data: portalInvoices = [] } = useQuery({
    queryKey: ["/api/supplier/invoices", supplierScopeId ?? "self"],
    queryFn: () => fetchSupplierPortalInvoices(supplierScopeId),
    enabled: !canChooseSupplier || supplierScopeId != null,
  });

  const confirmOrder = useMutation({
    mutationFn: (id: number) => confirmSupplierPortalOrder(id, supplierScopeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/supplier/orders"] });
      toast({ title: "Order confirmed", description: "The buyer can now track this acknowledgment." });
    },
    onError: (error) => {
      toast({
        title: "Failed to confirm order",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const updateDelivery = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => updateSupplierPortalDelivery(id, date, supplierScopeId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/supplier/orders"] });
      toast({ title: "Delivery date updated", description: "Expected delivery has been sent to procurement." });
    },
    onError: (error) => {
      toast({
        title: "Failed to update delivery",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const uploadInvoice = useMutation({
    mutationFn: async () => {
      if (canChooseSupplier && !supplierScopeId) {
        throw new Error("Select a supplier account first");
      }
      const poId = Number(invoicePoId);
      if (!Number.isFinite(poId) || poId <= 0) {
        throw new Error("Choose a valid purchase order");
      }
      if (!invoiceNumber.trim()) {
        throw new Error("Invoice number is required");
      }
      const total = Number(invoiceTotal);
      if (!Number.isFinite(total) || total <= 0) {
        throw new Error("Invoice total must be greater than zero");
      }
      const createdInvoice = await requestJson<{ id: number }>("POST", "/api/supplier/invoices", {
        purchaseOrderId: poId,
        invoiceNumber: invoiceNumber.trim(),
        total,
        currency: invoiceCurrency.trim() || "ZAR",
        ...(supplierScopeId ? { supplierId: supplierScopeId } : {}),
      });
      if (invoiceFile) {
        const form = new FormData();
        form.append("file", invoiceFile);
        form.append("entityType", "invoice");
        form.append("entityId", String(createdInvoice.id));
        await uploadDocumentFile(form);
      }
      return createdInvoice;
    },
    onSuccess: () => {
      setInvoicePoId("");
      setInvoiceNumber("");
      setInvoiceTotal("");
      setInvoiceFile(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/supplier/invoices"] });
      toast({
        title: "Supplier invoice submitted",
        description: "Invoice has been created and attachment uploaded.",
      });
    },
    onError: (error) => {
      toast({
        title: "Invoice submission failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const portalStats = useMemo(() => {
    const list = orders;
    const active = list.filter((o) => {
      const s = String(o.status ?? "").toLowerCase();
      return !["received", "cancelled", "completed"].includes(s);
    });
    const needsAttention = list.filter((o) => {
      const s = String(o.status ?? "").toLowerCase();
      return s === "open" || s === "sent" || s === "approved";
    });
    return { total: list.length, active: active.length, needsAttention: needsAttention.length };
  }, [orders]);

  return (
    <PageShell variant="standard" data-testid="supplier-portal-page">
      <PageHeader
        title="Supplier Portal"
        subtitle="Review your assigned purchase orders and share acknowledgments/delivery dates."
        breadcrumb={<span>Procurement / Supplier portal</span>}
      />

      {supplierSelected && !isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Assigned POs</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{portalStats.total}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active (not fully received)</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{portalStats.active}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Likely action needed</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{portalStats.needsAttention}</CardContent>
            <p className="text-xs text-muted-foreground px-6 pb-4">
              Open / sent / approved rows — confirm or update delivery as appropriate.
            </p>
          </Card>
        </div>
      ) : null}

      <Alert>
        <AlertTitle>Workflow</AlertTitle>
        <AlertDescription className="text-sm space-y-1">
          <ol className="list-decimal pl-4 space-y-1">
            <li>Confirm open POs so procurement sees acknowledgment.</li>
            <li>Update expected delivery when dates slip.</li>
            <li>Submit invoices linked to a PO (optional document upload).</li>
          </ol>
        </AlertDescription>
      </Alert>

      {canChooseSupplier ? (
        <Card>
          <CardHeader>
            <CardTitle>Supplier scope</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[320px_1fr] md:items-end">
            <div className="space-y-1">
              <Label htmlFor="supplier-scope-select">View supplier account</Label>
              <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                <SelectTrigger id="supplier-scope-select">
                  <SelectValue placeholder="Choose supplier" />
                </SelectTrigger>
                <SelectContent>
                  {supplierOptions.map((supplier) => (
                    <SelectItem key={supplier.id} value={String(supplier.id)}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              Managers/Admins must select a supplier to simulate supplier-portal access.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!supplierSelected ? (
        <Alert>
          <AlertTitle>Select a supplier</AlertTitle>
          <AlertDescription>
            Choose a supplier account above to load portal orders and submit supplier invoices.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className={!supplierSelected ? "opacity-70" : undefined}>
        <CardHeader>
          <CardTitle>Assigned purchase orders</CardTitle>
        </CardHeader>
        <CardContent>
          {!supplierSelected ? (
            <div className="text-sm text-muted-foreground">
              Select a supplier account to load assigned purchase orders.
            </div>
          ) : isLoading ? (
            <div className="text-sm text-muted-foreground">Loading supplier orders...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="w-[260px]">Delivery update</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} data-testid={`supplier-portal-po-row-${order.poNumber}`}>
                    <TableCell className="font-medium">{order.poNumber}</TableCell>
                    <TableCell>{order.status}</TableCell>
                    <TableCell>{Number(order.totalAmount ?? 0).toFixed(2)}</TableCell>
                    <TableCell>{order.requestedDate ? new Date(order.requestedDate).toLocaleDateString() : "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Label className="sr-only" htmlFor={`eta-${order.id}`}>
                          Expected delivery
                        </Label>
                        <Input
                          id={`eta-${order.id}`}
                          type="date"
                          value={etaByOrder[order.id] ?? ""}
                          onChange={(event) =>
                            setEtaByOrder((current) => ({ ...current, [order.id]: event.target.value }))
                          }
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const date = etaByOrder[order.id];
                            if (!date) {
                              toast({
                                title: "updateSupplierPortalDelivery: Missing expected delivery date",
                                description: "Select a delivery date before saving.",
                                variant: "destructive",
                              });
                              return;
                            }
                            updateDelivery.mutate({ id: order.id, date });
                          }}
                          disabled={updateDelivery.isPending}
                        >
                          Save
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => confirmOrder.mutate(order.id)}
                        disabled={confirmOrder.isPending}
                      >
                        Confirm
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={6}>
                      No purchase orders assigned to your supplier account yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className={!supplierSelected ? "opacity-70" : undefined}>
        <CardHeader>
          <CardTitle>Submit invoice</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="supplier-invoice-po">Purchase order</Label>
            <Select value={invoicePoId || "none"} onValueChange={(value) => setInvoicePoId(value === "none" ? "" : value)} disabled={!supplierSelected}>
              <SelectTrigger id="supplier-invoice-po" data-testid="supplier-portal-order-picker">
                <SelectValue placeholder="Choose PO" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose PO</SelectItem>
                {orders.map((order) => (
                  <SelectItem key={order.id} value={String(order.id)}>
                    {order.poNumber} · {Number(order.totalAmount ?? 0).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-invoice-number">Invoice number</Label>
            <Input
              id="supplier-invoice-number"
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              placeholder="Required"
              disabled={!supplierSelected}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-invoice-total">Invoice total</Label>
            <Input
              id="supplier-invoice-total"
              type="number"
              min={0}
              step={0.01}
              value={invoiceTotal}
              onChange={(event) => setInvoiceTotal(event.target.value)}
              placeholder="0.00"
              disabled={!supplierSelected}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-invoice-currency">Currency</Label>
            <Input
              id="supplier-invoice-currency"
              value={invoiceCurrency}
              onChange={(event) => setInvoiceCurrency(event.target.value.toUpperCase())}
              disabled={!supplierSelected}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-invoice-file">Invoice file</Label>
            <Input
              id="supplier-invoice-file"
              type="file"
              onChange={(event) => setInvoiceFile(event.target.files?.[0] ?? null)}
              disabled={!supplierSelected}
            />
          </div>
          <div className="flex items-end">
            <Button
              data-testid="supplier-portal-submit-invoice"
              onClick={() => uploadInvoice.mutate()}
              disabled={uploadInvoice.isPending || !supplierSelected}
            >
              Submit invoice
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Open POs</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {orders.filter((order) => !["received", "completed", "cancelled"].includes(String(order.status).toLowerCase())).length} assigned order(s) remain open for acknowledgement, delivery updates, or invoice submission.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invoices submitted</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {portalInvoices.length === 0 ? (
              <p className="text-muted-foreground">No supplier invoices submitted yet.</p>
            ) : (
              portalInvoices.slice(0, 5).map((invoice) => (
                <div key={invoice.id} className="flex justify-between gap-3 rounded-md border p-2">
                  <span>{invoice.invoiceNumber}</span>
                  <span className="text-muted-foreground">{invoice.status}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card data-testid="supplier-portal-payment-status">
          <CardHeader>
            <CardTitle>Payment / remittance status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {portalInvoices.length === 0 ? (
              <p className="text-muted-foreground">Payment status appears after invoice submission.</p>
            ) : (
              portalInvoices.slice(0, 5).map((invoice) => (
                <div key={invoice.id} className="flex justify-between gap-3 rounded-md border p-2">
                  <span>{invoice.invoiceNumber}</span>
                  <span className="text-muted-foreground">
                    Paid {Number(invoice.paidAmount ?? 0).toFixed(2)} / Due {Number(invoice.dueAmount ?? invoice.total).toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Upload invoice documents from the submission panel. Additional supplier document center workflows can build on the same attachment service.
        </CardContent>
      </Card>
    </PageShell>
  );
}
