import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { resetDemoData } from "@/api/client";
import { Can } from "@/components/auth/can";
import { useAccent } from "@/components/accent-provider";
import { useDensity } from "@/components/density-provider";
import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { GeneralSettingsForm } from "@/components/settings/general-settings-form";
import { InventorySettingsForm } from "@/components/settings/inventory-settings-form";
import { RealtimeSettingsForm } from "@/components/settings/realtime-settings-form";
import { DatabaseSettingsForm } from "@/components/settings/database-settings-form";
import { WarehouseSettingsForm } from "@/components/settings/warehouse-settings-form";
import { SecuritySettingsForm } from "@/components/settings/security-settings-form";
import { ForecastingSettingsForm } from "@/components/settings/forecasting-settings-form";
import { TaxSettingsForm } from "@/components/settings/tax-settings-form";
import { CompanyConfigurationCenter } from "@/components/settings/company-configuration-center";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
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
  SlidersHorizontal,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { APP_ROUTES, SETTINGS_SECTION_SLUGS, asSectionSlug } from "@/lib/routes/app-routes";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
import { currencyOptionsForSelect, fetchActiveMasterCurrencies } from "@/lib/currencies-query";

const settingsSections = [
  { value: "general", label: "General", icon: UserCircle, description: "Organization profile, locale, and base defaults." },
  { value: "inventory", label: "Inventory", icon: Package, description: "Stock controls, locations, and replenishment defaults." },
  { value: "realtime", label: "Real-Time", icon: Activity, description: "Live refresh behaviour and event-driven updates." },
  { value: "database", label: "Database", icon: Database, description: "Connectivity and sync behaviour for local installs." },
  { value: "forecasting", label: "Forecasting", icon: BarChart3, description: "Demand planning and prediction defaults." },
  { value: "tax", label: "Tax", icon: Receipt, description: "VAT, jurisdiction, and reporting defaults." },
  { value: "billing", label: "Billing", icon: CreditCard, description: "Subscription, payment, and invoice behaviour." },
  { value: "configuration", label: "Configuration", icon: SlidersHorizontal, description: "Company-level control-centre settings." },
  { value: "warehouses", label: "Warehouses", icon: Building, description: "Site defaults, receiving policies, and storage setup." },
  { value: "security", label: "Security", icon: Shield, description: "Authentication, 2FA, and operational guardrails." },
] as const;

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
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
  const activeSection = asSectionSlug(location.split("/")[3], SETTINGS_SECTION_SLUGS, "general");

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
    <PageShell className="py-8" data-testid="admin-settings-page">
      <PageHeader
        title="Settings"
        titleTestId="page-title"
        icon={Settings}
        breadcrumb={<span>Admin / Settings</span>}
        subtitle="Control centre for organization defaults, security posture, and operational configuration."
        description="Separate tenant-governed controls from local reviewer preferences so administrators can make safe, auditable changes."
      />

      <ModuleTrainingPanel moduleId="admin-settings" />

      {isDevMode && (
        <Card className="mb-6 border-dashed border-amber-400/60">
          <CardHeader>
            <CardTitle className="text-base">Development-only reset utility</CardTitle>
            <CardDescription>
              Local seed reset for development and test environments only.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              This operation truncates current data and reseeds deterministic records. It is not a production control.
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

      <div className="mb-6 grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organization controls</CardTitle>
            <CardDescription>
              Changes in the settings sections below persist to the active organization and affect live workflows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Use the production control panel for shared defaults, then open a settings area for deeper configuration.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {settingsSections.slice(0, 6).map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  className="rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
                  onClick={() => setLocation(APP_ROUTES.admin.settingsSection(value))}
                >
                  <div className="mb-2 flex items-center gap-2 text-foreground">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="font-medium">{label}</span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{description}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="settings-local-preferences">
          <CardHeader>
            <CardTitle className="text-base">Workspace preferences</CardTitle>
            <CardDescription>
              Saved in this browser only. These controls change your view of the app, not organization policy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
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
              <Label>Use workspace presets</Label>
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

        <Card data-testid="settings-role-guidance">
          <CardHeader>
            <CardTitle className="text-base">Role guidance</CardTitle>
            <CardDescription>
              Signed in as <span className="font-medium uppercase">{user?.role || "viewer"}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Common responsibilities for this role. Server-side permissions still apply to every write action.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {roleCapabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <ProductionControlPlanePanel isAdmin={roleKey === "admin"} />

      <Tabs
        value={activeSection}
        onValueChange={(value) => setLocation(APP_ROUTES.admin.settingsSection(value as typeof activeSection))}
        className="space-y-6"
      >
        <TabsList className="grid h-auto grid-cols-2 gap-2 md:grid-cols-5 lg:grid-cols-10">
          {settingsSections.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="flex items-center justify-center space-x-2 py-3 text-xs sm:text-sm">
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </TabsTrigger>
          ))}
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
          <Card>
            <CardHeader>
              <CardTitle>Billing controls moved</CardTitle>
              <CardDescription>
                SaaS plan and entitlement billing is managed under Subscription. Supplier invoices and payments are
                managed in Accounts Payable. This prevents settings from appearing saved when no authoritative billing
                configuration exists.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild><a href="/admin/subscription">Open Subscription</a></Button>
              <Button asChild variant="outline"><a href="/finance/accounts-payable">Open Accounts Payable</a></Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="configuration" className="space-y-4">
          <CompanyConfigurationCenter />
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
    </PageShell>
  );
}

function ProductionControlPlanePanel({ isAdmin }: { isAdmin: boolean }) {
  const { settings, isLoading, error, updateSettings } = useSettings();
  const currenciesQuery = useQuery({
    queryKey: ["/api/currencies", "settings-control-plane"],
    queryFn: fetchActiveMasterCurrencies,
  });
  const [form, setForm] = React.useState({
    companyName: settings.companyName ?? "ISSSourcing",
    currencyCode: (settings.currencyCode ?? "ZAR").toUpperCase(),
    lowStockDefaultThreshold: String(settings.lowStockDefaultThreshold ?? 10),
    allowNegativeInventory: Boolean(settings.allowNegativeInventory),
    requireLocationForItems: Boolean(settings.requireLocationForItems),
  });

  React.useEffect(() => {
    setForm({
      companyName: settings.companyName ?? "ISSSourcing",
      currencyCode: (settings.currencyCode ?? "ZAR").toUpperCase(),
      lowStockDefaultThreshold: String(settings.lowStockDefaultThreshold ?? 10),
      allowNegativeInventory: Boolean(settings.allowNegativeInventory),
      requireLocationForItems: Boolean(settings.requireLocationForItems),
    });
  }, [
    settings.allowNegativeInventory,
    settings.companyName,
    settings.currencyCode,
    settings.lowStockDefaultThreshold,
    settings.requireLocationForItems,
  ]);

  const currencyOptions = React.useMemo(
    () => currencyOptionsForSelect(currenciesQuery.data ?? [], [form.currencyCode, settings.currencyCode]),
    [currenciesQuery.data, form.currencyCode, settings.currencyCode],
  );
  const currencyReady = currenciesQuery.isSuccess && currencyOptions.length > 0;

  const save = () => {
    const threshold = Number(form.lowStockDefaultThreshold);
    if (!Number.isFinite(threshold) || threshold < 1 || !currencyReady) return;
    updateSettings.mutate({
      companyName: form.companyName.trim() || "ISSSourcing",
      currencyCode: form.currencyCode.trim().toUpperCase(),
      lowStockDefaultThreshold: Math.trunc(threshold),
      allowNegativeInventory: form.allowNegativeInventory,
      requireLocationForItems: form.requireLocationForItems,
    });
  };

  return (
    <Card className="mb-6" data-testid="settings-control-plane">
      <CardHeader>
        <CardTitle className="text-base">Production control plane</CardTitle>
        <CardDescription>
          Persisted controls used by reporting, procurement, receiving, AP matching, and inventory checks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="settings-control-plane-error">
            Settings failed to load. Retry the page before changing production controls.
          </div>
        ) : null}
        {currenciesQuery.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="settings-control-currency-error">
            Reporting currency options could not be loaded from Master Data. This control fails closed until currencies are available.
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="control-company-name">Organization profile</Label>
            <Input
              id="control-company-name"
              data-testid="settings-control-company-name"
              value={form.companyName}
              disabled={!isAdmin || isLoading}
              onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-currency">Reporting currency</Label>
            <Select
              value={form.currencyCode}
              onValueChange={(value) => setForm((current) => ({ ...current, currencyCode: value.toUpperCase() }))}
              disabled={!isAdmin || isLoading || currenciesQuery.isLoading || currencyOptions.length === 0}
            >
              <SelectTrigger id="control-currency" data-testid="settings-control-currency">
                <SelectValue placeholder={currenciesQuery.isLoading ? "Loading currencies..." : "Select currency"} />
              </SelectTrigger>
              <SelectContent>
                {currencyOptions.map((currency) => (
                  <SelectItem key={currency.code} value={currency.code}>
                    {currency.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-low-stock">Low-stock threshold</Label>
            <Input
              id="control-low-stock"
              data-testid="settings-control-low-stock"
              type="number"
              min={1}
              value={form.lowStockDefaultThreshold}
              disabled={!isAdmin || isLoading}
              onChange={(event) => setForm((current) => ({ ...current, lowStockDefaultThreshold: event.target.value }))}
            />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              data-testid="settings-control-negative-stock"
              checked={form.allowNegativeInventory}
              disabled={!isAdmin || isLoading}
              onChange={(event) => setForm((current) => ({ ...current, allowNegativeInventory: event.target.checked }))}
            />
            Allow negative inventory only when operations policy permits it
          </label>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              data-testid="settings-control-require-location"
              checked={form.requireLocationForItems}
              disabled={!isAdmin || isLoading}
              onChange={(event) => setForm((current) => ({ ...current, requireLocationForItems: event.target.checked }))}
            />
            Require storage location on inventory and receiving controls
          </label>
        </div>
        {!isAdmin ? (
          <p className="text-sm text-muted-foreground" data-testid="settings-control-denied">
            You can review settings, but only admins can change production controls.
          </p>
        ) : null}
        <Button
          type="button"
          data-testid="settings-control-save"
          onClick={save}
          disabled={!isAdmin || isLoading || updateSettings.isPending || !currencyReady}
        >
          {updateSettings.isPending ? "Saving controls..." : "Save production controls"}
        </Button>
      </CardContent>
    </Card>
  );
}
