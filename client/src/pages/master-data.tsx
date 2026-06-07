import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Coins,
  Database,
  ExternalLink,
  Filter,
  Globe2,
  Layers3,
  Percent,
  Ruler,
  Search,
  ShieldCheck,
  Tags,
  Truck,
  Wallet,
  Package,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES, MASTER_DATA_SECTION_SLUGS, asSectionSlug } from "@/lib/routes/app-routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageDataState } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { invalidateMasterDataDomainForEndpoint } from "@/lib/domain-invalidation";
import { normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { WarehouseDialogs } from "@/pages/warehouses/warehouse-dialogs";
import { WarehouseTable } from "@/pages/warehouses/warehouse-table";
import { useWarehouseCrud } from "@/pages/warehouses/use-warehouse-crud";

type BaseMasterRecord = {
  id: number;
  code: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  symbol?: string | null;
  active?: boolean | null;
  rate?: number | null;
  type?: string | null;
  countryCode?: string | null;
  netDays?: number | null;
  discountDays?: number | null;
  discountPercent?: number | null;
  costCenterId?: string | null;
  contact?: string | null;
  decimalPlaces?: number | null;
};

const MASTER_ENDPOINTS = {
  units: "/api/units-of-measure",
  currencies: "/api/currencies",
  taxCodes: "/api/tax-codes",
  commodityCodes: "/api/commodity-codes",
  incoterms: "/api/incoterms",
  paymentTerms: "/api/payment-terms",
  departments: "/api/departments",
  carriers: "/api/carriers",
} as const;

type MasterEndpoint = (typeof MASTER_ENDPOINTS)[keyof typeof MASTER_ENDPOINTS];
type MasterGroup = "Operations" | "Procurement" | "Finance" | "Governance";

type MasterExtraField = {
  key: keyof BaseMasterRecord;
  label: string;
  placeholder?: string;
  type?: "text" | "number";
};

type MasterSectionConfig = {
  slug: (typeof MASTER_DATA_SECTION_SLUGS)[number];
  label: string;
  shortLabel: string;
  endpoint?: MasterEndpoint;
  icon: LucideIcon;
  group: MasterGroup;
  description: string;
  usedBy: string[];
  risk: string;
  extraFields?: MasterExtraField[];
  primaryNameField?: "name" | "description";
  linkTo?: string;
};

const MASTER_SECTIONS: MasterSectionConfig[] = [
  {
    slug: "units",
    label: "Units of Measure",
    shortLabel: "Units",
    endpoint: MASTER_ENDPOINTS.units,
    icon: Ruler,
    group: "Operations",
    description: "Canonical quantity units used on items, requisitions, purchase orders, receipts, and counts.",
    usedBy: ["Inventory", "Requisitions", "POs", "Warehouse ops"],
    risk: "Duplicate or unclear units create receiving and valuation errors.",
    extraFields: [{ key: "symbol", label: "Symbol", placeholder: "ea, kg, box" }],
  },
  {
    slug: "warehouses",
    label: "Warehouses",
    shortLabel: "Warehouses",
    icon: Package,
    group: "Operations",
    description: "Physical setup for sites, contacts, aisles, bins, zones, and storage metadata.",
    usedBy: ["Receiving", "Storage", "Transfers", "Cycle counts"],
    risk: "Weak warehouse setup breaks putaway, counts, transfers, and stock visibility.",
  },
  {
    slug: "carriers",
    label: "Carriers",
    shortLabel: "Carriers",
    endpoint: MASTER_ENDPOINTS.carriers,
    icon: Truck,
    group: "Operations",
    description: "Approved logistics providers that can also be referenced from supplier defaults.",
    usedBy: ["Suppliers", "Logistics", "Shipments", "Reports"],
    risk: "Separate carrier lists create supplier/logistics mismatch and shipment blind spots.",
    extraFields: [{ key: "contact", label: "Contact", placeholder: "ops@carrier.example" }],
  },
  {
    slug: "commodityCodes",
    label: "Commodity Codes",
    shortLabel: "Commodities",
    endpoint: MASTER_ENDPOINTS.commodityCodes,
    icon: Tags,
    group: "Procurement",
    description: "Commodity classification for spend analysis, sourcing, reporting, and import/export structure.",
    usedBy: ["Procurement", "Reports", "Suppliers", "Analytics"],
    risk: "Free-text categories hide spend patterns and weaken supplier analysis.",
    primaryNameField: "description",
    extraFields: [{ key: "category", label: "Category", placeholder: "IT hardware" }],
  },
  {
    slug: "incoterms",
    label: "Incoterms",
    shortLabel: "Incoterms",
    endpoint: MASTER_ENDPOINTS.incoterms,
    icon: Globe2,
    group: "Procurement",
    description: "Commercial delivery terms used to align supplier defaults, contracts, purchase orders, and logistics.",
    usedBy: ["Suppliers", "Contracts", "POs", "Logistics"],
    risk: "Unclear handoff terms create shipping, customs, and invoice disputes.",
    extraFields: [{ key: "description", label: "Description", placeholder: "Seller delivers to buyer destination" }],
  },
  {
    slug: "currencies",
    label: "Currencies",
    shortLabel: "Currencies",
    endpoint: MASTER_ENDPOINTS.currencies,
    icon: Coins,
    group: "Finance",
    description: "Approved transaction currencies for suppliers, contracts, purchase orders, invoices, and reports.",
    usedBy: ["Suppliers", "Contracts", "POs", "AP"],
    risk: "Missing currency controls cause supplier, PO, and invoice mismatches.",
    extraFields: [
      { key: "symbol", label: "Symbol", placeholder: "$" },
      { key: "decimalPlaces", label: "Decimals", type: "number", placeholder: "2" },
    ],
  },
  {
    slug: "taxCodes",
    label: "Tax Codes",
    shortLabel: "Tax Codes",
    endpoint: MASTER_ENDPOINTS.taxCodes,
    icon: Percent,
    group: "Finance",
    description: "Tax treatments applied to supplier records, requisition lines, purchase orders, invoices, and exports.",
    usedBy: ["Suppliers", "POs", "AP", "Exports"],
    risk: "Wrong tax codes distort landed cost, VAT/GST, and audit reporting.",
    extraFields: [
      { key: "rate", label: "Rate %", type: "number", placeholder: "15" },
      { key: "type", label: "Type", placeholder: "vat" },
      { key: "countryCode", label: "Country", placeholder: "ZA" },
    ],
  },
  {
    slug: "paymentTerms",
    label: "Payment Terms",
    shortLabel: "Payment Terms",
    endpoint: MASTER_ENDPOINTS.paymentTerms,
    icon: Wallet,
    group: "Finance",
    description: "Default payment rules used by supplier setup, AP invoices, approvals, and cash planning.",
    usedBy: ["Suppliers", "POs", "AP", "Payments"],
    risk: "Unmanaged terms cause overdue payables, missed discounts, and approval exceptions.",
    extraFields: [
      { key: "netDays", label: "Net days", type: "number", placeholder: "30" },
      { key: "discountDays", label: "Discount days", type: "number", placeholder: "10" },
      { key: "discountPercent", label: "Discount %", type: "number", placeholder: "2" },
    ],
  },
  {
    slug: "departments",
    label: "Departments",
    shortLabel: "Departments",
    endpoint: MASTER_ENDPOINTS.departments,
    icon: Building2,
    group: "Governance",
    description: "Cost ownership structure for requisitions, suppliers, approvals, budgets, and reporting.",
    usedBy: ["Requisitions", "Approvals", "Suppliers", "Reports"],
    risk: "Missing departments weaken budget control and spend accountability.",
    extraFields: [{ key: "costCenterId", label: "Cost center", placeholder: "CC-OPS-001" }],
  },
  {
    slug: "approvalPolicies",
    label: "Approval Policies",
    shortLabel: "Approvals",
    icon: ShieldCheck,
    group: "Governance",
    description: "Delegation and approval rules for requisitions, purchase orders, invoices, and payments.",
    usedBy: ["Requisitions", "POs", "AP", "Payments"],
    risk: "Missing policies cause unauthorized spend or blocked operational flow.",
    linkTo: APP_ROUTES.finance.approvalPolicies,
  },
];

function sectionBySlug(slug: (typeof MASTER_DATA_SECTION_SLUGS)[number]) {
  return MASTER_SECTIONS.find((section) => section.slug === slug) ?? MASTER_SECTIONS[0];
}

function recordDisplayName(record: BaseMasterRecord, config: MasterSectionConfig): string {
  const field = config.primaryNameField ?? "name";
  return String(record[field] ?? record.name ?? record.description ?? "-");
}

function fieldValue(record: BaseMasterRecord, field: keyof BaseMasterRecord): string {
  const value = record[field];
  if (value == null || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, "");
  return String(value);
}

function parseFieldValue(field: MasterExtraField, value: string): string | number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (field.type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
}

function MasterTable({ config }: { config: MasterSectionConfig }) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const endpoint = config.endpoint ?? "";

  const { data = [], isLoading } = useQuery({
    queryKey: [endpoint],
    queryFn: async () => normalizeApiList<BaseMasterRecord>(await requestJson<unknown>("GET", endpoint)),
    enabled: Boolean(endpoint),
  });

  const createRecord = useMutation({
    mutationFn: (payload: Record<string, unknown>) => requestJson("POST", endpoint, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      resetForm();
      toast({ title: `${config.label} created` });
    },
    onError: (e) => toast({ title: `Failed to create ${config.label.toLowerCase()}`, description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const updateRecord = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) => requestJson("PATCH", `${endpoint}/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      resetForm();
      toast({ title: `${config.label} updated` });
    },
    onError: (e) => toast({ title: `Failed to update ${config.label.toLowerCase()}`, description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const deleteRecord = useMutation({
    mutationFn: (id: number) => requestJson("DELETE", `${endpoint}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      toast({ title: `${config.label} removed` });
    },
    onError: (e) => toast({ title: `Failed to delete ${config.label.toLowerCase()}`, description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const toggleRecord = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => requestJson("PATCH", `${endpoint}/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
    },
    onError: (e) => toast({ title: `Failed to update ${config.label.toLowerCase()} status`, description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const extraFields = config.extraFields ?? [];
  const nameLabel = config.primaryNameField === "description" ? "Description" : "Name";
  const activeCount = data.filter((row) => row.active !== false).length;
  const inactiveCount = data.length - activeCount;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...data]
      .filter((row) => {
        if (statusFilter === "active" && row.active === false) return false;
        if (statusFilter === "inactive" && row.active !== false) return false;
        if (!term) return true;
        return [row.code, row.name, row.description, row.category, row.symbol, row.type, row.countryCode, row.costCenterId, row.contact]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [data, search, statusFilter]);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setExtraValues({});
  }

  function buildPayload() {
    const payload: Record<string, unknown> = { code: code.trim(), [config.primaryNameField ?? "name"]: name.trim() };
    for (const field of extraFields) {
      const parsed = parseFieldValue(field, extraValues[String(field.key)] ?? "");
      if (parsed != null) payload[field.key] = parsed;
    }
    if (config.slug === "currencies") {
      payload.symbol = String(payload.symbol ?? "").trim() || code.trim().slice(0, 3) || "$";
      payload.decimalPlaces = Number(payload.decimalPlaces ?? 2);
    }
    if (config.slug === "taxCodes") {
      payload.rate = Number(payload.rate ?? 0);
      payload.type = String(payload.type ?? "vat");
    }
    if (config.slug === "paymentTerms") payload.netDays = Number(payload.netDays ?? 30);
    return payload;
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{config.label}</CardTitle>
              <Badge variant="outline">{config.group}</Badge>
              <Badge variant={inactiveCount > 0 ? "secondary" : "outline"}>{activeCount} active</Badge>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{config.description}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => queryClient.invalidateQueries({ queryKey: [endpoint] })}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 pt-4 md:grid-cols-3">
          <InfoPanel title="Used by">{config.usedBy.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}</InfoPanel>
          <InfoPanel title="Control risk" icon={<AlertTriangle className="h-3.5 w-3.5" />}><p className="text-sm">{config.risk}</p></InfoPanel>
          <InfoPanel title="Coverage"><div className="flex items-end gap-2"><span className="text-2xl font-semibold">{data.length}</span><span className="pb-1 text-sm text-muted-foreground">records</span>{inactiveCount > 0 ? <Badge variant="outline">{inactiveCount} inactive</Badge> : null}</div></InfoPanel>
        </div>

        <form className="rounded-md border bg-card p-3" onSubmit={(e) => {
          e.preventDefault();
          if (!code.trim() || !name.trim()) {
            toast({ title: `Code and ${nameLabel.toLowerCase()} are required`, variant: "destructive" });
            return;
          }
          const payload = buildPayload();
          if (editingId != null) updateRecord.mutate({ id: editingId, payload });
          else createRecord.mutate(payload);
        }}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
            <div className="space-y-1"><Label>{nameLabel}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            {extraFields.map((field) => (
              <div key={String(field.key)} className="space-y-1">
                <Label>{field.label}</Label>
                <Input type={field.type ?? "text"} value={extraValues[String(field.key)] ?? ""} onChange={(e) => setExtraValues((current) => ({ ...current, [String(field.key)]: e.target.value }))} placeholder={field.placeholder} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {editingId != null ? <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button> : null}
            <Button type="submit" disabled={createRecord.isPending || updateRecord.isPending}>{editingId != null ? "Save changes" : "Add record"}</Button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[18rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${config.shortLabel.toLowerCase()}...`} className="pl-9" />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {(["all", "active", "inactive"] as const).map((value) => <Button key={value} type="button" size="sm" variant={statusFilter === value ? "default" : "outline"} onClick={() => setStatusFilter(value)}>{value === "all" ? "All" : value === "active" ? "Active" : "Inactive"}</Button>)}
          </div>
        </div>

        {isLoading ? <div className="rounded-md border p-4 text-sm text-muted-foreground">Loading...</div> : rows.length === 0 ? <div className="rounded-md border p-4 text-sm text-muted-foreground">No matching records.</div> : (
          <div className="overflow-hidden rounded-md border">
            {rows.map((row) => (
              <div key={row.id} className="grid gap-3 border-b p-3 last:border-b-0 lg:grid-cols-[8rem_minmax(0,1fr)_14rem_18rem]">
                <div><div className="font-medium">{row.code}</div><div className="text-xs text-muted-foreground">{row.active === false ? "Inactive" : "Active"}</div></div>
                <div><div className="font-medium">{recordDisplayName(row, config)}</div><div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">{extraFields.slice(0, 3).map((field) => <span key={String(field.key)}>{field.label}: {fieldValue(row, field.key)}</span>)}</div></div>
                <Badge variant={row.active === false ? "outline" : "secondary"} className="h-fit w-fit gap-1">{row.active === false ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{row.active === false ? "Inactive" : "Active"}</Badge>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditingId(row.id); setCode(row.code); setName(recordDisplayName(row, config) === "-" ? "" : recordDisplayName(row, config)); const next: Record<string, string> = {}; for (const field of extraFields) next[String(field.key)] = row[field.key] == null ? "" : String(row[field.key]); setExtraValues(next); }}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => toggleRecord.mutate({ id: row.id, active: row.active === false })}>{row.active === false ? "Activate" : "Deactivate"}</Button>
                  <Button size="sm" variant="outline" onClick={() => deleteRecord.mutate(row.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoPanel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <div className="rounded-md border bg-background p-3"><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">{icon}{title}</div><div className="flex flex-wrap gap-1.5">{children}</div></div>;
}

function WarehouseMasterPanel() {
  const crud = useWarehouseCrud();
  const [createWarehouseFormVariant, setCreateWarehouseFormVariant] = useState<"quick" | "full">("quick");
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2"><CardTitle>Warehouses</CardTitle><Badge variant="outline">Operations</Badge><Badge variant="secondary">{crud.list.length} sites</Badge></div>
            <p className="max-w-3xl text-sm text-muted-foreground">Maintain location setup here: sites, addresses, contacts, aisles, bins, and storage metadata. Movement, receiving, cycle counts, and transfers stay in Warehouse Operations.</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => crud.refetch()}><RefreshCw className="h-4 w-4" />Refresh</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 pt-4 md:grid-cols-3">
          <InfoPanel title="Used by">{["Receiving", "Storage", "Transfers", "Cycle counts"].map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}</InfoPanel>
          <InfoPanel title="Control risk" icon={<AlertTriangle className="h-3.5 w-3.5" />}><p className="text-sm">Weak warehouse setup breaks putaway, counts, transfers, and stock visibility.</p></InfoPanel>
          <InfoPanel title="Coverage"><div className="flex items-end gap-2"><span className="text-2xl font-semibold">{crud.list.length}</span><span className="pb-1 text-sm text-muted-foreground">configured locations</span></div></InfoPanel>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3">
          <div className="text-sm text-muted-foreground">Add quick sites for early setup or full layout when bins and zones are known.</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => { crud.resetForm(); setCreateWarehouseFormVariant("quick"); crud.setIsCreateDialogOpen(true); }}>Quick add</Button>
            <Button type="button" onClick={() => { crud.resetForm(); setCreateWarehouseFormVariant("full"); crud.setIsCreateDialogOpen(true); }}>Add full setup</Button>
          </div>
        </div>
        <PageDataState isLoading={crud.isLoading} error={crud.isError ? (crud.error instanceof Error ? crud.error : new Error(String(crud.error))) : null} isEmpty={!crud.isLoading && !crud.isError && crud.list.length === 0} errorTitle="Failed to load warehouses" onRetry={() => crud.refetch()} emptyView={<div className="rounded-md border p-4 text-sm text-muted-foreground">No warehouses yet.</div>}>
          <WarehouseTable list={crud.list} onEdit={crud.openEditDialog} onDelete={crud.openDeleteDialog} />
        </PageDataState>
        <WarehouseDialogs isCreateDialogOpen={crud.isCreateDialogOpen} setIsCreateDialogOpen={crud.setIsCreateDialogOpen} createFormVariant={createWarehouseFormVariant} setCreateFormVariant={setCreateWarehouseFormVariant} isEditDialogOpen={crud.isEditDialogOpen} setIsEditDialogOpen={crud.setIsEditDialogOpen} isDeleteDialogOpen={crud.isDeleteDialogOpen} setIsDeleteDialogOpen={crud.setIsDeleteDialogOpen} formData={crud.formData} setFormData={crud.setFormData} selectedWarehouse={crud.selectedWarehouse} createWarehouse={crud.createWarehouse} updateWarehouse={crud.updateWarehouse} deleteWarehouse={crud.deleteWarehouse} addBin={crud.addBin} updateBin={crud.updateBin} removeBin={crud.removeBin} handleCreateSubmit={crud.handleCreateSubmit} handleEditSubmit={crud.handleEditSubmit} handleDeleteConfirm={crud.handleDeleteConfirm} />
      </CardContent>
    </Card>
  );
}

function ApprovalPoliciesRedirectCard() {
  return <Card className="overflow-hidden"><CardHeader className="border-b bg-muted/20"><div className="flex flex-wrap items-center gap-2"><CardTitle>Approval policies</CardTitle><Badge variant="outline">Governance</Badge></div></CardHeader><CardContent className="space-y-4 pt-4 text-sm text-muted-foreground"><InfoPanel title="Used by">{["Requisitions", "POs", "AP", "Payments"].map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}</InfoPanel><p>Approval rules are managed on the dedicated <strong>Approval policies</strong> page.</p><Button asChild className="gap-2"><Link href={APP_ROUTES.finance.approvalPolicies}>Open approval policies<ExternalLink className="h-4 w-4" /></Link></Button></CardContent></Card>;
}

export default function MasterDataPage() {
  const [location, setLocation] = useLocation();
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const activeSection = asSectionSlug(location.split("/")[3], MASTER_DATA_SECTION_SLUGS, "units");
  const activeConfig = sectionBySlug(activeSection);
  const ActiveIcon = activeConfig.icon;

  const summaryQueries = useQuery({
    queryKey: ["master-data-summary"],
    queryFn: async () => Promise.all(MASTER_SECTIONS.filter((section) => section.endpoint).map(async (section) => {
      const rows = normalizeApiList<BaseMasterRecord>(await requestJson<unknown>("GET", section.endpoint!));
      return { slug: section.slug, label: section.shortLabel, group: section.group, total: rows.length, active: rows.filter((row) => row.active !== false).length };
    })),
    staleTime: 60_000,
  });

  const summaryRows = summaryQueries.data ?? [];
  const totalRecords = summaryRows.reduce((sum, row) => sum + row.total, 0);
  const totalActive = summaryRows.reduce((sum, row) => sum + row.active, 0);
  const setupGaps = summaryRows.filter((row) => row.total === 0).length;

  useEffect(() => { if (!isLgUp) setLocation("/m/home"); }, [isLgUp, setLocation]);
  if (!isLgUp) return <div className="mx-auto max-w-lg p-6 text-center text-sm text-muted-foreground">Master data is available on large screens. Sending you to the mobile hub...</div>;

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-6" data-testid="master-data-page">
      <PageHeader title="Master Data" subtitle="Control shared setup data used by procurement, finance, operations, inventory, reporting, and supplier workflows." />
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard icon={Database} value={summaryQueries.isLoading ? "-" : totalRecords} label="reference records" />
        <MetricCard icon={CheckCircle2} value={summaryQueries.isLoading ? "-" : totalActive} label="active values" />
        <MetricCard icon={Layers3} value={MASTER_SECTIONS.length} label="setup domains" />
        <MetricCard icon={AlertTriangle} value={summaryQueries.isLoading ? "-" : setupGaps} label="empty lists" />
      </div>
      <Tabs value={activeSection} onValueChange={(value) => setLocation(APP_ROUTES.admin.masterDataSection(value as typeof activeSection))} className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="h-fit"><CardHeader className="pb-3"><CardTitle className="text-base">Setup areas</CardTitle><p className="text-sm text-muted-foreground">Grouped by where the data has operational impact.</p></CardHeader><CardContent className="space-y-4"><TabsList className="flex h-auto flex-col items-stretch gap-1 bg-transparent p-0">{(["Operations", "Procurement", "Finance", "Governance"] as MasterGroup[]).map((group) => <div key={group} className="contents"><div className="px-2 pt-2 text-xs font-semibold uppercase text-muted-foreground first:pt-0">{group}</div>{MASTER_SECTIONS.filter((section) => section.group === group).map((section) => { const Icon = section.icon; const summary = summaryRows.find((row) => row.slug === section.slug); return <TabsTrigger key={section.slug} value={section.slug} className="h-auto justify-between gap-2 rounded-md border px-3 py-2 text-left data-[state=active]:border-primary"><span className="flex min-w-0 items-center gap-2"><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{section.shortLabel}</span></span>{summary ? <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold text-muted-foreground">{summary.total}</span> : null}</TabsTrigger>; })}<Separator className="my-1" /></div>)}</TabsList></CardContent></Card>
        <div className="min-w-0 space-y-4"><div className="rounded-md border bg-muted/20 p-4"><div className="flex flex-wrap items-center gap-2"><ActiveIcon className="h-5 w-5 text-primary" /><h2 className="text-lg font-semibold">{activeConfig.label}</h2><Badge variant="outline">{activeConfig.group}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{activeConfig.description}</p></div>{MASTER_SECTIONS.map((section) => <TabsContent key={section.slug} value={section.slug} className="m-0">{section.slug === "warehouses" ? <WarehouseMasterPanel /> : section.slug === "approvalPolicies" ? <ApprovalPoliciesRedirectCard /> : <MasterTable config={section} />}</TabsContent>)}</div>
      </Tabs>
    </div>
  );
}

function MetricCard({ icon: Icon, value, label }: { icon: LucideIcon; value: string | number; label: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><Icon className="h-8 w-8 text-primary" /><div><div className="text-2xl font-semibold">{value}</div><div className="text-sm text-muted-foreground">{label}</div></div></CardContent></Card>;
}
