import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralSettingsForm } from "@/components/settings/general-settings-form";
import { InventorySettingsForm } from "@/components/settings/inventory-settings-form";
import { RealtimeSettingsForm } from "@/components/settings/realtime-settings-form";
import { DatabaseSettingsForm } from "@/components/settings/database-settings-form";
import { WarehouseSettingsForm } from "@/components/settings/warehouse-settings-form";
import { SecuritySettingsForm } from "@/components/settings/security-settings-form";
import { ForecastingSettingsForm } from "@/components/settings/forecasting-settings-form";
import { TaxSettingsForm } from "@/components/settings/tax-settings-form";
import { Settings, UserCircle, Package, Activity, Database, CreditCard, Building, Shield, BarChart3, Receipt } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="container py-10 max-w-6xl">
      <div className="mb-8">
        <div className="flex items-center mb-4">
          <Settings className="h-6 w-6 mr-2 text-primary" />
          <h1 className="text-3xl font-bold">Settings</h1>
        </div>
        <p className="text-muted-foreground">
          Configure application settings to match your business needs
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 h-auto">
          <TabsTrigger value="general" className="flex items-center space-x-2 py-3">
            <UserCircle className="h-4 w-4" />
            <span>General</span>
          </TabsTrigger>
          <TabsTrigger value="inventory" className="flex items-center space-x-2 py-3">
            <Package className="h-4 w-4" />
            <span>Inventory</span>
          </TabsTrigger>
          <TabsTrigger value="realtime" className="flex items-center space-x-2 py-3">
            <Activity className="h-4 w-4" />
            <span>Real-Time</span>
          </TabsTrigger>
          <TabsTrigger value="database" className="flex items-center space-x-2 py-3">
            <Database className="h-4 w-4" />
            <span>Database</span>
          </TabsTrigger>
          <TabsTrigger value="forecasting" className="flex items-center space-x-2 py-3">
            <BarChart3 className="h-4 w-4" />
            <span>Forecasting</span>
          </TabsTrigger>
          <TabsTrigger value="tax" className="flex items-center space-x-2 py-3">
            <Receipt className="h-4 w-4" />
            <span>Tax</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="flex items-center space-x-2 py-3">
            <CreditCard className="h-4 w-4" />
            <span>Billing</span>
          </TabsTrigger>
          <TabsTrigger value="warehouses" className="flex items-center space-x-2 py-3">
            <Building className="h-4 w-4" />
            <span>Warehouses</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center space-x-2 py-3">
            <Shield className="h-4 w-4" />
            <span>Security</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <GeneralSettingsForm />
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <InventorySettingsForm />
        </TabsContent>

        <TabsContent value="realtime" className="space-y-4">
          <RealtimeSettingsForm />
        </TabsContent>

        <TabsContent value="database" className="space-y-4">
          <DatabaseSettingsForm />
        </TabsContent>

        <TabsContent value="forecasting" className="space-y-4">
          <ForecastingSettingsForm />
        </TabsContent>

        <TabsContent value="tax" className="space-y-4">
          <TaxSettingsForm />
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <div className="rounded-md bg-amber-50 p-4 text-amber-800 dark:bg-amber-950 dark:text-amber-400">
            <h3 className="text-lg font-medium">Billing Settings Coming Soon</h3>
            <p className="mt-2">
              Payment processing and subscription management settings will be available 
              in a future update. These settings will allow you to configure payment methods, 
              tax calculations, and invoice templates.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="warehouses" className="space-y-4">
          <WarehouseSettingsForm />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <SecuritySettingsForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}