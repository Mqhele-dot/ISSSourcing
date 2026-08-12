import type { TutorialStep } from "@/components/tutorial/tutorial-types";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import {
  APP_NAV_SECTIONS,
  COMMAND_MENU_SECONDARY_GROUPS,
  type AppNavItem,
  type AppSectionKey,
} from "@/lib/routes/section-metadata";
import { getAllTrainingModules } from "@/lib/training/training-content";

export type GuidedLearningTopic = {
  id: string;
  title: string;
  section: string;
  route: string;
  tourId: string;
  summary: string;
  whyItMatters: string;
  instructions: string[];
  watchFor: string;
  moduleId?: string;
  selectors: string[];
};

type GuideOverride = Pick<GuidedLearningTopic, "whyItMatters" | "instructions" | "watchFor"> & {
  selectors?: string[];
};

const GUIDE_OVERRIDES: Record<string, GuideOverride> = {
  [APP_ROUTES.operations.root]: {
    whyItMatters: "This is the hand-off point between control, logistics, exceptions, and frontline phone work.",
    instructions: ["Review the available operations workspaces.", "Choose the queue that matches the work you need to perform.", "Return here when you need to switch from monitoring to execution."],
    watchFor: "Do not treat Overview totals as transaction records; open the destination workspace before acting.",
    selectors: ["main"],
  },
  [APP_ROUTES.operations.controlTower]: {
    whyItMatters: "Cross-functional KPIs help teams act on risk before it becomes a service or cash problem.",
    instructions: ["Scan the KPI tiles for abnormal or high-risk counts.", "Open the relevant exception, shipment, PO, or inventory queue.", "Refresh after work is completed to confirm the signal changed."],
    watchFor: "A KPI is a signal, not the root cause; drill into the underlying records.",
    selectors: ["[data-tour=control-tower-kpis]", "[data-tour=control-tower-shortcuts]"],
  },
  [APP_ROUTES.operations.fuel]: {
    whyItMatters: "Fuel and LPG controls connect physical stock, forecourt sales, pricing, custody, and safety evidence.",
    instructions: ["Create the station before its tanks, pumps, or cylinders.", "Record deliveries and tank readings against the correct station and tank.", "Reconcile pump meters to reported sales and review safety or low-stock warnings."],
    watchFor: "Never bypass tank capacity, blocked-tank, supplier ownership, or inspection controls.",
    selectors: ["main"],
  },
  [APP_ROUTES.operations.logistics]: {
    whyItMatters: "Shipment status and ETA determine when warehouses, buyers, and customers can rely on material arriving.",
    instructions: ["Filter the shipment queue by status, carrier, PO, or lateness.", "Open the affected shipment and verify tracking, ETA, and ownership.", "Update the record or raise an exception so downstream teams see the same truth."],
    watchFor: "An unchanged ETA is not proof that a delayed shipment recovered.",
    selectors: ["[data-tour=logistics-toolbar]", "[data-tour=shipments-list]"],
  },
  [APP_ROUTES.operations.exceptions]: {
    whyItMatters: "The exception queue turns broken rules and mismatches into owned, auditable work.",
    instructions: ["Filter by severity, status, type, or owner.", "Open the highest-impact issue and confirm the underlying record.", "Assign, comment, resolve, or escalate with enough detail for the next person."],
    watchFor: "Closing an exception without correcting the source record hides risk instead of resolving it.",
    selectors: ["[data-tour=exceptions-toolbar]", "[data-tour=exceptions-table]"],
  },
  [APP_ROUTES.inventory.root]: {
    whyItMatters: "Availability drives replenishment, allocation, customer promises, and financial confidence.",
    instructions: ["Search or filter to the SKU population you need.", "Compare on-hand, allocated, available, warehouse, and unassigned quantities.", "Open item detail before adjusting, exporting, or initiating replenishment."],
    watchFor: "Negative availability overlaps low stock and requires investigation, not cosmetic correction.",
    selectors: ["[data-tour=inventory-search]", "[data-tour=inventory-low-toggle]", "[data-tour=inventory-table]"],
  },
  [APP_ROUTES.inventory.warehouseOperations]: {
    whyItMatters: "Warehouse execution is where system quantities become physical receipts, allocations, batches, and serial movements.",
    instructions: ["Select a verified warehouse and item.", "Choose the receipt, movement, allocation, batch, or serial action.", "Confirm the posted result and resulting availability."],
    watchFor: "Do not create activity without a canonical warehouse or valid item ownership.",
    selectors: ["main"],
  },
  [APP_ROUTES.inventory.cycleCounts]: {
    whyItMatters: "Counts detect shrink, process errors, and stale stock before they distort planning or finance.",
    instructions: ["Choose the warehouse and count mode.", "Count independently of the expected quantity where policy requires blind counting.", "Review variances and post only after evidence and approvals are complete."],
    watchFor: "Do not confuse an empty count with a count that failed to load.",
    selectors: ["main"],
  },
  [APP_ROUTES.inventory.reorder]: {
    whyItMatters: "Reorder requests convert stock risk into controlled demand for procurement.",
    instructions: ["Review low-stock or demand-driven suggestions.", "Validate quantity, timing, warehouse, and supplier context.", "Submit, approve, or convert the request while preserving its audit trail."],
    watchFor: "A reorder threshold is a trigger for review, not permission to buy an arbitrary quantity.",
    selectors: ["main"],
  },
  [APP_ROUTES.inventory.barcodeScanner]: {
    whyItMatters: "Scanning reduces manual identification errors during receiving, picking, and stock lookup.",
    instructions: ["Choose camera scan or manual entry.", "Confirm the resolved item before performing an action.", "Use generated labels, history, and pause controls to manage the scanning session."],
    watchFor: "Camera permission failure is different from an unknown barcode; respond to the correct state.",
    selectors: ["main"],
  },
  [APP_ROUTES.procurement.sourcing]: {
    whyItMatters: "Structured RFQs create comparable supplier competition and defensible award decisions.",
    instructions: ["Create the sourcing event with dates, requirements, and evaluation context.", "Search and select only relevant suppliers, then issue the RFQ.", "Compare responses consistently and document the award decision."],
    watchFor: "Do not award from price alone when lead time, compliance, or service materially changes value.",
    selectors: ["main"],
  },
  [APP_ROUTES.procurement.orders]: {
    whyItMatters: "The PO is the controlled commercial instruction connecting demand, supplier, receipt, and invoice matching.",
    instructions: ["Filter the order desk to the status or supplier you own.", "Open a PO and verify lines, totals, delivery terms, and approval state.", "Approve, send, receive, or download only when the preceding control is complete."],
    watchFor: "Receiving more than ordered or sending an unapproved PO creates inventory and payment risk.",
    selectors: ["[data-tour=po-list]"],
  },
  [APP_ROUTES.procurement.requisitions]: {
    whyItMatters: "Requisitions capture internal need and approval before the organization commits to a supplier.",
    instructions: ["Describe the business need and required date.", "Add valid items, quantities, cost context, and department ownership.", "Submit for approval, then convert the approved demand to a PO."],
    watchFor: "A requisition is not a supplier order and should not be treated as authorization to buy.",
    selectors: ["main"],
  },
  [APP_ROUTES.procurement.suppliers]: {
    whyItMatters: "Clean supplier master data prevents duplicate spend, payment errors, and weak sourcing decisions.",
    instructions: ["Search before creating a supplier to avoid duplicates.", "Verify contact, tax, payment, compliance, and status information.", "Use performance and history when deciding whether to source or renew."],
    watchFor: "Similar names may represent the same legal supplier; verify identifiers before creating another record.",
    selectors: ["[data-tour=suppliers-list]"],
  },
  [APP_ROUTES.procurement.contracts]: {
    whyItMatters: "Contracts hold the commercial and compliance terms that should govern buying and supplier performance.",
    instructions: ["Filter by supplier, status, or text.", "Review dates, value, obligations, and linked documentation.", "Act on upcoming expiry or non-compliance before placing new commitments."],
    watchFor: "An active supplier does not guarantee that its contract is active or suitable for the purchase.",
    selectors: ["main"],
  },
  [APP_ROUTES.procurement.supplierPortal]: {
    whyItMatters: "The portal provides a focused collaboration view for acknowledgements, invoices, and shared order context.",
    instructions: ["Select the supplier record you are representing or reviewing.", "Confirm PO status and required supplier action.", "Submit or review the response, then verify it appears in the internal workflow."],
    watchFor: "Always verify the selected supplier before exposing or changing order information.",
    selectors: ["main"],
  },
  [APP_ROUTES.finance.accountsPayable]: {
    whyItMatters: "AP controls invoice intake, matching, approval, exceptions, and payment readiness.",
    instructions: ["Begin in the queue matching your task: intake, approval, exceptions, or payments.", "Verify supplier, PO, receipt, tax, totals, and duplicate indicators.", "Approve, hold, resolve, or schedule payment with supporting evidence."],
    watchFor: "Do not approve a mismatch merely to clear the queue; document and resolve the cause.",
    selectors: ["main"],
  },
  [APP_ROUTES.finance.invoices]: {
    whyItMatters: "This compatibility workspace keeps older invoice flows visible while AP is the canonical operating area.",
    instructions: ["Use it only when the required invoice is not yet available in the AP workspace.", "Confirm supplier, PO, receipt, and total alignment.", "Continue operational processing in Accounts Payable where possible."],
    watchFor: "Avoid duplicating the same invoice across the legacy and canonical AP entry points.",
    selectors: ["main"],
  },
  [APP_ROUTES.finance.approvalPolicies]: {
    whyItMatters: "Approval policy enforces authority limits and segregation of duties consistently.",
    instructions: ["Review thresholds, currency, scope, and approver sequence.", "Test the policy against representative transaction values.", "Activate changes only after confirming there are no approval gaps or self-approval paths."],
    watchFor: "Overlapping or missing amount bands can create ambiguous or blocked approvals.",
    selectors: ["main"],
  },
  [APP_ROUTES.analytics.overview]: {
    whyItMatters: "Analytics converts operational records into comparable measures for management decisions.",
    instructions: ["Choose the business area and KPI relevant to your question.", "Apply a consistent period and organizational scope.", "Drill to detail or export only after reconciling the headline number."],
    watchFor: "Changing filters changes the meaning of the KPI; include the filter context when sharing it.",
    selectors: ["#dashboard-stats", "#analytics"],
  },
  [APP_ROUTES.analytics.reports]: {
    whyItMatters: "Repeatable reports provide evidence for reviews, audits, close, and operational hand-offs.",
    instructions: ["Select the report family that answers the business question.", "Apply dates and filters, then review the visible rows and totals.", "Choose the correct export format and label the reporting scope when sharing."],
    watchFor: "An export without its date, filters, and cut-off can be misread as a complete live dataset.",
    selectors: ["[data-tour=reports-section]", "[data-tour=reports-tabs]"],
  },
  [APP_ROUTES.analytics.savedReports]: {
    whyItMatters: "Saved definitions keep recurring reports consistent across periods and users.",
    instructions: ["Find the saved definition by owner or purpose.", "Review its filters before running it because business conditions may have changed.", "Run, update, or retire the definition with clear ownership."],
    watchFor: "A saved report definition is reusable logic, not a frozen historical result.",
    selectors: ["main"],
  },
  [APP_ROUTES.analytics.exportCenter]: {
    whyItMatters: "Export Center makes large or asynchronous output traceable and recoverable.",
    instructions: ["Review export status, scope, creator, and generated time.", "Retry failed exports only after reading the error context.", "Download the completed artifact and verify its reporting period."],
    watchFor: "Do not repeatedly retry a structurally invalid export; correct its filters or source issue first.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.settings]: {
    whyItMatters: "Organization defaults influence every transaction, document, security decision, and integration.",
    instructions: ["Choose the settings section and read its scope before editing.", "Change the smallest necessary setting and save deliberately.", "Verify the downstream workflow affected by the change."],
    watchFor: "Settings are organization-wide; avoid experimental changes in a live organization.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.masterData]: {
    whyItMatters: "Master data supplies the controlled reference values used by procurement, inventory, logistics, and finance.",
    instructions: ["Choose the reference-data tab such as units, tax codes, warehouses, or carriers.", "Search before adding a value and verify code, description, status, and ownership.", "Deactivate obsolete values only after checking active transactions that reference them."],
    watchFor: "Duplicate or near-duplicate codes fragment reporting and make transaction choices confusing.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.documentExtractor]: {
    whyItMatters: "Extraction converts PDF, image, and spreadsheet content into reviewable import data without silent posting.",
    instructions: ["Choose single document, batch, spreadsheet import, or options.", "Upload a supported file and review extracted fields, confidence, and validation issues.", "Correct mappings before committing data to the destination workflow."],
    watchFor: "Extraction is an assisted draft; low-confidence or unmapped fields still require human review.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.integrations]: {
    whyItMatters: "Connectors synchronize external systems while their run log provides operational accountability.",
    instructions: ["Review connector configuration and current status.", "Run or schedule the correct integration for the intended scope.", "Inspect the run log and reconcile partial or failed outcomes."],
    watchFor: "A successful connection does not guarantee every record in the run succeeded.",
    selectors: ["[data-tour=integrations-connectors]", "[data-tour=integrations-runs]"],
  },
  [APP_ROUTES.admin.auditLogs]: {
    whyItMatters: "Audit logs answer who changed what, when, and in which organizational context.",
    instructions: ["Filter by date, user, action, module, or record.", "Open the relevant event and compare before-and-after context where available.", "Export or reference the evidence without changing source records."],
    watchFor: "An absence of matching results can mean the filter is too narrow, not that no activity occurred.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.subscription]: {
    whyItMatters: "Subscription controls plan entitlements, usage visibility, and billing-provider state.",
    instructions: ["Review the active plan and enabled capabilities.", "Compare usage and limits before changing entitlement or billing state.", "Confirm the change appears in feature access without exposing provider secrets."],
    watchFor: "Plan changes can remove access for multiple roles; assess impact before applying them.",
    selectors: ["main"],
  },
  [APP_ROUTES.operations.mobileWorkflows]: {
    whyItMatters: "The launcher teaches desktop users how frontline phone queues connect to the same operational data.",
    instructions: ["Preview the phone dashboard and its queue counts.", "Open Count, Scan, Receive, Pick, or Approvals in the browser.", "Use device-sized testing to verify touch targets and task completion."],
    watchFor: "The phone shell is a responsive PWA surface, not a separate source of operational truth.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.documents]: {
    whyItMatters: "The document repository keeps evidence attached to the supplier, PO, invoice, warehouse, or other business record.",
    instructions: ["Select the correct entity type and record before uploading.", "Add the file with a meaningful description and version context.", "Filter the library and open the attachment to verify retrieval."],
    watchFor: "A file uploaded against the wrong entity can be difficult to find during an audit.",
    selectors: ["[data-tour=documents-upload]", "[data-tour=documents-library]"],
  },
  [APP_ROUTES.admin.imageRecognition]: {
    whyItMatters: "Recognition assists item identification from images while keeping users responsible for confirmation.",
    instructions: ["Choose or capture a clear image with the relevant item visible.", "Run recognition and review matches, confidence, and alternatives.", "Confirm the correct item before using the result in an operational action."],
    watchFor: "A high-confidence match is still a suggestion; packaging variants can look nearly identical.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.employeeProfiles]: {
    whyItMatters: "Profiles connect people, organizational details, status, and the role that controls application access.",
    instructions: ["Search and select the employee before editing.", "Verify identity, department, status, and assigned role.", "Save and confirm access aligns with the person’s current responsibilities."],
    watchFor: "Job-title labels do not grant permissions; the assigned role does.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.userRoles]: {
    whyItMatters: "Role design enforces least privilege and controls which tabs and actions each profile can use.",
    instructions: ["Select an existing role or create a clearly named custom role.", "Choose tab visibility and action permissions that match the job.", "Assign users, test access, and deactivate or delete only when no active dependency remains."],
    watchFor: "Always preserve at least one active administrator with role-management access.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.systemDiagnostics]: {
    whyItMatters: "Diagnostics turns installation and runtime symptoms into specific, navigable findings.",
    instructions: ["Run the scan and review failures by severity and subsystem.", "Select a finding to open its affected tab or remediation destination.", "Apply the safe fix or manual correction, then rerun the scan."],
    watchFor: "Do not run destructive demo reset as part of routine diagnostics.",
    selectors: ["main"],
  },
  [APP_ROUTES.admin.profile]: {
    whyItMatters: "Profile settings keep personal identity, preferences, and security details accurate.",
    instructions: ["Review your personal and account information.", "Change only the preferences or credentials you intend to update.", "Save and verify the confirmation before leaving the page."],
    watchFor: "Personal preferences should not be confused with organization-wide Settings.",
    selectors: ["main"],
  },
};

const SECTION_DEFAULTS: Record<string, Pick<GuideOverride, "whyItMatters" | "instructions" | "watchFor">> = {
  Operations: {
    whyItMatters: "Operations tabs coordinate live execution and exception ownership.",
    instructions: ["Review the current state and scope.", "Open the record or queue that needs action.", "Complete the action and verify its downstream result."],
    watchFor: "Confirm status and ownership before changing live operational records.",
  },
  Inventory: {
    whyItMatters: "Inventory tabs protect quantity, location, and traceability accuracy.",
    instructions: ["Select the correct warehouse and item scope.", "Review quantity and transaction context.", "Post or hand off the controlled stock action."],
    watchFor: "Never infer physical stock from an unverified or failed data state.",
  },
  Procurement: {
    whyItMatters: "Procurement tabs control demand, supplier selection, commercial commitment, and receipt.",
    instructions: ["Find the relevant request, supplier, or order.", "Verify approval and commercial context.", "Perform the next allowed action and confirm status."],
    watchFor: "Do not skip the approval or supplier-ownership controls.",
  },
  Finance: {
    whyItMatters: "Finance tabs protect matching, approval, cash, and audit evidence.",
    instructions: ["Confirm supplier and transaction identity.", "Review matching, tax, and approval status.", "Resolve exceptions before posting or paying."],
    watchFor: "A cleared queue is not useful if the underlying financial control was bypassed.",
  },
  Analytics: {
    whyItMatters: "Analytics tabs convert operational records into decisions and evidence.",
    instructions: ["Define the question and reporting period.", "Apply filters and reconcile totals.", "Drill down or export with scope attached."],
    watchFor: "Compare like-for-like periods and filters.",
  },
  Admin: {
    whyItMatters: "Administration tabs govern shared reference data, access, configuration, and evidence.",
    instructions: ["Confirm the organization and administrative scope.", "Review dependencies before making a change.", "Save, verify, and audit the result."],
    watchFor: "Admin changes can affect every user and workflow.",
  },
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function collectItems(): Array<{ section: string; sectionKey: AppSectionKey | "secondary"; item: AppNavItem }> {
  const primary = APP_NAV_SECTIONS.flatMap((section) =>
    section.key === "learning" ? [] : section.items.map((item) => ({ section: section.label, sectionKey: section.key, item })),
  );
  const secondary = COMMAND_MENU_SECONDARY_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ section: group.heading.replace(/^Admin - /u, "Admin · "), sectionKey: "secondary" as const, item })),
  );
  return [...primary, ...secondary].filter(
    (entry, index, all) => all.findIndex((candidate) => candidate.item.path === entry.item.path) === index,
  );
}

const modules = getAllTrainingModules();

export const GUIDED_LEARNING_TOPICS: GuidedLearningTopic[] = collectItems().map(({ section, item }) => {
  const directModule = modules.find((module) => module.route === item.path);
  const detail = GUIDE_OVERRIDES[item.path] ?? SECTION_DEFAULTS[section.split(" · ")[0]] ?? SECTION_DEFAULTS.Admin;
  const topicId = slug(`${section}-${item.label}`);
  return {
    id: topicId,
    title: item.label,
    section,
    route: item.path,
    tourId: `learn-${topicId}`,
    summary: item.description,
    whyItMatters: detail.whyItMatters,
    instructions: directModule?.workflowExample?.length ? directModule.workflowExample : detail.instructions,
    watchFor: detail.watchFor,
    moduleId: directModule?.id,
    selectors: detail.selectors?.length ? detail.selectors : ["main"],
  };
});

export function getGuidedLearningTopic(id: string): GuidedLearningTopic | undefined {
  return GUIDED_LEARNING_TOPICS.find((topic) => topic.id === id);
}

export function getGuidedLearningTopicForRoute(route: string): GuidedLearningTopic | undefined {
  return GUIDED_LEARNING_TOPICS.find((topic) => topic.route === route);
}

export function buildGuidedLearningTour(topic: GuidedLearningTopic): TutorialStep[] {
  const targetSelectors = topic.selectors.length ? topic.selectors : ["main"];
  const firstSelector = targetSelectors[0] ?? "main";
  const secondSelector = targetSelectors[1] ?? firstSelector;
  return [
    {
      id: `${topic.id}-purpose`,
      title: `${topic.title}: what this tab does`,
      text: `${topic.summary}\n\nWhy it matters: ${topic.whyItMatters}`,
      route: topic.route,
      routeExact: true,
      presentation: "spotlight",
      attachTo: { element: firstSelector, on: "bottom" },
      settleMs: 180,
    },
    {
      id: `${topic.id}-workflow`,
      title: "How to work this tab",
      text: topic.instructions.map((instruction, index) => `${index + 1}. ${instruction}`).join("\n"),
      route: topic.route,
      routeExact: true,
      presentation: "spotlight",
      attachTo: { element: secondSelector, on: "top" },
      settleMs: 100,
    },
    {
      id: `${topic.id}-control`,
      title: "Before you finish",
      text: `Check your work: ${topic.watchFor}\n\nWhen the page status and downstream record agree, the workflow is complete.`,
      route: topic.route,
      routeExact: true,
      presentation: "spotlight",
      attachTo: { element: "main", on: "top" },
    },
  ];
}
