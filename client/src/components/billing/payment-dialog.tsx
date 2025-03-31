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
  method: z.enum([
    "CASH", 
    "CREDIT_CARD", 
    "DEBIT_CARD", 
    "BANK_TRANSFER", 
    "CHECK", 
    "PAYPAL", 
    "OTHER"
  ], {
    required_error: "Payment method is required",
  }),
  transactionReference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type PaymentFormValues = z.infer<typeof paymentFormSchema>;

export function PaymentDialog({ open, onClose, invoices }) {
  const { toast } = useToast();
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  
  // Default values for the form
  const defaultValues: Partial<PaymentFormValues> = {
    invoiceId: 0,
    paymentDate: new Date(),
    amount: 0,
    method: "CASH",
    transactionReference: "",
    notes: "",
  };
  
  // Set up form
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues,
  });
  
  // Update amount when invoice changes
  const handleInvoiceChange = (invoiceId: number) => {
    const invoice = invoices?.find(inv => inv.id === invoiceId);
    if (invoice) {
      setSelectedInvoice(invoice);
      
      // Calculate remaining amount
      const totalDue = invoice.total || 0;
      const amountPaid = invoice.amountPaid || 0;
      const remainingAmount = totalDue - amountPaid;
      
      form.setValue("amount", remainingAmount > 0 ? remainingAmount : 0);
    }
  };
  
  // Create payment mutation
  const paymentMutation = useMutation({
    mutationFn: async (data: PaymentFormValues) => {
      const res = await apiRequest("POST", "/api/payments", data);
      if (!res.ok) throw new Error("Failed to record payment");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      
      if (form.getValues("invoiceId")) {
        queryClient.invalidateQueries({ 
          queryKey: ["/api/invoices", form.getValues("invoiceId")] 
        });
      }
      
      toast({
        title: "Payment recorded",
        description: "The payment has been recorded successfully.",
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
  
  // Form submission
  const onSubmit = (data: PaymentFormValues) => {
    paymentMutation.mutate(data);
  };
  
  // Format currency
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };
  
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Record Payment
          </DialogTitle>
          <DialogDescription>
            Record a payment for an invoice
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
                        <SelectValue placeholder="Select an invoice" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {invoices?.map((invoice) => (
                        <SelectItem
                          key={invoice.id}
                          value={invoice.id.toString()}
                        >
                          #{invoice.invoiceNumber || invoice.id} - {invoice.customer?.name || `Customer #${invoice.customerId}`} - {formatCurrency(invoice.total || 0)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Payment Details Section */}
            {selectedInvoice && (
              <div className="rounded-md border p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice Total:</span>
                  <span className="font-medium">{formatCurrency(selectedInvoice.total || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount Paid:</span>
                  <span className="font-medium">{formatCurrency(selectedInvoice.amountPaid || 0)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="text-muted-foreground">Due Amount:</span>
                  <span className="font-medium">{formatCurrency((selectedInvoice.total || 0) - (selectedInvoice.amountPaid || 0))}</span>
                </div>
              </div>
            )}
            
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
                  <FormMessage />
                </FormItem>
              )}
            />
            
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
                        step="0.01"
                        min="0.01"
                        className="pl-7"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        disabled={paymentMutation.isPending}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Enter the payment amount
                  </FormDescription>
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
                  <FormLabel>Transaction Reference</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Check number, transaction ID, etc."
                      {...field}
                      value={field.value || ""}
                      disabled={paymentMutation.isPending}
                    />
                  </FormControl>
                  <FormDescription>
                    Reference number for this payment (optional)
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
                      placeholder="Additional notes about this payment"
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
                disabled={paymentMutation.isPending || !form.getValues("invoiceId")}
              >
                {paymentMutation.isPending ? "Saving..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}