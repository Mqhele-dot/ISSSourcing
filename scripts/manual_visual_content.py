"""Live-screen metadata for the illustrated ISSSourcing manuals.

The screenshots are captured from the local authenticated application.  Each
entry intentionally separates a button's visible label from its business
effect so readers do not confuse navigation with a state-changing action.
"""

SCREEN_ROOT = "output/manual-assets/screenshots"


GLOBAL_SHORTCUTS = [
    ("Ctrl+K", "Open Jump to / the command palette from any authenticated page."),
    ("Ctrl+B", "Expand or collapse the left navigation sidebar."),
    ("Tab", "Move to the next interactive control in keyboard order."),
    ("Shift+Tab", "Move to the previous interactive control."),
    ("Enter", "Activate a focused button or link; in global search it opens the active result."),
    ("Space", "Activate a focused button, checkbox, or switch without using the mouse."),
    ("Arrow Down / Arrow Up", "Move through global-search and menu results."),
    ("Home / End", "Move to the first or last global-search result."),
    ("Escape", "Close global search, the command palette, an open menu/dialog, or an active guided tour."),
    ("Arrow Left / Arrow Right", "Move through carousel-style panels when that control has focus."),
    ("Enter in scan/count entry", "Submit the current barcode or count entry where the page explicitly supports rapid entry."),
]


GLOBAL_BUTTONS = [
    ("Collapse/expand navigation", "Changes only the sidebar width. It does not change permissions."),
    ("Global search", "Searches only records the current user may access. Use arrows and Enter to open a result."),
    ("Jump to...", "Opens the command palette. The displayed shortcut is Ctrl+K."),
    ("LIVE / DEV / ADMIN badges", "Context indicators, not buttons and not proof of unrestricted access."),
    ("Theme", "Switches the resolved light/dark theme and persists the same theme preference."),
    ("Cycle accent palette", "Changes presentation colour only."),
    ("Notifications", "Opens notifications and their validated internal deep links."),
    ("User initials/menu", "Opens profile, account, and session actions."),
    ("Open lesson / Start tour / Spotlight tour", "Starts non-mutating guided learning for the current page."),
    ("Dismiss / X", "Closes the current banner, panel, menu, or dialog. Check the accessible label when two close controls are present."),
    ("Refresh", "Refetches current server data. It does not rewrite approved or posted records."),
    ("Retry", "Repeats only the failed load or operation after the cause is corrected."),
    ("Filter / Apply", "Applies the current server-backed query criteria."),
    ("Clear / Reset", "Removes current filters or input; it does not delete source records."),
    ("25 / 50 / 100 rows", "Changes bounded page size. The total remains the server total."),
    ("First / Previous / Next / Last", "Moves through stable server pages without changing records."),
    ("Review / View / Open", "Opens detail without changing lifecycle state."),
    ("Create / New / Add", "Starts an editable draft or adds a draft line. Final persistence still runs server validation."),
    ("Save / Update", "Persists permitted draft or settings changes. Disabled means a prerequisite, permission, or validation is missing."),
    ("Cancel", "Leaves or cancels the current edit; a lifecycle cancellation is a separate governed action and requires a reason."),
    ("Submit", "Locks the supported snapshot and starts the configured approval workflow."),
    ("Approve / Reject / Request info", "Records a governed decision subject to role, limit, segregation, and reason rules."),
    ("Convert", "Creates the linked downstream record, such as requisition to RFQ/PO, while preserving source evidence."),
    ("Export / Download / Print", "Creates or retrieves output for the current authorized scope. Preview before external use."),
    ("Delete", "Removes only records whose lifecycle and dependency rules permit deletion; posted history is not deleted."),
    ("Help & Tutorials", "Opens learning assistance without altering operational data."),
]


def screen(key, title, route, purpose, buttons, example, callouts=None):
    return {
        "key": key,
        "title": title,
        "route": route,
        "image": f"{SCREEN_ROOT}/{key}.png",
        "purpose": purpose,
        "buttons": buttons,
        "example": example,
        "callouts": callouts,
    }


USER_SCREEN_GUIDE = [
    screen("sign-in", "Sign in", "/auth", "Authenticate and select the correct local test identity or enter issued credentials.", [
        ("Admin / Planner / Viewer test access", "Local-development shortcuts that autofill a seeded account; unavailable in production."),
        ("Sign in instantly as Admin", "Local-development-only sign-in shortcut."),
        ("Remember me", "Keeps the permitted session according to server policy."),
        ("Forgot password?", "Starts password recovery; do not share reset codes."),
        ("Sign In", "Submits the username and password to the authentication service."),
    ], "Choose Planner in a local test environment, select Sign In, confirm the organization and role in the header, then open only a permitted workspace.", [(1, .36, .20), (2, .36, .40), (3, .35, .75), (4, .56, .75), (5, .43, .84)]),
    screen("control-tower", "Control Tower", "/operations/control-tower", "Review cross-workspace signals and drill into authoritative queues.", [
        ("Refresh", "Refetches the current operational snapshot."),
        ("Get Educated: Control Tower", "Opens the matching learning topic."),
        ("Exceptions / Shipments", "Opens the source workspaces."),
        ("Trend window / Focus", "Changes chart scope without changing transactions."),
        ("KPI and attention cards", "Open the source list with the matching filter."),
    ], "Select Low stock items, verify the inventory list uses low=1 and the same total, correct the item in Inventory, then return and Refresh."),
    screen("inventory", "Inventory", "/inventory", "Search item master records and review canonical warehouse stock.", [
        ("New item", "Creates a tenant-owned draft item and generates barcode/QR identity when saved."),
        ("Search / filters", "Restricts the bounded server result."),
        ("Review / Edit", "Opens the item; Edit changes permitted master fields, not posted movements."),
        ("Adjust", "Starts a controlled stock adjustment with warehouse, reason, and permission checks."),
        ("Pagination", "Moves through the server-backed inventory list."),
    ], "Search the SKU, open Review, compare unassigned quantity with warehouse positions, then use Edit for description or Adjust for a justified quantity correction."),
    screen("warehouse-operations", "Warehouse operations", "/inventory/warehouse-operations", "Coordinate receiving, put-away, counting, transfers, picking, and dispatch work.", [
        ("Workspace tabs", "Switch between operational queues without duplicating stock records."),
        ("Warehouse selector", "Sets the tenant-owned execution location."),
        ("Open task / Review", "Opens evidence and valid next actions."),
        ("Post / Complete", "Commits the supported movement under server validation."),
        ("Refresh", "Reloads queues and balances."),
    ], "Open an awaiting put-away task, verify receipt and warehouse, assign the destination bin, post the movement, and confirm the item position changed."),
    screen("barcode-scanner", "Barcode scanner", "/inventory/barcodes", "Identify items and perform controlled In, Out, Lookup, or quotation-add actions.", [
        ("Mode: In / Out / Lookup", "Determines whether stock increases, decreases, or remains unchanged."),
        ("Start camera", "Requests camera use for this scan session."),
        ("Manual entry", "Accepts a barcode/QR value without a camera."),
        ("Confirm", "Posts the selected mode after item, warehouse, quantity, and availability checks."),
        ("Clear", "Clears the current match without changing stock."),
    ], "Choose Out, select the dispatch warehouse, scan one item, enter quantity 2 and a source reference, confirm available stock, then post and review the movement."),
    screen("procurement-overview", "Procurement overview", "/procurement/overview", "Monitor requisitions, sourcing, agreements, POs, confirmation, receiving, AP, and exceptions.", [
        ("Date and dimension filters", "Change the server aggregation scope."),
        ("Refresh", "Regenerates the current procurement snapshot."),
        ("KPI / chart links", "Open the owning procurement or finance queue."),
        ("Needs attention rows", "Open the exact record or filtered list requiring action."),
    ], "Open Awaiting supplier confirmation, record the supplier response on the PO, then return and refresh to confirm the attention count changes."),
    screen("requisition-create", "Create a purchase requisition", "/procurement/requisitions/new", "Create governed demand from active Master Data and current reporting-currency context.", [
        ("Back to Requisitions", "Leaves the new form without creating a record."),
        ("Supplier / currency / department", "Select active tenant-owned context values."),
        ("Add supplier here", "Navigates to supplier onboarding; it does not create a supplier inside the requisition."),
        ("Add item / Catalog / Non-stock / Service", "Adds and classifies a draft line."),
        ("Create / Save draft", "Persists only after all readiness blockers are cleared."),
    ], "Select an approved supplier and department, add one catalog line with UOM, tax and cost centre, compare request and reporting values, save, then submit from the detail page."),
    screen("sourcing-rfqs", "Sourcing and RFQs", "/procurement/sourcing", "Create competitive events, preview supplier email, capture responses, compare, and award.", [
        ("New event / RFQ", "Starts a draft sourcing event."),
        ("Preview email", "Shows the supplier communication without sending it."),
        ("Issue / Close", "Opens or closes the event; early close requires a reason."),
        ("Compare / Evaluate", "Opens landed-cost and qualitative comparison."),
        ("Submit award / Approve / Convert to PO", "Runs governed award and downstream conversion."),
    ], "Create an RFQ from approved demand, invite two eligible suppliers, preview each email, issue, capture valid responses, compare reporting totals, justify and approve the award."),
    screen("blanket-agreements", "Blanket purchase agreements", "/procurement/contracts", "Manage agreements, price lines, releases, renewals, and immutable activity.", [
        ("New agreement", "Creates a draft framework or blanket agreement."),
        ("Agreements / Lines / Releases / Renewals / Activity", "Switches the register view."),
        ("Search / All statuses", "Filters the bounded agreement register."),
        ("Refresh", "Reloads agreement balances and lifecycle state."),
        ("Review", "Opens agreement detail and valid actions."),
        ("Pagination", "Moves through agreement pages."),
    ], "Open an approved active agreement, confirm the line price and remaining balance, choose an approved requisition, create the idempotent release PO, and verify the Releases tab."),
    screen("receiving-returns", "Receiving and returns", "/procurement/receiving", "Post shared goods-receipt evidence and controlled purchase returns.", [
        ("Queue filters / Search", "Selects receivable POs or prior receipt evidence."),
        ("Receive / Open", "Starts receipt entry for the selected PO."),
        ("Post receipt", "Atomically writes GRN, inventory movement, PO progress, and AP evidence."),
        ("Reverse", "Creates compensating evidence for an incorrect posted receipt."),
        ("Create return / Dispatch", "Runs approval and outbound return movement."),
    ], "Open a partially received PO, accept the delivered quantity, reject damaged units with a reason, post the GRN, then verify Inventory, PO progress, AP match, and exceptions."),
    screen("accounts-payable", "Accounts payable", "/finance/accounts-payable", "Capture, match, approve, age, batch, and document supplier liabilities.", [
        ("Intake / Invoices / Aging / Payments tabs", "Switches the AP lifecycle view."),
        ("Capture / Promote", "Creates and promotes invoice capture evidence."),
        ("Run 3-way match", "Compares invoice, PO, and receipt evidence."),
        ("Approve / Reject", "Records the governed invoice decision."),
        ("Create payment batch", "Atomically revalidates selected eligible invoices."),
        ("Voucher / Remittance preview and download", "Generates canonical finance documents."),
    ], "Capture an invoice, promote it, run the three-way match, resolve any mismatch, approve it, select it across pages, create the batch, and preview the remittance."),
    screen("approval-policies", "Approval policies", "/finance/approval-policies", "Define entity, amount band, level, role or approver, and active state.", [
        ("Create", "Adds a validated policy after the governed Entity is selected."),
        ("Entity", "Chooses a supported workflow from the authoritative catalog."),
        ("Amount min / max", "Defines the reporting-currency band; empty maximum means no cap."),
        ("Required role / Specific approver", "Defines who may act at this level."),
        ("Active", "Controls new-use eligibility."),
        ("Review / Edit / Deactivate", "Maintains existing policies without rewriting decisions."),
    ], "Choose Purchase requisition, enter level 1 and the lower amount band, assign the manager role, create the policy, then submit a disposable requisition within the band."),
    screen("analytics-overview", "Analytics and Insights", "/analytics/overview", "Visualize server-backed operational and financial summaries and drill into source data.", [
        ("Period / dimension filters", "Changes the authoritative analytics query."),
        ("Refresh", "Refetches charts and KPI summaries."),
        ("Chart segments / legends", "Selects or explains a visual category where interactive."),
        ("Open report / source", "Drills into the report or operational list."),
        ("Export", "Creates governed output for the same normalized filter scope."),
    ], "Set the month and supplier filter, compare the spend chart with Procurement Overview, open the source list, then export using the same filter fingerprint."),
    screen("company-setup", "Company setup", "/admin/company-setup", "Maintain the company identity used on newly generated documents.", [
        ("Upload logo / Use URL", "Stores or references the approved company logo."),
        ("Save", "Persists legal name, registration, tax, address, contact, locale, and branding data."),
        ("Preview", "Shows the current document identity before external generation."),
        ("Next / Complete setup", "Moves through guided setup and records completion only after server validation."),
    ], "Upload the approved logo, complete legal and physical address fields, save, generate a quotation or PO preview, and verify both company and counterparty address blocks."),
    screen("settings", "Settings", "/admin/settings", "Control presentation and link to the authoritative operational, financial, and security settings owners.", [
        ("Settings tabs", "Opens the selected configuration category."),
        ("Save changes", "Persists only values owned by that settings surface."),
        ("Open Production Control Plane / Master Data / Approval Policies", "Navigates to the authoritative editor for the selected control."),
        ("Reset presentation", "Restores presentation defaults only."),
    ], "Change date display or colour here, change reporting currency only in the authoritative financial control, save, then verify new PR/PO reporting values and a newly generated document."),
    screen("workflow-governance", "Workflow governance", "/admin/workflows", "Enable, monitor, and audit governed workflows without duplicating approval policy data.", [
        ("Configure approval rules", "Opens Approval Policies."),
        ("Approval limits", "Opens employee workflow limits."),
        ("Workflow audit", "Opens audit evidence for governed actions."),
        ("Workflow cards / Configure", "Opens configuration and status for one governed entity."),
        ("Open pending / overdue", "Navigates to the matching approval queue."),
    ], "Select Purchase requisition, confirm the policy chain and employee limits, submit a test requisition, approve independently, and verify the workflow audit entry."),
    screen("master-data", "Master Data", "/admin/master-data", "Govern tenant-owned currencies, FX, tax, UOM, departments, cost centres, warehouses, terms, Incoterms, carriers, and dependencies.", [
        ("Domain tiles / tabs", "Opens one authoritative Master Data domain."),
        ("New / Add", "Creates a tenant-owned draft or active reference as supported."),
        ("Edit / Deactivate / Delete", "Runs lifecycle and dependency guards."),
        ("Used by", "Shows server-generated dependency counts and direct links."),
        ("Review changes / Approve", "Runs governed change control for high-risk domains."),
    ], "Add an effective FX rate, save it, open an already-loaded new requisition, refetch its context, and confirm the new rate while an approved requisition remains unchanged."),
    screen("employee-profiles", "Employee profiles", "/admin/employee-profiles", "Assign role, visible tabs, warehouse scope, and approval limits while showing effective API access separately.", [
        ("Select employee", "Loads the chosen tenant user."),
        ("Role", "Assigns an active system or custom role."),
        ("Visible tabs", "Controls navigation presentation, not API authorization."),
        ("Review permission details", "Expands effective resource permissions and high-risk grants."),
        ("Approval limits", "Sets per-workflow authority where supported."),
        ("Save", "Persists the validated profile assignment."),
    ], "Select a buyer, assign the Buyer role and Procurement tab, set the requisition limit, save, then verify Effective Access and test a request above the limit."),
    screen("user-roles", "User roles", "/admin/user-roles", "Create and maintain custom roles using authoritative permission and navigation catalogs.", [
        ("New role", "Creates a custom-role draft."),
        ("Permission buttons", "Toggle one named resource/action grant; the accessible name states current state."),
        ("Navigation access", "Selects valid canonical tabs."),
        ("Save / Deactivate", "Persists or prevents new assignment."),
        ("Delete", "Allowed only after users and approval policies are reassigned."),
    ], "Create Receiving Clerk, grant only receipt and assigned-warehouse inventory actions, add the Receiving navigation area, assign a test user, and verify denied finance access."),
    screen("documents", "Documents", "/admin/documents", "Review versioned metadata and independent file-availability state.", [
        ("Search / lifecycle / file-status filters", "Filters the paginated document list."),
        ("Open / Preview / Download", "Retrieves an authorized available version."),
        ("Archive", "Changes metadata lifecycle without deleting history."),
        ("Reattach replacement", "Creates a new version when an old blob is missing."),
        ("Reconcile", "Scans storage and records findings without deleting metadata."),
    ], "Filter Missing, open one record, verify immutable metadata, reattach the authorized replacement as a new version, then rerun reconciliation."),
    screen("document-extractor", "Document extractor", "/admin/document-extractor", "Preview and map supported files before explicit database import.", [
        ("Single File / Batch", "Chooses one file or up to the configured batch limit."),
        ("Choose file / dropzone", "Selects supported PDF, spreadsheet, image, or CSV input."),
        ("Extract / Retry", "Runs extraction or retries after a structured failure."),
        ("Map columns", "Maps detected fields to the selected import contract."),
        ("Confirm import", "Writes only after preview and validation; extraction alone does not import."),
    ], "Choose Single File, select a supported supplier invoice, extract, verify every detected field, map columns, resolve rejection messages, then explicitly confirm import."),
    screen("system-diagnostics", "System diagnostics", "/admin/system-diagnostics", "Separate current problems, expected configuration, and historical evidence, with exact remediation links.", [
        ("Run scan", "Refreshes the structured diagnostics finding set."),
        ("Copy summary", "Copies a support-oriented summary without changing system state."),
        ("Refresh", "Reloads current finding state."),
        ("Run safe probes", "Runs non-destructive health probes."),
        ("Finding tabs and filters", "Narrow by category, severity, and evidence state."),
        ("Open problem tab", "Navigates to the exact internal target for one finding."),
    ], "Run safe probes, filter Current warnings, open one problem tab, apply the documented non-destructive correction, return, rerun, and confirm the finding becomes historical or clears."),
    screen("profile", "Profile", "/admin/profile", "Maintain personal identity, contact, picture, preferences, and security settings.", [
        ("Profile / Security", "Switches personal settings categories."),
        ("Upload Picture / Use URL", "Sets the profile image; never upload confidential documents as an avatar."),
        ("Save Changes / Save Details", "Persists the matching section."),
        ("Change password / 2FA", "Runs the dedicated verified security workflow."),
    ], "Upload a suitable profile image, update the work phone, save each section, reload, then confirm the header initials/avatar and profile data agree."),
    screen("get-educated", "Get Educated", "/get-educated", "Open route-specific lessons and guided tours without changing operational records.", [
        ("Open lesson", "Opens the selected topic."),
        ("Start guided tour", "Navigates to the route and highlights controls."),
        ("Mark understood", "Stores the learning acknowledgement for the current browser/user scope."),
        ("Reset progress", "Clears learning progress only."),
    ], "Search for Blanket purchase agreements, open its lesson, start the tour, use Escape to exit, then mark it understood after completing a disposable release example."),
    screen("mobile-approvals", "Mobile approvals", "/m/approvals", "Review task-first approval requests on a narrow screen while preserving full server controls.", [
        ("Approval cards", "Open the selected pending request."),
        ("Approve / Reject / Request info", "Records a governed decision with the same permission, limit, SoD, and reason rules as desktop."),
        ("Back / Home", "Returns to the mobile queue or hub."),
        ("Refresh", "Reloads the current approval queue."),
    ], "Open one pending requisition, inspect amount, requester, evidence and conflicts, request information if incomplete, or approve only within your recorded limit."),
]


SETUP_SCREEN_KEYS = {
    "sign-in", "company-setup", "settings", "workflow-governance", "master-data",
    "employee-profiles", "user-roles", "documents", "document-extractor",
    "system-diagnostics", "profile", "get-educated", "blanket-agreements",
    "approval-policies", "analytics-overview",
}

SETUP_SCREEN_GUIDE = [entry for entry in USER_SCREEN_GUIDE if entry["key"] in SETUP_SCREEN_KEYS]
