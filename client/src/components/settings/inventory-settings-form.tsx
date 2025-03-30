import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { z } from "zod";

// Define form schema
const inventorySettingsSchema = z.object({
  lowStockDefaultThreshold: z.number().int().min(1, "Threshold must be at least 1"),
  allowNegativeInventory: z.boolean(),
  requireLocationForItems: z.boolean(),
  allowTransfersBetweenWarehouses: z.boolean(),
});

type InventorySettingsFormType = z.infer<typeof inventorySettingsSchema>;

export function InventorySettingsForm() {
  const { settings, updateSettings } = useSettings();

  // Create form
  const form = useForm<InventorySettingsFormType>({
    resolver: zodResolver(inventorySettingsSchema),
    defaultValues: {
      lowStockDefaultThreshold: settings.lowStockDefaultThreshold ?? 10,
      allowNegativeInventory: settings.allowNegativeInventory ?? false,
      requireLocationForItems: settings.requireLocationForItems ?? true,
      allowTransfersBetweenWarehouses: settings.allowTransfersBetweenWarehouses ?? true,
    },
  });

  // Submit handler
  function onSubmit(data: InventorySettingsFormType) {
    updateSettings.mutate(data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory Management</CardTitle>
        <CardDescription>
          Configure settings for inventory management and tracking
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="lowStockDefaultThreshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Low Stock Threshold</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      {...field} 
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      min={1}
                    />
                  </FormControl>
                  <FormDescription>
                    Default quantity threshold for low stock alerts
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="allowNegativeInventory"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Allow Negative Inventory</FormLabel>
                    <FormDescription>
                      Allow quantity to go below zero when stock is insufficient
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="requireLocationForItems"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Require Location for Items</FormLabel>
                    <FormDescription>
                      Require a storage location to be specified for all inventory items
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="allowTransfersBetweenWarehouses"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Allow Transfers Between Warehouses</FormLabel>
                    <FormDescription>
                      Allow moving inventory items between different warehouse locations
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}