import { APP_ROUTES } from "@/lib/routes/app-routes";

export type AppSectionKey =
  | "operations"
  | "inventory"
  | "procurement"
  | "finance"
  | "analytics"
  | "admin"
  | "learning";

export type AppNavItem = {
  label: string;
  path: string;
  icon: string;
  description: string;
  keywords?: string;
  desktopOnly?: boolean;
  hiddenFromPrimaryNav?: boolean;
};

export type AppNavSection = {
  key: AppSectionKey;
  label: string;
  items: AppNavItem[];
};

export const APP_NAV_SECTIONS: AppNavSection[] = [
  {
    key: "operations",
    label: "Operations",
    items: [
      {
        label: "Overview",
        path: APP_ROUTES.operations.root,
        icon: "layout-dashboard",
        description: "Desktop operations hub—control tower, logistics, exceptions, and mobile launcher.",
        keywords: "operations overview hub",
      },
      {
        label: "Control tower",
        path: APP_ROUTES.operations.controlTower,
        icon: "radar",
        description: "Operational KPIs, alerts, and recent execution signals.",
        keywords: "operations monitoring",
      },
      {
        label: "Logistics",
        path: APP_ROUTES.operations.logistics,
        icon: "truck",
        description: "Shipment and logistics execution workspace.",
        keywords: "shipments transport carrier",
      },
      {
        label: "Exceptions",
        path: APP_ROUTES.operations.exceptions,
        icon: "alert-triangle",
        description: "Open operational issues that need review or action.",
        keywords: "issues exception queue",
      },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    items: [
      {
        label: "Inventory",
        path: APP_ROUTES.inventory.root,
        icon: "archive",
        description: "Inventory list, detail, and stock analytics.",
        keywords: "sku stock items",
      },
      {
        label: "Warehouse ops",
        path: APP_ROUTES.inventory.warehouseOperations,
        icon: "package-search",
        description: "Storage, stock movement, allocations, put-away, and warehouse execution workflows.",
        keywords: "warehouse operations allocation storage movements",
      },
      {
        label: "Cycle counts",
        path: APP_ROUTES.inventory.cycleCounts,
        icon: "refresh-cw",
        description: "Plan and post count programs and stock adjustments.",
        keywords: "cycle counts count sheet",
      },
      {
        label: "Reorder requests",
        path: APP_ROUTES.inventory.reorder,
        icon: "list-ordered",
        description: "Demand-driven reorder requests and replenishment cues.",
        keywords: "replenishment reorder",
      },
      {
        label: "Barcode scanner",
        path: APP_ROUTES.inventory.barcodeScanner,
        icon: "qr-code",
        description: "Scan inventory labels and execute barcode flows.",
        keywords: "barcode qr scan",
      },
    ],
  },
  {
    key: "procurement",
    label: "Procurement",
    items: [
      {
        label: "Purchase orders",
        path: APP_ROUTES.procurement.orders,
        icon: "shopping-cart",
        description: "Order desk and procurement execution workspace.",
        keywords: "purchase orders po",
      },
      {
        label: "Requisitions",
        path: APP_ROUTES.procurement.requisitions,
        icon: "clipboard-list",
        description: "Demand intake, approval, and conversion to PO.",
        keywords: "purchase requisitions request",
      },
      {
        label: "Suppliers",
        path: APP_ROUTES.procurement.suppliers,
        icon: "users",
        description: "Supplier master, contacts, and relationship data.",
        keywords: "vendors supplier",
      },
      {
        label: "Contracts",
        path: APP_ROUTES.procurement.contracts,
        icon: "scroll-text",
        description: "Commercial and compliance contract repository.",
        keywords: "contracts legal",
      },
      {
        label: "Supplier portal",
        path: APP_ROUTES.procurement.supplierPortal,
        icon: "store",
        description: "Supplier-facing collaboration and PO confirmation view.",
        keywords: "vendor portal",
      },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    items: [
      {
        label: "Accounts payable",
        path: APP_ROUTES.finance.accountsPayable,
        icon: "landmark",
        description: "Invoice intake, approvals, exceptions, and payment batches.",
        keywords: "ap invoices payments",
      },
      {
        label: "Invoices",
        path: APP_ROUTES.finance.invoices,
        icon: "receipt",
        description: "Legacy supplier invoice workspace and compatibility entrypoint.",
        keywords: "invoice match",
      },
      {
        label: "Approval policies",
        path: APP_ROUTES.finance.approvalPolicies,
        icon: "shield-check",
        description: "Amount bands, approvers, and finance approval governance.",
        keywords: "approvals policy",
      },
      {
        label: "Billing",
        path: APP_ROUTES.finance.billing,
        icon: "credit-card",
        description: "Billing settings and payment configuration.",
        keywords: "billing payments",
      },
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    items: [
      {
        label: "Overview",
        path: APP_ROUTES.analytics.overview,
        icon: "bar-chart-2",
        description: "Unified BI workspace with KPI registry and analytics drilldowns.",
        keywords: "analytics overview dashboard",
      },
      {
        label: "Reports",
        path: APP_ROUTES.analytics.reports,
        icon: "file-spreadsheet",
        description: "Structured tabular reporting and export entrypoint.",
        keywords: "reports export tables",
      },
      {
        label: "Saved reports",
        path: APP_ROUTES.analytics.savedReports,
        icon: "bookmark",
        description: "Reusable saved report definitions for repeated exports.",
        keywords: "saved reports presets",
      },
      {
        label: "Export center",
        path: APP_ROUTES.analytics.exportCenter,
        icon: "download",
        description: "Recent export history, retries, and download entrypoint.",
        keywords: "export history download retry",
      },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
      {
        label: "Settings",
        path: APP_ROUTES.admin.settings,
        icon: "settings",
        description: "Application preferences, operations settings, and security controls.",
        keywords: "settings preferences configuration",
      },
      {
        label: "Master data",
        path: APP_ROUTES.admin.masterData,
        icon: "database",
        description: "Reference data for units, currencies, tax, and payment terms.",
        keywords: "master data reference configuration",
      },
      {
        label: "Document extractor",
        path: APP_ROUTES.admin.documentExtractor,
        icon: "scan-search",
        description: "OCR, extraction, and import utilities.",
        keywords: "document extractor ocr import integration",
      },
      {
        label: "Integrations",
        path: APP_ROUTES.admin.integrations,
        icon: "plug",
        description: "External connectors and system integration settings.",
        keywords: "connectors integrations",
      },
      {
        label: "Audit logs",
        path: APP_ROUTES.admin.auditLogs,
        icon: "activity",
        description: "Compliance and activity review workspace.",
        keywords: "audit logs compliance governance",
      },
      {
        label: "Subscription",
        path: APP_ROUTES.admin.subscription,
        icon: "credit-card",
        description: "SaaS plan, entitlement, usage, and billing-provider controls.",
        keywords: "subscription plan entitlements saas billing",
      },
    ],
  },
  /** Intentionally last in `APP_NAV_SECTIONS` so primary product areas stay grouped; learning is a capstone link. */
  {
    key: "learning",
    label: "Learning",
    items: [
      {
        label: "Get Educated",
        path: APP_ROUTES.training.getEducated,
        icon: "graduation-cap",
        description: "Beginner-friendly lessons for operations, inventory, procurement, finance, and analytics.",
        keywords: "training course tutorial education learn",
      },
    ],
  },
];

/**
 * Paths hidden from compact navigation surfaces below `lg` (1024px); align with command palette filtering.
 */
export const NAV_DESKTOP_ONLY_PATHS = new Set<string>([
  "/admin/master-data",
  "/finance/approval-policies",
  "/admin/employee-profiles",
]);

/** Command palette secondary groups (frontline + admin utilities). */
export const COMMAND_MENU_SECONDARY_GROUPS: { heading: string; items: AppNavItem[] }[] = [
  {
    heading: "Frontline — mobile shell",
    items: [
      {
        label: "Mobile workflows launcher",
        path: APP_ROUTES.operations.mobileWorkflows,
        icon: "smartphone",
        description:
          "Desktop page that links into the mobile workflow shell (/m/…). Use for floor tasks; layout switches to mobile.",
        keywords: "mobile frontline m tasks scan receive pick",
      },
    ],
  },
  {
    heading: "Admin — Files & recognition",
    items: [
      {
        label: "Documents",
        path: APP_ROUTES.admin.documents,
        icon: "folder-open",
        description: "Document repository and upload workspace.",
        keywords: "documents uploads",
      },
      {
        label: "Downloads",
        path: APP_ROUTES.admin.downloads,
        icon: "arrow-down-to-line",
        description: "File downloads and generated artifacts.",
        keywords: "downloads files",
      },
      {
        label: "Image recognition",
        path: APP_ROUTES.admin.imageRecognition,
        icon: "camera",
        description: "Image-based recognition and capture utilities.",
        keywords: "vision camera image",
      },
    ],
  },
  {
    heading: "Admin — People & access",
    items: [
      {
        label: "Employee profiles",
        path: APP_ROUTES.admin.employeeProfiles,
        icon: "id-card",
        description: "User and employee profile administration.",
        keywords: "employee users hr",
        desktopOnly: true,
      },
      {
        label: "User roles",
        path: APP_ROUTES.admin.userRoles,
        icon: "users",
        description: "Role and access administration.",
        keywords: "rbac permissions roles",
        desktopOnly: true,
      },
      {
        label: "Subscription",
        path: APP_ROUTES.admin.subscription,
        icon: "credit-card",
        description: "Plan, usage, feature entitlements, and billing-provider readiness.",
        keywords: "subscription billing plan entitlements",
      },
    ],
  },
  {
    heading: "Admin — System & profile",
    items: [
      {
        label: "System diagnostics",
        path: APP_ROUTES.admin.systemDiagnostics,
        icon: "radar",
        description: "Install health, database, onboarding state, and build information.",
        keywords: "diagnostics setup health install",
      },
      {
        label: "Profile",
        path: APP_ROUTES.admin.profile,
        icon: "user-round",
        description: "Personal profile and account settings.",
        keywords: "profile account me",
      },
    ],
  },
];

/** Admin subgroups shown under Admin in the sidebar (same items as palette, without frontline mobile). */
export const SIDEBAR_ADMIN_SECONDARY_GROUPS = COMMAND_MENU_SECONDARY_GROUPS.filter((g) =>
  g.heading.startsWith("Admin"),
);

export function sidebarAdminSubgroupLabel(fullHeading: string): string {
  return fullHeading.replace(/^Admin — /u, "").trim();
}
