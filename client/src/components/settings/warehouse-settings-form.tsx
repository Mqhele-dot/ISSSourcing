import React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Building, Map } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Define schema for form validation
const warehouseSettingsSchema = z.object({
  defaultWarehouseId: z.coerce.number().int().positive().nullable().optional(),
  requireLocationForItems: z.boolean().default(true),
  allowTransfersBetweenWarehouses: z.boolean().default(true),
});

// Type for form data
type WarehouseSettingsFormType = z.infer<typeof warehouseSettingsSchema>;

// Warehouse interface for type safety
interface Warehouse {
  id: number;
  name: string;
}

export function WarehouseSettingsForm() {
  const { settings, updateSettings } = useSettings();
  
  // Fetch warehouses
  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ["/api/warehouses"],
  });

  // Create form
  const form = useForm<WarehouseSettingsFormType>({
    resolver: zodResolver(warehouseSettingsSchema),
    defaultValues: {
      defaultWarehouseId: settings.defaultWarehouseId,
      requireLocationForItems: settings.requireLocationForItems ?? true,
      allowTransfersBetweenWarehouses: settings.allowTransfersBetweenWarehouses ?? true,
    },
  });

  // Submit handler
  function onSubmit(data: WarehouseSettingsFormType) {
    updateSettings.mutate(data);
  }

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building className="h-5 w-5 text-primary" />
              Warehouse Settings
            </CardTitle>
            <CardDescription>
              Configure warehouse and location management preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="defaultWarehouseId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Warehouse</FormLabel>
                  <Select
                    onValueChange={(value) => 
                      field.onChange(value ? parseInt(value) : null)
                    }
                    value={field.value?.toString() || ""}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select default warehouse" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">No Default</SelectItem>
                      {warehouses.map((warehouse) => (
                        <SelectItem 
                          key={warehouse.id} 
                          value={warehouse.id.toString()}
                        >
                          {warehouse.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    The warehouse to use by default for new inventory items
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="requireLocationForItems"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      <div className="flex items-center">
                        <Map className="h-4 w-4 mr-2" />
                        Require Item Locations
                      </div>
                    </FormLabel>
                    <FormDescription>
                      Require location information when adding new inventory items
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="allowTransfersBetweenWarehouses"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Allow Warehouse Transfers</FormLabel>
                    <FormDescription>
                      Enable movement of inventory between warehouses
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-400">
              <p className="font-medium">About Multi-Warehouse Management</p>
              <p className="mt-1">
                Multi-warehouse functionality allows tracking and managing inventory across 
                different physical locations. The system can automatically suggest stock 
                transfers between warehouses to optimize inventory levels.
              </p>
            </div>
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