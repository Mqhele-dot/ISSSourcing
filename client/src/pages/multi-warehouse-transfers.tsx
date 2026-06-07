import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Truck, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { requestJson } from "@/lib/queryClient";
import { formatDate } from "@/lib/date-utils";
import { useReportingMoney } from "@/hooks/use-reporting-money";

interface WarehouseTransfer {
  id: number;
  referenceNumber: string;
  fromWarehouseId: number;
  fromWarehouseName?: string;
  toWarehouseId: number;
  toWarehouseName?: string;
  status: "draft" | "pending_approval" | "approved" | "in_transit" | "received" | "cancelled";
  requestedByUserId: number;
  requestedByName?: string;
  approvedByUserId?: number | null;
  approvedByName?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  receivedAt?: string | null;
  notes?: string | null;
  items: TransferLineItem[];
}

interface TransferLineItem {
  id?: number;
  itemId: number;
  itemName?: string;
  quantity: number;
  quantityReceived?: number;
  notes?: string;
}

interface WarehouseOption {
  id: number;
  name: string;
  location?: string;
}

/**
 * Multi-Warehouse Transfer Workflow
 * Handles inventory transfers between warehouses with approval workflow
 */
export default function MultiWarehouseTransferPage() {
  const { toast } = useToast();
  const { formatMoney } = useReportingMoney();
  const queryClient = useQueryClient();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<WarehouseTransfer | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Form state for new transfer
  const [formData, setFormData] = useState({
    fromWarehouseId: "",
    toWarehouseId: "",
    items: [{ itemId: "", quantity: "" }],
    notes: "",
  });

  // Fetch warehouses
  const { data: warehouses = [] } = useQuery({
    queryKey: ["/api/warehouses"],
    queryFn: () => requestJson<WarehouseOption[]>("GET", "/api/warehouses"),
  });

  // Fetch inventory items
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: () =>
      requestJson<Array<{ id: number; name: string; onHand: number }>>(
        "GET",
        "/api/inventory"
      ),
  });

  // Fetch transfers
  const { data: transfers = [] } = useQuery({
    queryKey: ["/api/warehouse-transfers", statusFilter],
    queryFn: () =>
      requestJson<WarehouseTransfer[]>(
        "GET",
        `/api/warehouse-transfers?status=${statusFilter === "all" ? "" : statusFilter}`
      ),
    staleTime: 30_000,
  });

  // Filter visible transfers
  const visibleTransfers = useMemo(() => {
    if (statusFilter === "all") return transfers;
    return transfers.filter((t) => t.status === statusFilter);
  }, [transfers, statusFilter]);

  // Create transfer mutation
  const createTransferMutation = useMutation({
    mutationFn: (data: any) =>
      requestJson("POST", "/api/warehouse-transfers", data),
    onSuccess: () => {
      toast({
        title: "Transfer created",
        description: "Transfer request has been submitted for approval",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-transfers"] });
      resetForm();
      setIsCreateDialogOpen(false);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create transfer",
        description: err?.message || "Please try again",
      });
    },
  });

  // Approve transfer mutation
  const approveTransferMutation = useMutation({
    mutationFn: (id: number) =>
      requestJson("PATCH", `/api/warehouse-transfers/${id}`, {
        status: "approved",
      }),
    onSuccess: () => {
      toast({ title: "Transfer approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-transfers"] });
      setSelectedTransfer(null);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Failed to approve",
        description: err?.message,
      });
    },
  });

  // Receive transfer mutation
  const receiveTransferMutation = useMutation({
    mutationFn: (data: { id: number; items: Array<{ itemId: number; quantityReceived: number }> }) =>
      requestJson("PATCH", `/api/warehouse-transfers/${data.id}`, {
        status: "received",
        items: data.items,
      }),
    onSuccess: () => {
      toast({ title: "Transfer received" });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-transfers"] });
      setSelectedTransfer(null);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Failed to receive transfer",
        description: err?.message,
      });
    },
  });

  const resetForm = () => {
    setFormData({
      fromWarehouseId: "",
      toWarehouseId: "",
      items: [{ itemId: "", quantity: "" }],
      notes: "",
    });
  };

  const handleCreateTransfer = () => {
    if (!formData.fromWarehouseId || !formData.toWarehouseId) {
      toast({
        variant: "destructive",
        title: "Validation error",
        description: "Please select both from and to warehouses",
      });
      return;
    }

    if (formData.fromWarehouseId === formData.toWarehouseId) {
      toast({
        variant: "destructive",
        title: "Validation error",
        description: "Source and destination warehouses must be different",
      });
      return;
    }

    const validItems = formData.items.filter((i) => i.itemId && i.quantity);
    if (validItems.length === 0) {
      toast({
        variant: "destructive",
        title: "Validation error",
        description: "Please add at least one item",
      });
      return;
    }

    createTransferMutation.mutate({
      fromWarehouseId: Number(formData.fromWarehouseId),
      toWarehouseId: Number(formData.toWarehouseId),
      items: validItems.map((i) => ({
        itemId: Number(i.itemId),
        quantity: Number(i.quantity),
      })),
      notes: formData.notes || undefined,
    });
  };

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { itemId: "", quantity: "" }],
    });
  };

  const handleRemoveItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "in_transit":
        return <Truck className="h-4 w-4 text-blue-600" />;
      case "pending_approval":
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case "cancelled":
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "draft":
        return "bg-gray-100 text-gray-800";
      case "pending_approval":
        return "bg-yellow-100 text-yellow-800";
      case "approved":
        return "bg-green-100 text-green-800";
      case "in_transit":
        return "bg-blue-100 text-blue-800";
      case "received":
        return "bg-green-100 text-green-800";
      case "cancelled":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Multi-Warehouse Transfers"
        description="Manage inventory transfers between warehouses with approval workflows"
        icon={Truck}
      />

      <div className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Pending Approval</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {transfers.filter((t) => t.status === "pending_approval").length}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">In Transit</p>
                <p className="text-2xl font-bold text-blue-600">
                  {transfers.filter((t) => t.status === "in_transit").length}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Received</p>
                <p className="text-2xl font-bold text-green-600">
                  {transfers.filter((t) => t.status === "received").length}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-gray-600">Total</p>
                <p className="text-2xl font-bold">{transfers.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_approval">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="in_transit">In Transit</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Transfer
          </Button>
        </div>

        {/* Transfers Table */}
        <Card>
          <CardHeader>
            <CardTitle>Transfer Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>From → To</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTransfers.map((transfer) => (
                    <TableRow key={transfer.id}>
                      <TableCell className="font-mono text-sm">
                        {transfer.referenceNumber}
                      </TableCell>
                      <TableCell className="text-sm">
                        {transfer.fromWarehouseName} → {transfer.toWarehouseName}
                      </TableCell>
                      <TableCell className="text-sm">
                        {transfer.items.length} item{transfer.items.length !== 1 ? "s" : ""}
                      </TableCell>
                      <TableCell className="text-sm">{transfer.requestedByName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(transfer.status)}
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadgeColor(transfer.status)}`}>
                            {transfer.status.replace(/_/g, " ")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {formatDate(new Date(transfer.createdAt))}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedTransfer(transfer)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Warehouse Transfer</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="from-warehouse">From Warehouse</Label>
                <Select
                  value={formData.fromWarehouseId}
                  onValueChange={(v) => setFormData({ ...formData, fromWarehouseId: v })}
                >
                  <SelectTrigger id="from-warehouse">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="to-warehouse">To Warehouse</Label>
                <Select
                  value={formData.toWarehouseId}
                  onValueChange={(v) => setFormData({ ...formData, toWarehouseId: v })}
                >
                  <SelectTrigger id="to-warehouse">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Items Section */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Items to Transfer</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddItem}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </div>

              <div className="space-y-2">
                {formData.items.map((item, index) => (
                  <div key={index} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Select
                        value={item.itemId}
                        onValueChange={(v) => {
                          const newItems = [...formData.items];
                          newItems[index].itemId = v;
                          setFormData({ ...formData, items: newItems });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select item" />
                        </SelectTrigger>
                        <SelectContent>
                          {inventoryItems.map((i) => (
                            <SelectItem key={i.id} value={String(i.id)}>
                              {i.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24">
                      <Input
                        type="number"
                        placeholder="Qty"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => {
                          const newItems = [...formData.items];
                          newItems[index].quantity = e.target.value;
                          setFormData({ ...formData, items: newItems });
                        }}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveItem(index)}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Input
                id="notes"
                placeholder="Add any notes about this transfer"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setIsCreateDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTransfer}
              disabled={createTransferMutation.isPending}
            >
              {createTransferMutation.isPending ? "Creating..." : "Create Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail View Dialog */}
      {selectedTransfer && (
        <Dialog open={!!selectedTransfer} onOpenChange={() => setSelectedTransfer(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedTransfer.referenceNumber}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">From</p>
                  <p className="font-medium">{selectedTransfer.fromWarehouseName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">To</p>
                  <p className="font-medium">{selectedTransfer.toWarehouseName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Requested By</p>
                  <p className="font-medium">{selectedTransfer.requestedByName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <div className="flex items-center gap-2 mt-1">
                    {getStatusIcon(selectedTransfer.status)}
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadgeColor(selectedTransfer.status)}`}>
                      {selectedTransfer.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h4 className="font-semibold mb-2">Items</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Received</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedTransfer.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-sm">{item.itemName}</TableCell>
                        <TableCell className="text-sm">{item.quantity}</TableCell>
                        <TableCell className="text-sm">{item.quantityReceived || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {selectedTransfer.notes && (
                <div>
                  <p className="text-sm text-gray-600">Notes</p>
                  <p className="text-sm">{selectedTransfer.notes}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              {selectedTransfer.status === "pending_approval" && (
                <Button
                  onClick={() =>
                    approveTransferMutation.mutate(selectedTransfer.id)
                  }
                  disabled={approveTransferMutation.isPending}
                >
                  {approveTransferMutation.isPending ? "Approving..." : "Approve"}
                </Button>
              )}
              {selectedTransfer.status === "approved" && (
                <Button
                  onClick={() => {
                    // In production, this would be more complex
                    setSelectedTransfer({
                      ...selectedTransfer,
                      status: "in_transit",
                    });
                  }}
                >
                  Mark In Transit
                </Button>
              )}
              <Button variant="outline" onClick={() => setSelectedTransfer(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}
