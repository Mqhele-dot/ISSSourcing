import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
  Plus,
  MoreHorizontal,
  RefreshCw,
  Download,
  FileSpreadsheet,
  History,
  ScanSearch,
  GitPullRequest,
  type LucideIcon,
} from "lucide-react";
import type { MasterDataGovernanceOverview } from "@shared/master-data-governance-types";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES, MASTER_DATA_SECTION_SLUGS, asSectionSlug } from "@/lib/routes/app-routes";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageDataState } from "@/components/page-shell";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { WarehouseTable } from "@/pages/warehouses/warehouse-table";
import { WarehouseDialogs } from "@/pages/warehouses/warehouse-dialogs";
import { useWarehouseCrud } from "@/pages/warehouses/use-warehouse-crud";

import { invalidateMasterDataDomainForEndpoint } from "@/lib/domain-invalidation";

type BaseMasterRecord = {
  id: number;
  supplierId?: number | null;
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

type PaginatedMasterRecords = {
  items: BaseMasterRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  summary?: { active: number; inactive: number };
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
  governance?: {
    dataQualityChecks: number;
    makerCheckerRequiredFor: string[];
    standardRecordFields: string[];
  };
};

type MdmDomainRegistryEntry = {
  key: string;
  displayName: string;
  ownerRole: string;
  stewardRole: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiredPermissions: string[];
  requiredFields: string[];
  highRiskFields: string[];
  approvalRequiredFields: string[];
  whereUsedChecks: string[];
  supportedActions: string[];
  importExportSupport: string;
  auditRequired: boolean;
};

type MdmChangeRequest = {
  id: number;
  domain: string;
  entityId?: number | null;
  action: string;
  riskLevel: string;
  status: string;
  submittedBy?: number | null;
  approvedBy?: number | null;
  decidedAt?: string | null;
  appliedBy?: number | null;
  appliedAt?: string | null;
  failureReason?: string | null;
  reason?: string | null;
  proposedPatch?: Record<string, unknown> | null;
  beforeState?: Record<string, unknown> | null;
  appliedRecord?: Record<string, unknown> | null;
  createdAt?: string | null;
  steps?: Array<{
    id?: number;
    step?: string;
    status?: string;
    actorId?: number | null;
    reason?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    createdAt?: string | null;
  }>;
  comments?: Array<{
    id?: number;
    comment?: string | null;
    createdBy?: number | null;
    createdAt?: string | null;
  }>;
};

type MdmWhereUsedResult = {
  code: "MDM_DEPENDENCY_BLOCKED" | "MDM_NO_DEPENDENCIES";
  dependencies: Array<{ workflow: string; label: string; count: number; blocking: boolean }>;
  canArchive: boolean;
  canDeactivate: boolean;
  replacementAllowed: boolean;
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
    slug: "overview",
    label: "Governance Overview",
    shortLabel: "Overview",
    icon: Database,
    group: "Governance",
    description: "Health, ownership, approvals, duplicate candidates, where-used risk, and recent Master Data changes.",
    usedBy: ["Procurement", "Inventory", "Finance", "Logistics", "Analytics"],
    risk: "Unreviewed Master Data changes can affect every downstream transaction.",
  },
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
  createSignal = 0,
}: {
  config: MasterSectionConfig;
  createSignal?: number;
}) {
  const { toast } = useToast();
  useAuth();
  const { hasPermission, hasRole } = usePermissions();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [dependencyResponse, setDependencyResponse] = useState<string | null>(null);
  const [whereUsedResponse, setWhereUsedResponse] = useState<string | null>(null);
  const [changeRequestMode, setChangeRequestMode] = useState(false);
  const [changeRequestReason, setChangeRequestReason] = useState("");
  const [changeRequestBefore, setChangeRequestBefore] = useState<BaseMasterRecord | null>(null);
  const endpoint = config.endpoint ?? "";
  const canReadMasterData =
    hasPermission("master_data", "read") ||
    hasPermission("settings", "read") ||
    hasPermission("import_export", "read") ||
    hasRole(["manager", "admin"]);
  const canCreateMasterData =
    hasPermission("master_data", "create") || hasPermission("import_export", "import") || hasRole(["manager", "admin"]);
  const canUpdateMasterData =
    hasPermission("master_data", "update") || hasPermission("settings", "manage") || hasRole(["manager", "admin"]);
  const canDeleteMasterData =
    hasPermission("master_data", "delete") || hasPermission("settings", "admin") || hasRole("admin");
  const canSubmitChangeRequest =
    hasPermission("master_data", "create") || hasPermission("master_data", "update") || hasRole(["manager", "admin"]);
  const canApproveChangeRequest =
    hasPermission("master_data", "approve") || hasPermission("settings", "admin") || hasRole("admin");
  const canAdminOverride =
    hasPermission("master_data", "admin") || hasPermission("settings", "admin") || hasRole("admin");
  const disabledReason = !canReadMasterData
    ? "Your role can open this page but cannot read Master Data records."
    : "Your permissions do not allow this Master Data action.";
  const domainKey =
    config.slug === "units"
      ? "units-of-measure"
      : config.slug === "taxCodes"
        ? "tax-codes"
        : config.slug === "paymentTerms"
          ? "payment-terms"
          : config.slug;

  const pageSize = 25;
  const { data: pageData, isLoading } = useQuery<PaginatedMasterRecords>({
    queryKey: [endpoint, { search, statusFilter, page, pageSize }],
    queryFn: async () => {
      if (!endpoint) return { items: [], total: 0, page: 1, pageSize, hasNext: false };
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status: statusFilter,
      });
      if (search.trim()) params.set("q", search.trim());
      const raw = await requestJson<unknown>("GET", `${endpoint}?${params.toString()}`);
      if (raw && typeof raw === "object" && Array.isArray((raw as PaginatedMasterRecords).items)) {
        return raw as PaginatedMasterRecords;
      }
      const items = normalizeApiList<BaseMasterRecord>(raw);
      return { items, total: items.length, page: 1, pageSize, hasNext: false };
    },
    enabled: Boolean(endpoint),
  });
  const data = useMemo(() => pageData?.items ?? [], [pageData]);
  const totalRecords = pageData?.total ?? 0;

  const createRecord = useMutation({
    mutationFn: (payload: Record<string, unknown>) => requestJson("POST", endpoint, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      setDependencyResponse(null);
      setCode("");
      setName("");
      setExtraValues({});
      setShowEditor(false);
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
      setDependencyResponse(null);
      setEditingId(null);
      setCode("");
      setName("");
      setExtraValues({});
      setShowEditor(false);
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
      setDependencyResponse(null);
      toast({ title: `${config.label} removed` });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      setDependencyResponse(message);
      toast({
        title: `Failed to delete ${config.label.toLowerCase()}`,
        description: message,
        variant: "destructive",
      });
    },
  });

  const toggleRecord = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => requestJson("PATCH", `${endpoint}/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      setDependencyResponse(null);
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      setDependencyResponse(message);
      toast({
        title: `Failed to update ${config.label.toLowerCase()} status`,
        description: message,
        variant: "destructive",
      });
    },
  });

  const whereUsed = useMutation({
    mutationFn: (id: number) =>
      requestJson<MdmWhereUsedResult>("GET", `/api/mdm/${encodeURIComponent(domainKey)}/${id}/where-used`),
    onSuccess: (result) => {
      if (!result.dependencies.length) {
        setWhereUsedResponse("No active dependencies were found. This record can be archived or deactivated safely.");
        return;
      }
      setWhereUsedResponse(
        result.dependencies
          .map((dependency) => `${dependency.workflow}: ${dependency.count} ${dependency.label}`)
          .join("; "),
      );
    },
    onError: (e) => {
      setWhereUsedResponse(e instanceof Error ? e.message : String(e));
    },
  });

  const submitChangeRequest = useMutation({
    mutationFn: (payload: Record<string, unknown>) => requestJson("POST", "/api/mdm/change-requests", {
      domain: domainKey, entityId: editingId, action: editingId == null ? "create" : "update", proposedPatch: payload,
      beforeState: changeRequestBefore, reason: changeRequestReason.trim(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mdm/change-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/master-data/overview"] });
      toast({ title: "Governed change submitted", description: "The live record was not changed. The proposal is waiting in the maker-checker queue." });
      resetForm();
    },
    onError: (error) => toast({ title: "Change request failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const activeCount = pageData?.summary?.active ?? data.filter((row) => row.active !== false).length;
  const inactiveCount = pageData?.summary?.inactive ?? (data.length - activeCount);

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
  const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sorted;

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, endpoint]);

  useEffect(() => {
    if (createSignal > 0 && endpoint) {
      setEditingId(null); setCode(""); setName(""); setExtraValues({}); setShowEditor(true);
    }
  }, [createSignal, endpoint]);

  const extraFields = config.extraFields ?? [];
  const visibleExtraFields = extraFields.slice(0, config.slug === "currencies" ? 6 : 3);
  const nameLabel = config.primaryNameField === "description" ? "Description" : "Name";

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setExtraValues({});
    setWhereUsedResponse(null);
    setShowEditor(false);
    setChangeRequestMode(false);
    setChangeRequestReason("");
    setChangeRequestBefore(null);
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowDetails((value) => !value)}>
              {showDetails ? "Hide details" : "About this data"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => queryClient.invalidateQueries({ queryKey: [endpoint] })}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button type="button" size="sm" className="gap-2" disabled={!canCreateMasterData} onClick={() => { resetForm(); setShowEditor(true); }}>
              <Plus className="h-4 w-4" />
              Add record
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showDetails ? <div className="grid gap-3 pt-4 md:grid-cols-3">
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
              <span className="text-2xl font-semibold">{totalRecords}</span>
              <span className="pb-1 text-sm text-muted-foreground">records</span>
              {inactiveCount > 0 ? <Badge variant="outline">{inactiveCount} inactive</Badge> : null}
            </div>
          </div>
        </div> : null}

        {showDetails ? <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          Access mode: {canReadMasterData ? "read" : "limited"}
          {canSubmitChangeRequest ? " + submit change request" : ""}
          {canApproveChangeRequest ? " + approve/reject" : ""}
          {canAdminOverride ? " + admin override" : ""}.
        </div> : null}

        {!canCreateMasterData && !canUpdateMasterData ? (
          <div
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="master-data-permission-denied"
          >
            {disabledReason} Stewards and managers can submit governed change requests, approvers can approve or reject
            high-risk requests, and admin override remains explicit and audited.
          </div>
        ) : null}

        {dependencyResponse ? (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="master-data-dependency-response"
          >
            This Master Data change was blocked by a dependency or validation rule: {dependencyResponse}
          </div>
        ) : null}

        {whereUsedResponse ? (
          <div
            className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"
            data-testid="mdm-where-used-panel"
          >
            Where-used check: {whereUsedResponse}
          </div>
        ) : null}

        {showEditor ? <form
          className="rounded-md border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (editingId != null ? !canUpdateMasterData : !canCreateMasterData) {
              setDependencyResponse("MASTER_DATA_PERMISSION_DENIED");
              return;
            }
            if (!code.trim() || !name.trim()) {
              toast({ title: `Code and ${nameLabel.toLowerCase()} are required`, variant: "destructive" });
              return;
            }
            const payload = buildPayload();
            if (changeRequestMode) {
              if (changeRequestReason.trim().length < 5) { toast({ title:"Explain the business reason for this governed change", variant:"destructive" }); return; }
              submitChangeRequest.mutate(payload);
            } else if (editingId != null) {
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
          {changeRequestMode ? <div className="mt-3 space-y-1"><Label htmlFor={`${endpoint}-change-reason`}>Business reason for change</Label><Textarea id={`${endpoint}-change-reason`} value={changeRequestReason} onChange={(event)=>setChangeRequestReason(event.target.value)} placeholder="Explain the operational, compliance, or reporting reason and expected impact." rows={3}/><p className="text-xs text-muted-foreground">This proposal will not change the live record until independently approved and applied.</p></div> : null}
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
                  <Button
                    type="submit"
                    disabled={!canUpdateMasterData || updateRecord.isPending || submitChangeRequest.isPending}
                    title={!canUpdateMasterData ? disabledReason : undefined}
                    data-testid={changeRequestMode?"mdm-record-submit-button":undefined}
                  >
                    {changeRequestMode ? "Submit change request" : "Save changes"}
                  </Button>
                </>
              ) : (
                <Button
                  type="submit"
                  disabled={!canCreateMasterData || createRecord.isPending}
                  title={!canCreateMasterData ? disabledReason : undefined}
                >
                  Add record
                </Button>
              )}
          </div>
        </form> : null}

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
            <div className="overflow-hidden rounded-md border">
              <div className="max-w-full overflow-x-auto">
              <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
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
                {pageRows.map((row) => (
                  <TableRow key={row.id} data-testid="mdm-record-row">
                    <TableCell className="font-medium">{row.code}</TableCell>
                    <TableCell data-testid="mdm-record-status">
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
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={`Actions for ${row.code}`} data-testid="mdm-record-open-button">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{row.code}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={!canUpdateMasterData || updateRecord.isPending || deleteRecord.isPending}
                              onSelect={() => {
                                setEditingId(row.id);
                                setShowEditor(true);
                                setCode(row.code);
                                setName(recordDisplayName(row, config) === "-" ? "" : recordDisplayName(row, config));
                                const nextExtras: Record<string, string> = {};
                                for (const field of extraFields) {
                                  const value = row[field.key];
                                  nextExtras[String(field.key)] = value == null ? "" : String(value);
                                }
                                setExtraValues(nextExtras);
                              }}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!canSubmitChangeRequest} data-testid="mdm-record-submit-button" onSelect={()=>{setEditingId(row.id);setShowEditor(true);setChangeRequestMode(true);setChangeRequestBefore(row);setCode(row.code);setName(recordDisplayName(row,config)==="-"?"":recordDisplayName(row,config));const next:Record<string,string>={};for(const field of extraFields){next[String(field.key)]=row[field.key]==null?"":String(row[field.key]);}setExtraValues(next);}}>
                              Propose governed change
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={whereUsed.isPending} data-testid="mdm-record-where-used-button" onSelect={() => whereUsed.mutate(row.id)}>
                              Where used
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!canUpdateMasterData || toggleRecord.isPending}
                              onSelect={() => toggleRecord.mutate({ id: row.id, active: row.active === false })}
                              data-testid="mdm-record-block-button"
                            >
                              {row.active === false ? "Activate" : "Deactivate"}
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild><a href={`/admin/audit-logs?entity_type=${encodeURIComponent(domainKey)}&entity_id=${row.id}`} data-testid="mdm-record-audit-button">Audit trail</a></DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={!canDeleteMasterData || deleteRecord.isPending}
                              onSelect={() => deleteRecord.mutate(row.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {totalRecords === 0
                    ? "No records"
                    : `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalRecords)} of ${totalRecords}`}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="min-w-20 text-center text-muted-foreground">
                    Page {currentPage} of {pageCount}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!pageData?.hasNext}
                    onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WarehouseMasterPanel() {
  const crud = useWarehouseCrud();
  const [createWarehouseFormVariant, setCreateWarehouseFormVariant] = useState<"quick" | "full">("quick");
  const [showWarehouseDetails, setShowWarehouseDetails] = useState(false);
  const [warehouseSearch, setWarehouseSearch] = useState("");
  const [warehousePage, setWarehousePage] = useState(1);
  const warehousePageSize = 10;
  const filteredWarehouses = useMemo(() => {
    const query = warehouseSearch.trim().toLowerCase();
    if (!query) return crud.list;
    return crud.list.filter((warehouse) =>
      [warehouse.name, warehouse.location, warehouse.address, warehouse.contactPerson, warehouse.contactPhone]
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }, [crud.list, warehouseSearch]);
  const warehousePageCount = Math.max(1, Math.ceil(filteredWarehouses.length / warehousePageSize));
  const visibleWarehouses = useMemo(
    () => filteredWarehouses.slice((warehousePage - 1) * warehousePageSize, warehousePage * warehousePageSize),
    [filteredWarehouses, warehousePage],
  );

  useEffect(() => {
    setWarehousePage(1);
  }, [warehouseSearch]);

  useEffect(() => {
    setWarehousePage((current) => Math.min(current, warehousePageCount));
  }, [warehousePageCount]);

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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowWarehouseDetails((value) => !value)}>
              {showWarehouseDetails ? "Hide details" : "About this data"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => crud.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showWarehouseDetails ? <div className="grid gap-3 pt-4 md:grid-cols-3">
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
        </div> : null}

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

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={warehouseSearch}
            onChange={(event) => setWarehouseSearch(event.target.value)}
            placeholder="Search warehouses by name, location, address, or contact..."
            className="pl-9"
            aria-label="Search warehouses"
          />
        </div>

        <PageDataState
          isLoading={crud.isLoading}
          error={crud.isError ? (crud.error instanceof Error ? crud.error : new Error(String(crud.error))) : null}
          isEmpty={!crud.isLoading && !crud.isError && filteredWarehouses.length === 0}
          errorTitle="Failed to load warehouses"
          onRetry={() => crud.refetch()}
          emptyView={
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              {crud.list.length === 0 ? "No warehouses yet." : "No warehouses match this search."}
            </div>
          }
        >
          <div className="overflow-hidden rounded-md border">
            <div className="max-w-full overflow-x-auto">
              <WarehouseTable list={visibleWarehouses} onEdit={crud.openEditDialog} onDelete={crud.openDeleteDialog} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                Showing {(warehousePage - 1) * warehousePageSize + 1}-{Math.min(warehousePage * warehousePageSize, filteredWarehouses.length)} of {filteredWarehouses.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={warehousePage <= 1}
                  onClick={() => setWarehousePage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="min-w-20 text-center text-muted-foreground">
                  Page {warehousePage} of {warehousePageCount}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={warehousePage >= warehousePageCount}
                  onClick={() => setWarehousePage((page) => Math.min(warehousePageCount, page + 1))}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
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

function CarrierDirectoryPanel() {
  const { data, isLoading, isError, refetch } = useQuery<PaginatedMasterRecords>({
    queryKey: [MASTER_ENDPOINTS.carriers, { page: 1, pageSize: 100, status: "all" }],
    queryFn: () => requestJson<PaginatedMasterRecords>("GET", `${MASTER_ENDPOINTS.carriers}?page=1&pageSize=100&status=all`),
  });
  const carriers = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b bg-muted/20">
        <div>
          <CardTitle>Carrier supplier profiles</CardTitle>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Carriers are supplier roles, not a second business-party list. Create and maintain their legal, compliance,
            commercial, and payment data in Suppliers; Logistics consumes the synchronized carrier profile.
          </p>
        </div>
        <Button asChild>
          <Link href={APP_ROUTES.procurement.suppliers}>Open Suppliers</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">Loading carrier suppliers…</div> : null}
        {isError ? (
          <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-5 text-center">
            <p className="font-medium text-destructive">Carrier directory unavailable</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : null}
        {!isLoading && !isError && carriers.length === 0 ? (
          <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
            No carrier suppliers are configured. Add a supplier and select “Carrier / logistics provider” as its type.
          </div>
        ) : null}
        {!isLoading && !isError ? carriers.map((carrier) => (
          <div key={carrier.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="font-medium">{carrier.code} - {carrier.name}</p>
              <p className="text-sm text-muted-foreground">{carrier.contact || "No logistics contact"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={carrier.active === false ? "outline" : "secondary"}>
                {carrier.active === false ? "Inactive" : "Active"}
              </Badge>
              {carrier.supplierId ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={APP_ROUTES.procurement.supplier(carrier.supplierId)}>View supplier</Link>
                </Button>
              ) : (
                <Badge variant="outline">Legacy record — not linked</Badge>
              )}
            </div>
          </div>
        )) : null}
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
    <Card id="mdm-data-quality-panel" data-testid="mdm-data-quality-panel">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
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

function ControlCentreGovernancePanel({
  registry,
  changeRequests,
  health,
}: {
  registry: MdmDomainRegistryEntry[];
  changeRequests: MdmChangeRequest[];
  health?: MdmControlCentreHealth;
}) {
  const { toast } = useToast();
  const { hasPermission, hasRole } = usePermissions();
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(changeRequests[0]?.id ?? null);
  const [comment, setComment] = useState("");
  const canApproveChangeRequest =
    hasPermission("master_data", "approve") || hasPermission("settings", "update") || hasRole(["admin", "manager"]);
  const canApplyChangeRequest =
    hasPermission("master_data", "execute") || hasPermission("settings", "update") || hasRole(["admin", "manager"]);
  const canCommentOnChangeRequest =
    hasPermission("master_data", "update") || hasPermission("settings", "update") || hasRole(["admin", "manager"]);
  const canAdminOverride = hasRole("admin") && hasPermission("settings", "update");
  const highRiskDomains = registry.filter((domain) => domain.riskLevel === "critical" || domain.riskLevel === "high");
  const pendingRequests = changeRequests.filter((request) =>
    ["submitted", "validation_passed", "pending_approval"].includes(String(request.status ?? "").toLowerCase()),
  );
  const selectedSummary =
    changeRequests.find((request) => Number(request.id) === Number(selectedRequestId)) ?? changeRequests[0] ?? null;
  const selectedDetail = useQuery({
    queryKey: ["/api/mdm/change-requests", selectedSummary?.id],
    enabled: selectedSummary?.id != null,
    queryFn: () => requestJson<MdmChangeRequest>("GET", `/api/mdm/change-requests/${selectedSummary!.id}`),
  });
  const selectedRequest = selectedDetail.data ?? selectedSummary;
  const selectedStatus = String(selectedRequest?.status ?? "").toLowerCase();
  const showApproveReject = Boolean(selectedRequest) && ["submitted", "validation_passed", "pending_approval"].includes(selectedStatus);
  const showApply = Boolean(selectedRequest) && selectedStatus === "approved";
  const unauthorizedReason = "You need the domain steward, approver, or admin permission for this Master Data action.";

  const refreshChangeRequests = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/mdm/change-requests"] });
    if (selectedRequest?.id != null) {
      await queryClient.invalidateQueries({ queryKey: ["/api/mdm/change-requests", selectedRequest.id] });
    }
  };
  const runChangeRequestAction = useMutation({
    mutationFn: async (input: { action: "approve" | "reject" | "apply"; reason: string; allowAdminOverride?: boolean }) => {
      if (!selectedRequest) throw new Error("Select a change request first.");
      return requestJson<MdmChangeRequest>("POST", `/api/mdm/change-requests/${selectedRequest.id}/${input.action}`, {
        reason: input.reason,
        allowAdminOverride: input.allowAdminOverride === true,
      });
    },
    onSuccess: async (_data, variables) => {
      await refreshChangeRequests();
      toast({ title: `MDM change request ${variables.action}d` });
    },
    onError: (error) => {
      toast({
        title: "MDM change request action failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });
  const addComment = useMutation({
    mutationFn: async () => {
      if (!selectedRequest) throw new Error("Select a change request first.");
      return requestJson("POST", `/api/mdm/change-requests/${selectedRequest.id}/comments`, { comment });
    },
    onSuccess: async () => {
      setComment("");
      await refreshChangeRequests();
      toast({ title: "MDM comment added" });
    },
    onError: (error) => {
      toast({
        title: "MDM comment failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="grid gap-4 xl:grid-cols-3" data-testid="master-data-governance-dashboard">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Domain governance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ownership, stewardship, risk, permissions, unique keys, audit, import/export, and where-used rules.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-xl font-semibold">{registry.length}</div>
              <div className="text-muted-foreground">domains</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xl font-semibold">{highRiskDomains.length}</div>
              <div className="text-muted-foreground">high risk</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xl font-semibold">{health?.governance?.dataQualityChecks ?? 0}</div>
              <div className="text-muted-foreground">DQ checks</div>
            </div>
          </div>
          <div className="max-h-48 space-y-2 overflow-auto pr-1">
            {highRiskDomains.slice(0, 8).map((domain) => (
              <div key={domain.key} className="rounded-md border bg-background p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{domain.displayName}</span>
                  <Badge variant={domain.riskLevel === "critical" ? "destructive" : "secondary"}>
                    {domain.riskLevel}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Owner: {domain.ownerRole} | Steward: {domain.stewardRole}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Maker-checker queue</CardTitle>
          <p className="text-sm text-muted-foreground">
            High-risk supplier bank, tax, GL, UOM, payment-term, contract-currency, approval, and warehouse status
            changes require approval.
          </p>
        </CardHeader>
        <CardContent className="space-y-2" data-testid="master-data-change-requests">
          {pendingRequests.length === 0 ? (
            <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              No pending high-risk change requests.
            </div>
          ) : (
            pendingRequests.slice(0, 6).map((request) => (
              <button
                type="button"
                key={request.id}
                className="w-full rounded-md border bg-background p-2 text-left text-sm transition hover:border-primary"
                data-testid={`mdm-change-request-row-${request.id}`}
                onClick={() => setSelectedRequestId(request.id)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {request.domain} #{request.entityId ?? "new"}
                  </span>
                  <Badge variant={request.riskLevel === "critical" ? "destructive" : "secondary"}>
                    {request.status}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{request.action}</div>
              </button>
            ))
          )}
          {selectedRequest ? (
            <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-3" data-testid="mdm-change-request-detail">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {selectedRequest.domain} #{selectedRequest.entityId ?? "new"} steward review
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Status: {selectedRequest.status} | Action: {selectedRequest.action}
                  </p>
                </div>
                <Badge variant={selectedStatus === "failed_to_apply" ? "destructive" : "outline"}>
                  {selectedRequest.status}
                </Badge>
              </div>
              {selectedStatus === "failed_to_apply" ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm" data-testid="mdm-failed-apply-reason">
                  Failed to apply: {selectedRequest.failureReason ?? "No failure reason was recorded."}
                </div>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2" data-testid="mdm-before-after-diff">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Before</p>
                  <pre className="max-h-40 overflow-auto rounded-md bg-background p-2 text-xs">
                    {JSON.stringify(selectedRequest.beforeState ?? {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">After</p>
                  <pre className="max-h-40 overflow-auto rounded-md bg-background p-2 text-xs">
                    {JSON.stringify(selectedRequest.proposedPatch ?? selectedRequest.appliedRecord ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
              <div data-testid="mdm-step-timeline">
                <p className="text-xs font-medium uppercase text-muted-foreground">Step timeline</p>
                <div className="mt-1 space-y-1">
                  {(selectedRequest.steps ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No lifecycle steps recorded yet.</p>
                  ) : (
                    (selectedRequest.steps ?? []).map((step, index) => (
                      <div key={step.id ?? index} className="rounded border bg-background p-2 text-xs">
                        <span className="font-medium">{step.step ?? "step"}</span> | {step.status ?? "recorded"} | actor{" "}
                        {step.actorId ?? "system"} {step.reason ? `| ${step.reason}` : ""}
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div data-testid="mdm-comment-box">
                <Label htmlFor="mdm-change-comment">Comment</Label>
                <Textarea
                  id="mdm-change-comment"
                  value={comment}
                  disabled={!canCommentOnChangeRequest}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder={canCommentOnChangeRequest ? "Add steward note or approval context" : unauthorizedReason}
                  rows={2}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canCommentOnChangeRequest || !comment.trim() || addComment.isPending}
                    title={!canCommentOnChangeRequest ? unauthorizedReason : undefined}
                    onClick={() => addComment.mutate()}
                  >
                    Add comment
                  </Button>
                  {showApproveReject ? (
                    <>
                      <Button
                        size="sm"
                        disabled={!canApproveChangeRequest || runChangeRequestAction.isPending}
                        title={!canApproveChangeRequest ? unauthorizedReason : undefined}
                        data-testid="mdm-change-request-approve-button"
                        onClick={() =>
                          runChangeRequestAction.mutate({ action: "approve", reason: "Approved in Control Centre" })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canApproveChangeRequest || runChangeRequestAction.isPending}
                        title={!canApproveChangeRequest ? unauthorizedReason : undefined}
                        data-testid="mdm-change-request-reject-button"
                        onClick={() =>
                          runChangeRequestAction.mutate({ action: "reject", reason: "Rejected in Control Centre" })
                        }
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {showApply ? (
                    <Button
                      size="sm"
                      disabled={!canApplyChangeRequest || runChangeRequestAction.isPending}
                      title={!canApplyChangeRequest ? unauthorizedReason : undefined}
                      data-testid="mdm-apply-change-request"
                      onClick={() => runChangeRequestAction.mutate({ action: "apply", reason: "Applied in Control Centre" })}
                    >
                      Apply approved change
                    </Button>
                  ) : null}
                  {canAdminOverride ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={runChangeRequestAction.isPending}
                      data-testid="mdm-admin-override-warning"
                      onClick={() =>
                        runChangeRequestAction.mutate({
                          action: selectedStatus === "approved" ? "apply" : "approve",
                          reason: "Explicit admin override from Master Data Control Centre",
                          allowAdminOverride: true,
                        })
                      }
                    >
                      Admin override
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1" data-testid="mdm-change-comments">
                {(selectedRequest.comments ?? []).map((entry, index) => (
                  <div key={entry.id ?? index} className="rounded border bg-background p-2 text-xs">
                    {entry.comment} | by {entry.createdBy ?? "system"}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Standard record model</CardTitle>
          <p className="text-sm text-muted-foreground">
            Typed domain tables stay intact, but adapters expose tenant, lifecycle, audit, version, source, and archive
            fields.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5" data-testid="master-data-standard-record-fields">
            {(health?.governance?.standardRecordFields ?? []).map((field) => (
              <Badge key={field} variant="outline">
                {field}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GovernanceOverviewPanel({ overview, onReviewApprovals, onScan }: {
  overview?: MasterDataGovernanceOverview;
  onReviewApprovals: () => void;
  onScan: () => void;
}) {
  if (!overview) return <div className="rounded-lg border p-6 text-sm text-muted-foreground">Loading governance overview...</div>;
  const text = (row: Record<string, unknown>, key: string, fallback = "-") => String(row[key] ?? fallback);
  return <div className="space-y-4" data-testid="mdm-tab-overview">
    {overview.meta.partialFailures.length ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      Some governance sources are unavailable. Available results remain visible; retry before making a high-risk change.
    </div> : null}
    <Card>
      <CardHeader><CardTitle className="text-base">Master Data domains</CardTitle><p className="text-sm text-muted-foreground">Open the source-of-truth area and see which workflows depend on it.</p></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {overview.domains.map((domain) => <a key={domain.key} id={domain.key==="documents"?"numbering-documents":undefined} href={domain.href} className="rounded-lg border bg-background p-3 transition hover:border-primary" data-testid={`mdm-domain-${domain.key}`}>
          <div className="flex items-start justify-between gap-3"><div className="font-medium">{domain.label}</div><Badge variant={domain.blocked ? "outline" : "secondary"}>{domain.active} active</Badge></div>
          <div className="mt-2 text-sm text-muted-foreground">{domain.total} records{domain.draft ? ` · ${domain.draft} draft` : ""}{domain.blocked ? ` · ${domain.blocked} blocked/inactive` : ""}</div>
          <div className="mt-3 flex flex-wrap gap-1">{domain.usedBy.slice(0, 4).map((item) => <Badge key={item} variant="outline" className="font-normal">{item}</Badge>)}</div>
        </a>)}
      </CardContent>
    </Card>
    <div className="grid gap-4 xl:grid-cols-2">
      <Card id="mdm-approval-queue"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">Change requests and approvals</CardTitle><p className="text-sm text-muted-foreground">Sensitive proposals waiting for independent review or application.</p></div><Button size="sm" variant="outline" onClick={onReviewApprovals}>Review queue</Button></div></CardHeader><CardContent className="space-y-2">
        {overview.pendingChanges.length === 0 ? <p className="text-sm text-muted-foreground">No Master Data changes are awaiting action.</p> : overview.pendingChanges.slice(0, 6).map((row) => <div key={text(row,"id")} className="rounded-md border p-3" data-testid="mdm-change-request-row"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{text(row,"domain")} #{text(row,"entityId","new")}</span><Badge variant={text(row,"riskLevel") === "critical" ? "destructive" : "outline"}>{text(row,"status")}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{text(row,"action")} · requested by {text(row,"requestedBy","System")}</p><p className="mt-1 text-sm">{text(row,"reason","No reason supplied")}</p></div>)}
      </CardContent></Card>
      <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">Data quality alerts</CardTitle><p className="text-sm text-muted-foreground">Problems that can make transactions or reporting unreliable.</p></div><Button size="sm" variant="outline" onClick={onScan}><ScanSearch className="mr-2 h-4 w-4"/>Run scan</Button></div></CardHeader><CardContent className="space-y-2">
        {overview.qualityIssues.length === 0 ? <p className="text-sm text-muted-foreground">No current Master Data quality issue was found.</p> : overview.qualityIssues.slice(0, 6).map((row) => <div key={`${text(row,"issueCode")}-${text(row,"affectedEntityId")}`} className="rounded-md border p-3" data-testid="mdm-data-quality-issue-row"><div className="flex flex-wrap items-center gap-2"><Badge variant={text(row,"severity") === "error" ? "destructive" : "outline"}>{text(row,"severity")}</Badge><span className="font-medium">{text(row,"title")}</span></div><p className="mt-1 text-sm text-muted-foreground">{text(row,"message")}</p></div>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Duplicate candidates</CardTitle><p className="text-sm text-muted-foreground">Potential duplicate identities require review before merge or blocking.</p></CardHeader><CardContent className="space-y-2">
        {overview.duplicateCandidates.length === 0 ? <p className="text-sm text-muted-foreground">No unresolved duplicate candidate was found.</p> : overview.duplicateCandidates.map((row) => <div key={text(row,"id")} className="rounded-md border p-3" data-testid="mdm-duplicate-candidate-row"><div className="font-medium">{text(row,"title")}</div><p className="mt-1 text-sm text-muted-foreground">{text(row,"message")}</p><p className="mt-2 text-sm">{text(row,"recommendedAction")}</p></div>)}
      </CardContent></Card>
      <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">Recent amendment trail</CardTitle><p className="text-sm text-muted-foreground">Who changed controlled data, what changed, and when.</p></div><Button asChild size="sm" variant="outline"><a href="/admin/audit-logs?entity_type=master_data">Open audit trail</a></Button></div></CardHeader><CardContent className="space-y-2" data-testid="mdm-audit-trail-panel">
        {overview.auditHighlights.length === 0 ? <p className="text-sm text-muted-foreground">No recent Master Data amendment was recorded.</p> : overview.auditHighlights.slice(0, 6).map((row) => <div key={text(row,"id")} className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{text(row,"domain")} #{text(row,"recordId","new")}</span><Badge variant="outline">{text(row,"action")}</Badge></div><p className="mt-1 text-sm">{text(row,"summary","Controlled record updated")}</p><p className="mt-1 text-xs text-muted-foreground">{text(row,"changedBy","System")} · {row.changedAt ? new Date(String(row.changedAt)).toLocaleString() : "Time unavailable"}</p></div>)}
      </CardContent></Card>
    </div>
  </div>;
}

function NewChangeRequestComposer({ registry, onClose, onCreated }: { registry: MdmDomainRegistryEntry[]; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [domain,setDomain] = useState(registry[0]?.key ?? "suppliers");
  const [entityId,setEntityId] = useState("");
  const [action,setAction] = useState<"create"|"update"|"deactivate"|"archive">("update");
  const [field,setField] = useState(""); const [value,setValue] = useState(""); const [reason,setReason] = useState("");
  const submit = useMutation({ mutationFn: () => {
    const proposedPatch: Record<string, unknown> = action === "deactivate" ? { active:false, status:"inactive" } : action === "archive" ? { active:false, status:"archived" } : field.trim() ? { [field.trim()]: value } : {};
    if (!domain || reason.trim().length < 5 || ((action === "update" || action === "create") && !field.trim())) throw new Error("Choose a domain, enter the changed field, and explain the business reason.");
    return requestJson("POST","/api/mdm/change-requests",{domain,entityId:entityId?Number(entityId):null,action,proposedPatch,reason:reason.trim()});
  }, onSuccess:()=>{toast({title:"Master Data change request submitted",description:"The proposal is now visible in the maker-checker queue."});onCreated();onClose();}, onError:(error)=>toast({title:"Change request could not be submitted",description:error instanceof Error?error.message:String(error),variant:"destructive"}) });
  return <Card data-testid="master-data-new-change-request"><CardHeader><CardTitle className="text-base">New governed change request</CardTitle><p className="text-sm text-muted-foreground">Propose a controlled change without altering the live record. Sensitive changes require independent approval.</p></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" onSubmit={(event)=>{event.preventDefault();submit.mutate();}}>
    <div className="space-y-1"><Label htmlFor="mdm-request-domain">Domain</Label><select id="mdm-request-domain" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={domain} onChange={(event)=>setDomain(event.target.value)}>{registry.map((entry)=><option key={entry.key} value={entry.key}>{entry.displayName}</option>)}</select></div>
    <div className="space-y-1"><Label htmlFor="mdm-request-action">Request type</Label><select id="mdm-request-action" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={action} onChange={(event)=>setAction(event.target.value as typeof action)}><option value="create">Create record</option><option value="update">Update record</option><option value="deactivate">Block / deactivate</option><option value="archive">Archive</option></select></div>
    <div className="space-y-1"><Label htmlFor="mdm-request-entity">Record ID (if existing)</Label><Input id="mdm-request-entity" type="number" min="1" value={entityId} onChange={(event)=>setEntityId(event.target.value)}/></div>
    {(action==="create"||action==="update")?<><div className="space-y-1"><Label htmlFor="mdm-request-field">Field to change</Label><Input id="mdm-request-field" value={field} onChange={(event)=>setField(event.target.value)} placeholder="e.g. paymentTermsId"/></div><div className="space-y-1"><Label htmlFor="mdm-request-value">Proposed value</Label><Input id="mdm-request-value" value={value} onChange={(event)=>setValue(event.target.value)}/></div></>:null}
    <div className="space-y-1 md:col-span-2 xl:col-span-3"><Label htmlFor="mdm-request-reason">Business reason</Label><Textarea id="mdm-request-reason" value={reason} onChange={(event)=>setReason(event.target.value)} placeholder="Explain why the change is required and its expected impact." rows={3}/></div>
    <div className="flex gap-2 md:col-span-2 xl:col-span-3"><Button type="submit" disabled={submit.isPending}>Submit for governance</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
  </form></CardContent></Card>;
}

export default function MasterDataPage() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [showGovernance, setShowGovernance] = useState(false);
  const [showChangeRequest, setShowChangeRequest] = useState(false);
  const [createSignal, setCreateSignal] = useState(0);
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const activeSection = asSectionSlug(location.split("/")[3], MASTER_DATA_SECTION_SLUGS, "overview");
  const activeConfig = sectionBySlug(activeSection);

  const governanceOverview = useQuery({
    queryKey: ["/api/master-data/overview"],
    queryFn: () => requestJson<MasterDataGovernanceOverview>("GET", "/api/master-data/overview"),
    staleTime: 60_000,
  });

  const mdmHealth = useQuery({
    queryKey: ["/api/mdm/control-centre/health"],
    queryFn: () => requestJson<MdmControlCentreHealth>("GET", "/api/mdm/control-centre/health"),
    staleTime: 60_000,
  });

  const dataQualityIssues = useQuery({
    queryKey: ["/api/mdm/data-quality/issues"],
    queryFn: () => requestJson<MdmQualityIssue[]>("GET", "/api/mdm/data-quality/issues"),
    staleTime: 60_000,
    enabled: showGovernance,
  });

  const mdmRegistry = useQuery({
    queryKey: ["/api/mdm/domain-registry"],
    queryFn: () => requestJson<MdmDomainRegistryEntry[]>("GET", "/api/mdm/domain-registry"),
    staleTime: 300_000,
    enabled: showGovernance || showChangeRequest,
  });

  const mdmChangeRequests = useQuery({
    queryKey: ["/api/mdm/change-requests"],
    queryFn: () => requestJson<MdmChangeRequest[]>("GET", "/api/mdm/change-requests"),
    staleTime: 60_000,
    enabled: showGovernance,
  });

  const scanDataQuality = useMutation({
    mutationFn: () => requestJson("POST", "/api/mdm/data-quality/scan", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-data/overview"] });
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
  const registry = mdmRegistry.data ?? [];
  const changeRequests = mdmChangeRequests.data ?? [];
  const issues = dataQualityIssues.data ?? health?.topIssues ?? [];
  const issueCount = health
    ? health.issueCounts.error + health.issueCounts.warning + health.issueCounts.info
    : issues.length;
  const overview = governanceOverview.data;
  const kpis = overview?.kpis;
  const governanceKpiCards: Array<[string, string, number, LucideIcon]> = [
    ["mdm-kpi-total-records", "Total master records", kpis?.totalRecords ?? totalRecords, Database],
    ["mdm-kpi-draft-records", "Draft records", kpis?.draftRecords ?? 0, FileSpreadsheet],
    ["mdm-kpi-pending-approval", "Pending approval", kpis?.pendingApproval ?? 0, ShieldCheck],
    ["mdm-kpi-active-records", "Active records", kpis?.activeRecords ?? totalActive, CheckCircle2],
    ["mdm-kpi-blocked-records", "Blocked / inactive", kpis?.blockedRecords ?? Math.max(0,totalRecords-totalActive), AlertTriangle],
    ["mdm-kpi-data-quality-issues", "Data quality issues", kpis?.dataQualityIssues ?? (issueCount || setupGaps), ScanSearch],
    ["mdm-kpi-high-risk-changes", "High-risk changes", kpis?.highRiskChanges ?? 0, GitPullRequest],
    ["mdm-kpi-duplicate-candidates", "Duplicate candidates", kpis?.duplicateCandidates ?? 0, Layers3],
  ];

  function downloadText(fileName: string, content: string, type = "text/csv;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    const fields = ["code", activeConfig.primaryNameField ?? "name", ...(activeConfig.extraFields ?? []).map((field) => String(field.key)), "status", "effectiveFrom", "effectiveTo"];
    downloadText(`master-data-${activeSection}-template.csv`, `${[...new Set(fields)].join(",")}\n`);
  }

  function exportGovernance() {
    if (!overview) return;
    const rows = ["domain,total,active,draft,blocked", ...overview.domains.map((domain) => [domain.label,domain.total,domain.active,domain.draft,domain.blocked].map((value)=>`"${String(value).replace(/"/g,'""')}"`).join(","))];
    downloadText(`master-data-governance-${new Date().toISOString().slice(0,10)}.csv`, rows.join("\n"));
  }

  function openApprovalQueue() {
    setShowGovernance(true);
    setLocation(APP_ROUTES.admin.masterDataSection("overview"));
    window.setTimeout(() => document.getElementById("mdm-approval-queue")?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
  }

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
        title="Master Data Governance"
        subtitle="Manage the controlled business data used across procurement, inventory, suppliers, logistics, finance, analytics, and approvals."
        actions={<div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={()=>{if(activeSection==="overview"){setLocation(APP_ROUTES.admin.masterDataSection("units"));}setCreateSignal((value)=>value+1);}} data-testid="master-data-create-button"><Plus className="mr-2 h-4 w-4"/>Create record</Button>
          <Button size="sm" variant="outline" onClick={()=>{setShowGovernance(true);setShowChangeRequest((value)=>!value);}} data-testid="master-data-new-change-request-button"><GitPullRequest className="mr-2 h-4 w-4"/>New change request</Button>
          <Button size="sm" variant="outline" onClick={openApprovalQueue} data-testid="master-data-review-approvals-button"><ShieldCheck className="mr-2 h-4 w-4"/>Approvals{kpis?.pendingApproval ? ` (${kpis.pendingApproval})` : ""}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><MoreHorizontal className="mr-2 h-4 w-4"/>More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Master Data tools</DropdownMenuLabel>
              <DropdownMenuItem onSelect={downloadTemplate} data-testid="master-data-import-button"><FileSpreadsheet className="mr-2 h-4 w-4"/>Download import template</DropdownMenuItem>
              <DropdownMenuItem onSelect={exportGovernance} disabled={!overview} data-testid="master-data-export-button"><Download className="mr-2 h-4 w-4"/>Export summary</DropdownMenuItem>
              <DropdownMenuSeparator/>
              <DropdownMenuItem onSelect={()=>scanDataQuality.mutate()} disabled={scanDataQuality.isPending} data-testid="master-data-quality-scan-button"><ScanSearch className="mr-2 h-4 w-4"/>Run data quality scan</DropdownMenuItem>
              <DropdownMenuItem asChild data-testid="master-data-audit-trail-button"><a href="/admin/audit-logs?entity_type=master_data"><History className="mr-2 h-4 w-4"/>Open audit trail</a></DropdownMenuItem>
              <DropdownMenuItem onSelect={()=>{void governanceOverview.refetch();void mdmHealth.refetch();void summaryQueries.refetch();}} data-testid="master-data-refresh-button"><RefreshCw className="mr-2 h-4 w-4"/>Refresh workspace</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>}
      />
      {showChangeRequest ? <NewChangeRequestComposer registry={registry.length?registry:mdmRegistry.data??[]} onClose={()=>setShowChangeRequest(false)} onCreated={()=>{void mdmChangeRequests.refetch();void governanceOverview.refetch();}}/> : null}
      <Card className="p-2">
        <CardContent className="grid grid-cols-2 gap-2 p-0 md:grid-cols-4 2xl:grid-cols-8">
          {governanceKpiCards.map(([testId,label,value,Icon])=><div key={testId} className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2.5" data-testid={testId}><Icon className="h-4 w-4 shrink-0 text-primary"/><div className="min-w-0"><div className="text-lg font-semibold leading-5 tabular-nums">{governanceOverview.isLoading?"-":String(value)}</div><div className="truncate text-xs text-muted-foreground" title={label}>{label}</div></div></div>)}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2" aria-label="Master Data workspace navigation">
        <Button asChild size="sm" variant={activeSection==="overview"?"default":"ghost"} data-testid="mdm-tab-overview"><a href="/admin/master-data/overview">Overview</a></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><Database className="mr-2 h-4 w-4"/>{activeSection==="overview"?"Browse setup areas":activeConfig.shortLabel}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[28rem] w-72 overflow-y-auto">
            {(["Operations", "Procurement", "Finance", "Governance"] as const).map((group)=><div key={group}>
              <DropdownMenuLabel>{group}</DropdownMenuLabel>
              {MASTER_SECTIONS.filter((section)=>section.group===group && section.slug!=="overview").map((section)=>{const Icon=section.icon;const summary=summaryRows.find((row)=>row.slug===section.slug);return <DropdownMenuItem key={section.slug} onSelect={()=>setLocation(APP_ROUTES.admin.masterDataSection(section.slug))}><Icon className="mr-2 h-4 w-4"/><span className="flex-1">{section.shortLabel}</span>{summary?<Badge variant="outline" className="ml-2">{summary.total}</Badge>:null}</DropdownMenuItem>;})}
              {group!=="Governance"?<DropdownMenuSeparator/>:null}
            </div>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true"/>
        <Button size="sm" variant="ghost" onClick={openApprovalQueue}><ShieldCheck className="mr-2 h-4 w-4"/>Approval queue</Button>
        <Button size="sm" variant="ghost" onClick={()=>{setShowGovernance(true);window.setTimeout(()=>document.getElementById("mdm-data-quality-panel")?.scrollIntoView({behavior:"smooth",block:"start"}),100);}}><ScanSearch className="mr-2 h-4 w-4"/>Quality issues {issueCount?`(${issueCount})`:""}</Button>
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setShowGovernance((value) => !value)}>{showGovernance ? "Hide controls" : "Governance controls"}</Button>
      </div>
      {showGovernance && health?.sections?.length ? (
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
      {showGovernance ? (
        <>
          <ControlCentreGovernancePanel registry={registry} changeRequests={changeRequests} health={health} />
          <ControlCentreIssuePanel
            issues={issues}
            onScan={() => scanDataQuality.mutate()}
            isScanning={scanDataQuality.isPending || mdmHealth.isFetching || dataQualityIssues.isFetching}
          />
        </>
      ) : null}
      <Tabs
        value={activeSection}
        onValueChange={(value) => setLocation(APP_ROUTES.admin.masterDataSection(value as typeof activeSection))}
        className="min-w-0"
      >
        <div className="min-w-0 space-y-4">
          {MASTER_SECTIONS.map((section) => (
            <TabsContent key={section.slug} value={section.slug} className="m-0">
              {section.slug === "overview" ? (
                <GovernanceOverviewPanel overview={overview} onReviewApprovals={openApprovalQueue} onScan={()=>scanDataQuality.mutate()} />
              ) : section.slug === "warehouses" ? (
                <WarehouseMasterPanel />
              ) : section.slug === "approvalPolicies" ? (
                <ApprovalPoliciesRedirectCard />
              ) : section.slug === "carriers" ? (
                <CarrierDirectoryPanel />
              ) : (
                <MasterTable config={section} createSignal={activeSection===section.slug?createSignal:0} />
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
