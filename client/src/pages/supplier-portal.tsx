import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { confirmSupplierPortalOrder, fetchSupplierPortalOrders, updateSupplierPortalDelivery, uploadDocumentFile } from "@/api/client";
import { requestJson } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function SupplierPortalPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [etaByOrder, setEtaByOrder] = useState<Record<number, string>>({});
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [invoicePoId, setInvoicePoId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const role = String(user?.role ?? "");
  const canChooseSupplier = role === "admin" || role === "manager";
  const supplierScopeId =
    canChooseSupplier && selectedSupplierId ? Number(selectedSupplierId) : undefined;

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
      const createdInvoice = await requestJson<{ id: number }>("POST", "/api/supplier/invoices", {
        purchaseOrderId: poId,
        invoiceNumber: invoiceNumber || undefined,
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
      setInvoiceFile(null);
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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Supplier Portal"
        subtitle="Review your assigned purchase orders and share acknowledgments/delivery dates."
      />

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

      {canChooseSupplier && !supplierScopeId ? (
        <Alert>
          <AlertTitle>Select a supplier</AlertTitle>
          <AlertDescription>
            Choose a supplier account above to load portal orders and submit supplier invoices.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Assigned purchase orders</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
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
                  <TableRow key={order.id}>
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
                            if (!date) return;
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

      <Card>
        <CardHeader>
          <CardTitle>Submit invoice</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="supplier-invoice-po">Purchase order ID</Label>
            <Input
              id="supplier-invoice-po"
              value={invoicePoId}
              onChange={(event) => setInvoicePoId(event.target.value)}
              placeholder="e.g. 123"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-invoice-number">Invoice number</Label>
            <Input
              id="supplier-invoice-number"
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-invoice-file">Invoice file</Label>
            <Input
              id="supplier-invoice-file"
              type="file"
              onChange={(event) => setInvoiceFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => uploadInvoice.mutate()}
              disabled={uploadInvoice.isPending || (canChooseSupplier && !supplierScopeId)}
            >
              Submit invoice
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
