import { APP_ROUTES } from "@/lib/routes/app-routes";

export type TrainingCategory = "Operations" | "Inventory" | "Procurement" | "Finance" | "Analytics" | "Admin";

export type TrainingFunction = {
  id: string;
  name: string;
  whatItDoes: string;
  whyItMatters: string;
  howToUse: string[];
  commonMistakes?: string[];
  relatedTerms?: string[];
};

export type TrainingModule = {
  id: string;
  title: string;
  route: string;
  category: TrainingCategory;
  estimatedMinutes: number;
  beginnerSummary: string;
  workplacePurpose: string;
  whoUsesIt: string;
  decisionsSupported: string;
  ifIgnored: string;
  keyTerms: {
    term: string;
    simpleDefinition: string;
    whyItMatters?: string;
  }[];
  functions: TrainingFunction[];
  workflowExample: string[];
  quickQuiz?: {
    question: string;
    options: string[];
    answer: string;
    explanation: string;
  }[];
  /** Extra phrases used only for search (aliases) */
  searchAliases?: string[];
};

function fn(p: TrainingFunction): TrainingFunction {
  return p;
}

export const TRAINING_MODULES: TrainingModule[] = [
  {
    id: "control-tower",
    title: "Control Tower",
    route: APP_ROUTES.operations.controlTower,
    category: "Operations",
    estimatedMinutes: 12,
    beginnerSummary:
      "The Control Tower is your operational dashboard: it pulls together KPIs and signals from procurement, inventory, logistics, and exceptions so you can see what needs attention before it becomes a crisis.",
    workplacePurpose:
      "Teams use it to monitor stock risk, shipment delays, purchase-order bottlenecks, and open issues in one place. It supports daily stand-ups, exception triage, and leadership check-ins without opening every module.",
    whoUsesIt: "Operations managers, planners, warehouse leads, finance partners, and executives who need a single snapshot of execution health.",
    decisionsSupported: "Which exceptions to tackle first, whether to expedite a supplier or shipment, and where inventory or PO backlogs threaten service or cash.",
    ifIgnored: "Problems surface late: stockouts, missed deliveries, angry suppliers, and firefighting instead of planned action.",
    keyTerms: [
      { term: "KPI", simpleDefinition: "Key performance indicator — a measurable number that shows health or risk.", whyItMatters: "Lets you compare areas at a glance." },
      { term: "Exception", simpleDefinition: "Something that broke a rule or needs a human decision (delay, mismatch, approval hold).", whyItMatters: "Left alone, exceptions often become customer or supplier problems." },
      { term: "Late / at-risk shipment", simpleDefinition: "A delivery that is behind schedule or likely to miss the committed date.", whyItMatters: "Drives expedite costs and customer dissatisfaction." },
    ],
    functions: [
      fn({
        id: "kpi-cards",
        name: "Operational KPI cards",
        whatItDoes: "Shows counts and totals such as late shipments, POs awaiting action, low-stock SKUs, and open exceptions.",
        whyItMatters: "You spot severity and volume before drilling into detail pages.",
        howToUse: ["Scan the cards top-down for anything red or unusually high.", "Click through shortcuts to logistics, POs, or exceptions when offered."],
        commonMistakes: ["Treating a single KPI in isolation — cross-check with related areas (e.g. low stock + late POs)."],
      }),
      fn({
        id: "activity-feed",
        name: "Recent activity",
        whatItDoes: "Lists recent operational events tied to shipments, POs, inventory, or exceptions.",
        whyItMatters: "Gives narrative context: what changed today and who might be affected.",
        howToUse: ["Read newest items first.", "Follow links to the underlying record to resolve or assign."],
      }),
      fn({
        id: "shortcuts",
        name: "Quick navigation",
        whatItDoes: "Buttons or links to exceptions, shipments, purchase orders, or other hubs.",
        whyItMatters: "Reduces time spent hunting the right workspace during an incident.",
        howToUse: ["Choose the area that matches the KPI or alert you are acting on."],
      }),
    ],
    workflowExample: [
      "Morning: open Control Tower and note any spike in late shipments or POs awaiting action.",
      "Click into logistics or PO workspaces to assign owners.",
      "Close the loop: update exception status or PO workflow so the tower reflects reality.",
    ],
    quickQuiz: [
      {
        question: "What is the main purpose of the Control Tower?",
        options: [
          "Replace detailed work in every module",
          "Provide one place to see operational risk and execution signals",
          "Store supplier contracts",
          "Print barcodes only",
        ],
        answer: "Provide one place to see operational risk and execution signals",
        explanation: "It summarizes cross-functional signals so you know where to drill in — not replace line-level tasks.",
      },
    ],
    searchAliases: ["dashboard", "kpi", "command center"],
  },
  {
    id: "inventory",
    title: "Inventory",
    route: APP_ROUTES.inventory.root,
    category: "Inventory",
    estimatedMinutes: 14,
    beginnerSummary:
      "The Inventory module is the master list of what you stock: SKUs, quantities, locations, and stock health signals such as low or negative availability.",
    workplacePurpose:
      "It tells planners and warehouse staff what is on hand, where it sits, and what might run out. Accurate inventory reduces expedites, returns, and customer disappointment.",
    whoUsesIt: "Planners, buyers, warehouse staff, finance (for valuation context), and auditors.",
    decisionsSupported: "Reorder timing, which warehouse to ship from, cycle count priorities, and whether a SKU is serviceable.",
    ifIgnored: "You promise stock you do not have, freeze cash in dead stock, or miss replenishment until it is an emergency.",
    keyTerms: [
      { term: "SKU", simpleDefinition: "Stock keeping unit — a specific product or packaging variant you track.", whyItMatters: "The atomic unit of inventory accuracy." },
      { term: "Available quantity", simpleDefinition: "Stock you can promise or pick after reservations.", whyItMatters: "Drives customer service and fulfillment promises." },
      { term: "Low stock", simpleDefinition: "On-hand or available below a defined threshold.", whyItMatters: "Early warning before stockout." },
    ],
    functions: [
      fn({
        id: "search-filter",
        name: "Search and filters",
        whatItDoes: "Narrows the list by text, location, category, or low-stock flags.",
        whyItMatters: "Quickly finds the few items causing risk in a large catalog.",
        howToUse: ["Enter SKU or description fragments.", "Toggle low-stock filters when preparing counts or reorders."],
      }),
      fn({
        id: "export",
        name: "Export",
        whatItDoes: "Downloads list data for spreadsheets or offline analysis.",
        whyItMatters: "Supports audits, offline planning, and sharing with stakeholders who do not use the app daily.",
        howToUse: ["Apply filters first, then export so the file matches what you see."],
        commonMistakes: ["Exporting the full catalog when you only needed the low-stock subset — wastes time and confuses readers."],
      }),
      fn({
        id: "detail-drill",
        name: "Item detail",
        whatItDoes: "Opens a single SKU to see movements, positions, and related PO context.",
        whyItMatters: "Root-cause analysis when totals on the list look wrong.",
        howToUse: ["Click a row or SKU link.", "Trace recent transactions before adjusting stock."],
      }),
    ],
    workflowExample: [
      "Filter to low stock before the production week.",
      "Open top offenders, confirm lead times with procurement, and create or approve reorders.",
      "After receipt, verify that available quantities updated.",
    ],
    quickQuiz: [
      {
        question: "Why is “available” quantity often more important than raw on-hand?",
        options: [
          "It never matters",
          "It reflects what you can actually promise after allocations or reservations",
          "It is always the same as on-hand",
          "It only applies to retail stores",
        ],
        answer: "It reflects what you can actually promise after allocations or reservations",
        explanation: "Reservations for orders or work orders reduce what you can still use or sell.",
      },
    ],
    searchAliases: ["stock", "sku", "items"],
  },
  {
    id: "warehouses",
    title: "Warehouses",
    route: APP_ROUTES.inventory.warehouses,
    category: "Inventory",
    estimatedMinutes: 10,
    beginnerSummary:
      "Warehouses are the physical or logical places where inventory lives. This area manages sites, zones, and stock positions so movements are traceable.",
    workplacePurpose:
      "Without warehouse structure, you cannot answer “where is it?” or plan put-away and picking. It is foundational for accurate fulfillment and audits.",
    whoUsesIt: "Warehouse managers, inventory controllers, and IT during setup.",
    decisionsSupported: "Where to receive, where to store slow movers, and how to split stock across regions.",
    ifIgnored: "Transfers and adjustments become guesswork; shrink and mis-picks increase.",
    keyTerms: [
      { term: "Warehouse master", simpleDefinition: "The record of a stocking location (building or depot).", whyItMatters: "Every quantity ties back to a place." },
      { term: "Bin / location", simpleDefinition: "A sub-location inside a warehouse for precise picking.", whyItMatters: "Speeds operators and reduces search time." },
    ],
    functions: [
      fn({
        id: "warehouse-list",
        name: "Warehouse list",
        whatItDoes: "Shows all stocking sites and key metadata.",
        whyItMatters: "Lets you confirm coverage across regions or business units.",
        howToUse: ["Verify active sites match real operations.", "Drill into a warehouse for positions or tasks."],
      }),
      fn({
        id: "detail",
        name: "Warehouse detail",
        whatItDoes: "Shows SKUs and quantities associated with a warehouse.",
        whyItMatters: "Supports slotting, cycle counting, and investigating imbalances.",
        howToUse: ["Compare physical counts to system positions.", "Coordinate with inbound/outbound schedules."],
      }),
    ],
    workflowExample: [
      "New site opens: create warehouse, define structure, assign default put-away rules.",
      "Monthly: spot-check high-volume SKUs per warehouse before financial close.",
    ],
    quickQuiz: [
      {
        question: "Why define warehouses before trusting inventory totals?",
        options: [
          "You should not",
          "Quantities and movements are tracked per location — structure comes first",
          "Warehouses are only cosmetic labels",
          "Only finance uses warehouses",
        ],
        answer: "Quantities and movements are tracked per location — structure comes first",
        explanation: "Location hierarchy is how the system knows where stock belongs.",
      },
    ],
    searchAliases: ["locations.depot", "sites"],
  },
  {
    id: "warehouse-operations",
    title: "Warehouse Operations",
    route: APP_ROUTES.inventory.warehouseOperations,
    category: "Inventory",
    estimatedMinutes: 12,
    beginnerSummary:
      "Warehouse Operations is where day-to-day execution happens: tasks that reflect how product moves through receiving, put-away, picking, and adjustments.",
    workplacePurpose:
      "Bridges planning (what we need) and physical work (what we do). Keeps the system aligned with the floor so planners do not rely on stale quantities.",
    whoUsesIt: "Warehouse leads, receivers, pickers, inventory analysts.",
    decisionsSupported: "Task prioritization, whether to reprioritize inbound, and when to escalate a location that will miss a shipment.",
    ifIgnored: "System inventory drifts from reality; customers get wrong promises.",
    keyTerms: [
      { term: "Put-away", simpleDefinition: "Moving received goods from dock to storage locations.", whyItMatters: "Stock is not usable until it is put away correctly." },
      { term: "Allocation", simpleDefinition: "Reserving stock for an order or task.", whyItMatters: "Prevents double-promising the same unit." },
    ],
    functions: [
      fn({
        id: "task-queues",
        name: "Operational queues",
        whatItDoes: "Surfaces work items such as pending moves or confirmations.",
        whyItMatters: "Operators know what to do next without manual lists.",
        howToUse: ["Sort by due time or customer priority.", "Complete tasks in the app so inventory updates immediately."],
      }),
      fn({
        id: "adjustments",
        name: "Adjustments and corrections",
        whatItDoes: "Records gains/losses or corrections after counts or damage.",
        whyItMatters: "Keeps financial and service records honest.",
        howToUse: ["Always tie adjustments to a reason code or reference when offered.", "Escalate recurring variances to inventory control."],
        commonMistakes: ["Repeating small manual fixes instead of fixing root cause (damage, theft, process gap)."],
      }),
    ],
    workflowExample: [
      "Inbound arrives: receive, put away, confirm in system.",
      "Outbound wave: pick, pack, ship, confirm picks.",
      "End of shift: clear exceptions or flag stuck transactions.",
    ],
    quickQuiz: [
      {
        question: "Why should floor staff confirm tasks in the system promptly?",
        options: [
          "It is optional paperwork",
          "So planners and customers see accurate available stock",
          "Only managers need updates",
          "The system does not use confirmations",
        ],
        answer: "So planners and customers see accurate available stock",
        explanation: "Delays between physical work and system updates create false availability.",
      },
    ],
    searchAliases: ["wh operations", "floor"],
  },
  {
    id: "cycle-counts",
    title: "Cycle Counts",
    route: APP_ROUTES.inventory.cycleCounts,
    category: "Inventory",
    estimatedMinutes: 11,
    beginnerSummary:
      "Cycle counting is counting a subset of inventory on a schedule instead of shutting down for one huge annual count.",
    workplacePurpose:
      "Maintains accuracy with less disruption. Catches drift from theft, damage, mis-picks, or system errors before they snowball.",
    whoUsesIt: "Inventory controllers, warehouse supervisors, auditors.",
    decisionsSupported: "Which SKUs or locations to count next, whether to adjust books, and whether a process is broken.",
    ifIgnored: "Year-end surprises, write-offs, and mistrust between finance and operations.",
    keyTerms: [
      { term: "Cycle count program", simpleDefinition: "A planned list of counts (by ABC class, risk, or location).", whyItMatters: "Spreads workload and focuses on high-risk SKUs." },
      { term: "Variance", simpleDefinition: "Difference between counted quantity and system quantity.", whyItMatters: "Signals control issues or master data errors." },
    ],
    functions: [
      fn({
        id: "plan-counts",
        name: "Plan / select scope",
        whatItDoes: "Defines what to count and when.",
        whyItMatters: "Without scope, teams wander or recount low-value items.",
        howToUse: ["Align scope with policy (e.g. A items monthly).", "Coordinate with receiving so docks are not double-counted mid-shift."],
      }),
      fn({
        id: "post-results",
        name: "Record results",
        whatItDoes: "Posts count outcomes and generates adjustments.",
        whyItMatters: "Closes the loop so system matches physical reality.",
        howToUse: ["Count blind when possible to avoid bias.", "Investigate large variances before posting."],
        commonMistakes: ["Posting adjustments without finding the root cause of repeat variances."],
      }),
    ],
    workflowExample: [
      "Monday: system suggests fast movers in aisle A.",
      "Counters scan and record; supervisor reviews variances > 2%.",
      "Post adjustments and open investigation for repeat offenders.",
    ],
    quickQuiz: [
      {
        question: "What is a main benefit of cycle counting over annual wall-to-wall counts?",
        options: [
          "It eliminates the need for any counting",
          "Problems are found earlier with less operational disruption",
          "It only applies to retail",
          "It removes finance oversight",
        ],
        answer: "Problems are found earlier with less operational disruption",
        explanation: "Smaller, frequent counts keep accuracy trending without stopping the whole site.",
      },
    ],
    searchAliases: ["stock take", "count sheet"],
  },
  {
    id: "reorder-requests",
    title: "Reorder Requests",
    route: APP_ROUTES.inventory.reorder,
    category: "Inventory",
    estimatedMinutes: 10,
    beginnerSummary:
      "Reorder requests are structured asks to replenish stock when demand, safety stock, or projects say you are running low.",
    workplacePurpose:
      "Separates “we need stock” from the formal purchase order. Helps prioritize what buying should work on when supply is tight.",
    whoUsesIt: "Planners, store managers, production schedulers feeding procurement.",
    decisionsSupported: "What to buy next, how much, and whether to expedite or substitute.",
    ifIgnored: "Ad-hoc emails and spreadsheets hide demand; buyers miss urgency until stockouts.",
    keyTerms: [
      { term: "Reorder point", simpleDefinition: "Inventory level triggering replenishment review.", whyItMatters: "Balances carrying cost vs stockout risk." },
      { term: "Safety stock", simpleDefinition: "Buffer for demand or lead-time variability.", whyItMatters: "Absorbs small surprises without stockout." },
    ],
    functions: [
      fn({
        id: "create-request",
        name: "Create request",
        whatItDoes: "Captures item, quantity, need-by, and justification.",
        whyItMatters: "Gives procurement an auditable queue instead of chat messages.",
        howToUse: ["Be specific on quantity and date.", "Link to production or customer order when applicable."],
      }),
      fn({
        id: "prioritize",
        name: "Review queue",
        whatItDoes: "Shows open requests by urgency and category.",
        whyItMatters: "Aligns limited buyer capacity with highest service risk.",
        howToUse: ["Triage by stockout risk and contractual deadlines.", "Decline or defer with a reason so requesters understand."],
      }),
    ],
    workflowExample: [
      "Planner sees low stock alert, files reorder request with need-by Friday.",
      "Buyer converts approved need into a PO or adds to consolidated buy.",
      "Receipt updates inventory and closes the loop.",
    ],
    quickQuiz: [
      {
        question: "Why use reorder requests instead of only informal emails?",
        options: [
          "Emails are always better",
          "Requests create an auditable queue with dates and quantities",
          "Requests prevent any purchase orders",
          "Requests are only for IT",
        ],
        answer: "Requests create an auditable queue with dates and quantities",
        explanation: "Structured intake reduces confusion and helps prioritize under constraints.",
      },
    ],
    searchAliases: ["replenishment", "reorder"],
  },
  {
    id: "barcode-scanner",
    title: "Barcode Scanner",
    route: APP_ROUTES.inventory.barcodeScanner,
    category: "Inventory",
    estimatedMinutes: 8,
    beginnerSummary:
      "The barcode scanner ties physical labels to system records so you can look up, receive, or move items faster and with fewer typos.",
    workplacePurpose:
      "Speed and accuracy at the dock and on the floor. Scanning reduces wrong-SKU picks that cause returns and rework.",
    whoUsesIt: "Warehouse operators, cycle counters, sometimes retail-style backrooms.",
    decisionsSupported: "Is this the right SKU? Where should it go next? Did this unit already move?",
    ifIgnored: "Manual entry mistakes compound; training new hires takes longer.",
    keyTerms: [
      { term: "GTIN / barcode", simpleDefinition: "Encoded identifier on a label.", whyItMatters: "Machine-readable link to master data." },
      { term: "Scan verify", simpleDefinition: "Confirming system and label agree before acting.", whyItMatters: "Prevents silent wrong picks." },
    ],
    functions: [
      fn({
        id: "scan-lookup",
        name: "Lookup by scan",
        whatItDoes: "Resolves a scan to SKU and shows status or instructions.",
        whyItMatters: "Instant validation without memorizing codes.",
        howToUse: ["Allow camera permissions if using device camera.", "Rescan if label is damaged — use manual fallback cautiously."],
      }),
      fn({
        id: "execute-flow",
        name: "Workflow actions",
        whatItDoes: "May tie into receive, pick, or count flows depending on configuration.",
        whyItMatters: "Keeps transactions consistent with policy.",
        howToUse: ["Follow on-screen prompts in order.", "Do not skip confirmation screens when compliance requires them."],
        commonMistakes: ["Scanning too quickly without reading the confirmation — leads to wrong bin commits."],
      }),
    ],
    workflowExample: [
      "Receiver scans PO line item label at dock.",
      "System confirms expected SKU and quantity.",
      "Put-away instruction displays target zone.",
    ],
    quickQuiz: [
      {
        question: "What problem does scanning primarily reduce compared to manual typing?",
        options: ["Strategic planning errors", "Transcription mistakes on item identifiers", "Supplier selection", "Tax calculation"],
        answer: "Transcription mistakes on item identifiers",
        explanation: "Barcodes encode IDs so humans do not mis-key similar SKUs.",
      },
    ],
    searchAliases: ["qr", "scan", "camera"],
  },
  {
    id: "purchase-orders",
    title: "Purchase Orders",
    route: APP_ROUTES.procurement.orders,
    category: "Procurement",
    estimatedMinutes: 15,
    beginnerSummary:
      "A purchase order (PO) is the formal document sent to a supplier confirming what you will buy, in what quantity, at what price, and under what terms.",
    workplacePurpose:
      "Creates a legally and operationally clear commitment. Receiving, invoicing, and three-way matching all trace back to the PO.",
    whoUsesIt: "Buyers, procurement managers, AP staff, suppliers.",
    decisionsSupported: "Whether to approve spend, which supplier to use, and how much inventory to bring in.",
    ifIgnored: "Unauthorized spend, receipt confusion, invoice disputes, and audit findings.",
    keyTerms: [
      { term: "PO", simpleDefinition: "Purchase order.", whyItMatters: "Core contract-to-pay anchor." },
      { term: "Approval workflow", simpleDefinition: "Sequence of authorizations based on policy.", whyItMatters: "Enforces delegation of authority and budget control." },
      { term: "Line item", simpleDefinition: "One SKU or service line on the PO with qty and price.", whyItMatters: "Receiving and invoicing match at line level." },
    ],
    functions: [
      fn({
        id: "po-list",
        name: "PO list & filters",
        whatItDoes: "Shows POs by status, supplier, or search text.",
        whyItMatters: "Finds commitments that are stuck or ready to receive.",
        howToUse: ["Filter by status (draft, approved, sent, received).", "Use search for PO number fragments."],
      }),
      fn({
        id: "po-detail",
        name: "PO detail",
        whatItDoes: "Displays lines, totals, terms, history.",
        whyItMatters: "Resolves mismatch questions with suppliers or AP.",
        howToUse: ["Compare ordered vs received quantities before approving invoices.", "Track approvals and changes."],
      }),
      fn({
        id: "export-pdf",
        name: "Export / share",
        whatItDoes: "May export a signable or shareable PDF for the supplier.",
        whyItMatters: "Formal proof of what was sent vs verbally agreed.",
        howToUse: ["Generate after final approval.", "Version-control: avoid two conflicting PDFs for the same PO number."],
        commonMistakes: ["Sending a draft PO externally before approvals complete."],
      }),
    ],
    workflowExample: [
      "Planner converts approved requisition to PO draft.",
      "Manager approves; buyer sends to supplier.",
      "Warehouse receives against PO lines; AP invoices match to PO and receipt.",
    ],
    quickQuiz: [
      {
        question: "Why is the PO central to procure-to-pay?",
        options: [
          "It is optional",
          "It links what was ordered, received, and invoiced",
          "It replaces inventory entirely",
          "It is only for marketing",
        ],
        answer: "It links what was ordered, received, and invoiced",
        explanation: "Matching flows use PO, receipt, and invoice together.",
      },
    ],
    searchAliases: ["po", "order desk"],
  },
  {
    id: "requisitions",
    title: "Requisitions",
    route: APP_ROUTES.procurement.requisitions,
    category: "Procurement",
    estimatedMinutes: 12,
    beginnerSummary:
      "A requisition is an internal request to buy something before it becomes a PO. It captures need, quantity, and justification for approval.",
    workplacePurpose:
      "Controls spend and documents need. Stops casual purchasing that bypasses budget and policy.",
    whoUsesIt: "Requesters, department managers, procurement, finance approvers.",
    decisionsSupported: "Whether demand is valid, funded, and from an approved supplier path.",
    ifIgnored: "Maverick spend, duplicated requests, budget overruns.",
    keyTerms: [
      { term: "Requisition", simpleDefinition: "Internal purchase request.", whyItMatters: "Gate before commitment to supplier." },
      { term: "Approval chain", simpleDefinition: "Who must bless higher amounts or categories.", whyItMatters: "Enforces governance." },
    ],
    functions: [
      fn({
        id: "create-req",
        name: "New requisition",
        whatItDoes: "Captures items, qty, needed-by, notes.",
        whyItMatters: "Creates an auditable intake record.",
        howToUse: ["Use catalogs or item masters when available.", "Attach specs or links for non-catalog buys."],
      }),
      fn({
        id: "approve-convert",
        name: "Approve / convert to PO",
        whatItDoes: "Approves spend and may spawn PO creation.",
        whyItMatters: "Connects governance to execution.",
        howToUse: ["Reject with a reason so requesters can fix.", "Ensure supplier and price align with contract when applicable."],
        commonMistakes: ["Approving vague descriptions that suppliers cannot quote reliably."],
      }),
    ],
    workflowExample: [
      "Engineering requests specialty parts with drawing link.",
      "Manager approves budget; procurement assigns supplier.",
      "Buyer converts to PO after final terms check.",
    ],
    quickQuiz: [
      {
        question: "What is the main difference between a requisition and a PO?",
        options: [
          "They are identical",
          "A requisition is internal need; a PO is supplier-facing commitment",
          "Only AP creates requisitions",
          "POs never need approval",
        ],
        answer: "A requisition is internal need; a PO is supplier-facing commitment",
        explanation: "Requisitions control internal intent; POs communicate and bind externally.",
      },
    ],
    searchAliases: ["req", "purchase request"],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    route: APP_ROUTES.procurement.suppliers,
    category: "Procurement",
    estimatedMinutes: 11,
    beginnerSummary:
      "The Suppliers area holds vendor master data: legal names, contacts, payment terms, and performance context used in POs and AP.",
    workplacePurpose:
      "One trusted record of who you buy from. Reduces duplicate vendors, wrong payment details, and contractual leakage.",
    whoUsesIt: "Procurement, AP, legal/compliance, warehouse (contacts).",
    decisionsSupported: "Which vendors are active, preferred, or blocked; how you pay them.",
    ifIgnored: "Split master data, incorrect bank details, missed contract renewals.",
    keyTerms: [
      { term: "Vendor master", simpleDefinition: "System of record for supplier identity and terms.", whyItMatters: "Feeds PO and payment rails." },
      { term: "Payment terms", simpleDefinition: "When payment is due (e.g. Net 30).", whyItMatters: "Cash flow and AP scheduling." },
    ],
    functions: [
      fn({
        id: "supplier-list",
        name: "Supplier directory",
        whatItDoes: "Lists suppliers with status and key fields.",
        whyItMatters: "Quick verification before issuing PO or payment.",
        howToUse: ["Deactivate vendors you no longer use.", "Avoid duplicate entries for the same entity."],
      }),
      fn({
        id: "supplier-detail",
        name: "Supplier profile",
        whatItDoes: "Shows contacts, addresses, notes, related transactions.",
        whyItMatters: "Resolves operational questions without email archaeology.",
        howToUse: ["Confirm tax IDs and remit-to before onboarding.", "Store insurance or cert expiry dates when required."],
        commonMistakes: ["Outdated remit-to addresses leading to failed payments."],
      }),
    ],
    workflowExample: [
      "Onboard new vendor: collect W-9/tax, banking, insurance.",
      "Procurement marks preferred for a category.",
      "AP validates terms before first pay run.",
    ],
    quickQuiz: [
      {
        question: "Why keep supplier master data clean?",
        options: [
          "It is only cosmetic",
          "POs, receipts, and payments all reference the same trusted identity",
          "Suppliers never change",
          "Only IT uses supplier data",
        ],
        answer: "POs, receipts, and payments all reference the same trusted identity",
        explanation: "Broken master data propagates into wrong payees and audit gaps.",
      },
    ],
    searchAliases: ["vendors"],
  },
  {
    id: "contracts",
    title: "Contracts",
    route: APP_ROUTES.procurement.contracts,
    category: "Procurement",
    estimatedMinutes: 10,
    beginnerSummary:
      "Contracts store negotiated terms—prices, volumes, SLAs, and validity periods—that procurement and AP rely on when ordering and paying.",
    workplacePurpose:
      "Ensures you buy and pay according to agreement, not ad-hoc pricing. Supports compliance and renewal discipline.",
    whoUsesIt: "Procurement, legal, finance, category managers.",
    decisionsSupported: "Which price list applies, whether spend is in-policy, when to renegotiate.",
    ifIgnored: "Leakage to spot pricing, missed volume rebates, disputes.",
    keyTerms: [
      { term: "MSA", simpleDefinition: "Master services agreement — umbrella legal terms.", whyItMatters: "Frames subsequent POs and statements of work." },
      { term: "Rebate / tier", simpleDefinition: "Discounts tied to volume thresholds.", whyItMatters: "Material dollars if tracked." },
    ],
    functions: [
      fn({
        id: "repository",
        name: "Contract repository",
        whatItDoes: "Central list of agreements and metadata.",
        whyItMatters: "Find active deal quickly during quoting or invoice challenge.",
        howToUse: ["Tag by category and supplier.", "Set renewal alerts."],
      }),
      fn({
        id: "link-to-buying",
        name: "Reference in buying",
        whatItDoes: "Supports checking PO prices against agreed terms.",
        whyItMatters: "Catches overbilling early.",
        howToUse: ["When prices spike, verify against contract schedule.", "Escalate mismatches to supplier account manager."],
      }),
    ],
    workflowExample: [
      "Negotiate annual IT hardware deal; store in contracts with price breaks.",
      "Buyer references schedule when building PO lines.",
      "AP challenges invoice price against contract line.",
    ],
    quickQuiz: [
      {
        question: "Why link purchasing and invoicing to contracts?",
        options: [
          "Contracts are never used",
          "To enforce negotiated prices and terms in execution",
          "Contracts replace POs entirely",
          "Only legal reads contracts",
        ],
        answer: "To enforce negotiated prices and terms in execution",
        explanation: "Execution systems operationalize what legal negotiated.",
      },
    ],
    searchAliases: ["agreements", "msa"],
  },
  {
    id: "accounts-payable",
    title: "Accounts Payable",
    route: APP_ROUTES.finance.accountsPayable,
    category: "Finance",
    estimatedMinutes: 16,
    beginnerSummary:
      "Accounts Payable (AP) manages money owed to suppliers for goods or services already received or agreed—turning validated invoices into scheduled payments.",
    workplacePurpose:
      "AP ensures you pay the right supplier the right amount at the right time—after proper checks. It reduces duplicate payments, fraud risk, late fees, and damaged supplier relationships.",
    whoUsesIt: "AP clerks, controllers, procurement partners resolving receipt issues, auditors.",
    decisionsSupported: "Whether an invoice can be paid, when to pay, and how to resolve exceptions.",
    ifIgnored: "Duplicate or erroneous payments, strained suppliers, missed early-pay discounts, audit findings.",
    keyTerms: [
      { term: "Invoice", simpleDefinition: "Supplier document requesting payment for delivered goods/services.", whyItMatters: "Legal and cash-out trigger when valid." },
      { term: "Goods received note (GRN)", simpleDefinition: "Evidence of physical or logical receipt.", whyItMatters: "Proves you got what you are paying for." },
      { term: "Three-way match", simpleDefinition: "Compare PO, receipt, and invoice for quantity/price alignment.", whyItMatters: "Primary control against overpaying or paying for ghost orders." },
      { term: "Payment status", simpleDefinition: "Lifecycle stage: pending, approved, scheduled, paid, disputed, overdue.", whyItMatters: "Cash forecasting and supplier communication." },
    ],
    functions: [
      fn({
        id: "view-invoices",
        name: "View invoices / intake",
        whatItDoes: "Shows supplier invoices awaiting coding, match, or approval.",
        whyItMatters: "Finance knows what cash is about to leave and can prioritize risky items.",
        howToUse: ["Open AP workspace, review intake queue.", "Validate supplier, PO linkage, amounts, and tax."],
      }),
      fn({
        id: "match-po",
        name: "Match invoice to PO and receipt",
        whatItDoes: "Aligns billed lines with what was ordered and received.",
        whyItMatters: "Prevents paying for items not ordered or not received.",
        howToUse: ["Open invoice detail, verify PO line quantities and prices.", "Flag quantity or price breaks for buyer or supplier correction."],
        commonMistakes: ["Force-approving mismatches to “clear the queue” — creates cash and audit risk."],
      }),
      fn({
        id: "exceptions",
        name: "Exception handling",
        whatItDoes: "Routes invoices that fail match or policy to a resolution queue.",
        whyItMatters: "Structured path instead of sticky notes and side email.",
        howToUse: ["Document the root cause.", "Loop in procurement for price answers or warehouse for receipt proof."],
      }),
    ],
    workflowExample: [
      "Supplier delivers office equipment; warehouse confirms receipt.",
      "Supplier emails invoice; AP matches to PO and GRN.",
      "If matched, invoice is approved for the next pay batch; if not, exception goes to buyer for price confirmation.",
    ],
    quickQuiz: [
      {
        question: "Why does AP use a three-way match?",
        options: [
          "To slow down suppliers intentionally",
          "To confirm you only pay for what was ordered and received, at agreed prices",
          "Because POs are optional",
          "Only for payroll",
        ],
        answer: "To confirm you only pay for what was ordered and received, at agreed prices",
        explanation: "Matching ties obligation (PO), fulfillment (receipt), and bill (invoice).",
      },
    ],
    searchAliases: ["ap", "invoice"],
  },
  {
    id: "payments",
    title: "Payments",
    route: APP_ROUTES.finance.accountsPayablePayments,
    category: "Finance",
    estimatedMinutes: 11,
    beginnerSummary:
      "Payments covers scheduling and executing outbound cash to suppliers—often in batches—with controls and audit trails.",
    workplacePurpose:
      "Centralizes cash-out timing, reduces duplicate sends, and supports working capital decisions (pay now vs pay on due date).",
    whoUsesIt: "Treasury, AP leads, controllers.",
    decisionsSupported: "Which invoices join a batch, payment method, and pay date.",
    ifIgnored: "Double pays, late pays, cash surprises.",
    keyTerms: [
      { term: "Payment batch", simpleDefinition: "Grouped approved invoices sent to bank together.", whyItMatters: "Operational efficiency and control." },
      { term: "Remittance", simpleDefinition: "Notice showing which invoices a payment settles.", whyItMatters: "Supplier applies cash correctly." },
    ],
    functions: [
      fn({
        id: "build-batch",
        name: "Build payment batch",
        whatItDoes: "Selects approved invoices meeting pay rules.",
        whyItMatters: "Structured release instead of one-off wires without oversight.",
        howToUse: ["Respect due dates and early-pay discounts.", "Segregate duties: preparer vs approver where required."],
      }),
      fn({
        id: "release",
        name: "Approve / release",
        whatItDoes: "Final authorization before funds move.",
        whyItMatters: "Fraud and error control point.",
        howToUse: ["Reconcile batch totals to bank limits.", "Confirm supplier bank details on file."],
        commonMistakes: ["Reusing old bank details after supplier notifies change without verification."],
      }),
    ],
    workflowExample: [
      "Daily: gather invoices approved through Tuesday.",
      "Treasury builds batch, CFO approves high value.",
      "Bank file releases; remittance advices emailed to suppliers.",
    ],
    quickQuiz: [
      {
        question: "Why batch supplier payments?",
        options: [
          "To eliminate invoices",
          "For control, efficiency, and clear remittance grouping",
          "Batches are illegal",
          "Only for payroll",
        ],
        answer: "For control, efficiency, and clear remittance grouping",
        explanation: "Batching pairs operational rhythm with governance.",
      },
    ],
    searchAliases: ["batch pay", "treasury"],
  },
  {
    id: "analytics",
    title: "Analytics Overview",
    route: APP_ROUTES.analytics.overview,
    category: "Analytics",
    estimatedMinutes: 13,
    beginnerSummary:
      "Analytics turns operational data into KPIs and trends—inventory value, procurement spend posture, and risk signals—for decisions that are too big for a single list view.",
    workplacePurpose:
      "Supports leadership and functional managers with consistent metrics. Reduces one-off spreadsheet extracts that go stale.",
    whoUsesIt: "Planners, ops managers, finance BP, executives.",
    decisionsSupported: "Where to cut inventory dollars, which categories are growing, and whether service targets are at risk.",
    ifIgnored: "Decisions rely on anecdotes; cross-functional teams argue from different numbers.",
    keyTerms: [
      { term: "KPI registry", simpleDefinition: "Catalog of defined metrics with consistent definitions.", whyItMatters: "Stops dueling spreadsheets." },
      { term: "Drilldown", simpleDefinition: "Moving from summary to supporting detail.", whyItMatters: "Turns insight into action owner." },
    ],
    functions: [
      fn({
        id: "workspace-nav",
        name: "Section navigation",
        whatItDoes: "Switches between overview, inventory, procurement, finance, logistics lenses.",
        whyItMatters: "Frames questions by domain expert.",
        howToUse: ["Pick the lens matching your decision.", "Escalate cross-domain issues with shared screenshots."],
      }),
      fn({
        id: "kpi-cards",
        name: "KPI cards and charts",
        whatItDoes: "Visual and numeric summaries tied to live data.",
        whyItMatters: "Shows movement over time, not only point-in-time lists.",
        howToUse: ["Check footnotes or filters for date scope.", "Pair KPIs with operational queues when investigating spikes."],
      }),
    ],
    workflowExample: [
      "Weekly ops review: open analytics overview, note inventory trend vs PO fill rate.",
      "Drill to procurement lens for category spend.",
      "Assign buyer actions for top variance suppliers.",
    ],
    quickQuiz: [
      {
        question: "Why define KPIs centrally in analytics instead of ad-hoc Excel only?",
        options: [
          "Excel is always wrong",
          "Shared definitions reduce arguing about different numbers",
          "Analytics never uses data",
          "KPIs are only for HR",
        ],
        answer: "Shared definitions reduce arguing about different numbers",
        explanation: "Consistency builds trust and speed in cross-functional decisions.",
      },
    ],
    searchAliases: ["bi", "kpi"],
  },
  {
    id: "reports",
    title: "Reports",
    route: APP_ROUTES.analytics.reports,
    category: "Analytics",
    estimatedMinutes: 12,
    beginnerSummary:
      "Reports provide structured tabular outputs—inventory, orders, suppliers, shipments—often exportable for audit, tax, or operations review.",
    workplacePurpose:
      "Answers repeatable questions on a schedule (month-end inventory valuation, open PO aging) with evidence you can file.",
    whoUsesIt: "Finance, inventory control, compliance, planners.",
    decisionsSupported: "Accruals, reserve calculations, performance reviews, regulatory submissions.",
    ifIgnored: "Fire drills at period close; weaker audit trail.",
    keyTerms: [
      { term: "Cut-off", simpleDefinition: "Point in time a report includes transactions through.", whyItMatters: "Material to financial accuracy." },
      { term: "Export", simpleDefinition: "Download in csv/excel/pdf for sharing.", whyItMatters: "Stakeholder communication outside the app." },
    ],
    functions: [
      fn({
        id: "select-template",
        name: "Choose report type",
        whatItDoes: "Picks domain-specific templates (inventory, PO, etc.).",
        whyItMatters: "Right columns and joins without manual query writing.",
        howToUse: ["Select template matching the business question.", "Apply date and org filters before export."],
      }),
      fn({
        id: "preview-export",
        name: "Preview and export",
        whatItDoes: "Shows data sample and generates files.",
        whyItMatters: "Verifies filters before publishing numbers externally.",
        howToUse: ["Reconcile totals to analytics KPIs for sanity.", "Version file names with date for archiving."],
        commonMistakes: ["Circulating an export without stating the filter — readers assume it is all-time."],
      }),
    ],
    workflowExample: [
      "Month-end: run inventory valuation as-of last day.",
      "Compare to GL preview; investigate top variances.",
      "File export with close workpapers.",
    ],
    quickQuiz: [
      {
        question: "Why note the report cut—off date when sharing exports?",
        options: [
          "It is optional flavor text",
          "So readers know which transactions are included — reduces misinterpretation",
          "Dates confuse everyone",
          "Reports never change by date",
        ],
        answer: "So readers know which transactions are included — reduces misinterpretation",
        explanation: "The same report name can show different totals on different dates.",
      },
    ],
    searchAliases: ["export", "spreadsheet"],
  },
  {
    id: "admin-settings",
    title: "Admin / Settings",
    route: APP_ROUTES.admin.settings,
    category: "Admin",
    estimatedMinutes: 14,
    beginnerSummary:
      "Settings configure how InvTrack behaves for your organization: naming, inventory rules, security, integrations, tax, and more.",
    workplacePurpose:
      "Aligns software behavior to policy and local regulations. Poor settings cause silent wrong behavior everywhere else.",
    whoUsesIt: "Administrators, IT, finance for tax/billing modules, operations for warehouse defaults.",
    decisionsSupported: "Security posture, default thresholds, compliance toggles, integration endpoints.",
    ifIgnored: "Users workaround broken defaults; data quality erodes; audits find access control gaps.",
    keyTerms: [
      { term: "Tenant / org settings", simpleDefinition: "Configuration scoped to your company instance.", whyItMatters: "Separates your rules from other customers in multi-tenant SaaS." },
      { term: "Role-based access", simpleDefinition: "Permissions mapped to job functions.", whyItMatters: "Least privilege security." },
    ],
    functions: [
      fn({
        id: "general",
        name: "General & appearance",
        whatItDoes: "Branding, locale, user-visible preferences.",
        whyItMatters: "Consistency for users and external documents.",
        howToUse: ["Pilot changes in non-peak hours.", "Communicate changes that alter numbering or formats."],
      }),
      fn({
        id: "inventory-security",
        name: "Inventory & security",
        whatItDoes: "Rules for stock, warehouses, passwords, sessions.",
        whyItMatters: "Protects assets and data.",
        howToUse: ["Review dormant users quarterly.", "Align inventory policies with physical capabilities."],
        commonMistakes: ["Giving everyone admin to “speed things up”."],
      }),
    ],
    workflowExample: [
      "Go-live: set company name, currency, default warehouse, tax mode.",
      "Hardening: enforce MFA policy, review role assignments.",
      "Annual: verify integration credentials still valid.",
    ],
    quickQuiz: [
      {
        question: "Why restrict admin settings to trusted roles?",
        options: [
          "Settings do nothing",
          "Misconfiguration affects every module and user",
          "Only developers use settings",
          "Settings are public",
        ],
        answer: "Misconfiguration affects every module and user",
        explanation: "A wrong threshold or integration key poisons downstream workflows.",
      },
    ],
    searchAliases: ["configuration", "preferences"],
  },
  {
    id: "system-diagnostics",
    title: "System Diagnostics",
    route: APP_ROUTES.admin.systemDiagnostics,
    category: "Admin",
    estimatedMinutes: 9,
    beginnerSummary:
      "System Diagnostics is the install-health view: database connectivity, onboarding state, export paths, and build metadata — used when something is wrong or before go-live.",
    workplacePurpose:
      "Shortens time-to-resolution for IT and support by surfacing objective checks instead of guessing.",
    whoUsesIt: "IT admins, implementers, support engineers, power users during cutover.",
    decisionsSupported: "Whether the environment is safe to use for financial transactions; what remediation step next.",
    ifIgnored: "Users blame “the app” when the DB or path setup is broken.",
    keyTerms: [
      { term: "Readiness probe", simpleDefinition: "Lightweight health check endpoint.", whyItMatters: "Quick signal before deep tests." },
      { term: "Setup status", simpleDefinition: "Product onboarding completion snapshot.", whyItMatters: "Explains blocked navigation or missing master data." },
    ],
    functions: [
      fn({
        id: "health-tiles",
        name: "Status summary",
        whatItDoes: "Shows pass/fail style indicators for key subsystems.",
        whyItMatters: "Immediate triage.",
        howToUse: ["Read failing tile first.", "Use copy/export bundle for vendor support tickets when available."],
      }),
      fn({
        id: "remediation-links",
        name: "Guided next steps",
        whatItDoes: "Links back to setup, onboarding, or docs.",
        whyItMatters: "Turns diagnosis into action.",
        howToUse: ["Follow links in order.", "Retry probes after fixes."],
      }),
    ],
    workflowExample: [
      "User reports export failure; admin opens diagnostics — path not writable.",
      "Fix folder permissions; rerun probe; confirm green.",
    ],
    quickQuiz: [
      {
        question: "When should you open System Diagnostics first?",
        options: [
          "Never",
          "When multiple modules fail in similar ways or after environment changes",
          "Only on weekends",
          "Only for barcodes",
        ],
        answer: "When multiple modules fail in similar ways or after environment changes",
        explanation: "Shared infrastructure (DB, paths, onboarding) shows up here before module-specific bugs.",
      },
    ],
    searchAliases: ["health", "install"],
  },
];

const MODULE_BY_ID = new Map(TRAINING_MODULES.map((m) => [m.id, m]));

export function getTrainingModuleById(id: string): TrainingModule | undefined {
  return MODULE_BY_ID.get(id);
}

export function getAllTrainingModules(): TrainingModule[] {
  return TRAINING_MODULES;
}

export function getTrainingCategories(): TrainingCategory[] {
  return ["Operations", "Inventory", "Procurement", "Finance", "Analytics", "Admin"];
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Search titles, summaries, terms, function names, aliases */
export function searchTrainingModules(query: string): TrainingModule[] {
  const q = normalize(query);
  if (!q) return TRAINING_MODULES;
  const tokens = q.split(/\s+/).filter(Boolean);
  const score = (m: TrainingModule): number => {
    const hay = [
      m.title,
      m.beginnerSummary,
      m.workplacePurpose,
      m.id,
      ...(m.searchAliases ?? []),
      ...m.keyTerms.map((k) => `${k.term} ${k.simpleDefinition}`),
      ...m.functions.flatMap((f) => [f.name, f.whatItDoes, f.whyItMatters, ...(f.relatedTerms ?? [])]),
    ]
      .join(" ")
      .toLowerCase();
    if (hay.includes(q)) return 100;
    let s = 0;
    for (const t of tokens) {
      if (hay.includes(t)) s += 10;
    }
    return s;
  };
  return TRAINING_MODULES.map((m) => ({ m, s: score(m) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .map(({ m }) => m);
}
