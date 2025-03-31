import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { CalendarIcon, Trash, Plus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

// Invoice validation schema
const invoiceFormSchema = z.object({
  customerId: z.number({
    required_error: "Customer is required",
  }),
  dueDate: z.date({
    required_error: "Due date is required",
  }),
  status: z.enum([
    "DRAFT", 
    "SENT", 
    "OVERDUE", 
    "PARTIALLY_PAID", 
    "PAID", 
    "CANCELLED", 
    "VOID"
  ], {
    required_error: "Status is required",
  }),
  notes: z.string().nullable().optional(),
  termsAndConditions: z.string().nullable().optional(),
  items: z.array(
    z.object({
      itemId: z.number().optional(),
      description: z.string({
        required_error: "Item description is required",
      }),
      quantity: z.number().min(0.01, "Quantity must be greater than 0"),
      unitPrice: z.number().min(0, "Price cannot be negative"),
      discount: z.number().min(0, "Discount cannot be negative").max(100, "Discount cannot exceed 100%").nullable().optional(),
      taxRate: z.number().min(0, "Tax rate cannot be negative").max(100, "Tax rate cannot exceed 100%").nullable().optional(),
      taxAmount: z.number().nullable().optional(),
      totalPrice: z.number(),
    })
  ).min(1, "At least one item is required"),
});

type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

export function InvoiceDialog({ open, onClose, invoice }) {
  const { toast } = useToast();
  const [total, setTotal] = useState(0);
  const [taxTotal, setTaxTotal] = useState(0);
  const [discountTotal, setDiscountTotal] = useState(0);
  const isEditing = !!invoice?.id;
  
  // Calculate totals
  const calculateSubtotal = (items) => {
    return items.reduce((sum, item) => {
      return sum + (item.quantity * item.unitPrice);
    }, 0);
  };
  
  const calculateTotal = (items) => {
    return items.reduce((sum, item) => {
      return sum + item.totalPrice;
    }, 0);
  };
  
  // Default values for the form
  const defaultValues: Partial<InvoiceFormValues> = {
    customerId: 0,
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    status: "DRAFT",
    notes: "",
    termsAndConditions: "Payment is due within 30 days. Late payments may incur additional fees.",
    items: [
      {
        itemId: undefined,
        description: "",
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        totalPrice: 0,
      },
    ],
  };
  
  // Fetch customers for the dropdown
  const { data: customers } = useQuery({
    queryKey: ["/api/customers"],
    queryFn: undefined,
  });
  
  // Fetch items for the dropdown
  const { data: inventoryItems } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: undefined,
  });
  
  // Set up form
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: isEditing ? {
      ...defaultValues,
      ...invoice,
      dueDate: new Date(invoice.dueDate),
      items: invoice.items?.map((item) => ({
        ...item,
        discount: item.discount || 0,
        taxRate: item.taxRate || 0,
        taxAmount: item.taxAmount || 0,
      })) || defaultValues.items,
    } : defaultValues,
  });
  
  // Set up field array for invoice items
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });
  
  // Calculate item total price on change
  const calculateItemPrice = (index: number) => {
    const values = form.getValues();
    const item = values.items[index];
    
    if (!item) return;
    
    const { quantity, unitPrice, discount, taxRate } = item;
    const subtotal = quantity * unitPrice;
    const discountAmount = subtotal * ((discount || 0) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = afterDiscount * ((taxRate || 0) / 100);
    const totalPrice = afterDiscount + taxAmount;
    
    form.setValue(`items.${index}.taxAmount`, taxAmount);
    form.setValue(`items.${index}.totalPrice`, totalPrice);
    
    // Recalculate entire invoice total
    const items = form.getValues("items");
    setTotal(calculateTotal(items));
    setTaxTotal(items.reduce((sum, item) => sum + (item.taxAmount || 0), 0));
    setDiscountTotal(items.reduce((sum, item) => {
      const itemSubtotal = item.quantity * item.unitPrice;
      return sum + (itemSubtotal * ((item.discount || 0) / 100));
    }, 0));
  };
  
  // Update calculations when an inventory item is selected
  const handleInventoryItemSelect = (itemId: number, index: number) => {
    if (!inventoryItems) return;
    
    const item = inventoryItems.find(invItem => invItem.id === itemId);
    if (!item) return;
    
    form.setValue(`items.${index}.itemId`, item.id);
    form.setValue(`items.${index}.description`, item.name);
    form.setValue(`items.${index}.unitPrice`, item.price);
    
    calculateItemPrice(index);
  };
  
  // Create/Update invoice mutation
  const invoiceMutation = useMutation({
    mutationFn: async (data: InvoiceFormValues) => {
      const url = isEditing ? `/api/invoices/${invoice.id}` : "/api/invoices";
      const method = isEditing ? "PATCH" : "POST";
      
      const res = await apiRequest(method, url, data);
      if (!res.ok) throw new Error(`Failed to ${isEditing ? "update" : "create"} invoice`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      
      if (isEditing && invoice.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoice.id] });
      }
      
      toast({
        title: `Invoice ${isEditing ? "updated" : "created"}`,
        description: `The invoice has been ${isEditing ? "updated" : "created"} successfully.`,
      });
      onClose(true);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to ${isEditing ? "update" : "create"} invoice: ${error.message}`,
        variant: "destructive",
      });
    },
  });
  
  // Form submission
  const onSubmit = (data: InvoiceFormValues) => {
    invoiceMutation.mutate(data);
  };
  
  // Add a new item
  const addItem = () => {
    append({
      itemId: undefined,
      description: "",
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      totalPrice: 0,
    });
  };
  
  // Update totals on form changes
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name?.startsWith("items")) {
        const indexMatch = name.match(/items\.(\d+)\./);
        if (indexMatch && indexMatch[1]) {
          const index = parseInt(indexMatch[1], 10);
          calculateItemPrice(index);
        } else {
          // If the entire items array changed, recalculate all items
          const items = form.getValues("items") || [];
          items.forEach((_, index) => calculateItemPrice(index));
        }
      }
    });
    
    // Initialize totals
    const items = form.getValues("items") || [];
    items.forEach((_, index) => calculateItemPrice(index));
    
    return () => subscription.unsubscribe();
  }, [form, form.watch]);
  
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {isEditing ? "Edit Invoice" : "Create Invoice"}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? "Update the invoice details below" : "Create a new invoice by filling out the form below"}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Customer Selection */}
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(parseInt(value))}
                      defaultValue={field.value ? field.value.toString() : undefined}
                      disabled={invoiceMutation.isPending}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a customer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers?.map((customer) => (
                          <SelectItem
                            key={customer.id}
                            value={customer.id.toString()}
                          >
                            {customer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {/* Due Date Selection */}
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Due Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            disabled={invoiceMutation.isPending}
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
                          disabled={(date) => date < new Date()}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {/* Invoice Status */}
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={invoiceMutation.isPending}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="DRAFT">Draft</SelectItem>
                        <SelectItem value="SENT">Sent</SelectItem>
                        <SelectItem value="OVERDUE">Overdue</SelectItem>
                        <SelectItem value="PARTIALLY_PAID">Partially Paid</SelectItem>
                        <SelectItem value="PAID">Paid</SelectItem>
                        <SelectItem value="CANCELLED">Cancelled</SelectItem>
                        <SelectItem value="VOID">Void</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            {/* Invoice Items */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Invoice Items</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItem}
                  disabled={invoiceMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </Button>
              </div>
              
              <div className="border rounded-md">
                <div className="grid grid-cols-12 gap-2 p-4 bg-muted/50 border-b font-medium text-sm">
                  <div className="col-span-3">Description</div>
                  <div className="col-span-1 text-center">Qty</div>
                  <div className="col-span-2 text-center">Unit Price</div>
                  <div className="col-span-1 text-center">Discount %</div>
                  <div className="col-span-1 text-center">Tax %</div>
                  <div className="col-span-1 text-center">Tax Amt</div>
                  <div className="col-span-2 text-center">Total</div>
                  <div className="col-span-1"></div>
                </div>
                
                {fields.map((field, index) => (
                  <div key={field.id} className="grid grid-cols-12 gap-2 p-4 border-b items-center">
                    <div className="col-span-3">
                      <FormField
                        control={form.control}
                        name={`items.${index}.description`}
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <FormControl>
                              <div className="space-y-2">
                                {inventoryItems && (
                                  <Select
                                    onValueChange={(value) => handleInventoryItemSelect(parseInt(value), index)}
                                    disabled={invoiceMutation.isPending}
                                  >
                                    <SelectTrigger className="w-full h-9 mb-1">
                                      <SelectValue placeholder="Select item" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {inventoryItems.map((invItem) => (
                                        <SelectItem
                                          key={invItem.id}
                                          value={invItem.id.toString()}
                                        >
                                          {invItem.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                <Input
                                  placeholder="Item description"
                                  {...field}
                                  disabled={invoiceMutation.isPending}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="col-span-1">
                      <FormField
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <FormControl>
                              <Input
                                type="number"
                                min="0.01"
                                step="0.01"
                                {...field}
                                onChange={(e) => {
                                  field.onChange(parseFloat(e.target.value) || 0);
                                  calculateItemPrice(index);
                                }}
                                disabled={invoiceMutation.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="col-span-2">
                      <FormField
                        control={form.control}
                        name={`items.${index}.unitPrice`}
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <FormControl>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  className="pl-7"
                                  placeholder="0.00"
                                  {...field}
                                  onChange={(e) => {
                                    field.onChange(parseFloat(e.target.value) || 0);
                                    calculateItemPrice(index);
                                  }}
                                  disabled={invoiceMutation.isPending}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="col-span-1">
                      <FormField
                        control={form.control}
                        name={`items.${index}.discount`}
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <FormControl>
                              <div className="relative">
                                <Input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.1"
                                  placeholder="0"
                                  className="pr-7"
                                  {...field}
                                  value={field.value || 0}
                                  onChange={(e) => {
                                    field.onChange(parseFloat(e.target.value) || 0);
                                    calculateItemPrice(index);
                                  }}
                                  disabled={invoiceMutation.isPending}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2">%</span>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="col-span-1">
                      <FormField
                        control={form.control}
                        name={`items.${index}.taxRate`}
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <FormControl>
                              <div className="relative">
                                <Input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.1"
                                  placeholder="0"
                                  className="pr-7"
                                  {...field}
                                  value={field.value || 0}
                                  onChange={(e) => {
                                    field.onChange(parseFloat(e.target.value) || 0);
                                    calculateItemPrice(index);
                                  }}
                                  disabled={invoiceMutation.isPending}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2">%</span>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="col-span-1">
                      <FormField
                        control={form.control}
                        name={`items.${index}.taxAmount`}
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                className="read-only:opacity-50"
                                readOnly
                                {...field}
                                value={field.value || 0}
                                disabled={true}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="col-span-2">
                      <FormField
                        control={form.control}
                        name={`items.${index}.totalPrice`}
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <FormControl>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  className="pl-7 read-only:opacity-50"
                                  placeholder="0.00"
                                  readOnly
                                  {...field}
                                  value={field.value || 0}
                                  disabled={true}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="col-span-1 flex justify-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0"
                        onClick={() => {
                          remove(index);
                          // Recalculate totals after removing an item
                          setTimeout(() => {
                            const items = form.getValues("items") || [];
                            setTotal(calculateTotal(items));
                            setTaxTotal(items.reduce((sum, item) => sum + (item.taxAmount || 0), 0));
                            setDiscountTotal(items.reduce((sum, item) => {
                              const itemSubtotal = item.quantity * item.unitPrice;
                              return sum + (itemSubtotal * ((item.discount || 0) / 100));
                            }, 0));
                          }, 0);
                        }}
                        disabled={invoiceMutation.isPending || fields.length <= 1}
                      >
                        <Trash className="h-4 w-4" />
                        <span className="sr-only">Remove</span>
                      </Button>
                    </div>
                  </div>
                ))}
                
                {/* Invoice Totals */}
                <div className="grid grid-cols-12 gap-2 p-4 bg-muted/20">
                  <div className="col-span-8 md:col-span-9"></div>
                  <div className="col-span-4 md:col-span-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Subtotal:</span>
                      <span>${(total + discountTotal - taxTotal).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Discount:</span>
                      <span>-${discountTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Tax:</span>
                      <span>${taxTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-medium pt-2 border-t">
                      <span>Total:</span>
                      <span>${total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Notes and Terms */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes for the customer"
                        className="min-h-[120px]"
                        {...field}
                        value={field.value || ""}
                        disabled={invoiceMutation.isPending}
                      />
                    </FormControl>
                    <FormDescription>
                      Notes will be visible to the customer
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="termsAndConditions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Terms and Conditions</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Terms and conditions for the invoice"
                        className="min-h-[120px]"
                        {...field}
                        value={field.value || ""}
                        disabled={invoiceMutation.isPending}
                      />
                    </FormControl>
                    <FormDescription>
                      Terms will appear at the bottom of the invoice
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onClose(false)}
                disabled={invoiceMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={invoiceMutation.isPending}
              >
                {invoiceMutation.isPending ? "Saving..." : isEditing ? "Update Invoice" : "Create Invoice"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}