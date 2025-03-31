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
  CreditCard,
  Receipt,
  Trash2,
  FileSearch,
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
import { cn } from "@/lib/utils";

interface Payment {
  id: number;
  invoiceId: number;
  amount: number;
  paymentDate: string | Date;
  method: string;
  transactionReference: string | null;
  notes: string | null;
  receivedBy: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  invoice?: any;
}

interface PaymentsListProps {
  payments: Payment[];
  onInvoiceView: (invoiceId: number) => void;
  onCreatePayment: () => void;
  onRefresh: () => void;
}

export function PaymentsList({
  payments,
  onInvoiceView,
  onCreatePayment,
  onRefresh,
}: PaymentsListProps) {
  const { toast } = useToast();
  const [sortField, setSortField] = useState("paymentDate");
  const [sortDirection, setSortDirection] = useState("desc");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  
  // Sort payments
  const sortedPayments = [...payments].sort((a, b) => {
    let valueA = a[sortField];
    let valueB = b[sortField];
    
    // Handle dates
    if (valueA instanceof Date || (typeof valueA === 'string' && !isNaN(Date.parse(valueA)))) {
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
  
  // Get payment method badge
  const getMethodBadge = (method: string) => {
    let badgeVariant;
    switch (method) {
      case "CREDIT_CARD":
      case "DEBIT_CARD":
        badgeVariant = "default";
        break;
      case "CASH":
        badgeVariant = "success";
        break;
      case "BANK_TRANSFER":
        badgeVariant = "outline";
        break;
      case "CHECK":
        badgeVariant = "secondary";
        break;
      case "PAYPAL":
        badgeVariant = "blue";
        break;
      default:
        badgeVariant = "outline";
    }
    
    // Convert method to user-friendly format
    const methodText = method
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ");
    
    return (
      <Badge variant={badgeVariant as any} className="font-normal">
        {methodText}
      </Badge>
    );
  };
  
  // View invoice details
  const handleViewInvoice = (invoiceId: number) => {
    onInvoiceView(invoiceId);
  };
  
  // Delete payment mutation
  const deletePaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/payments/${id}`);
      if (!res.ok) throw new Error("Failed to delete payment");
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      
      if (selectedPayment?.invoiceId) {
        queryClient.invalidateQueries({ queryKey: ["/api/invoices", selectedPayment.invoiceId] });
      }
      
      toast({
        title: "Payment deleted",
        description: "The payment has been deleted successfully.",
      });
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete payment: ${error.message}`,
        variant: "destructive",
      });
    },
  });
  
  // Handle payment deletion
  const handleDeleteClick = (payment: Payment) => {
    setSelectedPayment(payment);
    setDeleteDialogOpen(true);
  };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <div className="text-sm text-muted-foreground">
          {payments.length} payment{payments.length !== 1 ? "s" : ""} found
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={onCreatePayment}>
            <CreditCard className="h-4 w-4 mr-2" />
            New Payment
          </Button>
        </div>
      </div>
      
      {payments.length === 0 ? (
        <div className="text-center p-8 border rounded-md border-dashed">
          <h3 className="font-medium text-lg">No payments found</h3>
          <p className="text-muted-foreground mt-1">
            No payments have been recorded yet.
          </p>
          <Button onClick={onCreatePayment} className="mt-4">
            <CreditCard className="h-4 w-4 mr-2" />
            Record Payment
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
                    onClick={() => toggleSort("invoiceId")}
                  >
                    Invoice
                    {sortField === "invoiceId" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("method")}
                  >
                    Method
                    {sortField === "method" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("paymentDate")}
                  >
                    Date
                    {sortField === "paymentDate" && (
                      <ArrowDownUp className="ml-2 h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-medium"
                    onClick={() => toggleSort("amount")}
                  >
                    Amount
                    {sortField === "amount" && (
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
              {sortedPayments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{payment.id}</TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 h-auto font-normal"
                      onClick={() => handleViewInvoice(payment.invoiceId)}
                    >
                      #{payment.invoice?.invoiceNumber || payment.invoiceId}
                    </Button>
                  </TableCell>
                  <TableCell>{getMethodBadge(payment.method)}</TableCell>
                  <TableCell>
                    {format(new Date(payment.paymentDate), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(payment.amount)}
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
                        <DropdownMenuItem onClick={() => handleViewInvoice(payment.invoiceId)}>
                          <FileSearch className="h-4 w-4 mr-2" />
                          View Invoice
                        </DropdownMenuItem>
                        
                        <DropdownMenuItem 
                          onClick={() => {
                            toast({
                              title: "Info",
                              description: "Payment receipt printing is not yet implemented.",
                            })
                          }}
                        >
                          <Receipt className="h-4 w-4 mr-2" />
                          Print Receipt
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          onClick={() => handleDeleteClick(payment)}
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
              This will permanently delete the payment of {formatCurrency(selectedPayment?.amount || 0)} 
              made on {selectedPayment ? format(new Date(selectedPayment.paymentDate), "MMMM d, yyyy") : ""}.
              This action cannot be undone, and it will also reduce the paid amount on the associated invoice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedPayment && deletePaymentMutation.mutate(selectedPayment.id)}
              disabled={deletePaymentMutation.isPending}
            >
              {deletePaymentMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}