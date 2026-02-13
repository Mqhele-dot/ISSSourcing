import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, CreditCard, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getQueryFn } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { InvoicesList } from "@/components/billing/invoices-list";
import { PaymentsList } from "@/components/billing/payments-list";
import { InvoiceDialog } from "@/components/billing/invoice-dialog";
import { PaymentDialog } from "@/components/billing/payment-dialog";

export default function BillingPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("invoices");
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  
  // Fetch invoices with nested customer data
  const { 
    data: invoices = [], 
    isLoading: isLoadingInvoices, 
    refetch: refetchInvoices 
  } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: getQueryFn(),
  });
  
  // Fetch payments with nested invoice data
  const { 
    data: payments = [], 
    isLoading: isLoadingPayments, 
    refetch: refetchPayments 
  } = useQuery({
    queryKey: ["/api/payments"],
    queryFn: getQueryFn(),
  });
  
  // Handle dialog open/close and operations
  const handleCreateInvoice = () => {
    setSelectedInvoice(null);
    setInvoiceDialogOpen(true);
  };
  
  const handleEditInvoice = (invoice) => {
    setSelectedInvoice(invoice);
    setInvoiceDialogOpen(true);
  };
  
  const handleInvoiceDialogClose = (success) => {
    setInvoiceDialogOpen(false);
    if (success) {
      refetchInvoices();
      toast({
        title: selectedInvoice ? "Invoice updated" : "Invoice created",
        description: selectedInvoice 
          ? "The invoice has been updated successfully." 
          : "The invoice has been created successfully.",
      });
    }
  };
  
  const handleCreatePayment = () => {
    setPaymentDialogOpen(true);
  };
  
  const handlePaymentDialogClose = (success) => {
    setPaymentDialogOpen(false);
    if (success) {
      refetchPayments();
      refetchInvoices(); // Refresh invoices as payment might change invoice status
      toast({
        title: "Payment recorded",
        description: "The payment has been recorded successfully.",
      });
    }
  };
  
  // Determine which action button to show based on active tab
  const renderActionButton = () => {
    if (activeTab === "invoices") {
      return (
        <Button onClick={handleCreateInvoice}>
          <Plus className="mr-2 h-4 w-4" />
          New Invoice
        </Button>
      );
    } else {
      return (
        <Button onClick={handleCreatePayment}>
          <Plus className="mr-2 h-4 w-4" />
          Record Payment
        </Button>
      );
    }
  };
  
  return (
    <div className="container space-y-6 py-6">
      <PageHeader
        title="Billing Management"
        description="Manage invoices and payments"
        icon={<FileText className="h-6 w-6" />}
        actions={renderActionButton()}
      />
      
      <Tabs
        defaultValue="invoices"
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="invoices" className="flex items-center">
            <FileText className="mr-2 h-4 w-4" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center">
            <CreditCard className="mr-2 h-4 w-4" />
            Payments
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="invoices" className="mt-6">
          {isLoadingInvoices ? (
            <div className="flex justify-center my-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
          ) : (
            <InvoicesList
              invoices={invoices}
              onRefresh={refetchInvoices}
              onEdit={handleEditInvoice}
            />
          )}
        </TabsContent>
        
        <TabsContent value="payments" className="mt-6">
          {isLoadingPayments ? (
            <div className="flex justify-center my-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
          ) : (
            <PaymentsList
              payments={payments}
              onRefresh={refetchPayments}
            />
          )}
        </TabsContent>
      </Tabs>
      
      {/* Dialogs */}
      <InvoiceDialog
        open={invoiceDialogOpen}
        onClose={handleInvoiceDialogClose}
        invoice={selectedInvoice}
      />
      
      <PaymentDialog
        open={paymentDialogOpen}
        onClose={handlePaymentDialogClose}
        invoices={invoices.filter(inv => 
          ["DRAFT", "SENT", "OVERDUE", "PARTIALLY_PAID"].includes(inv.status)
        )}
      />
    </div>
  );
}