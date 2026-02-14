import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { GeneralSettingsForm } from "@/components/settings/general-settings-form";
import { InventorySettingsForm } from "@/components/settings/inventory-settings-form";
import { RealtimeSettingsForm } from "@/components/settings/realtime-settings-form";
import { DatabaseSettingsForm } from "@/components/settings/database-settings-form";
import { WarehouseSettingsForm } from "@/components/settings/warehouse-settings-form";
import { SecuritySettingsForm } from "@/components/settings/security-settings-form";
import { ForecastingSettingsForm } from "@/components/settings/forecasting-settings-form";
import { TaxSettingsForm } from "@/components/settings/tax-settings-form";
import { BillingSettingsForm } from "@/components/settings/billing-settings-form";
import {
  Settings,
  UserCircle,
  Package,
  Activity,
  Database,
  CreditCard,
  Building,
  Shield,
  BarChart3,
  Receipt,
  Loader2,
  RotateCcw,
} from "lucide-react";

type DemoResetSummary = {
  users: number;
  warehouses: number;
  suppliers: number;
  items: number;
  settings: number;
};

export default function SettingsPage() {
  const { toast } = useToast();
  const isDevMode = import.meta.env.DEV;
  const [isResetDialogOpen, setIsResetDialogOpen] = React.useState(false);
  const [isResettingDemoData, setIsResettingDemoData] = React.useState(false);

  const handleResetDemoData = async () => {
    setIsResettingDemoData(true);

    try {
      const response = await fetch("/admin/demo/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorPayload = await response
          .json()
          .catch(() => ({ message: "Unable to reset demo data" }));
        throw new Error(errorPayload.message || "Unable to reset demo data");
      }

      const summary = (await response.json()) as DemoResetSummary;
      toast({
        title: "Demo data reset complete",
        description: `Users: ${summary.users}, Warehouses: ${summary.warehouses}, Suppliers: ${summary.suppliers}, Items: ${summary.items}, Settings: ${summary.settings}`,
      });
      setIsResetDialogOpen(false);
    } catch (error) {
      toast({
        title: "Demo reset failed",
        description: error instanceof Error ? error.message : "Unexpected reset error",
        variant: "destructive",
      });
    } finally {
      setIsResettingDemoData(false);
    }
  };

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

      {isDevMode && (
        <Card className="mb-6 border-dashed border-amber-400/60">
          <CardHeader>
            <CardTitle className="text-base">Development Utilities</CardTitle>
            <CardDescription>
              Reset demo data to a known-good baseline for reviews and demos.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              This operation truncates current data and reseeds deterministic demo records.
            </p>
            <Button
              variant="destructive"
              className="sm:w-auto"
              onClick={() => setIsResetDialogOpen(true)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset demo data
            </Button>
          </CardContent>
        </Card>
      )}

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
          <BillingSettingsForm />
        </TabsContent>

        <TabsContent value="warehouses" className="space-y-4">
          <WarehouseSettingsForm />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <SecuritySettingsForm />
        </TabsContent>
      </Tabs>

      <AlertDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear existing records and reseed users, warehouses, suppliers, inventory items,
              and settings. This action is only available in development.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResettingDemoData}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetDemoData} disabled={isResettingDemoData}>
              {isResettingDemoData ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}