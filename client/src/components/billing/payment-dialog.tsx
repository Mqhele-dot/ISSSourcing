import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// Payment validation schema
const paymentFormSchema = z.object({
  invoiceId: z.number({
    required_error: "Invoice is required",
  }),
  paymentDate: z.date({
    required_error: "Payment date is required",
  }),
  amount: z.number({
    required_error: "Amount is required",
  }).min(0.01, "Amount must be greater than 0"),
  method: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "CHECK", "PAYPAL", "OTHER"], {
    required_error: "Payment method is required",
  }),
  transactionReference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type PaymentFormValues = z.infer<typeof paymentFormSchema>;

export function PaymentDialog({ open, onClose, invoices }) {
  const { toast } = useToast();
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  
  // Default form values
  const defaultValues: Partial<PaymentFormValues> = {
    invoiceId: 0,
    paymentDate: new Date(),
    amount: 0,
    method: "CASH",
    transactionReference: "",
    notes: "",
  };
  
  // Setup form
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues,
  });
  
  // Update the amount when invoice changes
  const handleInvoiceChange = (invoiceId: number) => {
    const invoice = invoices.find(inv => inv.id === invoiceId);
    setSelectedInvoice(invoice);
    
    if (invoice) {
      const dueAmount = invoice.total - (invoice.amountPaid || 0);
      form.setValue("amount", dueAmount);
    }
  };
  
  // Get invoice options with status badges
  const getInvoiceOptions = () => {
    return invoices
      .filter(invoice => 
        invoice.status !== "PAID" && 
        invoice.status !== "CANCELLED" && 
        invoice.status !== "VOID"
      )
      .map(invoice => ({
        id: invoice.id,
        label: `#${invoice.invoiceNumber || invoice.id} - ${format(new Date(invoice.dueDate), "MMM d, yyyy")}`,
        dueAmount: invoice.total - (invoice.amountPaid || 0),
        status: invoice.status,
        customerName: invoice.customer?.name || `Customer #${invoice.customerId}`
      }));
  };
  
  // Get status badge
  const getStatusBadge = (status: string) => {
    let badgeVariant;
    switch (status) {
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
      default:
        badgeVariant = "outline";
    }
    
    // Convert status to user-friendly format
    const statusText = status
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ");
    
    return (
      <Badge variant={badgeVariant as any} className="font-normal ml-2">
        {statusText}
      </Badge>
    );
  };
  
  // Format currency
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };
  
  // Create payment mutation
  const paymentMutation = useMutation({
    mutationFn: async (data: PaymentFormValues) => {
      // Add receivedBy (current user ID - would come from auth in a real app)
      const paymentData = {
        ...data,
        receivedBy: 1, // Placeholder, would be the current user ID
      };
      
      const res = await apiRequest("POST", "/api/payments", paymentData);
      
      if (!res.ok) throw new Error("Failed to record payment");
      
      return await res.json();
    },
    onSuccess: (data) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", data.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      
      toast({
        title: "Payment recorded",
        description: "The payment has been recorded successfully",
      });
      
      onClose(true);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to record payment: ${error.message}`,
        variant: "destructive",
      });
    },
  });
  
  // Create payment with Stripe
  const processPaymentWithStripe = () => {
    const values = form.getValues();
    const invoice = invoices.find(invoice => invoice.id === values.invoiceId);
    
    // Check if we have Stripe keys configured
    if (!import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
      toast({
        title: "Stripe not configured",
        description: "Stripe payment processing is not configured. Please add your Stripe API keys to process card payments.",
        variant: "destructive",
      });
      return;
    }
    
    toast({
      title: "Stripe integration",
      description: "Stripe payment processing would be initiated here with proper setup. For now, recording as a manual payment.",
    });
    
    // Submit the form with the current values
    form.handleSubmit(onSubmit)();
  };
  
  // Form submission
  const onSubmit = (data: PaymentFormValues) => {
    if (data.method === "CREDIT_CARD" || data.method === "DEBIT_CARD") {
      // If using card payment and Stripe is set up, process with Stripe
      if (import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
        processPaymentWithStripe();
        return;
      }
    }
    
    // Otherwise, just record the payment directly
    paymentMutation.mutate(data);
  };
  
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Record Payment
          </DialogTitle>
          <DialogDescription>
            Record a payment for an invoice. This will update the invoice's payment status.
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Invoice Selection */}
            <FormField
              control={form.control}
              name="invoiceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Invoice</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(parseInt(value));
                      handleInvoiceChange(parseInt(value));
                    }}
                    defaultValue={field.value ? field.value.toString() : undefined}
                    disabled={paymentMutation.isPending}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an invoice to pay" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {getInvoiceOptions().map((option) => (
                        <SelectItem
                          key={option.id}
                          value={option.id.toString()}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span>{option.label}</span>
                            {getStatusBadge(option.status)}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {option.customerName} - Due: {formatCurrency(option.dueAmount)}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Payment Amount and Date in a row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Payment Amount */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          className="pl-7"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          disabled={paymentMutation.isPending}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {/* Payment Date */}
              <FormField
                control={form.control}
                name="paymentDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Payment Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            disabled={paymentMutation.isPending}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            {/* Payment Method */}
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={paymentMutation.isPending}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select payment method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="CASH">Cash</SelectItem>
                      <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                      <SelectItem value="DEBIT_CARD">Debit Card</SelectItem>
                      <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                      <SelectItem value="CHECK">Check</SelectItem>
                      <SelectItem value="PAYPAL">PayPal</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {(form.watch("method") === "CREDIT_CARD" || form.watch("method") === "DEBIT_CARD") && (
                    <FormDescription>
                      Card payments will be processed through Stripe when configured.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Transaction Reference */}
            <FormField
              control={form.control}
              name="transactionReference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference/Transaction ID</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter check number, transaction ID, etc."
                      {...field}
                      value={field.value || ""}
                      disabled={paymentMutation.isPending}
                    />
                  </FormControl>
                  <FormDescription>
                    {form.watch("method") === "CHECK" ? "Check number" : 
                     form.watch("method") === "BANK_TRANSFER" ? "Transfer reference" :
                     form.watch("method") === "CREDIT_CARD" || form.watch("method") === "DEBIT_CARD" ? "Card last 4 digits" :
                     "Optional reference information"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter any additional notes about this payment"
                      className="min-h-[80px]"
                      {...field}
                      value={field.value || ""}
                      disabled={paymentMutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onClose(false)}
                disabled={paymentMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={paymentMutation.isPending || !form.formState.isValid}
              >
                {paymentMutation.isPending ? "Processing..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}