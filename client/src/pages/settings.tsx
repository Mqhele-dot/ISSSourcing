import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
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
import { requestJson } from "@/lib/queryClient";
import { GeneralSettingsForm } from "@/components/settings/general-settings-form";
import { RealtimeSettingsForm } from "@/components/settings/realtime-settings-form";
import { DatabaseSettingsForm } from "@/components/settings/database-settings-form";
import { SecuritySettingsForm } from "@/components/settings/security-settings-form";
import { ForecastingSettingsForm } from "@/components/settings/forecasting-settings-form";
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
import { currencyOptionsForSelect, fetchActiveMasterCurrencies } from "@/lib/currencies-query";

const settingsSections = [
  { value: "overview", label: "Overview", icon: Settings, description: "See which workspace owns each organization control." },
  { value: "general", label: "Appearance", icon: UserCircle, description: "Local display, accent, density, date, and time preferences." },
  { value: "inventory", label: "Operational policy", icon: Package, description: "Reporting currency, stock policy, and receiving requirements." },
  { value: "realtime", label: "Live updates", icon: Activity, description: "Live refresh behaviour and event-driven updates." },
  { value: "database", label: "Database", icon: Database, description: "Connectivity and sync behaviour for local installs." },
  { value: "forecasting", label: "Planning", icon: BarChart3, description: "Demand planning and forecast defaults." },
  { value: "tax", label: "Tax", icon: Receipt, description: "VAT, jurisdiction, and reporting defaults." },
  { value: "billing", label: "Billing", icon: CreditCard, description: "Subscription, payment, and invoice behaviour." },
  { value: "configuration", label: "Workflow controls", icon: SlidersHorizontal, description: "Company-level workflow and control-centre settings." },
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

  const roleKey = (user?.role || "viewer").toLowerCase();
  const { data: myAccess } = useQuery<{
    permissions: Record<string, Record<string, boolean>>;
    navigationPaths: string[] | null;
  }>({
    queryKey: ["/api/permissions/me"],
    queryFn: () => requestJson("GET", "/api/permissions/me"),
    enabled: Boolean(user),
  });
  const roleCapabilities = React.useMemo(
    () => Object.entries(myAccess?.permissions ?? {}).flatMap(([resource, permissions]) =>
      Object.entries(permissions)
        .filter(([, allowed]) => allowed)
        .map(([permission]) => `${permission} ${resource.replaceAll("_", " ")}`),
    ),
    [myAccess?.permissions],
  );
  const highRiskCapabilities = React.useMemo(
    () => roleCapabilities.filter((capability) => /^(delete|approve|export|manage|update)\s/i.test(capability)),
    [roleCapabilities],
  );
  const activeSection = asSectionSlug(location.split("/")[3], SETTINGS_SECTION_SLUGS, "overview");
  const primarySections = settingsSections.filter((section) =>
    ["overview", "general", "inventory", "realtime", "forecasting", "configuration", "security"].includes(section.value) ||
    (isDevMode && section.value === "database"),
  );

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
        subtitle="Manage display preferences and the organization-wide policies used across the app."
        description="Company identity, Master Data, approvals, access, integrations, and subscription controls remain in their authoritative workspaces."
      />

      {isDevMode && activeSection === "database" && (
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

      <div className={`mb-6 grid gap-4 ${activeSection === "overview" ? "xl:grid-cols-[1.3fr_1fr]" : activeSection === "general" ? "grid-cols-1" : "hidden"}`}>
        <Card className={activeSection === "overview" ? "" : "hidden"}>
          <CardHeader>
            <CardTitle className="text-base">Configuration ownership</CardTitle>
            <CardDescription>
              Open the authoritative workspace for each kind of business configuration.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {[
              ["Company identity & documents", APP_ROUTES.admin.companySetup, "Legal details, addresses, logo and document branding", Building],
              ["Master Data", APP_ROUTES.admin.masterData, "Currencies, tax, terms, warehouses and controlled reference data", Database],
              ["Approval policies", APP_ROUTES.finance.approvalPolicies, "Approval entities, levels, amount bands and approvers", Shield],
              ["Workflow governance", APP_ROUTES.admin.workflows, "End-to-end process stages, approval coverage and pending work", SlidersHorizontal],
              ["People & access", APP_ROUTES.admin.employeeProfiles, "Profiles, approval limits, roles and visible navigation", UserCircle],
              ["Integrations", APP_ROUTES.admin.integrations, "External providers, document services and connection status", Activity],
              ["Subscription", APP_ROUTES.admin.subscription, "Plan, entitlements, limits and billing access", CreditCard],
            ].map(([label, href, description, Icon]) => (
              <Link key={String(label)} href={String(href)} className="rounded-lg border p-3 transition-colors hover:bg-accent/50">
                <div className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4 text-primary" />{String(label)}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{String(description)}</p>
              </Link>
            ))}
            <div className="col-span-full mt-1 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setLocation(APP_ROUTES.admin.settingsSection("inventory"))}>Open operational policy</Button>
              <Button size="sm" variant="outline" onClick={() => setLocation(APP_ROUTES.admin.settingsSection("general"))}>Open appearance preferences</Button>
            </div>
          </CardContent>
        </Card>

        <Card className={activeSection === "general" ? "" : "hidden"} data-testid="settings-local-preferences">
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

        <Card className={activeSection === "overview" ? "" : "hidden"} data-testid="settings-role-guidance">
          <CardHeader>
            <CardTitle className="text-base">Role guidance</CardTitle>
            <CardDescription>
              Signed in as <span className="font-medium uppercase">{user?.role || "viewer"}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Effective permissions enforced by the server for the current organization.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{roleCapabilities.length}</div><div className="text-xs text-muted-foreground">Effective permissions</div></div>
              <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{myAccess?.navigationPaths?.length ?? "All"}</div><div className="text-xs text-muted-foreground">Visible navigation tabs</div></div>
              <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{highRiskCapabilities.length}</div><div className="text-xs text-muted-foreground">High-risk capabilities</div></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild type="button" size="sm" variant="outline"><Link href={APP_ROUTES.admin.userRoles}>Manage roles</Link></Button>
              <Button asChild type="button" size="sm" variant="outline"><Link href={APP_ROUTES.admin.employeeProfiles}>Review effective access</Link></Button>
            </div>
            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Show effective permission details</summary>
              <ul className="mt-3 max-h-72 list-disc space-y-1 overflow-auto pl-5 text-muted-foreground">
                {roleCapabilities.map((capability) => <li key={capability}>{capability}</li>)}
                {roleCapabilities.length === 0 ? <li>No effective permissions assigned.</li> : null}
              </ul>
            </details>
          </CardContent>
        </Card>
      </div>

      {activeSection === "inventory" ? <ProductionControlPlanePanel isAdmin={roleKey === "admin"} /> : null}

      <Tabs
        value={activeSection}
        onValueChange={(value) => setLocation(APP_ROUTES.admin.settingsSection(value as typeof activeSection))}
        className="space-y-6"
      >
        <TabsList className="grid h-auto grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          {primarySections.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="flex items-center justify-center space-x-2 py-3 text-xs sm:text-sm">
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div><div className="font-medium">Settings are separated by authority</div><p className="text-sm text-muted-foreground">This page keeps operational policy and personal display preferences here while business records remain in their source workspaces.</p></div>
              <Button asChild variant="outline"><Link href={APP_ROUTES.admin.masterData}>Open Master Data Governance</Link></Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general" className="space-y-4">
          <GeneralSettingsForm />
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Connected operational setup</CardTitle><CardDescription>Stock policy is controlled above. Warehouse layouts and item-level thresholds remain with their authoritative records.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href={APP_ROUTES.admin.masterDataSection("warehouses")}>Warehouse Master Data</Link></Button><Button asChild variant="outline"><Link href={APP_ROUTES.inventory.root}>Inventory items</Link></Button><Button asChild variant="outline"><Link href={APP_ROUTES.inventory.warehouseOperations}>Warehouse operations</Link></Button></CardContent>
          </Card>
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
          <Card><CardHeader><CardTitle>Tax controls moved to Master Data</CardTitle><CardDescription>Tax codes, rates, active status, currency definitions, and their downstream dependencies are governed records rather than general settings.</CardDescription></CardHeader><CardContent><Button asChild><Link href={APP_ROUTES.admin.masterDataSection("taxCodes")}>Open Tax Code Master Data</Link></Button></CardContent></Card>
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
          <Card><CardHeader><CardTitle>Warehouse setup moved to Master Data</CardTitle><CardDescription>Sites, addresses, defaults, aisles, bins, and receiving layouts are maintained in the warehouse source of truth.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button asChild><Link href={APP_ROUTES.admin.masterDataSection("warehouses")}>Open Warehouse Master Data</Link></Button><Button asChild variant="outline"><Link href={APP_ROUTES.inventory.warehouseOperations}>Open Warehouse Operations</Link></Button></CardContent></Card>
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
  const { settings, isLoading, error, refetch, updateSettings } = useSettings();
  const currenciesQuery = useQuery({
    queryKey: ["/api/currencies", "settings-control-plane"],
    queryFn: fetchActiveMasterCurrencies,
  });
  const [form, setForm] = React.useState({
    currencyCode: (settings?.currencyCode ?? "").toUpperCase(),
    lowStockDefaultThreshold: settings?.lowStockDefaultThreshold == null ? "" : String(settings.lowStockDefaultThreshold),
    allowNegativeInventory: Boolean(settings?.allowNegativeInventory),
    requireLocationForItems: Boolean(settings?.requireLocationForItems),
    allowTransfersBetweenWarehouses: Boolean(settings?.allowTransfersBetweenWarehouses),
  });

  React.useEffect(() => {
    if (!settings) return;
    setForm({
      currencyCode: (settings.currencyCode ?? "ZAR").toUpperCase(),
      lowStockDefaultThreshold: String(settings.lowStockDefaultThreshold ?? 10),
      allowNegativeInventory: Boolean(settings.allowNegativeInventory),
      requireLocationForItems: Boolean(settings.requireLocationForItems),
      allowTransfersBetweenWarehouses: Boolean(settings.allowTransfersBetweenWarehouses),
    });
  }, [settings]);

  const currencyOptions = React.useMemo(
    () => currencyOptionsForSelect(currenciesQuery.data ?? [], [form.currencyCode, settings?.currencyCode]),
    [currenciesQuery.data, form.currencyCode, settings?.currencyCode],
  );
  const currencyReady = currenciesQuery.isSuccess && currencyOptions.length > 0;

  const save = () => {
    const threshold = Number(form.lowStockDefaultThreshold);
    if (!settings || !Number.isFinite(threshold) || threshold < 1 || !currencyReady) return;
    updateSettings.mutate({
      currencyCode: form.currencyCode.trim().toUpperCase(),
      currencySymbol: new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: form.currencyCode.trim().toUpperCase(),
        currencyDisplay: "narrowSymbol",
      }).formatToParts(0).find((part) => part.type === "currency")?.value ?? form.currencyCode.trim().toUpperCase(),
      lowStockDefaultThreshold: Math.trunc(threshold),
      allowNegativeInventory: form.allowNegativeInventory,
      requireLocationForItems: form.requireLocationForItems,
      allowTransfersBetweenWarehouses: form.allowTransfersBetweenWarehouses,
    });
  };

  if (!settings) {
    return <Card className="mb-6"><CardHeader><CardTitle className="text-base">Production control plane unavailable</CardTitle><CardDescription>No fallback organization values are shown or editable.</CardDescription></CardHeader><CardContent><Button type="button" variant="outline" disabled={isLoading} onClick={() => void refetch()}>{isLoading ? "Loading settings…" : "Retry settings"}</Button></CardContent></Card>;
  }

  return (
    <Card className="mb-6" data-testid="settings-control-plane">
      <CardHeader>
        <CardTitle className="text-base">Operational policy</CardTitle>
        <CardDescription>
          Persisted reporting and inventory rules used by procurement, receiving, warehouse operations, AP, and analytics.
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
        <div className="grid gap-4 md:grid-cols-2">
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
        <div className="grid gap-3 md:grid-cols-3">
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
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              data-testid="settings-control-warehouse-transfers"
              checked={form.allowTransfersBetweenWarehouses}
              disabled={!isAdmin || isLoading}
              onChange={(event) => setForm((current) => ({ ...current, allowTransfersBetweenWarehouses: event.target.checked }))}
            />
            Allow controlled transfers between configured warehouses
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
          {updateSettings.isPending ? "Saving policy..." : "Save operational policy"}
        </Button>
      </CardContent>
    </Card>
  );
}
