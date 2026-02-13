import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MoreHorizontal,
  RefreshCw,
  ArrowDownUp,
  FileText,
  CreditCard,
  Trash2,
  Download,
  Send,
  Printer,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
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

interface InvoicesListProps {
  invoices: any[];
  onCreateInvoice: () => void;
  onPayInvoice: (invoice: any) => void;
  onEditInvoice: (invoice: any) => void;
  onRefresh: () => void;
}

export function InvoicesList({
  invoices,
  onCreateInvoice,
  onPayInvoice,
  onEditInvoice,
  onRefresh,
}: InvoicesListProps) {
  const { toast } = useToast();
  const [sortField, setSortField] = useState("dueDate");
  const [sortDirection, setSortDirection] = useState("desc");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  
  // Sort invoices
  const sortedInvoices = [...invoices].sort((a, b) => {
    let valueA = a[sortField];
    let valueB = b[sortField];
    
    // Handle dates
    if (typeof valueA === 'string' && !isNaN(Date.parse(valueA))) {
      valueA = new Date(valueA).getTime();
      valueB = new Date(valueB).getTime();
    }
    
    // Handle numbers
    if (typeof valueA === "number" && typeof valueB === "number") {
      return sortDirection === "asc" ? valueA - valueB : valueB - valueA;
    }
    
    // Handle strings
    if (typeof valueA === "string" && typeof valueB === "string") {
      return sortDirection === "asc"
        ? valueA.localeCompare(valueB)
        : valueB.localeCompare(valueA);
    }
    
    return 0;
  });
  
  // Toggle sort
  const toggleSort = (field: string) => {
    if (field === sortField) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };
  
  // Get status badge
  const getStatusBadge = (status: string) => {
    let badgeVariant;
    
    switch (status) {
      case "PAID":
        badgeVariant = "success";
        break;
      case "PARTIALLY_PAID":
        badgeVariant = "warning";
        break;
      case "OVERDUE":
        badgeVariant = "destructive";
        break;
      case "DRAFT":
        badgeVariant = "outline";
        break;
      case "SENT":
        badgeVariant = "default";
        break;
      case "CANCELLED":
      case "VOID":
        badgeVariant = "secondary";
        break;
      default:
        badgeVariant = "outline";
    }
    
    // Convert status to user-friendly format
    const statusText = status
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ");
    
    return (
      <Badge variant={badgeVariant as any} className="font-normal">
        {statusText}
      </Badge>
    );
  };
  
  // Delete invoice mutation
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/invoices/${id}`);
      if (!res.ok) throw new Error("Failed to delete invoice");
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      
      toast({
        title: "Invoice deleted",
        description: "The invoice has been deleted successfully.",
      });
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete invoice: ${error.message}`,
        variant: "destructive",
      });
    },
  });
  
  // Send invoice mutation
  const sendInvoiceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/invoices/${id}/send`);
      if (!res.ok) throw new Error("Failed to send invoice");
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", id] });
      
      toast({
        title: "Invoice sent",
        description: "The invoice has been marked as sent and an email would be sent to the customer.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to send invoice: ${error.message}`,
        variant: "destructive",
      });
    },
  });
  
  // Handle invoice actions
  const handleDeleteClick = (invoice: any) => {
    setSelectedInvoice(invoice);
    setDeleteDialogOpen(true);
  };
  
  const handleSendClick = (invoice: any) => {
    sendInvoiceMutation.mutate(invoice.id);
  };
  
  // Handle document generation/printing/download
  const handlePrintClick = (invoice: any) => {
    toast({
      title: "Print feature",
      description: "Invoice printing is not yet implemented.",
    });
  };
  
  const handleDownloadClick = (invoice: any) => {
    toast({
      title: "Download feature",
      description: "Invoice download is not yet implemented.",
    });
  };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <div className="text-sm text-muted-foreground">
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} found
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={onCreateInvoice}>
            <FileText className="h-4 w-4 mr-2" />
            Create Invoice
          </Button>
        </div>
      </div>
      
      {invoices.length === 0 ? (
        <div className="text-center p-8 border rounded-md border-dashed">
          <h3 className="font-medium text-lg">No invoices found</h3>
          <p className="text-muted-foreground mt-1">
            No invoices have been created yet.
          </p>
          <Button onClick={onCreateInvoice} className="mt-4">
            <FileText className="h-4 w-4 mr-2" />
            Create Invoice
          </Button>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("invoiceNumber")}
                  >
                    Invoice #
                    {sortField === "invoiceNumber" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("customerId")}
                  >
                    Customer
                    {sortField === "customerId" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("createdAt")}
                  >
                    Created
                    {sortField === "createdAt" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("dueDate")}
                  >
                    Due Date
                    {sortField === "dueDate" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("status")}
                  >
                    Status
                    {sortField === "status" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("total")}
                  >
                    Total
                    {sortField === "total" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("amountPaid")}
                  >
                    Paid
                    {sortField === "amountPaid" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("dueAmount")}
                  >
                    Balance
                    {sortField === "dueAmount" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedInvoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoiceNumber || `#${invoice.id}`}</TableCell>
                  <TableCell>{invoice.customer?.name || `Customer #${invoice.customerId}`}</TableCell>
                  <TableCell>{format(new Date(invoice.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell>{format(new Date(invoice.dueDate), "MMM d, yyyy")}</TableCell>
                  <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                  <TableCell className="font-medium">{formatCurrency(invoice.total)}</TableCell>
                  <TableCell>{formatCurrency(invoice.amountPaid || 0)}</TableCell>
                  <TableCell className={invoice.dueAmount > 0 ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                    {formatCurrency(invoice.dueAmount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEditInvoice(invoice)}>
                          <FileText className="h-4 w-4 mr-2" />
                          Edit Invoice
                        </DropdownMenuItem>
                        
                        {(invoice.status === "DRAFT" || invoice.status === "SENT" || invoice.status === "OVERDUE" || invoice.status === "PARTIALLY_PAID") && (
                          <DropdownMenuItem onClick={() => onPayInvoice(invoice)}>
                            <CreditCard className="h-4 w-4 mr-2" />
                            Record Payment
                          </DropdownMenuItem>
                        )}
                        
                        {invoice.status === "DRAFT" && (
                          <DropdownMenuItem onClick={() => handleSendClick(invoice)} disabled={sendInvoiceMutation.isPending}>
                            <Send className="h-4 w-4 mr-2" />
                            Mark as Sent
                          </DropdownMenuItem>
                        )}
                        
                        <DropdownMenuItem onClick={() => handlePrintClick(invoice)}>
                          <Printer className="h-4 w-4 mr-2" />
                          Print
                        </DropdownMenuItem>
                        
                        <DropdownMenuItem onClick={() => handleDownloadClick(invoice)}>
                          <Download className="h-4 w-4 mr-2" />
                          Download PDF
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem 
                          onClick={() => handleDeleteClick(invoice)}
                          className="text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the invoice and all associated line items. This action cannot be undone.
              {selectedInvoice && selectedInvoice.status !== "DRAFT" && " This invoice has already been processed. Deleting it may cause accounting inconsistencies."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedInvoice && deleteInvoiceMutation.mutate(selectedInvoice.id)}
              disabled={deleteInvoiceMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteInvoiceMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}