import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import { format, addDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, FileText, Plus, Trash } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Invoice validation schema
const invoiceFormSchema = z.object({
  customerId: z.number({
    required_error: "Customer is required",
  }),
  dueDate: z.date({
    required_error: "Due date is required",
  }),
  status: z.enum(["DRAFT", "SENT", "PAID", "PARTIALLY_PAID", "OVERDUE", "CANCELLED", "VOID"], {
    required_error: "Status is required",
  }).default("DRAFT"),
  notes: z.string().nullable().optional(),
  invoiceNumber: z.string().optional(),
  subtotal: z.number().optional(),
  taxAmount: z.number().optional(),
  discountAmount: z.number().optional(),
  total: z.number().optional(),
  amountPaid: z.number().optional(),
  dueAmount: z.number().optional(),
  items: z.array(
    z.object({
      id: z.number().optional(),
      itemId: z.number(),
      description: z.string(),
      quantity: z.number().min(0.01, "Quantity must be greater than 0"),
      unitPrice: z.number().min(0, "Unit price must be 0 or greater"),
      discount: z.number().min(0, "Discount must be 0 or greater").max(100, "Discount cannot exceed 100%").optional().nullable(),
      taxRate: z.number().min(0, "Tax rate must be 0 or greater").max(100, "Tax rate cannot exceed 100%").optional().nullable(),
      taxAmount: z.number().optional().nullable(),
      totalPrice: z.number(),
    })
  ).optional(),
});

type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

// Invoice line item schema
const invoiceItemSchema = z.object({
  itemId: z.number(),
  description: z.string().min(1, "Description is required"),
  quantity: z.number().min(0.01, "Quantity must be greater than 0"),
  unitPrice: z.number().min(0, "Unit price must be 0 or greater"),
  discount: z.number().min(0, "Discount must be 0 or greater").max(100, "Discount cannot exceed 100%").default(0),
  taxRate: z.number().min(0, "Tax rate must be 0 or greater").max(100, "Tax rate cannot exceed 100%").default(0),
});

type InvoiceItemValues = z.infer<typeof invoiceItemSchema>;

export function InvoiceDialog({ open, onClose, invoice }) {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [newItemDialogOpen, setNewItemDialogOpen] = useState(false);
  
  // Calculate totals
  const calculateSubtotal = (items) => {
    return items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
  };
  
  const calculateTaxTotal = (items) => {
    return items.reduce((sum, item) => sum + (item.taxAmount || 0), 0);
  };
  
  // Calculate item total price
  const calculateItemTotalPrice = (quantity: number, unitPrice: number, discount: number = 0, taxRate: number = 0) => {
    const lineTotal = quantity * unitPrice;
    const discountAmount = (lineTotal * discount) / 100;
    const subtotalAfterDiscount = lineTotal - discountAmount;
    const taxAmount = (subtotalAfterDiscount * taxRate) / 100;
    
    return {
      totalPrice: subtotalAfterDiscount + taxAmount,
      taxAmount
    };
  };
  
  // Default values for the form
  const defaultValues: Partial<InvoiceFormValues> = {
    customerId: 0,
    dueDate: addDays(new Date(), 30),
    status: "DRAFT",
    notes: "",
    items: [],
  };
  
  // Fetch inventory items query
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/inventory");
      if (!response.ok) {
        throw new Error("Failed to fetch inventory items");
      }
      return response.json();
    },
    enabled: open,
  });
  
  // Fetch customers query
  const { data: customers = [] } = useQuery({
    queryKey: ["/api/customers"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/customers");
      if (!response.ok) {
        throw new Error("Failed to fetch customers");
      }
      return response.json();
    },
    enabled: open,
  });
  
  // Set up form
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: invoice ? { ...invoice } : defaultValues,
  });
  
  // Initialize form with invoice data if editing
  useEffect(() => {
    if (invoice) {
      const formattedInvoice = {
        ...invoice,
        dueDate: new Date(invoice.dueDate)
      };
      
      form.reset(formattedInvoice);
      setItems(invoice.items || []);
    } else {
      form.reset(defaultValues);
      setItems([]);
    }
  }, [invoice, form]);
  
  // New item form
  const newItemForm = useForm<InvoiceItemValues>({
    resolver: zodResolver(invoiceItemSchema),
    defaultValues: {
      itemId: 0,
      description: "",
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      taxRate: 0
    },
  });
  
  // Update item description and unit price when inventory item changes
  const handleInventoryItemChange = (itemId: number) => {
    const inventoryItem = inventoryItems.find(item => item.id === itemId);
    if (inventoryItem) {
      newItemForm.setValue("description", inventoryItem.name || "");
      newItemForm.setValue("unitPrice", inventoryItem.price || 0);
    }
  };
  
  // Calculate item total price when values change
  useEffect(() => {
    const subscription = newItemForm.watch((value) => {
      const quantity = parseFloat(value.quantity?.toString() || "0");
      const unitPrice = parseFloat(value.unitPrice?.toString() || "0");
      const discount = parseFloat(value.discount?.toString() || "0");
      const taxRate = parseFloat(value.taxRate?.toString() || "0");
      
      if (quantity && unitPrice) {
        const { totalPrice, taxAmount } = calculateItemTotalPrice(quantity, unitPrice, discount, taxRate);
        newItemForm.setValue("totalPrice", totalPrice);
      }
    });
    
    return () => subscription.unsubscribe();
  }, [newItemForm]);
  
  // Add new line item
  const handleAddItem = (data: InvoiceItemValues) => {
    const { totalPrice, taxAmount } = calculateItemTotalPrice(
      data.quantity,
      data.unitPrice,
      data.discount,
      data.taxRate
    );
    
    const newItem = {
      ...data,
      totalPrice,
      taxAmount
    };
    
    const updatedItems = [...items, newItem];
    setItems(updatedItems);
    
    // Update form values
    form.setValue("items", updatedItems);
    form.setValue("subtotal", calculateSubtotal(updatedItems));
    form.setValue("taxAmount", calculateTaxTotal(updatedItems));
    form.setValue("total", calculateSubtotal(updatedItems));
    
    // Close dialog and reset form
    setNewItemDialogOpen(false);
    newItemForm.reset({
      itemId: 0,
      description: "",
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      taxRate: 0
    });
  };
  
  // Remove line item
  const handleRemoveItem = (index: number) => {
    const updatedItems = [...items];
    updatedItems.splice(index, 1);
    setItems(updatedItems);
    
    // Update form values
    form.setValue("items", updatedItems);
    form.setValue("subtotal", calculateSubtotal(updatedItems));
    form.setValue("taxAmount", calculateTaxTotal(updatedItems));
    form.setValue("total", calculateSubtotal(updatedItems));
  };
  
  // Create or update invoice mutation
  const invoiceMutation = useMutation({
    mutationFn: async (data: InvoiceFormValues) => {
      // Calculate totals
      const subtotal = calculateSubtotal(data.items || []);
      const taxAmount = calculateTaxTotal(data.items || []);
      const total = subtotal;
      const dueAmount = total - (data.amountPaid || 0);
      
      // Prepare data for submission
      const invoiceData = {
        ...data,
        subtotal,
        taxAmount,
        total,
        dueAmount
      };
      
      let res;
      
      if (invoice?.id) {
        // Update existing invoice
        res = await apiRequest("PATCH", `/api/invoices/${invoice.id}`, invoiceData);
      } else {
        // Create new invoice
        res = await apiRequest("POST", "/api/invoices", invoiceData);
      }
      
      if (!res.ok) throw new Error(invoice?.id ? "Failed to update invoice" : "Failed to create invoice");
      
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      
      if (invoice?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoice.id] });
      }
      
      toast({
        title: invoice?.id ? "Invoice updated" : "Invoice created",
        description: invoice?.id ? "Invoice has been updated successfully" : "New invoice has been created successfully",
      });
      
      onClose(true);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to ${invoice?.id ? "update" : "create"} invoice: ${error.message}`,
        variant: "destructive",
      });
    },
  });
  
  // Form submission
  const onSubmit = (data: InvoiceFormValues) => {
    invoiceMutation.mutate(data);
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
  
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {invoice?.id ? "Edit Invoice" : "Create New Invoice"}
          </DialogTitle>
          <DialogDescription>
            {invoice?.id ? `Editing invoice #${invoice.invoiceNumber || invoice.id}` : "Enter the details for a new invoice"}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-6">
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
                          {customers.map((customer) => (
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
                
                {/* Due Date */}
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
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* Status (only for edit) */}
                {invoice?.id && (
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
                            <SelectItem value="PAID">Paid</SelectItem>
                            <SelectItem value="PARTIALLY_PAID">Partially Paid</SelectItem>
                            <SelectItem value="OVERDUE">Overdue</SelectItem>
                            <SelectItem value="CANCELLED">Cancelled</SelectItem>
                            <SelectItem value="VOID">Void</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                
                {/* Notes */}
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Enter any additional notes or payment terms"
                          className="min-h-[120px]"
                          {...field}
                          value={field.value || ""}
                          disabled={invoiceMutation.isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="space-y-6">
                {/* Invoice Summary Card */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Invoice Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-3">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Invoice Number:</span>
                        <span className="font-medium">
                          {invoice?.invoiceNumber || (invoice?.id ? `#${invoice.id}` : "Auto-generated")}
                        </span>
                      </div>
                      
                      {invoice && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Created:</span>
                          <span>
                            {format(new Date(invoice.createdAt), "MMM d, yyyy")}
                          </span>
                        </div>
                      )}
                      
                      {invoice && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Status:</span>
                          <span>
                            {getStatusBadge(invoice.status)}
                          </span>
                        </div>
                      )}
                      
                      <div className="flex justify-between items-center text-sm pt-2 border-t">
                        <span className="text-muted-foreground">Subtotal:</span>
                        <span className="font-medium">
                          {formatCurrency(calculateSubtotal(items))}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Tax:</span>
                        <span className="font-medium">
                          {formatCurrency(calculateTaxTotal(items))}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center text-base font-medium pt-2 border-t">
                        <span>Total:</span>
                        <span>
                          {formatCurrency(calculateSubtotal(items))}
                        </span>
                      </div>
                      
                      {invoice && invoice.amountPaid > 0 && (
                        <>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Amount Paid:</span>
                            <span className="font-medium text-green-600 dark:text-green-500">
                              {formatCurrency(invoice.amountPaid)}
                            </span>
                          </div>
                          
                          <div className="flex justify-between items-center text-base font-medium pt-2 border-t">
                            <span>Balance Due:</span>
                            <span className="text-red-600 dark:text-red-500">
                              {formatCurrency(invoice.total - invoice.amountPaid)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-3 border-t flex justify-between">
                    <span className="text-sm text-muted-foreground">
                      {items.length} item{items.length !== 1 ? "s" : ""}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setNewItemDialogOpen(true)}
                      disabled={invoiceMutation.isPending}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Item
                    </Button>
                  </CardFooter>
                </Card>
              </div>
            </div>
            
            {/* Invoice Items */}
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Discount %</TableHead>
                    <TableHead className="text-right">Tax %</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center h-24 text-muted-foreground">
                        No items added to this invoice yet.
                        <div className="mt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setNewItemDialogOpen(true)}
                            disabled={invoiceMutation.isPending}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Item
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          {inventoryItems.find(invItem => invItem.id === item.itemId)?.name || `Item #${item.itemId}`}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.description}
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell className="text-right">{item.discount || 0}%</TableCell>
                        <TableCell className="text-right">{item.taxRate || 0}%</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(item.totalPrice)}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveItem(index)}
                            disabled={invoiceMutation.isPending}
                          >
                            <Trash className="h-4 w-4 text-red-500" />
                            <span className="sr-only">Remove</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {items.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={6} className="text-right font-medium">
                        Subtotal
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(calculateSubtotal(items))}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} className="text-right font-medium">
                        Tax
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(calculateTaxTotal(items))}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} className="text-right text-lg font-semibold">
                        Total
                      </TableCell>
                      <TableCell className="text-right text-lg font-semibold">
                        {formatCurrency(calculateSubtotal(items))}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
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
                disabled={invoiceMutation.isPending || items.length === 0}
              >
                {invoiceMutation.isPending
                  ? invoice?.id
                    ? "Updating..."
                    : "Creating..."
                  : invoice?.id
                  ? "Update Invoice"
                  : "Create Invoice"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
      
      {/* New Item Dialog */}
      <Dialog open={newItemDialogOpen} onOpenChange={setNewItemDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Invoice Item</DialogTitle>
            <DialogDescription>
              Add a new item to this invoice.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...newItemForm}>
            <form
              onSubmit={newItemForm.handleSubmit(handleAddItem)}
              className="space-y-4"
            >
              {/* Item Selection */}
              <FormField
                control={newItemForm.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(parseInt(value));
                        handleInventoryItemChange(parseInt(value));
                      }}
                      defaultValue={field.value ? field.value.toString() : undefined}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {inventoryItems.map((item) => (
                          <SelectItem
                            key={item.id}
                            value={item.id.toString()}
                          >
                            {item.name} - {formatCurrency(item.price)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {/* Description */}
              <FormField
                control={newItemForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                {/* Quantity */}
                <FormField
                  control={newItemForm.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* Unit Price */}
                <FormField
                  control={newItemForm.control}
                  name="unitPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit Price</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="pl-7"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {/* Discount */}
                <FormField
                  control={newItemForm.control}
                  name="discount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discount %</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          {...field}
                          value={field.value || 0}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* Tax Rate */}
                <FormField
                  control={newItemForm.control}
                  name="taxRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax Rate %</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          {...field}
                          value={field.value || 0}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewItemDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Add Item</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}