export const ANALYTICS_SECTION_SLUGS = [
  "overview",
  "inventory",
  "procurement",
  "finance",
  "logistics",
  "reports",
  "saved-reports",
  "export-center",
] as const;

export const REPORT_SECTION_SLUGS = [
  "inventory",
  "low-stock",
  "value",
  "purchase-orders",
  "purchase-requisitions",
  "suppliers",
  "reorder-requests",
  "invoices",
  "shipments",
] as const;

export const SETTINGS_SECTION_SLUGS = [
  "general",
  "inventory",
  "realtime",
  "database",
  "forecasting",
  "tax",
  "billing",
  "configuration",
  "warehouses",
  "security",
] as const;

export const MASTER_DATA_SECTION_SLUGS = [
  "units",
  "currencies",
  "taxCodes",
  "commodityCodes",
  "incoterms",
  "paymentTerms",
  "departments",
  "warehouses",
  "carriers",
  "approvalPolicies",
] as const;

export const DOCUMENT_EXTRACTOR_SECTION_SLUGS = [
  "single",
  "batch",
  "url",
  "import",
  "options",
] as const;

export type AnalyticsSectionSlug = (typeof ANALYTICS_SECTION_SLUGS)[number];
export type ReportSectionSlug = (typeof REPORT_SECTION_SLUGS)[number];
export type SettingsSectionSlug = (typeof SETTINGS_SECTION_SLUGS)[number];
export type MasterDataSectionSlug = (typeof MASTER_DATA_SECTION_SLUGS)[number];
export type DocumentExtractorSectionSlug = (typeof DOCUMENT_EXTRACTOR_SECTION_SLUGS)[number];

export const APP_ROUTES = {
  home: "/",
  auth: "/auth",
  /** First-run product wizard (currency, warehouse, tax, starter master data). */
  setup: {
    product: "/setup",
  },
  operations: {
    /** Desktop operations hub (cards + links; stays in desktop shell). */
    root: "/operations",
    /** Desktop page that explains and links into the `/m/*` mobile workflow shell. */
    mobileWorkflows: "/operations/mobile-workflows",
    controlTower: "/operations/control-tower",
    logistics: "/operations/logistics",
    shipment: (id: string | number) => `/operations/logistics/${id}`,
    exceptions: "/operations/exceptions",
    mobileHub: "/m/home",
    mobileTasks: "/m/tasks",
    mobileCounts: "/m/counts",
    mobileCount: (id: string | number) => `/m/counts/${encodeURIComponent(String(id))}`,
    mobileCountReview: (id: string | number) => `/m/counts/${encodeURIComponent(String(id))}/review`,
    mobileCountSpot: "/m/counts/spot",
    mobileScan: "/m/scan",
    mobileApprovals: "/m/approvals",
    mobileMore: "/m/more",
    mobileReceive: "/m/receive",
    mobilePick: "/m/pick",
  },
  inventory: {
    root: "/inventory",
    /** Build a link to a SKU detail URL; encodes the segment for reserved URL characters. Do not use for Wouter `path` — use `` `/inventory/:sku` ``. */
    item: (sku: string) => `/inventory/${encodeURIComponent(sku)}`,
    reorder: "/inventory/reorder",
    barcodeScanner: "/inventory/barcodes",
    warehouses: "/inventory/warehouses",
    warehouse: (id: string | number) => `/inventory/warehouses/${id}`,
    cycleCounts: "/inventory/cycle-counts",
    warehouseOperations: "/inventory/warehouse-operations",
  },
  procurement: {
    orders: "/procurement/orders",
    /** Build a link to a PO; encodes the segment for reserved URL characters. Do not use for Wouter `path` patterns — use `` `/procurement/orders/:po` ``. */
    order: (po: string | number) =>
      `/procurement/orders/${encodeURIComponent(String(po))}`,
    requisitions: "/procurement/requisitions",
    requisitionNew: "/procurement/requisitions/new",
    requisition: (id: string | number) => `/procurement/requisitions/${id}`,
    suppliers: "/procurement/suppliers",
    supplier: (id: string | number) => `/procurement/suppliers/${id}`,
    contracts: "/procurement/contracts",
    supplierPortal: "/procurement/supplier-portal",
  },
  finance: {
    accountsPayable: "/finance/accounts-payable",
    accountsPayableIntake: "/finance/accounts-payable/intake",
    accountsPayableApprovals: "/finance/accounts-payable/approvals",
    accountsPayableExceptions: "/finance/accounts-payable/exceptions",
    accountsPayablePayments: "/finance/accounts-payable/payments",
    invoices: "/finance/invoices",
    approvalPolicies: "/finance/approval-policies",
    billing: "/finance/billing",
  },
  analytics: {
    root: "/analytics",
    overview: "/analytics/overview",
    inventory: "/analytics/inventory",
    procurement: "/analytics/procurement",
    finance: "/analytics/finance",
    logistics: "/analytics/logistics",
    reports: "/analytics/reports",
    reportSection: (tab: ReportSectionSlug | string) => `/analytics/reports/${tab}`,
    savedReports: "/analytics/saved-reports",
    exportCenter: "/analytics/export-center",
  },
  training: {
    getEducated: "/get-educated",
    getEducatedModule: (moduleId: string) => `/get-educated/${encodeURIComponent(moduleId)}`,
  },
  admin: {
    settings: "/admin/settings",
    settingsSection: (section: SettingsSectionSlug | string) => `/admin/settings/${section}`,
    masterData: "/admin/master-data",
    masterDataSection: (section: MasterDataSectionSlug | string) => `/admin/master-data/${section}`,
    documentExtractor: "/admin/document-extractor",
    documentExtractorMode: (mode: DocumentExtractorSectionSlug | string) => `/admin/document-extractor/${mode}`,
    integrations: "/admin/integrations",
    auditLogs: "/admin/audit-logs",
    documents: "/admin/documents",
    employeeProfiles: "/admin/employee-profiles",
    userRoles: "/admin/user-roles",
    profile: "/admin/profile",
    downloads: "/admin/downloads",
    imageRecognition: "/admin/image-recognition",
    syncDashboard: "/admin/sync-dashboard",
    syncTest: "/admin/sync-test",
    realTimeUpdates: "/admin/real-time-updates",
    /** First organization bootstrap (admin); shown when /api/ready reports needsFirstRunOnboarding */
    onboarding: "/admin/onboarding",
    /** Local install / packaged diagnostics: DB, onboarding, exports path, build info */
    systemDiagnostics: "/admin/system-diagnostics",
  },
} as const;

/** Collect every static string path from `APP_ROUTES` (excludes helper functions). Used by stabilization tests. */
export function collectAppRouteStaticPaths(value: unknown = APP_ROUTES): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      out.push(v);
      return;
    }
    if (typeof v === "function") return;
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) {
        walk(x);
      }
    }
  };
  walk(value);
  return out;
}

export const LEGACY_ROUTE_REDIRECTS = {
  dashboard: APP_ROUTES.analytics.overview,
  analytics: APP_ROUTES.analytics.overview,
  supplyAnalytics: APP_ROUTES.analytics.procurement,
  reports: APP_ROUTES.analytics.reports,
  purchase: APP_ROUTES.procurement.orders,
  orders: APP_ROUTES.procurement.orders,
  requisitions: APP_ROUTES.procurement.requisitions,
  invoices: APP_ROUTES.finance.invoices,
  accountsPayable: APP_ROUTES.finance.accountsPayable,
  approvalPolicies: APP_ROUTES.finance.approvalPolicies,
  suppliers: APP_ROUTES.procurement.suppliers,
  contracts: APP_ROUTES.procurement.contracts,
  logistics: APP_ROUTES.operations.logistics,
  exceptions: APP_ROUTES.operations.exceptions,
  barcodeScanner: APP_ROUTES.inventory.barcodeScanner,
  warehouses: APP_ROUTES.inventory.warehouses,
  cycleCounts: APP_ROUTES.inventory.cycleCounts,
  reorder: APP_ROUTES.inventory.reorder,
  warehouseOperations: APP_ROUTES.inventory.warehouseOperations,
  settings: APP_ROUTES.admin.settings,
  masterData: APP_ROUTES.admin.masterData,
  documentExtractor: APP_ROUTES.admin.documentExtractor,
  integrations: APP_ROUTES.admin.integrations,
  auditLogs: APP_ROUTES.admin.auditLogs,
  documents: APP_ROUTES.admin.documents,
  employeeProfiles: APP_ROUTES.admin.employeeProfiles,
  userRoles: APP_ROUTES.admin.userRoles,
  profile: APP_ROUTES.admin.profile,
  download: APP_ROUTES.admin.downloads,
  imageRecognition: APP_ROUTES.admin.imageRecognition,
  syncDashboard: APP_ROUTES.admin.syncDashboard,
  syncTest: APP_ROUTES.admin.syncTest,
  realTimeUpdates: APP_ROUTES.admin.realTimeUpdates,
  mobileReceive: APP_ROUTES.operations.mobileReceive,
  mobilePick: APP_ROUTES.operations.mobilePick,
} as const;

export function asSectionSlug<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  if (value && (allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  return fallback;
}
