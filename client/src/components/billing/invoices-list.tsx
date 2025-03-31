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
  Send,
  Printer,
  Download,
  Clock,
  Ban,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, isAfter, parseISO } from "date-fns";
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
  onInvoiceSelect: (invoice: any) => void;
  onCreateInvoice: () => void;
  onPaymentAdd: (invoice: any) => void;
  onRefresh: () => void;
}

export function InvoicesList({
  invoices,
  onInvoiceSelect,
  onCreateInvoice,
  onPaymentAdd,
  onRefresh,
}: InvoicesListProps) {
  const { toast } = useToast();
  const [sortField, setSortField] = useState("dueDate");
  const [sortDirection, setSortDirection] = useState("desc");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  
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
  
  // Select invoice to view
  const handleInvoiceClick = (invoice: any) => {
    onInvoiceSelect(invoice);
  };
  
  // Invoice actions mutations
  const updateInvoiceStatusMutation = useMutation({
    mutationFn: async ({ invoice, action }: { invoice: any, action: string }) => {
      let newStatus;
      
      switch (action) {
        case "cancel":
          newStatus = "CANCELLED";
          break;
        case "void":
          newStatus = "VOID";
          break;
        case "mark_paid":
          newStatus = "PAID";
          break;
        case "mark_sent":
          newStatus = "SENT";
          break;
        default:
          throw new Error("Invalid action");
      }
      
      const res = await apiRequest("PATCH", `/api/invoices/${invoice.id}`, {
        status: newStatus
      });
      
      if (!res.ok) throw new Error(`Failed to ${action} invoice`);
      
      return {
        invoice,
        action,
        newStatus
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", data.invoice.id] });
      
      let message;
      switch (data.action) {
        case "cancel":
          message = "Invoice cancelled successfully";
          setCancelDialogOpen(false);
          break;
        case "void":
          message = "Invoice voided successfully";
          setVoidDialogOpen(false);
          break;
        case "mark_paid":
          message = "Invoice marked as paid";
          setPayDialogOpen(false);
          break;
        case "mark_sent":
          message = "Invoice marked as sent";
          break;
      }
      
      toast({
        title: "Status updated",
        description: message,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/invoices/${id}`);
      if (!res.ok) throw new Error("Failed to delete invoice");
      return id;
    },
    onSuccess: () => {
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
  
  // Check if invoice is overdue
  const isInvoiceOverdue = (dueDate: any) => {
    const parsedDueDate = typeof dueDate === 'string' ? parseISO(dueDate) : dueDate;
    return parsedDueDate && isAfter(new Date(), parsedDueDate);
  };
  
  // Get due date styling
  const getDueDateStyle = (dueDate: any, status: any) => {
    if (["PAID", "CANCELLED", "VOID"].includes(status)) {
      return "text-muted-foreground";
    }
    
    return isInvoiceOverdue(dueDate) ? "text-red-500 dark:text-red-400 font-medium" : "";
  };
  
  // Handle invoice actions
  const handleDeleteClick = (invoice: any) => {
    setSelectedInvoice(invoice);
    setDeleteDialogOpen(true);
  };
  
  const handleCancelClick = (invoice: any) => {
    setSelectedInvoice(invoice);
    setCancelDialogOpen(true);
  };
  
  const handleVoidClick = (invoice: any) => {
    setSelectedInvoice(invoice);
    setVoidDialogOpen(true);
  };
  
  const handlePaymentClick = (invoice: any) => {
    onPaymentAdd(invoice);
  };
  
  const handleMarkAsPaidClick = (invoice: any) => {
    setSelectedInvoice(invoice);
    setPayDialogOpen(true);
  };
  
  const handleMarkAsSentClick = (invoice: any) => {
    updateInvoiceStatusMutation.mutate({ invoice, action: "mark_sent" });
  };
  
  // Handle document generation/printing/download
  const handlePrintClick = () => {
    toast({
      title: "Print feature",
      description: "Invoice printing is not yet implemented.",
    });
  };
  
  const handleDownloadClick = () => {
    toast({
      title: "Download feature",
      description: "Invoice download is not yet implemented.",
    });
  };
  
  const handleSendInvoiceClick = () => {
    toast({
      title: "Send invoice",
      description: "Email sending is not yet implemented.",
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
            New Invoice
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
                    onClick={() => toggleSort("id")}
                  >
                    ID
                    {sortField === "id" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
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
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedInvoices.map((invoice) => (
                <TableRow key={invoice.id} className="cursor-pointer" onClick={() => handleInvoiceClick(invoice)}>
                  <TableCell>{invoice.id}</TableCell>
                  <TableCell className="font-medium">
                    #{invoice.invoiceNumber || invoice.id}
                  </TableCell>
                  <TableCell>
                    {invoice.customer?.name || `Customer #${invoice.customerId}`}
                  </TableCell>
                  <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                  <TableCell className={getDueDateStyle(invoice.dueDate, invoice.status)}>
                    {format(new Date(invoice.dueDate), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(invoice.total || 0)}
                  </TableCell>
                  <TableCell>
                    {formatCurrency(invoice.amountPaid || 0)}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleInvoiceClick(invoice)}>
                          <FileText className="h-4 w-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        
                        {invoice.status !== "PAID" && invoice.status !== "CANCELLED" && invoice.status !== "VOID" && (
                          <DropdownMenuItem onClick={() => handlePaymentClick(invoice)}>
                            <CreditCard className="h-4 w-4 mr-2" />
                            Record Payment
                          </DropdownMenuItem>
                        )}
                        
                        <DropdownMenuItem onClick={handlePrintClick}>
                          <Printer className="h-4 w-4 mr-2" />
                          Print
                        </DropdownMenuItem>
                        
                        <DropdownMenuItem onClick={handleDownloadClick}>
                          <Download className="h-4 w-4 mr-2" />
                          Download PDF
                        </DropdownMenuItem>
                        
                        {invoice.status === "DRAFT" && (
                          <DropdownMenuItem onClick={() => handleMarkAsSentClick(invoice)}>
                            <Send className="h-4 w-4 mr-2" />
                            Mark as Sent
                          </DropdownMenuItem>
                        )}
                        
                        {invoice.status === "SENT" && (
                          <DropdownMenuItem onClick={handleSendInvoiceClick}>
                            <Send className="h-4 w-4 mr-2" />
                            Send Email
                          </DropdownMenuItem>
                        )}
                        
                        {invoice.status !== "PAID" && invoice.status !== "CANCELLED" && invoice.status !== "VOID" && (
                          <DropdownMenuItem onClick={() => handleMarkAsPaidClick(invoice)}>
                            <Check className="h-4 w-4 mr-2" />
                            Mark as Paid
                          </DropdownMenuItem>
                        )}
                        
                        <DropdownMenuSeparator />
                        
                        {invoice.status !== "CANCELLED" && invoice.status !== "VOID" && (
                          <>
                            <DropdownMenuItem 
                              onClick={() => handleCancelClick(invoice)}
                              className="text-amber-600 dark:text-amber-400"
                            >
                              <Ban className="h-4 w-4 mr-2" />
                              Cancel Invoice
                            </DropdownMenuItem>
                            
                            <DropdownMenuItem 
                              onClick={() => handleVoidClick(invoice)}
                              className="text-amber-600 dark:text-amber-400"
                            >
                              <Clock className="h-4 w-4 mr-2" />
                              Void Invoice
                            </DropdownMenuItem>
                          </>
                        )}
                        
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
              This will permanently delete the invoice #{selectedInvoice?.invoiceNumber || selectedInvoice?.id}.
              This action cannot be undone.
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
      
      {/* Cancel Invoice Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel invoice #{selectedInvoice?.invoiceNumber || selectedInvoice?.id}?
              Cancelled invoices cannot be modified or paid, but they will remain in the system for record-keeping.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, Keep It</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedInvoice && updateInvoiceStatusMutation.mutate({ invoice: selectedInvoice, action: "cancel" })}
              disabled={updateInvoiceStatusMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {updateInvoiceStatusMutation.isPending ? "Cancelling..." : "Yes, Cancel Invoice"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Void Invoice Dialog */}
      <AlertDialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to void invoice #{selectedInvoice?.invoiceNumber || selectedInvoice?.id}?
              Voided invoices cannot be modified or paid, and they will be marked as having zero value while 
              remaining in the system for record-keeping.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, Keep It</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedInvoice && updateInvoiceStatusMutation.mutate({ invoice: selectedInvoice, action: "void" })}
              disabled={updateInvoiceStatusMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {updateInvoiceStatusMutation.isPending ? "Voiding..." : "Yes, Void Invoice"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Mark as Paid Dialog */}
      <AlertDialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Invoice as Paid?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark invoice #{selectedInvoice?.invoiceNumber || selectedInvoice?.id} as paid?
              This will update the invoice status without recording any specific payment details. 
              For detailed payment records, use the "Record Payment" option instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedInvoice && updateInvoiceStatusMutation.mutate({ invoice: selectedInvoice, action: "mark_paid" })}
              disabled={updateInvoiceStatusMutation.isPending}
            >
              {updateInvoiceStatusMutation.isPending ? "Updating..." : "Mark as Paid"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}