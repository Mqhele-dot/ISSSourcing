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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Loader2, 
  Building, 
  Map, 
  ArrowLeftRight, 
  LayoutGrid, 
  ShieldAlert, 
  TruckIcon, 
  FileWarning,
  InfoIcon 
} from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";

// Define schema for form validation
const warehouseSettingsSchema = z.object({
  defaultWarehouseId: z.coerce.number().int().positive().nullable().optional(),
  requireLocationForItems: z.boolean().default(true),
  allowTransfersBetweenWarehouses: z.boolean().default(true),
  autoUpdateStockLevels: z.boolean().default(true),
  trackInventoryByLocation: z.boolean().default(false),
  enableBinLocations: z.boolean().default(false),
  requireApprovalForTransfers: z.boolean().default(false),
  lowStockNotificationsEnabled: z.boolean().default(true),
  transferNotificationsEnabled: z.boolean().default(true),
  autoGenerateReorderRequests: z.boolean().default(false),
  defaultBinNamingConvention: z.string().optional(),
  warehouseCodePrefix: z.string().min(0).max(5).optional(),
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
      autoUpdateStockLevels: true,
      trackInventoryByLocation: false,
      enableBinLocations: false,
      requireApprovalForTransfers: false,
      lowStockNotificationsEnabled: true, 
      transferNotificationsEnabled: true,
      autoGenerateReorderRequests: settings.autoReorderEnabled ?? false,
      defaultBinNamingConvention: "ZONE-AISLE-SHELF-BIN",
      warehouseCodePrefix: "WH",
    },
  });

  // Submit handler
  function onSubmit(data: WarehouseSettingsFormType) {
    updateSettings.mutate({
      ...data,
      // Map any special cases from our form to the settings
      autoReorderEnabled: data.autoGenerateReorderRequests
    });
  }

  const hasWarehouses = warehouses.length > 0;

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
              Configure warehouse and location management preferences for your inventory system
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!hasWarehouses && (
              <Alert className="mb-6">
                <FileWarning className="h-4 w-4" />
                <AlertTitle>No warehouses found</AlertTitle>
                <AlertDescription>
                  You need to create at least one warehouse before configuring warehouse settings.
                  <Button variant="link" asChild className="p-0 h-auto font-normal">
                    <Link href="/warehouses">Go to Warehouses</Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <Tabs defaultValue="general" className="w-full">
              <TabsList className="grid grid-cols-3 mb-6">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="transfers">Transfers</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-6">
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
                  name="warehouseCodePrefix"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Warehouse Code Prefix</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="WH"
                          maxLength={5}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Used when generating warehouse codes (up to 5 characters)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator className="my-6" />

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
                  name="trackInventoryByLocation"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Track Inventory by Location</FormLabel>
                        <FormDescription>
                          Track stock quantities separately for each location within warehouses
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
                  name="enableBinLocations"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          <div className="flex items-center">
                            <LayoutGrid className="h-4 w-4 mr-2" />
                            Enable Bin Locations
                          </div>
                        </FormLabel>
                        <FormDescription>
                          Enable detailed bin location tracking within warehouses
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

                {form.watch("enableBinLocations") && (
                  <FormField
                    control={form.control}
                    name="defaultBinNamingConvention"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default Bin Naming Convention</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="ZONE-AISLE-SHELF-BIN"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>
                          Standard format for naming bin locations (e.g., ZONE-AISLE-SHELF-BIN)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </TabsContent>

              <TabsContent value="transfers" className="space-y-6">
                <FormField
                  control={form.control}
                  name="allowTransfersBetweenWarehouses"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          <div className="flex items-center">
                            <ArrowLeftRight className="h-4 w-4 mr-2" />
                            Allow Warehouse Transfers
                          </div>
                        </FormLabel>
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

                <FormField
                  control={form.control}
                  name="autoUpdateStockLevels"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Auto-Update Stock Levels</FormLabel>
                        <FormDescription>
                          Automatically update stock levels when transfers are completed
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
                  name="requireApprovalForTransfers"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          <div className="flex items-center">
                            <ShieldAlert className="h-4 w-4 mr-2" />
                            Require Approval for Transfers
                          </div>
                        </FormLabel>
                        <FormDescription>
                          Require manager approval for stock transfers between warehouses
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
              </TabsContent>

              <TabsContent value="notifications" className="space-y-6">
                <FormField
                  control={form.control}
                  name="lowStockNotificationsEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Low Stock Notifications</FormLabel>
                        <FormDescription>
                          Enable notifications when items reach low stock levels in warehouses
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
                  name="transferNotificationsEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Transfer Notifications</FormLabel>
                        <FormDescription>
                          Enable notifications when inventory is transferred between warehouses
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
                  name="autoGenerateReorderRequests"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          <div className="flex items-center">
                            <TruckIcon className="h-4 w-4 mr-2" />
                            Auto-Generate Reorder Requests
                          </div>
                        </FormLabel>
                        <FormDescription>
                          Automatically generate reorder requests when items reach low stock thresholds
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
              </TabsContent>
            </Tabs>

            <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-400 mt-6">
              <div className="flex mb-2">
                <InfoIcon className="h-5 w-5 mr-2 flex-shrink-0" />
                <p className="font-medium">About Multi-Warehouse Management</p>
              </div>
              <p className="ml-7">
                Multi-warehouse functionality allows tracking and managing inventory across 
                different physical locations. The system can automatically suggest stock 
                transfers between warehouses to optimize inventory levels.
              </p>
              <p className="ml-7 mt-2">
                For detailed bin location tracking, enable both the "Track Inventory by Location" 
                and "Enable Bin Locations" settings. You can then define specific bin locations 
                within each warehouse.
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