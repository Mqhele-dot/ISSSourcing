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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { resetDemoData } from "@/api/client";
import { Can } from "@/components/auth/can";
import { useAccent } from "@/components/accent-provider";
import { useDensity } from "@/components/density-provider";
import { useAuth } from "@/hooks/use-auth";
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

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { accent, accentConfig, setAccentConfig, setPreset } = useAccent();
  const { density, setDensity } = useDensity();
  const isDevMode = import.meta.env.DEV;
  const [isResetDialogOpen, setIsResetDialogOpen] = React.useState(false);
  const [isResettingDemoData, setIsResettingDemoData] = React.useState(false);

  const capabilitiesByRole: Record<string, string[]> = {
    admin: ["Approve/send/receive POs", "Manage users and settings", "Reset demo data"],
    manager: ["Approve/send/receive POs", "Assign and resolve exceptions", "Update shipment status"],
    warehouse_staff: ["Adjust inventory", "Receive inbound shipments", "Review low stock alerts"],
    viewer: ["View dashboards and reports", "Track shipments and exceptions", "Read-only access"],
    supplier: ["View assigned POs", "Track shipment progress", "Comment on exceptions"],
  };
  const roleKey = (user?.role || "viewer").toLowerCase();
  const roleCapabilities = capabilitiesByRole[roleKey] ?? capabilitiesByRole.viewer;

  const handleResetDemoData = async () => {
    setIsResettingDemoData(true);

    try {
      const summary = await resetDemoData();
      const op = (summary as { operational?: { purchaseOrders: number; shipments: number; exceptions: number; integrationRuns: number; activity: number } }).operational;
      const baseDesc = `Users: ${summary.users}, Warehouses: ${summary.warehouses}, Suppliers: ${summary.suppliers}, Items: ${summary.items}, Settings: ${summary.settings}`;
      const desc = op
        ? `${baseDesc}. Operational: ${op.purchaseOrders} POs, ${op.shipments} shipments, ${op.exceptions} exceptions, ${op.integrationRuns} runs, ${op.activity} activity.`
        : baseDesc;
      toast({
        title: "Demo data reset complete",
        description: desc,
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
            <Can roles={["admin"]} reason="Requires Admin">
              <Button
                variant="destructive"
                className="sm:w-auto"
                onClick={() => setIsResetDialogOpen(true)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset demo data
              </Button>
            </Can>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Appearance studio</CardTitle>
          <CardDescription>
            Dynamic accent and density controls for reviewer demos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="accent-hue">Hue ({Math.round(accentConfig.hue)})</Label>
              <Input
                id="accent-hue"
                type="range"
                min={0}
                max={360}
                value={accentConfig.hue}
                onChange={(event) => setAccentConfig({ hue: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accent-sat">Vividness ({Math.round(accentConfig.saturation)}%)</Label>
              <Input
                id="accent-sat"
                type="range"
                min={20}
                max={100}
                value={accentConfig.saturation}
                onChange={(event) => setAccentConfig({ saturation: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accent-light">Contrast ({Math.round(accentConfig.lightness)}%)</Label>
              <Input
                id="accent-light"
                type="range"
                min={25}
                max={75}
                value={accentConfig.lightness}
                onChange={(event) => setAccentConfig({ lightness: Number(event.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Use brand presets</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "blue", label: "Ocean" },
                { key: "teal", label: "Teal" },
                { key: "purple", label: "Violet" },
                { key: "orange", label: "Sunset" },
                { key: "rose", label: "Rose" },
              ].map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  variant={accent === preset.key ? "default" : "outline"}
                  onClick={() => setPreset(preset.key as "blue" | "teal" | "purple" | "orange" | "rose")}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Density mode</Label>
            <div className="flex flex-wrap gap-2">
              {(["compact", "comfortable", "spacious"] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={density === mode ? "default" : "outline"}
                  onClick={() => setDensity(mode)}
                >
                  {mode}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">What can I do?</CardTitle>
          <CardDescription>
            Signed in as <span className="font-medium uppercase">{user?.role || "viewer"}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {roleCapabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

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