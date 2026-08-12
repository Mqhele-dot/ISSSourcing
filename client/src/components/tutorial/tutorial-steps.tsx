// Using TS with our simplified tutorial system
import { useRef, useLayoutEffect } from "react";
import { useTutorial } from "@/contexts/tutorial-context";
import { FULL_APP_TOUR_STEPS, PAGE_TOUR_DEFINITIONS } from "@/components/tutorial/tutorial-page-tours-data";
import { buildGuidedLearningTour, GUIDED_LEARNING_TOPICS } from "@/lib/training/guided-learning";

/**
 * Component to register all available tutorials in the application.
 * useLayoutEffect ensures registration runs before paint so the Tutorial button works on first click.
 */
export function TutorialSteps() {
  const { registerTutorial } = useTutorial();
  // Use ref to prevent multiple registrations
  const isRegistered = useRef(false);
  
  useLayoutEffect(() => {
    // Only register tutorials once to prevent re-registering on every render
    if (isRegistered.current) return;
    isRegistered.current = true;
    
    // Main tutorial - a general introduction to the application
    registerTutorial("main", [
      {
        id: "welcome",
        title: "Welcome to ISSSourcing",
        text: "What you are seeing: a short orientation to the shells you will use for inventory, buying, and payables.\n\nWhy it matters: supply-chain work spans many screens; knowing the layout speeds up handoffs between warehouse, procurement, and finance.\n\nRisk if skipped: new teammates hunt for the right tab, duplicate work, or miss approvals because they do not know where decisions are recorded.",
      },
      {
        id: "dashboard",
        title: "Operational overview",
        text: "What you are seeing: summary areas (control tower / analytics) meant to show health of stock, orders, and exceptions in one glance.\n\nWhy it matters: leaders and operators prioritize by exception instead of reading every list.\n\nRisk if skipped: problems surface late—short shipments, stockouts, or overdue invoices—because nobody is reviewing the overview.",
      },
      {
        id: "navigation",
        title: "Navigation",
        text: "What you are seeing: the sidebar and routes grouped by operations, inventory, procurement, finance, analytics, and admin.\n\nWhy it matters: consistent navigation keeps inventory, POs, and AP in sync with how your process actually runs.\n\nRisk if skipped: people file data in the wrong place or work from outdated exports instead of the system.",
      },
      {
        id: "user-menu",
        title: "Your profile & sign-out",
        text: "What you are seeing: account menu for profile, settings access, and secure sign-out.\n\nWhy it matters: especially on shared PCs, signing out protects vendor and payment data.\n\nRisk if skipped: sessions left open create audit and fraud exposure.",
      },
      {
        id: "tour-complete",
        title: "Next steps",
        text: "What you are seeing: the end of this short orientation.\n\nWhy it matters: structured learning (Get Educated) plus occasional spotlight tours builds confidence without guessing.\n\nRisk if skipped: teams rely on tribal knowledge; errors repeat when staff change.",
      },
    ]);
    
    // Dashboard tutorial: targets exist on Control Tower home (/) and Analytics overview (/analytics/overview) — use Help → Dashboard after navigating to the page you want to spotlight.
    registerTutorial("dashboard", [
      {
        id: "dashboard-intro",
        title: "Dashboard Overview",
        text: "What you are seeing: KPI-style cards and charts for stock, movement, and alerts.\n\nWhy it matters: decisions on replenishment and cash use start from a trustworthy snapshot.\n\nRisk if skipped: you chase symptoms in spreadsheets while the live picture in the app is ignored.",
        targetSelector: "#dashboard-stats"
      },
      {
        id: "dashboard-stats",
        title: "Key Metrics",
        text: "What you are seeing: headline numbers such as low stock, value, or demand signals depending on your workspace.\n\nWhy it matters: they condense thousands of SKUs into what needs attention today.\n\nRisk if skipped: stockouts or slow-moving inventory go unnoticed until a customer or auditor complains.",
        targetSelector: "#dashboard-stats"
      },
      {
        id: "dashboard-charts",
        title: "Trends & breakdowns",
        text: "What you are seeing: visual breakdowns of usage, value, or category mix.\n\nWhy it matters: trends show whether buying and stocking strategy matches reality.\n\nRisk if skipped: you reorder on gut feel and misread seasonality or category shifts.",
        targetSelector: "#analytics"
      },
      {
        id: "dashboard-activity",
        title: "Recent Activity",
        text: "What you are seeing: a chronological feed of notable changes or events.\n\nWhy it matters: tells you what changed recently when investigating a discrepancy.\n\nRisk if skipped: investigations take longer because nobody knows what moved recently.",
        targetSelector: "#dashboard-activity"
      },
      {
        id: "dashboard-actions",
        title: "Actions from here",
        text: "What you are seeing: shortcuts into deeper workspaces (control tower links, exports, tutorials).\n\nWhy it matters: reduces clicks when you already know the next task.\n\nRisk if skipped: users duplicate effort navigating manually every time.",
        targetSelector: "#dashboard-actions"
      }
    ]);
    
    // Inventory management tutorial
    registerTutorial("inventory", [
      {
        id: "inventory-intro",
        title: "Inventory Management",
        text: "What you are seeing: the operational list of SKUs with quantities and locations.\n\nWhy it matters: planning, promising customer dates, and buying all depend on believing this picture.\n\nRisk if skipped: you oversell, buy duplicates, or ship late because on-hand data is treated casually."
      },
      {
        id: "inventory-list",
        title: "Item List",
        text: "What you are seeing: rows of items with SKU, availability, and filters.\n\nWhy it matters: this is the fastest path to answer “what do we have, where?”.\n\nRisk if ignored: people work from emails instead of the list and book conflicting adjustments."
      },
      {
        id: "adding-items",
        title: "Adding New Items",
        text: "What you are seeing: flows to create SKUs with identifiers, categories, and opening balances.\n\nWhy it matters: clean master data prevents wrong POs and wrong receipts.\n\nRisk if skipped: free-text item names and duplicate SKUs break reporting and matching."
      },
      {
        id: "stock-movements",
        title: "Stock Movements",
        text: "What you are seeing: ways to receive, issue, or adjust stock with an audit trail.\n\nWhy it matters: every movement should explain why inventory changed.\n\nRisk if skipped: variances cannot be explained during audit or cycle count."
      },
      {
        id: "multi-warehouse",
        title: "Multi-Warehouse Support",
        text: "What you are seeing: warehouse or location context on balances.\n\nWhy it matters: the same SKU can exist in multiple sites with different availability.\n\nRisk if skipped: transfers and picks target the wrong site and shipments fail."
      }
    ]);
    
    // Analytics tutorial (dedicated analytics page: charts, top items, value)
    registerTutorial("analytics", [
      {
        id: "analytics-intro",
        title: "Analytics Overview",
        text: "What you are seeing: charts and KPIs built from inventory and operational data.\n\nWhy it matters: bridges day-to-day transactions with management decisions on stock and spend.\n\nRisk if skipped: you optimize for anecdotes instead of measured demand and value.",
        targetSelector: "#analytics"
      },
      {
        id: "analytics-stock-value",
        title: "Stock Use & Value",
        text: "What you are seeing: quantity and value views by usage, category, or item.\n\nWhy it matters: shows where capital sits and what is actually moving.\n\nRisk if skipped: dead stock accumulates while you reorder fast movers too late.",
        targetSelector: "#analytics"
      },
      {
        id: "analytics-custom",
        title: "Custom Graphs",
        text: "What you are seeing: controls to choose measures and chart types for ad-hoc views.\n\nWhy it matters: different roles ask different questions from the same dataset.\n\nRisk if skipped: analytics team exports to Excel for every question, slowing decisions."
      },
      {
        id: "analytics-insights",
        title: "Top Items & Inventory Value",
        text: "What you are seeing: ranked items and value concentration.\n\nWhy it matters: prioritizes attention to SKUs that drive service levels or cash.\n\nRisk if skipped: low-impact SKUs consume attention while critical items stock out."
      },
    ]);

    // Reports tutorial
    registerTutorial("reports", [
      {
        id: "reports-intro",
        title: "Reports & Analytics",
        text: "What you are seeing: structured outputs (tables / exports) generated from live data.\n\nWhy it matters: finance, ops, and auditors need repeatable snapshots with filters.\n\nRisk if skipped: everyone keeps private spreadsheets that disagree with the system."
      },
      {
        id: "report-types",
        title: "Report Types",
        text: "What you are seeing: templates for inventory, orders, requisitions, shipments, etc.\n\nWhy it matters: each template answers a standard business question.\n\nRisk if skipped: leadership reads the wrong report and misinterprets performance."
      },
      {
        id: "date-filters",
        title: "Date Range Filters",
        text: "What you are seeing: time windows that bound movements or balances.\n\nWhy it matters: period-close and trend views must compare apples to apples.\n\nRisk if skipped: month-end numbers conflict because ranges were inconsistent."
      },
      {
        id: "report-visualizations",
        title: "Data Views",
        text: "What you are seeing: table-first layouts tuned for scanning rows before export.\n\nWhy it matters: operations usually validate detail before sharing upward.\n\nRisk if skipped: pretty charts hide line-level exceptions until it is too late."
      },
      {
        id: "export-options",
        title: "Export Options",
        text: "What you are seeing: PDF, CSV, Excel (or similar) handoffs.\n\nWhy it matters: downstream tools and partners expect standard files.\n\nRisk if skipped: manual copy-paste introduces formula errors and stale attachments."
      }
    ]);
    
    // Suppliers tutorial
    registerTutorial("suppliers", [
      {
        id: "suppliers-intro",
        title: "Supplier Management",
        text: "What you are seeing: vendor master data used on POs, contracts, and invoices.\n\nWhy it matters: buying and AP rely on one approved record per supplier.\n\nRisk if skipped: payments go to wrong entities, tax IDs mismatch, and duplicate vendor names cause false spend reporting."
      },
      {
        id: "supplier-details",
        title: "Supplier Information",
        text: "What you are seeing: contact, terms, currency, and identifiers for each supplier.\n\nWhy it matters: POs and invoices inherit these defaults and reduce back-and-forth.\n\nRisk if skipped: urgent orders stall on missing terms or banking details."
      },
      {
        id: "supplier-orders",
        title: "Purchase Orders",
        text: "What you are seeing: links from supplier context into open PO history and status.\n\nWhy it matters: tells you commitment vs. receipt vs. invoice by vendor.\n\nRisk if skipped: you cannot explain accruals or overdue receipts when finance asks."
      },
      {
        id: "supplier-performance",
        title: "Performance Metrics",
        text: "What you are seeing: signals such as lead time, quality notes, or fill performance where tracked.\n\nWhy it matters: informs sourcing decisions and safety stock.\n\nRisk if skipped: poor performers stay on the roster without evidence."
      },
      {
        id: "supplier-import",
        title: "Bulk Import",
        text: "What you are seeing: paths to load or refresh supplier catalogs from files.\n\nWhy it matters: accelerates onboarding of many SKUs or price lists.\n\nRisk if skipped: manual keying drifts from the supplier’s official data."
      }
    ]);
    
    // User Roles tutorial
    registerTutorial("users", [
      {
        id: "users-intro",
        title: "User Management",
        text: "What you are seeing: role and access definitions for who can approve, receive, or administer.\n\nWhy it matters: segregation of duties prevents fraud and accidental data loss.\n\nRisk if skipped: everyone is an admin, or sensitive tasks sit with one person arbitrarily."
      },
      {
        id: "user-roles",
        title: "Role-Based Access",
        text: "What you are seeing: roles that bundle permissions for common job types.\n\nWhy it matters: matches how real teams work without one-off toggles per user.\n\nRisk if skipped: people get too much access “to save time” and bypass controls."
      },
      {
        id: "user-permissions",
        title: "Granular Permissions",
        text: "What you are seeing: finer limits on view vs. edit vs. approve where offered.\n\nWhy it matters: least privilege keeps contractors and junior staff in safe lanes.\n\nRisk if skipped: a mistaken click changes pricing, stock, or payment data."
      },
      {
        id: "activity-logs",
        title: "User Activity Logs",
        text: "What you are seeing: traceability of who changed critical records.\n\nWhy it matters: audits and investigations require attribution.\n\nRisk if skipped: disputes with suppliers or auditors cannot be resolved factually."
      },
      {
        id: "user-settings",
        title: "User Preferences",
        text: "What you are seeing: personal defaults such as density or notification choices.\n\nWhy it matters: reduces errors from cramped layouts or missed alerts.\n\nRisk if skipped: users blame the tool instead of adjusting to how they work."
      }
    ]);
    
    // Settings tutorial
    registerTutorial("settings", [
      {
        id: "settings-intro",
        title: "System Settings",
        text: "What you are seeing: organization-wide defaults for inventory, tax, security, and integrations.\n\nWhy it matters: wrong defaults silently skew every transaction downstream.\n\nRisk if skipped: you troubleshoot symptoms in POs and AP when the root cause is a setting."
      },
      {
        id: "company-settings",
        title: "Company Information",
        text: "What you are seeing: legal name, identifiers, and branding used on documents.\n\nWhy it matters: POs, invoices, and contracts must name the right entity.\n\nRisk if skipped: suppliers or customs reject paperwork over mismatched names."
      },
      {
        id: "inventory-settings",
        title: "Inventory Configuration",
        text: "What you are seeing: thresholds, units, and rules that drive replenishment signals.\n\nWhy it matters: alerts and reorders align to how your business defines “low”.\n\nRisk if skipped: chronic stockouts or excess because thresholds never matched reality."
      },
      {
        id: "notification-settings",
        title: "Notifications",
        text: "What you are seeing: how the system alerts people about stock, approvals, or failures.\n\nWhy it matters: timely nudges prevent small issues becoming outages.\n\nRisk if skipped: teams find out about problems from customers first."
      },
      {
        id: "billing-settings",
        title: "Billing Settings",
        text: "What you are seeing: subscription or SaaS billing controls where applicable.\n\nWhy it matters: service continuity for the team using ISSSourcing.\n\nRisk if skipped: abrupt lockout interrupts receiving or paying during close."
      }
    ]);
    
    // Document Generation tutorial
    registerTutorial("documents", [
      {
        id: "documents-intro",
        title: "Document Generation",
        text: "What you are seeing: tools to turn system data into shareable PDFs or spreadsheets.\n\nWhy it matters: stakeholders who do not log in still need evidence in a standard format.\n\nRisk if skipped: manual cut-and-paste documents drift from the truth."
      },
      {
        id: "document-types",
        title: "Available Documents",
        text: "What you are seeing: templates tied to operational objects—inventory, transfers, orders.\n\nWhy it matters: each template carries the fields that role expects to see.\n\nRisk if skipped: site sends an informal attachment that cannot be matched back to a PO line."
      },
      {
        id: "document-customization",
        title: "Customization Options",
        text: "What you are seeing: branding and field choices before output.\n\nWhy it matters: keeps customer-facing docs professional and compliant.\n\nRisk if skipped: wrong logo or missing terms voids a shipment or payment."
      },
      {
        id: "document-formats",
        title: "Output Formats",
        text: "What you are seeing: PDF vs spreadsheet vs CSV choices.\n\nWhy it matters: legal, warehouse, and finance each consume data in different tools.\n\nRisk if skipped: finance imports CSV with wrong columns and posts incorrect journals."
      },
      {
        id: "document-automation",
        title: "Automated Reports",
        text: "What you are seeing: optional schedules to generate recurring packages.\n\nWhy it matters: leadership reviews a reliable rhythm instead of ad-hoc pulls.\n\nRisk if skipped: month-end surprises because nobody ran the report."
      }
    ]);
    
    // Purchase Orders tutorial
    registerTutorial("purchase", [
      {
        id: "purchase-intro",
        title: "Purchase Management",
        text: "What you are seeing: workspaces for internal requests (requisitions) and external commitments (purchase orders).\n\nWhy it matters: separates “we want to buy” from “supplier is bound to deliver at this price”. \n\nRisk if skipped: maverick spend, no audit trail, or paying against unapproved demand."
      },
      {
        id: "requisition-creation",
        title: "Requisition Process",
        text: "What you are seeing: a structured request with quantity, need-by, and justification.\n\nWhy it matters: gives approvers facts before money is promised.\n\nRisk if skipped: buyers place POs without visibility of true priority or budget."
      },
      {
        id: "po-creation",
        title: "Purchase Order Creation",
        text: "What you are seeing: line-level detail sent to the supplier—SKU, qty, price, terms.\n\nWhy it matters: becomes the legal and logistical reference for receipt and invoice.\n\nRisk if skipped: receipts and three-way match fail because the PO never reflected reality."
      },
      {
        id: "po-approval",
        title: "Approval Workflow",
        text: "What you are seeing: gates so only authorized roles release spend.\n\nWhy it matters: protects cash and enforces policy.\n\nRisk if skipped: fraud, duplicate buys, or budget overruns."
      },
      {
        id: "po-tracking",
        title: "Order Tracking",
        text: "What you are seeing: status from drafted → sent → partially received → closed.\n\nWhy it matters: warehouse and finance plan around firm dates and quantities.\n\nRisk if skipped: you pay invoices for goods never received or miss escalations on late lines."
      }
    ]);
    
    // Barcode Scanner tutorial
    registerTutorial("barcode", [
      {
        id: "barcode-intro",
        title: "Barcode Functionality",
        text: "What you are seeing: scan and lookup paths tied to item identities.\n\nWhy it matters: floor speed and accuracy beat typing SKU strings.\n\nRisk if skipped: wrong item picked or counted, especially under time pressure."
      },
      {
        id: "barcode-scanning",
        title: "Scanning Items",
        text: "What you are seeing: camera or scanner input resolving to an item record.\n\nWhy it matters: enforces “scan what you move” discipline.\n\nRisk if skipped: pallets get mis-labeled and later locations disagree with the system."
      },
      {
        id: "barcode-generation",
        title: "Generate Codes",
        text: "What you are seeing: creation of new symbologies for labels.\n\nWhy it matters: every physical unit needs a stable bridge to the digital SKU.\n\nRisk if skipped: duplicate codes or unscannable prints break downstream automation."
      },
      {
        id: "bulk-scanning",
        title: "Bulk Operations",
        text: "What you are seeing: rapid consecutive scans for receiving or cycle counts.\n\nWhy it matters: keeps large batches honest with fewer keystrokes.\n\nRisk if skipped: receivers shortcut counts and variances explode at audit."
      },
      {
        id: "offline-scanning",
        title: "Offline Mode",
        text: "What you are seeing: queueing scans when the network drops.\n\nWhy it matters: warehouse work does not stop for Wi-Fi blips.\n\nRisk if skipped: people paper-log scans that never make it back into stock."
      }
    ]);
    
    // Real-time Sync tutorial
    registerTutorial("sync", [
      {
        id: "sync-intro",
        title: "Real-time Synchronization",
        text: "What you are seeing: mechanisms that keep sessions and inventory views aligned across devices.\n\nWhy it matters: everyone plans from the same on-hand truth.\n\nRisk if skipped: two sites think different quantities exist and transshipments misfire."
      },
      {
        id: "sync-status",
        title: "Connection Status",
        text: "What you are seeing: indicators that data is flowing or delayed.\n\nWhy it matters: tells you whether to trust the number on screen this second.\n\nRisk if skipped: users ship against stale stock and create negative balances."
      },
      {
        id: "offline-mode",
        title: "Offline Capabilities",
        text: "What you are seeing: local buffering of actions until the link returns.\n\nWhy it matters: keeps receiving lines moving in dead zones.\n\nRisk if skipped: queues grow until someone manually untangles conflicts."
      },
      {
        id: "sync-conflicts",
        title: "Conflict Resolution",
        text: "What you are seeing: prompts when two edits collide.\n\nWhy it matters: forces an explicit choice instead of silent overwrites.\n\nRisk if skipped: one site’s correction silently erases another’s receipt."
      },
      {
        id: "sync-settings",
        title: "Synchronization Settings",
        text: "What you are seeing: knobs for frequency or scope of updates.\n\nWhy it matters: balances freshness with bandwidth on poor links.\n\nRisk if skipped: either constant lag or battery drain—both frustrate floor staff."
      }
    ]);
    
    // Billing tutorial
    registerTutorial("billing", [
      {
        id: "billing-intro",
        title: "Billing Management",
        text: "What you are seeing: subscription or tenant billing for the ISSSourcing product itself (not supplier invoices).\n\nWhy it matters: keeps the platform available for your team.\n\nRisk if skipped: accidental suspension during month-end close."
      },
      {
        id: "subscription-details",
        title: "Subscription Plan",
        text: "What you are seeing: current tier, limits, and renewal timing.\n\nWhy it matters: capacity planning for users and integrations.\n\nRisk if skipped: hitting limits mid-quarter without noticing."
      },
      {
        id: "payment-methods",
        title: "Payment Methods",
        text: "What you are seeing: cards or mandates used for SaaS charges.\n\nWhy it matters: failed payments are almost always expired methods.\n\nRisk if skipped: unnecessary downtime over a simple card update."
      },
      {
        id: "invoice-history",
        title: "Invoice History",
        text: "What you are seeing: past platform invoices and status.\n\nWhy it matters: finance needs a GAAP-friendly trail of software spend.\n\nRisk if skipped: variances between accrued software costs and actuals."
      },
      {
        id: "billing-notifications",
        title: "Billing Notifications",
        text: "What you are seeing: alerts before charges fail or plans change.\n\nWhy it matters: time to fix issues before users feel impact.\n\nRisk if skipped: first notice of trouble is a locked-out buyer."
      }
    ]);
    
    registerTutorial("full-app", FULL_APP_TOUR_STEPS);
    for (const [tourId, steps] of Object.entries(PAGE_TOUR_DEFINITIONS)) {
      registerTutorial(tourId, steps);
    }
    for (const topic of GUIDED_LEARNING_TOPICS) {
      registerTutorial(topic.tourId, buildGuidedLearningTour(topic));
    }

    // Setup wizard: task-oriented onboarding flow
    registerTutorial("setup-wizard", [
      {
        id: "setup-intro",
        title: "Setup Wizard",
        text: "What you are seeing: a sequenced checklist to stand up warehouses, SKUs, suppliers, approvals, and a first PO.\n\nWhy it matters: gives new teams a guided path instead of random clicks.\n\nRisk if skipped: demos look empty or first real transactions fail missing master data.",
      },
      {
        id: "setup-warehouse",
        title: "Step 1: Add your first warehouse",
        text: "What you are seeing: creation of a location graph (site → aisles/bins as your org defines).\n\nWhy it matters: every receipt and pick needs a valid “put” destination.\n\nRisk if skipped: inventory balances exist only in a spreadsheet column, not in a place.",
      },
      {
        id: "setup-inventory",
        title: "Step 2: Add inventory items",
        text: "What you are seeing: SKU records with units, thresholds, and default stocking points.\n\nWhy it matters: enables reorder signals and accurate promising.\n\nRisk if skipped: buyers guess quantities and service levels wobble.",
      },
      {
        id: "setup-supplier",
        title: "Step 3: Add suppliers",
        text: "What you are seeing: approved vendor records for use on POs and contracts.\n\nWhy it matters: reduces one-off emails and keeps terms consistent.\n\nRisk if skipped: POs reference ad-hoc names finance cannot pay.",
      },
      {
        id: "setup-approvals",
        title: "Step 4: Configure approval rules",
        text: "What you are seeing: policy on who can approve what spend band.\n\nWhy it matters: protects budget without freezing small buys.\n\nRisk if skipped: either everything waits on one VP or everything sails through unchecked.",
      },
      {
        id: "setup-po",
        title: "Step 5: Create your first PO",
        text: "What you are seeing: a dry run of requisition → PO → receive to prove connectors work.\n\nWhy it matters: validates that procurement touch AP and inventory together.\n\nRisk if skipped: go-live day is the first time anyone noticed a broken hand-off.",
      },
    ]);

    // Database Management tutorial
    registerTutorial("database", [
      {
        id: "database-intro",
        title: "Database Management",
        text: "What you are seeing: how ISSSourcing connects to PostgreSQL for durable storage.\n\nWhy it matters: transactions, audit, and reporting all assume a healthy DB.\n\nRisk if skipped: silent data loss or corrupt backups that surface only during recovery."
      },
      {
        id: "connection-string",
        title: "Connection String",
        text: "What you are seeing: the DATABASE_URL style secret pointing at host, port, database, and credentials.\n\nWhy it matters: wrong host/user is the fastest way to “app won’t start.”\n\nRisk if skipped: teams thrash on firewall rules instead of validating the string."
      },
      {
        id: "db-setup",
        title: "Database Setup",
        text: "What you are seeing: prerequisites—running Postgres cluster and empty database.\n\nWhy it matters: migrations expect a blank schema they own.\n\nRisk if skipped: mixing dev and prod schemas on one DB."
      },
      {
        id: "schema-management",
        title: "Schema Management",
        text: "What you are seeing: Drizzle / migration workflow after model changes.\n\nWhy it matters: keeps API code and columns aligned.\n\nRisk if skipped: deploy succeeds but runtime queries explode on missing columns."
      },
      {
        id: "data-backup",
        title: "Backup and Recovery",
        text: "What you are seeing: reminders to snapshot before major changes.\n\nWhy it matters: supply-chain data is business-critical.\n\nRisk if skipped: ransom or fat-finger truncate with no restore story."
      }
    ]);
    
  // Empty dependency array intentional: register once on mount; isRegistered.current prevents re-registration
  // eslint-disable-next-line react-hooks/exhaustive-deps -- registerTutorial is stable, mount-only effect
  }, []);
  
  // This component doesn't render anything visible
  return null;
}
