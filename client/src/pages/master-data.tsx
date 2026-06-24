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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageDataState } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { WarehouseTable } from "@/pages/warehouses/warehouse-table";
import { WarehouseDialogs } from "@/pages/warehouses/warehouse-dialogs";
import { useWarehouseCrud } from "@/pages/warehouses/use-warehouse-crud";

import { invalidateMasterDataDomainForEndpoint } from "@/lib/domain-invalidation";

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
  system?: string | null;
  decimalPlaces?: number | null;
  regionCode?: string | null;
  regionName?: string | null;
  isMainForRegion?: boolean | null;
  exchangeRateToZar?: number | null;
};

const MASTER_ENDPOINTS = {
  units: "/api/units-of-measure",
  currencies: "/api/currencies",
  taxCodes: "/api/tax-codes",
  commodityCodes: "/api/commodity-codes",
  incoterms: "/api/incoterms",
  paymentTerms: "/api/payment-terms",
  departments: "/api/departments",
  warehouses: "/api/warehouses",
  carriers: "/api/carriers",
} as const;

type MasterEndpoint = (typeof MASTER_ENDPOINTS)[keyof typeof MASTER_ENDPOINTS];

type MdmQualityIssue = {
  domain: string;
  severity: "info" | "warning" | "error";
  issueCode: string;
  title: string;
  message: string;
  affectedEntityType?: string | null;
  affectedEntityId?: number | null;
  recommendedAction?: string | null;
};

type MdmHealthSection = {
  key: string;
  label: string;
  records: number;
  status: "ready" | "needs_setup" | string;
  connectedTo: string[];
};

type MdmControlCentreHealth = {
  title: string;
  defaultCurrencyCode: string;
  healthScore: number;
  issueCounts: { info: number; warning: number; error: number };
  metrics: Record<string, number>;
  sections: MdmHealthSection[];
  topIssues: MdmQualityIssue[];
};

type MasterExtraField = {
  key: keyof BaseMasterRecord;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "boolean";
};

type MasterSectionConfig = {
  slug: (typeof MASTER_DATA_SECTION_SLUGS)[number];
  label: string;
  shortLabel: string;
  endpoint?: MasterEndpoint;
  icon: LucideIcon;
  group: "Procurement" | "Finance" | "Operations" | "Governance";
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
    slug: "currencies",
    label: "Currencies",
    shortLabel: "Currencies",
    endpoint: MASTER_ENDPOINTS.currencies,
    icon: Coins,
    group: "Finance",
    description: "Approved transaction currencies for suppliers, contracts, purchase orders, invoices, and reports.",
    usedBy: ["Regions", "Suppliers", "Requisitions", "POs", "AP", "Reports"],
    risk: "Missing region defaults or exchange rates cause requisitions, POs, invoices, and reporting to disagree.",
    extraFields: [
      { key: "symbol", label: "Symbol", placeholder: "$" },
      { key: "regionCode", label: "Region code", placeholder: "ZA" },
      { key: "regionName", label: "Region name", placeholder: "South Africa" },
      { key: "isMainForRegion", label: "Main for region", type: "boolean" },
      { key: "exchangeRateToZar", label: "ZAR rate", type: "number", placeholder: "1" },
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
  if (field.type === "boolean") {
    return ["true", "yes", "1", "main", "primary"].includes(trimmed.toLowerCase()) ? "true" : "false";
  }
  if (field.type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
}

function MasterTable({
  config,
}: {
  config: MasterSectionConfig;
}) {
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
    queryFn: async () => {
      if (!endpoint) return [];
      const raw = await requestJson<unknown>("GET", endpoint);
      return normalizeApiList<BaseMasterRecord>(raw);
    },
    enabled: Boolean(endpoint),
  });

  const createRecord = useMutation({
    mutationFn: (payload: Record<string, unknown>) => requestJson("POST", endpoint, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      setCode("");
      setName("");
      setExtraValues({});
      toast({ title: `${config.label} created` });
    },
    onError: (e) => {
      toast({
        title: `Failed to create ${config.label.toLowerCase()}`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const updateRecord = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      requestJson("PATCH", `${endpoint}/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      setEditingId(null);
      setCode("");
      setName("");
      setExtraValues({});
      toast({ title: `${config.label} updated` });
    },
    onError: (e) => {
      toast({
        title: `Failed to update ${config.label.toLowerCase()}`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const deleteRecord = useMutation({
    mutationFn: (id: number) => requestJson("DELETE", `${endpoint}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      toast({ title: `${config.label} removed` });
    },
    onError: (e) => {
      toast({
        title: `Failed to delete ${config.label.toLowerCase()}`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const toggleRecord = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => requestJson("PATCH", `${endpoint}/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
    },
    onError: (e) => {
      toast({
        title: `Failed to update ${config.label.toLowerCase()} status`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const activeCount = data.filter((row) => row.active !== false).length;
  const inactiveCount = data.length - activeCount;

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...data]
      .filter((row) => {
        if (statusFilter === "active" && row.active === false) return false;
        if (statusFilter === "inactive" && row.active !== false) return false;
        if (!term) return true;
        const haystack = [
          row.code,
          row.name,
          row.description,
          row.category,
          row.symbol,
          row.type,
          row.countryCode,
          row.regionCode,
          row.regionName,
          row.costCenterId,
          row.contact,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [data, search, statusFilter]);

  const extraFields = config.extraFields ?? [];
  const visibleExtraFields = extraFields.slice(0, config.slug === "currencies" ? 6 : 3);
  const nameLabel = config.primaryNameField === "description" ? "Description" : "Name";

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setExtraValues({});
  }

  function buildPayload() {
    const payload: Record<string, unknown> = {
      code: code.trim(),
      [config.primaryNameField ?? "name"]: name.trim(),
    };

    for (const field of extraFields) {
      const parsed = parseFieldValue(field, extraValues[String(field.key)] ?? "");
      if (parsed != null) payload[field.key] = field.type === "boolean" ? parsed === "true" : parsed;
    }

    if (config.slug === "currencies") {
      payload.symbol = String(payload.symbol ?? "").trim() || code.trim().slice(0, 3) || "$";
      payload.regionCode = String(payload.regionCode ?? "ZA").trim().toUpperCase() || "ZA";
      payload.regionName = String(payload.regionName ?? "South Africa").trim() || "South Africa";
      payload.exchangeRateToZar = Number(payload.exchangeRateToZar ?? 1);
      payload.decimalPlaces = Number(payload.decimalPlaces ?? 2);
    }
    if (config.slug === "taxCodes") {
      payload.rate = Number(payload.rate ?? 0);
      payload.type = String(payload.type ?? "vat");
    }
    if (config.slug === "paymentTerms") {
      payload.netDays = Number(payload.netDays ?? 30);
    }

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
              <Badge variant={inactiveCount > 0 ? "secondary" : "outline"}>
                {activeCount} active
              </Badge>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{config.description}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => queryClient.invalidateQueries({ queryKey: [endpoint] })}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 pt-4 md:grid-cols-3">
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Used by</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {config.usedBy.map((item) => (
                <Badge key={item} variant="secondary" className="font-medium">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Control risk
            </div>
            <p className="mt-2 text-sm">{config.risk}</p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Coverage</div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-2xl font-semibold">{data.length}</span>
              <span className="pb-1 text-sm text-muted-foreground">records</span>
              {inactiveCount > 0 ? <Badge variant="outline">{inactiveCount} inactive</Badge> : null}
            </div>
          </div>
        </div>

        <form
          className="rounded-md border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim() || !name.trim()) {
              toast({ title: `Code and ${nameLabel.toLowerCase()} are required`, variant: "destructive" });
              return;
            }
            const payload = buildPayload();
            if (editingId != null) {
              updateRecord.mutate({ id: editingId, payload });
            } else {
              createRecord.mutate(payload);
            }
          }}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor={`${endpoint}-code`}>Code</Label>
              <Input id={`${endpoint}-code`} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${endpoint}-name`}>{nameLabel}</Label>
              <Input
                id={`${endpoint}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={config.primaryNameField === "description" ? "Commodity description" : "Display name"}
              />
            </div>
            {extraFields.map((field) => (
              <div key={String(field.key)} className="space-y-1">
                <Label htmlFor={`${endpoint}-${String(field.key)}`}>{field.label}</Label>
                <Input
                  id={`${endpoint}-${String(field.key)}`}
                  type={field.type === "number" ? "number" : "text"}
                  value={extraValues[String(field.key)] ?? ""}
                  onChange={(e) => setExtraValues((current) => ({ ...current, [String(field.key)]: e.target.value }))}
                  placeholder={field.placeholder}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
              {editingId != null ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updateRecord.isPending}>
                    Save changes
                  </Button>
                </>
              ) : (
                <Button type="submit" disabled={createRecord.isPending}>
                  Add record
                </Button>
              )}
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[18rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${config.shortLabel.toLowerCase()}...`}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {(["all", "active", "inactive"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={statusFilter === value ? "default" : "outline"}
                onClick={() => setStatusFilter(value)}
              >
                {value === "all" ? "All" : value === "active" ? "Active" : "Inactive"}
              </Button>
            ))}
          </div>
        </div>

        <div>
          {isLoading ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">Loading...</div>
          ) : sorted.length === 0 ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">No matching records.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[10rem]">Code</TableHead>
                  <TableHead>{nameLabel}</TableHead>
                  {visibleExtraFields.map((field) => (
                    <TableHead key={String(field.key)}>{field.label}</TableHead>
                  ))}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.code}</TableCell>
                    <TableCell>
                      <div className="max-w-xl">
                        <div className="font-medium">{recordDisplayName(row, config)}</div>
                        {row.name && row.description && config.primaryNameField === "description" ? (
                          <div className="text-xs text-muted-foreground">{row.name}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    {visibleExtraFields.map((field) => (
                      <TableCell key={String(field.key)}>{fieldValue(row, field.key)}</TableCell>
                    ))}
                    <TableCell>
                      <Badge variant={row.active === false ? "outline" : "secondary"} className="gap-1">
                        {row.active === false ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {row.active === false ? "Inactive" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(row.id);
                            setCode(row.code);
                            setName(recordDisplayName(row, config) === "-" ? "" : recordDisplayName(row, config));
                            const nextExtras: Record<string, string> = {};
                            for (const field of extraFields) {
                              const value = row[field.key];
                              nextExtras[String(field.key)] = value == null ? "" : String(value);
                            }
                            setExtraValues(nextExtras);
                          }}
                          disabled={updateRecord.isPending || deleteRecord.isPending}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleRecord.mutate({ id: row.id, active: row.active === false })}
                          disabled={toggleRecord.isPending}
                        >
                          {row.active === false ? "Activate" : "Deactivate"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteRecord.mutate(row.id)}
                          disabled={deleteRecord.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WarehouseMasterPanel() {
  const crud = useWarehouseCrud();
  const [createWarehouseFormVariant, setCreateWarehouseFormVariant] = useState<"quick" | "full">("quick");

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Warehouses</CardTitle>
              <Badge variant="outline">Operations</Badge>
              <Badge variant="secondary">{crud.list.length} sites</Badge>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Maintain location setup here: sites, addresses, contacts, aisles, bins, and storage metadata. Movement,
              receiving, cycle counts, and transfers stay in Warehouse Operations.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => crud.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 pt-4 md:grid-cols-3">
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Used by</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Receiving", "Storage", "Transfers", "Cycle counts"].map((item) => (
                <Badge key={item} variant="secondary" className="font-medium">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Control risk
            </div>
            <p className="mt-2 text-sm">Weak warehouse setup breaks putaway, counts, transfers, and stock visibility.</p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Coverage</div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-2xl font-semibold">{crud.list.length}</span>
              <span className="pb-1 text-sm text-muted-foreground">configured locations</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3">
          <div className="text-sm text-muted-foreground">
            Add quick sites for early setup or full layout when bins and zones are known.
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                crud.resetForm();
                setCreateWarehouseFormVariant("quick");
                crud.setIsCreateDialogOpen(true);
              }}
            >
              Quick add
            </Button>
            <Button
              type="button"
              onClick={() => {
                crud.resetForm();
                setCreateWarehouseFormVariant("full");
                crud.setIsCreateDialogOpen(true);
              }}
            >
              Add full setup
            </Button>
          </div>
        </div>

        <PageDataState
          isLoading={crud.isLoading}
          error={crud.isError ? (crud.error instanceof Error ? crud.error : new Error(String(crud.error))) : null}
          isEmpty={!crud.isLoading && !crud.isError && crud.list.length === 0}
          errorTitle="Failed to load warehouses"
          onRetry={() => crud.refetch()}
          emptyView={<div className="rounded-md border p-4 text-sm text-muted-foreground">No warehouses yet.</div>}
        >
          <WarehouseTable list={crud.list} onEdit={crud.openEditDialog} onDelete={crud.openDeleteDialog} />
        </PageDataState>

        <WarehouseDialogs
          isCreateDialogOpen={crud.isCreateDialogOpen}
          setIsCreateDialogOpen={crud.setIsCreateDialogOpen}
          createFormVariant={createWarehouseFormVariant}
          setCreateFormVariant={setCreateWarehouseFormVariant}
          isEditDialogOpen={crud.isEditDialogOpen}
          setIsEditDialogOpen={crud.setIsEditDialogOpen}
          isDeleteDialogOpen={crud.isDeleteDialogOpen}
          setIsDeleteDialogOpen={crud.setIsDeleteDialogOpen}
          formData={crud.formData}
          setFormData={crud.setFormData}
          selectedWarehouse={crud.selectedWarehouse}
          createWarehouse={crud.createWarehouse}
          updateWarehouse={crud.updateWarehouse}
          deleteWarehouse={crud.deleteWarehouse}
          addBin={crud.addBin}
          updateBin={crud.updateBin}
          removeBin={crud.removeBin}
          handleCreateSubmit={crud.handleCreateSubmit}
          handleEditSubmit={crud.handleEditSubmit}
          handleDeleteConfirm={crud.handleDeleteConfirm}
        />
      </CardContent>
    </Card>
  );
}
function ApprovalPoliciesRedirectCard() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Approval policies</CardTitle>
          <Badge variant="outline">Governance</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4 text-sm text-muted-foreground">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Used by</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Requisitions", "POs", "AP", "Payments"].map((item) => (
                <Badge key={item} variant="secondary" className="font-medium">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
          <div className="rounded-md border bg-background p-3 md:col-span-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Control risk
            </div>
            <p className="mt-2">Missing policies cause unauthorized spend or blocked operational flow.</p>
          </div>
        </div>
        <p>
          Approval rules are managed on the dedicated <strong>Approval policies</strong> page (create, edit, levels, and
          approvers).
        </p>
        <Button asChild variant="default" className="gap-2">
          <Link href={APP_ROUTES.finance.approvalPolicies}>
            Open approval policies
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function severityVariant(severity: MdmQualityIssue["severity"]): "default" | "secondary" | "destructive" | "outline" {
  if (severity === "error") return "destructive";
  if (severity === "warning") return "secondary";
  return "outline";
}

function ControlCentreIssuePanel({
  issues,
  onScan,
  isScanning,
}: {
  issues: MdmQualityIssue[];
  onScan: () => void;
  isScanning: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Data quality workbench</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            These checks connect setup gaps to the workflows they can break before requisitions, POs, receipts, AP, or
            reporting fail downstream.
          </p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={onScan} disabled={isScanning}>
          <RefreshCw className={`h-4 w-4 ${isScanning ? "animate-spin" : ""}`} />
          Scan controls
        </Button>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
            No open Master Data quality issues were found. Keep scanning after supplier, item, tax, FX, GL, or warehouse
            setup changes.
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {issues.slice(0, 8).map((issue, index) => (
              <div key={`${issue.issueCode}-${issue.affectedEntityType ?? "global"}-${issue.affectedEntityId ?? index}`} className="rounded-md border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={severityVariant(issue.severity)}>{issue.severity}</Badge>
                      <Badge variant="outline">{issue.domain}</Badge>
                    </div>
                    <div className="mt-2 font-medium">{issue.title}</div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">{issue.issueCode}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{issue.message}</p>
                {issue.recommendedAction ? <p className="mt-2 text-sm">{issue.recommendedAction}</p> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MasterDataPage() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const activeSection = asSectionSlug(location.split("/")[3], MASTER_DATA_SECTION_SLUGS, "units");
  const activeConfig = sectionBySlug(activeSection);
  const ActiveIcon = activeConfig.icon;

  const mdmHealth = useQuery({
    queryKey: ["/api/mdm/control-centre/health"],
    queryFn: () => requestJson<MdmControlCentreHealth>("GET", "/api/mdm/control-centre/health"),
    staleTime: 60_000,
  });

  const dataQualityIssues = useQuery({
    queryKey: ["/api/mdm/data-quality/issues"],
    queryFn: () => requestJson<MdmQualityIssue[]>("GET", "/api/mdm/data-quality/issues"),
    staleTime: 60_000,
  });

  const scanDataQuality = useMutation({
    mutationFn: () => requestJson("POST", "/api/mdm/data-quality/scan", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mdm/control-centre/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mdm/data-quality/issues"] });
      toast({ title: "Master Data controls scanned" });
    },
    onError: (e) => {
      toast({
        title: "Master Data scan failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const summaryQueries = useQuery({
    queryKey: ["master-data-summary"],
    queryFn: async () => {
      const sections = MASTER_SECTIONS.filter((section) => section.endpoint);
      const results = await Promise.all(
        sections.map(async (section) => {
          const raw = await requestJson<unknown>("GET", section.endpoint!);
          const rows = normalizeApiList<BaseMasterRecord>(raw);
          return {
            slug: section.slug,
            label: section.shortLabel,
            group: section.group,
            total: rows.length,
            active: rows.filter((row) => row.active !== false).length,
          };
        }),
      );
      return results;
    },
    staleTime: 60_000,
  });

  const summaryRows = summaryQueries.data ?? [];
  const totalRecords = summaryRows.reduce((sum, row) => sum + row.total, 0);
  const totalActive = summaryRows.reduce((sum, row) => sum + row.active, 0);
  const setupGaps = summaryRows.filter((row) => row.total === 0).length;
  const health = mdmHealth.data;
  const issues = dataQualityIssues.data ?? health?.topIssues ?? [];
  const issueCount = health
    ? health.issueCounts.error + health.issueCounts.warning + health.issueCounts.info
    : issues.length;

  useEffect(() => {
    if (!isLgUp) {
      setLocation("/m/home");
    }
  }, [isLgUp, setLocation]);

  if (!isLgUp) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-muted-foreground">
        Master data is available on large screens (1024px and wider). Use a desktop browser or resize the window.
        Sending you to the mobile hub...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-6" data-testid="master-data-page">
      <PageHeader
        title="Master Data & Control Centre"
        subtitle="The single source of truth for suppliers, items, units, currency, tax, approvals, warehouses, documents, finance mapping, and reports."
      />
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Database className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-semibold">{mdmHealth.isLoading ? "-" : health?.healthScore ?? 0}%</div>
              <div className="text-sm text-muted-foreground">data health score</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-semibold">{summaryQueries.isLoading ? "-" : totalActive}</div>
              <div className="text-sm text-muted-foreground">active legacy values</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Layers3 className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-semibold">{health?.defaultCurrencyCode ?? "ZAR"}</div>
              <div className="text-sm text-muted-foreground">company currency</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-semibold">{mdmHealth.isLoading ? "-" : issueCount || setupGaps}</div>
              <div className="text-sm text-muted-foreground">open control issues</div>
            </div>
          </CardContent>
        </Card>
      </div>
      {health?.sections?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Control Centre map</CardTitle>
            <p className="text-sm text-muted-foreground">
              Each setup domain below feeds defaults, validation, approval routing, and reporting dimensions elsewhere in
              the app.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {health.sections.map((section) => (
              <div key={section.key} className="rounded-md border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{section.label}</div>
                    <div className="text-sm text-muted-foreground">{section.records} active/control records</div>
                  </div>
                  <Badge variant={section.status === "ready" ? "secondary" : "outline"}>
                    {section.status === "ready" ? "Ready" : "Needs setup"}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {section.connectedTo.map((target) => (
                    <Badge key={target} variant="outline" className="font-normal">
                      {target}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <ControlCentreIssuePanel
        issues={issues}
        onScan={() => scanDataQuality.mutate()}
        isScanning={scanDataQuality.isPending || mdmHealth.isFetching || dataQualityIssues.isFetching}
      />
      <Tabs
        value={activeSection}
        onValueChange={(value) => setLocation(APP_ROUTES.admin.masterDataSection(value as typeof activeSection))}
        className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]"
      >
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Setup areas</CardTitle>
            <p className="text-sm text-muted-foreground">Grouped by where the data has operational impact.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <TabsList className="flex h-auto flex-col items-stretch gap-1 bg-transparent p-0">
              {(["Operations", "Procurement", "Finance", "Governance"] as const).map((group) => (
                <div key={group} className="contents">
                  <div className="px-2 pt-2 text-xs font-semibold uppercase text-muted-foreground first:pt-0">
                    {group}
                  </div>
                  {MASTER_SECTIONS.filter((section) => section.group === group).map((section) => {
                    const Icon = section.icon;
                    const summary = summaryRows.find((row) => row.slug === section.slug);
                    return (
                      <TabsTrigger
                        key={section.slug}
                        value={section.slug}
                        className="h-auto justify-between gap-2 rounded-md border px-3 py-2 text-left data-[state=active]:border-primary"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{section.shortLabel}</span>
                        </span>
                        {summary ? (
                          <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                            {summary.total}
                          </span>
                        ) : null}
                      </TabsTrigger>
                    );
                  })}
                  <Separator className="my-1" />
                </div>
              ))}
            </TabsList>
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-4">
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <ActiveIcon className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">{activeConfig.label}</h2>
              <Badge variant="outline">{activeConfig.group}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{activeConfig.description}</p>
          </div>
          {MASTER_SECTIONS.map((section) => (
            <TabsContent key={section.slug} value={section.slug} className="m-0">
              {section.slug === "warehouses" ? (
                <WarehouseMasterPanel />
              ) : section.slug === "approvalPolicies" ? (
                <ApprovalPoliciesRedirectCard />
              ) : (
                <MasterTable config={section} />
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
