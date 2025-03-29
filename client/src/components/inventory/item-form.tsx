import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { type Category, type InventoryItem, type InventoryItemForm, inventoryItemFormSchema } from "@shared/schema";

interface ItemFormProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  initialData?: InventoryItem | null;
}

export default function ItemForm({ open, setOpen, initialData = null }: ItemFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  // Form setup
  const form = useForm<InventoryItemForm>({
    resolver: zodResolver(inventoryItemFormSchema),
    defaultValues: {
      name: initialData?.name || "",
      sku: initialData?.sku || "",
      description: initialData?.description || "",
      categoryId: initialData?.categoryId || undefined,
      price: initialData?.price || 0,
      cost: initialData?.cost || 0,
      quantity: initialData?.quantity || 0,
      lowStockThreshold: initialData?.lowStockThreshold || 10,
      location: initialData?.location || "",
    },
  });

  // Update form values when initialData changes
  useEffect(() => {
    if (initialData) {
      Object.keys(initialData).forEach((key) => {
        const k = key as keyof InventoryItem;
        if (k in form.getValues()) {
          form.setValue(k as any, initialData[k] as any);
        }
      });
    } else {
      form.reset({
        name: "",
        sku: "",
        description: "",
        categoryId: undefined,
        price: 0,
        cost: 0,
        quantity: 0,
        lowStockThreshold: 10,
        location: "",
      });
    }
  }, [initialData, form]);

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const response = await fetch("/api/categories");
      if (!response.ok) {
        throw new Error("Failed to fetch categories");
      }
      return response.json() as Promise<Category[]>;
    },
  });

  // Create or update item mutation
  const mutation = useMutation({
    mutationFn: async (data: InventoryItemForm) => {
      if (initialData) {
        // Update existing item
        return apiRequest("PUT", `/api/inventory/${initialData.id}`, data);
      } else {
        // Create new item
        return apiRequest("POST", "/api/inventory", data);
      }
    },
    onSuccess: async () => {
      // Invalidate and refetch
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory/stats"] });
      
      // Close modal and show success toast
      setOpen(false);
      toast({
        title: initialData ? "Item Updated" : "Item Created",
        description: initialData 
          ? `${initialData.name} has been updated successfully.` 
          : "New inventory item has been created.",
        variant: "default",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save item. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: InventoryItemForm) => {
    setLoading(true);
    try {
      await mutation.mutateAsync(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialData ? "Edit Inventory Item" : "Add New Inventory Item"}
          </DialogTitle>
          <DialogDescription>
            {initialData 
              ? "Update the details of the existing inventory item." 
              : "Fill in the details below to add a new item to your inventory."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter item name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter SKU" {...field} />
                  </FormControl>
                  <FormDescription>
                    Stock Keeping Unit - unique identifier for this item
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(Number(value))}
                    defaultValue={field.value ? String(field.value) : undefined}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories?.map((category) => (
                        <SelectItem key={category.id} value={String(category.id)}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price</FormLabel>
                    <FormControl>
                      <div className="relative rounded-md shadow-sm">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-neutral-500 dark:text-neutral-400 sm:text-sm">$</span>
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          className="pl-7"
                          {...field}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === "" ? 0 : parseFloat(e.target.value)
                            )
                          }
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="0"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? 0 : parseInt(e.target.value, 10)
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost (Optional)</FormLabel>
                    <FormControl>
                      <div className="relative rounded-md shadow-sm">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-neutral-500 dark:text-neutral-400 sm:text-sm">$</span>
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          className="pl-7"
                          {...field}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === "" ? 0 : parseFloat(e.target.value)
                            )
                          }
                        />
                      </div>
                    </FormControl>
                    <FormDescription>Cost per unit</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lowStockThreshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Low Stock Threshold</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="10"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? 0 : parseInt(e.target.value, 10)
                          )
                        }
                      />
                    </FormControl>
                    <FormDescription>Alert when stock is below this level</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Storage Location (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Warehouse A, Shelf B5" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter item description"
                      className="resize-none"
                      {...field}
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
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : initialData ? "Update Item" : "Add Item"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
