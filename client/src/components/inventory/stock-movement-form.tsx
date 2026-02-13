import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type StockMovementFormProps = {
  open: boolean;
  onClose: () => void;
  type: "RECEIPT" | "ISSUE";
  itemId?: number;
  warehouseId?: number;
};

type Warehouse = {
  id: number;
  name: string;
};

type InventoryItem = {
  id: number;
  name: string;
  sku: string;
};

export function StockMovementForm({ open, onClose, type, itemId, warehouseId }: StockMovementFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Define the form schema based on the movement type
  const formSchema = z.object({
    itemId: z.number().positive({ message: "Item is required" }),
    warehouseId: z.number().positive({ message: "Warehouse is required" }),
    quantity: z.coerce.number().positive({ message: "Quantity must be positive" }),
    notes: z.string().nullable().optional(),
    referenceType: z.string().nullable().optional(),
    referenceId: z.string().nullable().optional(),
    unitCost: z.coerce.number().nullable().optional(),
  });
  
  // Create the form
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      itemId: itemId || 0,
      warehouseId: warehouseId || 0,
      quantity: 0,
      notes: "",
      referenceType: null,
      referenceId: null,
      unitCost: null,
    },
  });
  
  // Update form values when props change
  useEffect(() => {
    form.setValue("itemId", itemId || 0);
    form.setValue("warehouseId", warehouseId || 0);
  }, [form, itemId, warehouseId]);
  
  // Fetch warehouses
  const { data: warehouses } = useQuery({
    queryKey: ["/api/warehouses"],
    queryFn: async () => {
      const response = await fetch("/api/warehouses");
      if (!response.ok) {
        throw new Error("Failed to fetch warehouses");
      }
      return response.json() as Promise<Warehouse[]>;
    },
  });
  
  // Fetch inventory items if itemId is not provided
  const { data: items } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const response = await fetch("/api/inventory");
      if (!response.ok) {
        throw new Error("Failed to fetch inventory items");
      }
      return response.json() as Promise<InventoryItem[]>;
    },
    enabled: !itemId,
  });
  
  // Handle form submission
  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);
    
    try {
      // Determine the endpoint based on the movement type
      const endpoint = type === "RECEIPT" 
        ? "/api/stock-movements/receipt" 
        : "/api/stock-movements/issue";
      
      // Make the API request
      await apiRequest(
        "POST", 
        endpoint, 
        {
          itemId: data.itemId,
          warehouseId: data.warehouseId,
          quantity: data.quantity,
          notes: data.notes,
          referenceType: data.referenceType,
          referenceId: data.referenceId ? parseInt(data.referenceId) : null,
          unitCost: data.unitCost,
        }
      );
      
      // Show success toast
      toast({
        title: `Stock ${type === "RECEIPT" ? "Receipt" : "Issue"} Recorded`,
        description: `Inventory has been ${type === "RECEIPT" ? "increased" : "decreased"} successfully.`,
      });
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/stock-movements"] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock-movements/item/${data.itemId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock-movements/warehouse/${data.warehouseId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: [`/api/inventory/${data.itemId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory"] });
      
      // Close the dialog
      onClose();
      form.reset();
    } catch (error) {
      console.error("Error recording stock movement:", error);
      toast({
        title: "Error",
        description: `Failed to record stock ${type === "RECEIPT" ? "receipt" : "issue"}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[475px]">
        <DialogHeader>
          <DialogTitle>
            {type === "RECEIPT" ? "Record Stock Receipt" : "Record Stock Issue"}
          </DialogTitle>
          <DialogDescription>
            {type === "RECEIPT"
              ? "Add inventory quantities when receiving new stock."
              : "Reduce inventory quantities when items leave the warehouse."}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Item selection - only show if itemId is not provided */}
            {!itemId && (
              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item</FormLabel>
                    <Select
                      disabled={isSubmitting}
                      onValueChange={(value) => field.onChange(parseInt(value))}
                      value={field.value ? field.value.toString() : ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {items && items.map((item) => (
                          <SelectItem key={item.id} value={item.id.toString()}>
                            {item.name} ({item.sku})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            
            {/* Warehouse selection - only show if warehouseId is not provided */}
            {!warehouseId && (
              <FormField
                control={form.control}
                name="warehouseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warehouse</FormLabel>
                    <Select
                      disabled={isSubmitting}
                      onValueChange={(value) => field.onChange(parseInt(value))}
                      value={field.value ? field.value.toString() : ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a warehouse" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {warehouses && warehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id.toString()}>
                            {warehouse.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            
            {/* Quantity */}
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Enter quantity"
                      disabled={isSubmitting}
                      {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormDescription>
                    {type === "RECEIPT"
                      ? "Number of items to add to inventory"
                      : "Number of items to remove from inventory"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Unit Cost - only show for RECEIPT */}
            {type === "RECEIPT" && (
              <FormField
                control={form.control}
                name="unitCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit Cost</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Enter unit cost (optional)"
                        disabled={isSubmitting}
                        {...field}
                        value={field.value || ""}
                        onChange={(e) => 
                          field.onChange(
                            e.target.value ? e.target.valueAsNumber : null
                          )
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Cost per unit for inventory valuation (optional)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            
            {/* Reference Type */}
            <FormField
              control={form.control}
              name="referenceType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference Type</FormLabel>
                  <Select
                    disabled={isSubmitting}
                    onValueChange={field.onChange}
                    value={field.value || ""}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select reference type (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {type === "RECEIPT" && (
                        <>
                          <SelectItem value="PURCHASE_ORDER">Purchase Order</SelectItem>
                          <SelectItem value="RETURN">Customer Return</SelectItem>
                          <SelectItem value="ADJUSTMENT">Inventory Adjustment</SelectItem>
                        </>
                      )}
                      {type === "ISSUE" && (
                        <>
                          <SelectItem value="SALE">Sale</SelectItem>
                          <SelectItem value="RETURN">Supplier Return</SelectItem>
                          <SelectItem value="ADJUSTMENT">Inventory Adjustment</SelectItem>
                          <SelectItem value="DAMAGE">Damaged Goods</SelectItem>
                          <SelectItem value="EXPIRE">Expired Goods</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Categorize this stock movement (optional)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Reference ID */}
            <FormField
              control={form.control}
              name="referenceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference ID</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter reference ID (optional)"
                      disabled={isSubmitting}
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormDescription>
                    ID of related record (order number, etc.)
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
                      placeholder="Enter notes about this transaction (optional)"
                      disabled={isSubmitting}
                      className="min-h-[80px]"
                      {...field}
                      value={field.value || ""}
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
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className={type === "RECEIPT" 
                  ? "bg-green-600 hover:bg-green-700" 
                  : "bg-red-600 hover:bg-red-700"
                }
              >
                {isSubmitting ? "Processing..." : type === "RECEIPT" ? "Record Receipt" : "Record Issue"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}