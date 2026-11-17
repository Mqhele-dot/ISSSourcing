"""Function-level operating contracts for the illustrated ISSSourcing manuals.

Each record answers the questions an operator needs before using a control:
what it does, what feeds it, what is mandatory, what it changes, what else is
affected, what evidence remains, and why the action can be unavailable.
"""

SCREEN_ROOT = "output/playwright/manual-tabs"


def fn(title, location, definition, uses, required, optional, result, impacts,
       permission, evidence, failures, screenshot):
    return {
        "title": title,
        "location": location,
        "definition": definition,
        "uses": uses,
        "required": required,
        "optional": optional,
        "result": result,
        "impacts": impacts,
        "permission": permission,
        "evidence": evidence,
        "failures": failures,
        "image": f"{SCREEN_ROOT}/{screenshot}",
    }


PURCHASE_ORDER_FUNCTIONS = [
    fn("Purchase Order register", "Procurement > Purchase orders",
       "The bounded register of formal supplier commitments. It is a control and follow-up queue, not the place where unauthorised demand is entered.",
       "The tenant-scoped PO list service, supplier master, document/reporting currency snapshots, receipt progress and server status summaries.",
       "An authenticated user with Purchase Order read access.",
       "Search text, supplier, status, sort order and page size (25/50/100).",
       "Filtering changes only the URL-backed view. Refresh re-reads the server. No transaction is changed.",
       "The same PO records feed supplier confirmation, Logistics, Receiving, AP matching, reports, Control Tower and audit views.",
       "Read permission; row actions are separately guarded.",
       "PO number, supplier, status, request date, line count, received percentage, document and reporting totals.",
       "A visible tab does not override API permission. Empty means no matching tenant records; Error/Denied requires retry or access correction.",
       "po-list.png"),
    fn("Create a Purchase Order", "Purchase orders > Create path",
       "ISSSourcing deliberately does not create a blank PO. The /procurement/orders/new route redirects to a new requisition. A PO is generated only from approved demand so commercial and approval lineage is retained.",
       "One of four governed origins: approved requisition conversion, approved sourcing award, approved reorder flow, or approved blanket-agreement release.",
       "Approved source demand; active supplier; active currency, tax and UOM; valid department/cost centre; required approval; and a warehouse when physical goods will be received.",
       "Contract, payment terms, Incoterm, delivery address, carrier, project/cost dimensions and authorised override reason where the source permits them.",
       "Creates the PO header and lines transactionally, links the source, snapshots commercial values and starts in its controlled pre-dispatch state.",
       "Creates a supplier commitment and budget exposure; enables PO approval, dispatch, supplier confirmation, shipment tracking, receiving and invoice matching.",
       "Source conversion permission plus any approval/segregation rules. Blanket releases also require the agreement release permission.",
       "Source ID, conversion actor/time, pricing source, FX snapshot, approval chain, PO number and audit event.",
       "Blocked for unapproved demand, inactive/foreign master data, missing price/UOM/tax, exhausted agreement, currency conflict, budget rule, duplicate idempotency request or self-approval conflict.",
       "po-list.png"),
    fn("Preview a PO", "Purchase orders > select a row / eye button",
       "Shows a non-editing summary before opening the complete record.",
       "The selected list-row DTO: status, supplier, dates, totals, lines and receipt progress.",
       "A valid PO row in the current tenant.", "None.",
       "No write occurs. Close returns to the same filtered list; Open full PO loads authoritative detail; Download requests the official PDF.",
       "Helps avoid opening or downloading the wrong supplier commitment.",
       "PO read; PDF download also requires document access.",
       "The preview identifies the exact PO number and snapshot totals.",
       "Historical supplier may be displayed by ID; missing FX produces a warning rather than an invented conversion.",
       "po-preview.png"),
    fn("Workflow summary and next action", "Purchase Order detail > top summary",
       "Explains where the PO is in its lifecycle, what can legally happen next and which linked evidence already exists.",
       "PO status and approval status, supplier-confirmation events, receipt/invoice/exception counts and linked source records.",
       "A valid PO detail response.", "None.",
       "The panel is read-only. Its Retry button reloads evidence without changing the PO.",
       "Directs the user to approval, dispatch, confirmation, receiving or resolution instead of guessing the next step.",
       "PO read; each next action has its own permission.",
       "Current status, next action, confirmation history, linked counts and exception count.",
       "If workflow evidence fails, the PO remains readable but no action should be inferred; use Retry and preserve the request ID.",
       "po-detail-header-workflow.png"),
    fn("Submit for approval", "Purchase Order detail > Submit for approval",
       "Locks the current supported PO snapshot and starts the Purchase Order approval chain. It does not send the order to the supplier.",
       "Approval Policies for entity purchase_order, reporting-currency value, user effective access, employee approval limits and segregation-of-duties rules.",
       "Draft PO with complete supplier, lines, commercial references and a matching active policy where approval is governed.",
       "Supporting comments or documents when the workflow permits them.",
       "Moves the PO into the approval workflow and creates an approval-history/audit record.",
       "The PO becomes unavailable for ordinary commercial editing; approval queues, notifications and Workflow Governance update.",
       "Purchase management/submit permission. The requester cannot satisfy an independent approval that requires another actor.",
       "Submitted snapshot, actor, time, reporting amount, policy/level and hash-chained audit event.",
       "Disabled for incomplete data, wrong state, no applicable approver, stale revision, insufficient limit, policy conflict or pending mutation.",
       "po-detail-header-workflow.png"),
    fn("Approve a PO", "Purchase Order detail > Approve",
       "Records an independent approval decision at the required policy level. Approval authorises later dispatch; it is not supplier acceptance.",
       "Applicable PO policy band, current level, effective role/custom role, employee PO limit and current reporting value.",
       "PO awaiting approval and an approval reason of at least five characters where shown.",
       "Additional evidence/comment when required by company policy.",
       "Advances the approval level or marks the PO approved when the chain is complete.",
       "Approval queues and notifications update; a fully approved PO exposes supplier dispatch.",
       "Purchase approve permission, amount limit and SoD compliance.",
       "Decision, reason, level, approver, previous/new status and time in Approval history and Audit.",
       "Blocked for self-approval, insufficient limit, wrong role, inactive policy/role, stale status, missing reason or previous level not complete.",
       "po-approval-history.png"),
    fn("Dispatch PO to supplier", "Purchase Order detail > Dispatch",
       "Sends the approved commercial snapshot to a verified supplier email and records that the supplier has been asked to perform.",
       "Approved PO, company profile/branding, supplier address/contact, official PO PDF and local/external email transport configuration.",
       "Fully approved PO and syntactically valid verified supplier dispatch email.",
       "An organisation email template or additional attachments when supported.",
       "Moves the PO to Sent/Dispatched and appends an AWAITING supplier-confirmation event. Email failure must not be represented as successful dispatch.",
       "Supplier Portal Open POs/Confirmations, Procurement Overview, Logistics planning, notifications and audit evidence update.",
       "Manager, Planner or Admin with send permission.",
       "Recipient, immutable document version, send result/request ID, actor/time and confirmation event.",
       "Blocked before approval, for missing/invalid email, missing document/company identity, wrong state or unavailable configured email provider. Local JSON transport is test evidence only.",
       "po-detail-header-workflow.png"),
    fn("Commercial terms", "Purchase Order detail > Commercial terms",
       "Maintains pre-dispatch commercial references. These fields define how the PO is valued, delivered, taxed and later matched.",
       "Only active tenant values from the PO context: departments, supplier contracts, currencies, effective FX, payment terms, Incoterms, tax codes and supplier defaults.",
       "Order currency. Other mandatory values depend on the source, line and organisation rules.",
       "Department, contract, payment terms, Incoterm and header default tax code may be optional only when policy allows; blank is not the same as an invented default.",
       "Save terms writes a new PO revision while the PO is editable. Sent and later snapshots are immutable.",
       "Currency/FX changes the reporting-value snapshot; contract changes pricing/default precedence; payment terms affect AP due dates; Incoterm affects logistics responsibility; tax feeds PO/AP totals; department feeds approvals, budgets and reports.",
       "PO update/manage permission before dispatch.",
       "Old/new values, selected master IDs, revision, actor/time and audit event.",
       "Blocked for inactive/foreign values, stale revision, sent/received state, or contract-currency mismatch. Use contract currency or clear the contract rather than forcing an invalid pairing.",
       "po-commercial-terms.png"),
    fn("Apply contract and supplier defaults", "Purchase Order detail > Commercial terms",
       "Copies eligible commercial defaults into the editable form; it does not persist until Save terms is selected.",
       "Contract values take precedence. Supplier defaults fill fields the contract leaves blank. Currency must exist in active Master Data.",
       "A supplier and selected active contract for the contract action.",
       "The user may review and change permitted fields before saving.",
       "Populates currency, payment terms, Incoterm and tax in the form, with a source hint.",
       "Once saved, downstream reporting, receiving documents, logistics and AP matching use the revised snapshot.",
       "Same as editing commercial terms.",
       "Source hint plus saved revision after confirmation.",
       "Does nothing when no contract is selected; invalid contract/supplier/currency combinations are rejected.",
       "po-commercial-terms.png"),
    fn("Order lines", "Purchase Order detail > Order lines",
       "The committed goods/services: line type, item or description, ordered quantity, unit price and receipt evidence requirement.",
       "Copied source-demand lines and their catalog item/UOM/tax/cost evidence; agreement or sourcing pricing when applicable.",
       "At least one valid line. Catalog goods require an active item and UOM; manual/service lines require a description and may require an authorised entry reason.",
       "Supplier part number, service confirmation rule, project/cost dimensions and line notes where supported.",
       "Lines are normally created through source conversion. Posted/approved/sent evidence is not silently rewritten.",
       "Line quantities drive agreement commitments, receipt remaining quantities, inventory receipts and three-way invoice matching; price/tax drive PO and reporting totals.",
       "Source conversion and PO manage permission.",
       "Line number/type, item or manual reason, quantity, price source, tax/UOM, receipt requirement and source link.",
       "Invalid inactive item/UOM/tax, zero/negative values, agreement limits, currency conflicts or unsupported edits are rejected.",
       "po-order-lines.png"),
    fn("Receive selected", "Purchase Order detail > Receive panel",
       "Posts a Goods Receipt against remaining catalog quantities and puts accepted goods into a canonical warehouse position.",
       "PO lines, prior receipts, selected tenant warehouse/aisle/bin, batch/serial rules, linked shipments and the shared Goods Receipt service.",
       "Receivable PO state, at least one positive quantity not exceeding remaining quantity, receiver name, authorised warehouse and valid put-away selection. Batch/serial evidence is required when the item is controlled.",
       "GRN number and explicit shipment link; Auto updates all open PO shipments supported by the receive result.",
       "Transactionally writes receipt lines, inventory deltas and stock movements, updates PO received progress, shipment state and receipt evidence. Posted receipts are not edited.",
       "Inventory on hand/availability, Warehouse Operations, Procurement Receiving, Logistics, AP three-way match, exceptions, analytics and Control Tower all change from the same receipt.",
       "Receive permission plus warehouse/bin scope.",
       "GRN, receiver, quantities, rejected/discrepancy details when present, warehouse/bin, batch/serial, linked shipment, inventory deltas, actor/time and audit event.",
       "Blocked for insufficient remaining quantity, zero input, foreign/inactive warehouse, missing batch/serial, concurrency/stale data, non-receivable PO or permission denial. Retry only after refreshing remaining quantities.",
       "po-receive-panel.png"),
    fn("Activity", "Purchase Order detail > Activity",
       "Chronological entity activity for operational review; it supplements, but does not replace, the formal approval and hash-chained audit records.",
       "Tenant-scoped purchase_order activity events.", "PO read access.", "Activity filters where shown.",
       "Read-only.", "Supports investigation of creation, edits, dispatch, receipt and related actions.",
       "PO/activity read permission.", "Event type, actor, time, description and entity reference.",
       "An empty feed means no available activity; do not infer that no audit evidence exists—check Approval history and Audit logs.",
       "po-activity.png"),
    fn("Approval history", "Purchase Order detail > Approval history",
       "The decision ledger for submission and approval transitions, including who acted and at what level.",
       "Approval history service for entity purchase_order.", "PO and approval-history read access.", "None.",
       "Read-only; corrections are new events, never edits to a previous decision.",
       "Supports segregation-of-duties review and explains why dispatch became available.",
       "Authorised procurement/audit viewers.", "Action, level, performer, previous/new status and timestamp.",
       "If unavailable, current PO detail remains visible but approval evidence must be retried before audit conclusions are made.",
       "po-approval-history.png"),
    fn("Linked shipments", "Purchase Order detail > Linked shipments",
       "Shows inbound logistics records connected to this PO.",
       "Tenant-scoped v2 Logistics shipments filtered by exact PO number.", "PO read and Logistics read access.", "Carrier, tracking and ETA may be blank until planned.",
       "Read-only on the PO; shipment updates occur in Logistics or supplier delivery updates.",
       "ETA/status drive Procurement Overview, Control Tower and current exception rules; the receipt panel can link the receipt back to a shipment.",
       "PO and Logistics read permission.", "Shipment ID, carrier, tracking, status, ETA and update time.",
       "No linked shipments is valid. Never create an exception simply by opening this GET view.",
       "po-linked-shipments.png"),
    fn("Official document: Signable PDF / Quick print", "Purchase Order detail > document actions",
       "Produces the controlled supplier-facing representation of the current immutable PO snapshot. Signable PDF is the canonical file; Quick print is a browser print view.",
       "PO snapshot, company legal profile/logo/address, supplier legal/contact/address, lines, taxes, totals, currency, terms and signature blocks.",
       "PO number and readable authorised record; external use should follow approval/dispatch policy.",
       "Wet-ink or external e-signing occurs outside the app unless an integration is configured.",
       "Download retrieves/generates a versioned PDF; print opens a local print view. Neither approves, sends nor receives the PO.",
       "The same document may be attached to supplier dispatch and retained in Documents/audit evidence.",
       "PO read/document-download permission.", "Filename/PO number, document version, company/supplier identity, generation/download record and checksum where stored.",
       "Blocked for missing PO identity, permission, tenant mismatch or generation/storage error. Preview addresses and totals before sending.",
       "po-official-document.png"),
]


INVENTORY_FUNCTIONS = [
    fn("Inventory register", "Inventory > Inventory",
       "The item master and current stock-health register. Item identity and stock quantity are different controls: Edit changes master data; transactions change stock.",
       "Tenant item master, categories, locations, canonical warehouse positions, allocations, movement ledger and low-stock policy.",
       "Inventory read permission.", "Search, location/category, sort, table/card view, low-only flag and page size.",
       "Filtering/refreshing never changes stock.",
       "Counts and low-stock state feed Control Tower, reorder requests, quotations, requisitions, warehouse tasks and analytics.",
       "Inventory read; creation/edit/adjust are separately guarded.",
       "SKU, name, category/location, on-hand/allocated/available, warehouse versus unassigned stock, threshold, status and last movement.",
       "A missing warehouse position is not replaced with a fabricated Main Warehouse. Unassigned stock is labelled separately.",
       "inventory-list.png"),
    fn("Create item", "Inventory > Add item",
       "Creates a tenant-owned inventory item definition and automatically assigns its barcode/QR identity after save.",
       "Active organization categories/UOMs, suppliers and default warehouse policy; server-generated SKU/barcode rules where configured.",
       "Unique SKU, item name, UOM and valid numeric control values required by the form. Category/warehouse requirements follow organisation policy.",
       "Description, supplier part number, selling price, unit cost, reorder point, maximum level, lead time and default warehouse when allowed.",
       "Creates item master data only; it does not invent opening stock. The new item can then be selected on quotations, requisitions and warehouse transactions.",
       "Updates Inventory and selectors after cache invalidation; generated barcode/QR links back to the item; replenishment uses thresholds/defaults.",
       "Inventory create/manage permission.",
       "Item ID/SKU, creator/time, selected master references, generated code values and audit event.",
       "Blocked for duplicate SKU/barcode, invalid numeric values, inactive/foreign master data, missing prerequisites or permission denial.",
       "inventory-create-item.png"),
    fn("Review item detail", "Inventory > Open item",
       "Shows item master data separately from canonical warehouse positions, availability, movements and activity.",
       "Item detail API, warehouse inventory positions, stock movements, generated barcode and default warehouse references.",
       "A valid tenant-owned SKU.", "None.",
       "Read-only until Edit item details or Adjust stock is explicitly chosen.",
       "Available quantity is used for outbound validation; default warehouse guides future receiving but does not move existing stock.",
       "Inventory read.",
       "Master fields, position totals, allocation, movement timestamp/reason/reference/user and audit activity.",
       "Cross-tenant or unknown SKU is denied/not found. If default differs from actual positions, use an audited transfer—not a master-data edit.",
       "inventory-item-detail.png"),
    fn("Edit item details", "Inventory item > Edit item details",
       "Changes editable item-master attributes without changing posted stock movements or quantities.",
       "Current item revision plus active UOM/category/warehouse and supplier references.",
       "Unique SKU/name rules and valid numeric values; exact mandatory fields are marked by the form.",
       "Description, prices, thresholds, supplier identifiers, lead time and default warehouse according to policy.",
       "Saves a new item revision and refreshes item/list selectors.",
       "Thresholds affect low-stock/reorder logic; price/cost affects quotations and valuation; UOM affects later demand/receipts; default warehouse affects future defaults only.",
       "Inventory update/manage permission.", "Old/new values, revision, actor/time and audit event.",
       "Blocked for duplicate identifiers, stale revision, referenced inactive values, invalid numbers or permission denial.",
       "inventory-edit-item.png"),
    fn("Adjust stock", "Inventory item > Adjust stock",
       "Posts a controlled quantity correction when a real count or authorised correction differs from the ledger. It is not receiving, transfer, picking or return.",
       "Current canonical warehouse availability, organisation warehouses, user warehouse scope and inventory-adjustment workflow/limit.",
       "Warehouse ID, valid non-zero quantity/delta, reason and reference/evidence required by policy.",
       "Notes or attachment where supported.",
       "Writes an atomic stock movement and updates only the selected warehouse position. Approval may be required before posting.",
       "Inventory totals, low-stock state, analytics, exceptions, audit and possibly approval queues update.",
       "Inventory adjust permission, warehouse scope and applicable approval limit.", "Before/after quantity, warehouse, reason, reference, actor/time, approval and audit event.",
       "Blocked for foreign warehouse/item, invalid quantity, unavailable stock for a decrease, missing reason, stale balance, insufficient approval or concurrent movement.",
       "inventory-adjust-stock.png"),
    fn("Receive purchased inventory", "Purchase Order > Receive panel / Procurement > Receiving",
       "Increases canonical warehouse stock only through a posted Goods Receipt tied to a PO, not by editing the item or PO totals.",
       "PO remaining quantity, item controls, selected warehouse/bin, batch/serial requirements and receipt service.",
       "Receivable PO, accepted quantity, receiver and warehouse; controlled items also need batch/serial evidence.",
       "GRN and shipment link.",
       "Writes receipt, inventory movement, PO progress and AP match evidence atomically.",
       "Inventory, Warehouse Ops, PO, Logistics, AP and exceptions see the same receipt.",
       "Receiving permission and warehouse scope.", "GRN, PO/line, accepted/rejected quantity, warehouse/bin, user/time and movement/audit links.",
       "Over-receipt, inactive warehouse, wrong item, stale remaining quantity or missing controlled evidence is rejected.",
       "receiving-goods-receipts.png"),
    fn("Return purchased inventory", "Procurement > Receiving & returns > Purchase returns",
       "Creates a governed outbound return against original PO/GRN evidence. It is distinct from a negative adjustment.",
       "Original PO, posted goods receipt, supplier, receipt lines, returnable accepted quantity, canonical warehouse stock and batch/serial traceability.",
       "Original receipt line, positive return quantity within returnable and available stock, warehouse, reason and required approval.",
       "Notes, attachment, carrier/tracking and supplier acknowledgement as the lifecycle progresses.",
       "Draft/approval records do not move stock. Dispatch atomically deducts warehouse stock and creates compensating movement evidence; financial quantities can create a supplier debit note/AP credit adjustment.",
       "Inventory, PO/GRN evidence, Logistics, AP, supplier performance, exceptions, Documents and Audit update while original receipt remains immutable.",
       "Purchase-return create/approve/dispatch permission, approval limit, SoD and warehouse scope.",
       "Return number/status, original PO/GRN/line, quantities, reason, approvals, dispatch movement, debit-note link and audit history.",
       "Blocked for unposted/foreign receipt, quantity above returnable/available stock, missing batch/serial, wrong state, insufficient approval or concurrent stock change.",
       "inventory-purchase-return.png"),
    fn("Barcode/QR stock In, Out and Lookup", "Inventory > Barcode scanner > Scan",
       "Resolves a code to an item. Lookup is read-only; In and Out create controlled warehouse movements using the selected mode.",
       "Generated item barcode/QR, tenant item lookup, warehouse inventory, camera/manual input and transaction validation.",
       "Recognised active item. In/Out additionally require warehouse, positive quantity and reason/source reference; Out requires sufficient availability.",
       "Camera scan may be replaced by manual code entry. A quotation-add mode is available only from the quotation workflow.",
       "Lookup changes nothing. In increases and Out decreases the chosen canonical warehouse position and appends a movement.",
       "Inventory detail/totals, warehouse enquiries, low-stock/reorder state, analytics and audit update.",
       "Scanner access plus inventory receive/issue permission and warehouse scope for mutations.", "Raw code, resolved item, mode, quantity, warehouse, reference, actor/time and movement/audit event.",
       "Unknown/duplicate code, camera denial, inactive item, missing warehouse, invalid quantity or insufficient stock stops posting.",
       "barcode-scan.png"),
]


def tab(prefix, title, area, definition, uses, required, result, impacts, screenshot,
        optional="Filters and notes shown on the screen.", permission="Read access to the workspace; mutation buttons require their named permission.",
        evidence="The record ID, status, actor/time and linked audit/document evidence shown in the workspace.",
        failures="Loading, Empty, Denied and Error are different states. Retry errors; correct prerequisites for Setup required; never infer success from a disabled control."):
    return fn(title, area, definition, uses, required, optional, result, impacts, permission, evidence, failures, screenshot)


TAB_FUNCTIONS = [
    tab("fuel", "Fuel — Stations & stock", "Operations > Fuel operations", "Defines the operating station/product context and shows current tank/product stock.", "Fuel stations, fuel products, tanks and canonical fuel transactions.", "At least one active station and product for operational use.", "Read-only until an explicit delivery, sale, pricing or reconciliation action is submitted.", "Provides the base identities used by every other Fuel tab.", "fuel-stations-stock.png"),
    tab("fuel", "Fuel — Deliveries", "Operations > Fuel operations", "Records inbound fuel deliveries and reconciles received volume/value.", "Stations, products, supplier/PO evidence and delivery measurements.", "Station, product, quantity/volume, date and source evidence.", "Posting changes fuel stock and feeds supplier/financial reporting.", "Affects Fuel stock, procurement/AP evidence and analytics.", "fuel-deliveries.png"),
    tab("fuel", "Fuel — Pumps, sales & pricing", "Operations > Fuel operations", "Maintains effective selling prices and records pump/sales activity.", "Active products, pumps, price versions and sales/reconciliation data.", "Station/product and valid effective price or sale reading.", "A posted sale reduces fuel stock and updates sales/margin analytics.", "Affects stock, revenue analytics, variance and audit evidence.", "fuel-pumps-sales-pricing.png"),
    tab("fuel", "Fuel — LPG cylinders", "Operations > Fuel operations", "Tracks optional LPG cylinder/channel activity separately from canonical fuel.", "Optional LP-gas schema and configured products.", "LP setup only when the organisation uses this channel.", "Updates LP counts while allowing the core Fuel workspace to remain operational if LP is unavailable.", "Affects LP safety/compliance and channel analytics, not unrelated fuel records.", "fuel-lpg-cylinders.png"),
    tab("fuel", "Fuel — Safety", "Operations > Fuel operations", "Records and reviews fuel safety/compliance controls.", "Station setup, inspections/incidents and supporting evidence.", "Applicable station and required safety details.", "Creates governed safety evidence; it does not alter stock unless a separate transaction is posted.", "Feeds diagnostics, exceptions and compliance reporting.", "fuel-safety.png"),
]


for label, filename, definition, impact in [
    ("Logistics — Overview", "logistics-overview.png", "Summarises bounded inbound/outbound shipment status and risk.", "Links to PO, inventory issue, carrier, exception and delivery evidence."),
    ("Logistics — Inbound", "logistics-inbound.png", "Controls supplier-to-warehouse shipments, ETA, tracking and receiving handoff.", "Updates PO delivery visibility, receiving queues and late/no-ETA exceptions."),
    ("Logistics — Outbound", "logistics-outbound.png", "Controls inventory-issue dispatch, shipment execution and delivery-note evidence.", "Dispatch reduces stock atomically and links movement, shipment, delivery note and status."),
    ("Logistics — Carriers", "logistics-carriers.png", "Selects approved carrier-capable suppliers and logistics attributes.", "Carrier changes flow to shipment assignment, rate/performance data and reports; the supplier remains the commercial authority."),
    ("Logistics — Activity", "logistics-activity.png", "Shows logistics event history across shipment changes and reconciliations.", "Supports operational investigation without mutating shipments."),
]:
    TAB_FUNCTIONS.append(tab("logistics", label, "Operations > Logistics", definition,
        "Tenant-scoped v2 shipment data, carrier-capable suppliers, source POs/issues and current exceptions.",
        "Logistics read; writes also require a valid source, destination and lifecycle state.",
        "Only explicit create/update/reconcile/dispatch actions write data.", impact, filename))


for label, filename, definition, impact in [
    ("Blanket Agreements — Agreements", "agreements-agreements.png", "Lists and creates governed framework/blanket agreement headers.", "Approved active agreements become the first PO pricing source."),
    ("Blanket Agreements — Lines", "agreements-lines.png", "Defines eligible catalog/non-stock/service lines, UOM, prices, breaks and release limits.", "Lines constrain release quantity/value and replace requisition estimates on release POs."),
    ("Blanket Agreements — Releases", "agreements-releases.png", "Maps every line of an independently approved requisition to an eligible agreement line and creates an idempotent release PO.", "Atomically increases agreement commitments and links requisition, agreement and PO."),
    ("Blanket Agreements — Renewals", "agreements-renewals.png", "Reviews expiry/renewal dates and starts a controlled renewal/version process.", "Renewal creates a new governed version; it does not rewrite the approved original."),
    ("Blanket Agreements — Activity", "agreements-activity.png", "Displays agreement lifecycle, line and release evidence.", "Explains approval, release and balance changes for audit."),
]:
    TAB_FUNCTIONS.append(tab("agreements", label, "Procurement > Contracts",
        definition, "Active suppliers and PO Master Data context; agreement detail/release services.",
        "Agreement read; creation/release needs supplier, currency and valid dates. Release requires an approved requisition.",
        "Writes occur only on create, line add, lifecycle transition or release.", impact, filename))


for label, filename, definition, impact in [
    ("Receiving — Goods receipts", "receiving-goods-receipts.png", "Shows posted GRNs and receipt/reversal evidence from the single shared receipt service.", "The same receipt updates PO progress, Inventory, Logistics and AP matching."),
    ("Receiving — Purchase returns", "receiving-purchase-returns.png", "Creates and follows governed supplier returns against original PO/GRN lines.", "Approval and dispatch update inventory and can create supplier debit/AP credit evidence."),
]:
    TAB_FUNCTIONS.append(tab("receiving", label, "Procurement > Receiving & returns", definition,
        "POs, receipt lines, warehouses, stock movements, approvals and documents.",
        "Tenant-owned source evidence, valid quantities, reason and permissions.",
        "Posted receipt/dispatch actions write compensating immutable evidence.", impact, filename))


for label, filename, definition, impact in [
    ("Supplier Portal — RFQs", "supplier-portal-rfqs.png", "Shows sourcing events assigned to the supplier and enables structured response work.", "Submitted quotes feed buyer comparison and award; drafts do not."),
    ("Supplier Portal — Open POs", "supplier-portal-open-pos.png", "Shows supplier-assigned sent POs without exposing other suppliers.", "Opens exact commercial commitment and response actions."),
    ("Supplier Portal — Confirmations", "supplier-portal-confirmations.png", "Appends Confirmed, Rejected or Clarification Requested responses to a PO.", "Updates PO workflow, Procurement Overview, exceptions, notifications and audit without overwriting PO terms."),
    ("Supplier Portal — Delivery Updates", "supplier-portal-delivery-updates.png", "Records supplier ETA/tracking updates for linked shipments.", "Updates Logistics and resolves/reopens ETA-related exceptions."),
    ("Supplier Portal — Submitted Invoices", "supplier-portal-submitted-invoices.png", "Submits invoices linked to the supplier and PO with optional supporting file.", "Creates AP intake evidence; payment is not created here."),
    ("Supplier Portal — Payment Status", "supplier-portal-payment-status.png", "Shows authorised invoice/batch/payment status for the signed-in supplier.", "Provides status visibility without exposing bank execution controls."),
    ("Supplier Portal — Documents", "supplier-portal-documents.png", "Provides authorised supplier-facing document versions.", "Downloads remain tenant/supplier scoped and missing files retain immutable metadata."),
]:
    TAB_FUNCTIONS.append(tab("portal", label, "Procurement > Supplier portal", definition,
        "Supplier-linked session identity and tenant-scoped RFQ/PO/shipment/AP/document services.",
        "A user profile linked to the exact supplier plus the permission and record assignment.",
        "Only explicit response, delivery update or invoice submit actions write records.", impact, filename,
        permission="Supplier-portal scope plus exact supplier ownership; Admin visibility does not change the supplier contract."))


for label, filename, definition, impact in [
    ("Accounts Payable — Intake", "ap-intake.png", "Captures/stages supplier invoice evidence and promotes valid captures into the invoice lifecycle.", "Promotion feeds matching and approvals; extraction alone is not a posted invoice."),
    ("Accounts Payable — Approvals", "ap-approvals.png", "Submits, previews approvers, approves, rejects or withdraws supplier invoices.", "Decisions update AP status, audit, notifications and eligibility for payment."),
    ("Accounts Payable — Exceptions", "ap-exceptions.png", "Shows PO/receipt/invoice mismatch and duplicate-risk evidence.", "Resolution affects invoice approval/payment eligibility but does not rewrite source PO/GRN evidence."),
    ("Accounts Payable — Aging", "ap-aging.png", "Groups open approved liabilities by due-date band using payment terms.", "Feeds cash planning, supplier status and finance analytics."),
    ("Accounts Payable — Payments", "ap-payments.png", "Selects eligible invoices across pages and creates an atomically revalidated payment batch.", "Updates invoice payment state and remittance evidence; it exports instructions but does not directly move funds."),
]:
    TAB_FUNCTIONS.append(tab("ap", label, "Finance > Accounts payable", definition,
        "Tenant-scoped paginated captures/invoices/batches, suppliers, POs, GRNs, matching, approvals and documents.",
        "Valid supplier/invoice references, current eligibility and appropriate AP permission.",
        "Only capture, promote, match, decision or batch commands write data.", impact, filename))


for label, filename, definition, impact in [
    ("General Ledger — Chart of accounts", "gl-chart-of-accounts.png", "Lists the accounts used by posting rules and statements.", "Account changes affect future postings and reporting dimensions, not posted journal history."),
    ("General Ledger — Fiscal periods", "gl-fiscal-periods.png", "Shows accounting date windows and their open/closed state.", "Closed periods reject ordinary posting; corrections require controlled reversals/reopening."),
    ("General Ledger — Journals", "gl-journals.png", "Shows balanced posted accounting entries and their source.", "Feeds trial balance and statements; posted entries are immutable."),
    ("General Ledger — Trial balance", "gl-trial-balance.png", "Aggregates account debits, credits and balances for the selected period.", "Supports financial-statement and subledger reconciliation."),
    ("Accounts Receivable — Customers", "ar-customers.png", "Shows customer credit, currency and receivable balance.", "Customer status/credit affects sales and quotation-to-order workflows."),
    ("Accounts Receivable — Invoices", "ar-invoices.png", "Shows customer sales invoices and outstanding balances.", "Feeds aging, receipts, statements and GL postings."),
    ("Accounts Receivable — Aging", "ar-aging.png", "Groups customer balances into due-date bands.", "Feeds collections, credit review and cash forecasting."),
]:
    TAB_FUNCTIONS.append(tab("finance", label, "Finance", definition,
        "Tenant finance services, fixed-precision money, accounting dimensions, periods and posting evidence.",
        "Finance read; posting/close/approval needs the relevant permission and valid open period.",
        "List/summary tabs are read-only; explicit posting/reversal actions create immutable journal evidence.", impact, filename))


SETTINGS_NAMES = [
    ("Overview", "settings-overview.png", "Maps each organisation control to its authoritative owning workspace."),
    ("Appearance", "settings-appearance.png", "Controls local logo/colour/density/date/time presentation; it does not own reporting currency."),
    ("Operational policy", "settings-operational-policy.png", "Edits reporting currency, low-stock and receiving/operational controls through the Production Control Plane."),
    ("Live updates", "settings-live-updates.png", "Controls live refresh behaviour and event-driven display updates."),
    ("Database", "settings-database.png", "Shows local connectivity/synchronisation configuration without fabricating tenant values."),
    ("Planning", "settings-planning.png", "Sets demand-planning and forecast defaults used by replenishment functions."),
    ("Tax", "settings-tax.png", "Controls tax jurisdiction/reporting defaults while tax codes remain Master Data."),
    ("Billing", "settings-billing.png", "Links subscription/payment/invoice behaviour to the authoritative billing workspace."),
    ("Workflow controls", "settings-workflow-controls.png", "Links organisation workflow choices to Approval Policies and Workflow Governance rather than duplicating rules."),
    ("Warehouses", "settings-warehouses.png", "Sets organisation receiving/default-site policy while warehouse master/layout remains Master Data."),
    ("Security", "settings-security.png", "Controls authentication and operational guardrails; effective API permissions remain RBAC-authoritative."),
]
for label, filename, definition in SETTINGS_NAMES:
    TAB_FUNCTIONS.append(tab("settings", f"Settings — {label}", "Admin > Settings", definition,
        "Authoritative organisation settings service plus links to Master Data, roles, policies and company setup.",
        "Administrator access and a successfully loaded tenant settings revision.",
        "Save persists only the fields owned by this section and invalidates settings consumers.",
        "New forms and future operations use the new setting; approved/posted snapshots are not retroactively rewritten.", filename,
        optional="Only fields without a required marker are optional; Save stays disabled when settings have not loaded."))


MDM_NAMES = [
    ("Overview", "mdm-overview.png", "Shows Master Data health, approvals, dependency risk, duplicate candidates and recent changes."),
    ("Units of Measure", "mdm-units.png", "Defines quantity units used by items, requisitions, POs, receipts and counts."),
    ("Currencies and FX", "mdm-currencies.png", "Defines transaction currencies and versioned effective exchange rates used for reporting snapshots."),
    ("Tax Codes", "mdm-tax-codes.png", "Defines tax treatments used by suppliers, demand, POs, invoices and exports."),
    ("Commodity Codes", "mdm-commodity-codes.png", "Defines spend/sourcing classifications used by suppliers, lines and analytics."),
    ("Incoterms", "mdm-incoterms.png", "Defines delivery-responsibility terms copied through supplier/contract defaults to POs and Logistics."),
    ("Payment Terms", "mdm-payment-terms.png", "Defines due/discount rules copied to suppliers/contracts/POs and used for AP aging."),
    ("Departments", "mdm-departments.png", "Defines ownership/cost dimensions used by demand, approvals, budgets and reporting."),
    ("Warehouses", "mdm-warehouses.png", "Defines tenant sites/layouts/defaults used by receiving, storage, transfers and counts."),
    ("Carriers", "mdm-carriers.png", "Maintains logistics-provider references linked to carrier-capable suppliers rather than a competing commercial supplier record."),
    ("Approval Policies", "mdm-approval-policies.png", "Links to the governed approval policy editor; no duplicate policy store is created here."),
]
for label, filename, definition in MDM_NAMES:
    TAB_FUNCTIONS.append(tab("mdm", f"Master Data — {label}", "Admin > Master Data", definition,
        "Tenant-scoped Master Data APIs, dependency counts and governed change/audit services.",
        "Admin/master-data permission; create/edit also needs unique code/name and valid domain fields.",
        "New documents use active current values. Drafts expose drift and require explicit expected-revision refresh; submitted/approved/posted documents keep snapshots.",
        "Every dependent selector/context is invalidated after a relevant change; inactive values remain visible on historical records but cannot be newly selected.", filename,
        permission="Master Data read/manage/approve permission according to the domain and risk.",
        evidence="Stable code/ID, status, dependencies, revision/effective date, actor/time and change approval/audit."))


for label, filename, definition, impact in [
    ("Document Extractor — Single File", "extractor-single.png", "Accepts exactly one supported file for extraction preview.", "No database record is created until mapping validation and Confirm import."),
    ("Document Extractor — Batch Processing", "extractor-batch.png", "Accepts up to ten supported files and exposes per-file success/rejection.", "Each file remains individually reviewable; one failure need not fabricate success for others."),
    ("Document Extractor — Database Import", "extractor-import.png", "Maps reviewed extracted columns to an allowed import contract and validates them.", "Confirmed rows update the selected destination and invalidate its consumers."),
    ("Document Extractor — Options", "extractor-options.png", "Sets extraction/interpretation options without importing anything.", "Options affect later extraction output, not existing records."),
]:
    TAB_FUNCTIONS.append(tab("extractor", label, "Admin > Document extractor", definition,
        "Supported PDF, XLSX, XLSM, CSV, JPEG, PNG and TIFF handlers plus the selected import contract.",
        "Supported type/size, readable file and extractor permission.",
        "Only Confirm import writes operational/master data.", impact, filename))


for label, filename, definition in [
    ("Overview", "diagnostics-overview.png", "Separates current failures, expected configuration and historical evidence."),
    ("User-Visible Errors", "diagnostics-user-errors.png", "Shows failed actions and structured validation users encountered."),
    ("Frontend", "diagnostics-frontend.png", "Shows route, React, browser network and slow-request evidence from this browser."),
    ("Backend", "diagnostics-backend.png", "Shows readiness, database/schema, route and worker/service findings."),
    ("Business Rules", "diagnostics-business.png", "Shows workflow, approval and Master Data rule conflicts."),
    ("Integrations", "diagnostics-integrations.png", "Shows email, exports, billing, WebSocket and provider configuration/results."),
    ("Data Consistency", "diagnostics-consistency.png", "Shows fixture, orphan, dependency, currency, tax and GL risks."),
    ("Notifications", "diagnostics-notifications.png", "Shows backlog, duplication, delivery and retention evidence."),
    ("Security", "diagnostics-security.png", "Shows recorded runtime security evidence and explicit release-gate gaps."),
    ("Audit Timeline", "diagnostics-audit.png", "Shows tenant audit coverage and recent hash-chain evidence."),
]:
    TAB_FUNCTIONS.append(tab("diagnostics", f"Diagnostics — {label}", "Admin > System diagnostics", definition,
        "Structured diagnostic findings with code, severity, evidence state, request ID, remediation and exact internal target path.",
        "Administrator diagnostics access.",
        "Run checks/safe probes may refresh findings but do not purge or repair operational data automatically.",
        "Open problem tab navigates to the exact owning workspace; rerun after correction to confirm current state clears or becomes history.", filename,
        permission="Administrator diagnostics permission; destructive fixture cleanup is separate, guarded and not run from ordinary scans."))


for slug, label in [
    ("inventory", "Inventory"), ("low-stock", "Low-stock"), ("value", "Inventory value"),
    ("purchase-orders", "Purchase orders"), ("purchase-requisitions", "Purchase requisitions"),
    ("suppliers", "Suppliers"), ("reorder-requests", "Reorder requests"),
    ("invoices", "Invoices"), ("shipments", "Shipments"),
]:
    TAB_FUNCTIONS.append(tab("reports", f"Reports — {label}", "Analytics > Reports", f"Builds the {label} preview from the server report-preview service.",
        "The same validated dataset/filter/sort query builder used by exports, including normalized filters and fingerprint.",
        "Report read/export permission and valid filters.",
        "Preview is read-only; Export queues only a format advertised as supported for this dataset.",
        "Preview total, summary, footer and exported row set must describe the same tenant-scoped filtered dataset.", f"reports-{slug}.png"))


for label, filename, definition in [
    ("Profile", "profile-profile.png", "Updates the current user's name, email and profile image; contact fields shown without a connected save contract must not be treated as persisted evidence."),
    ("Security", "profile-security.png", "Changes password and supported security preferences; 2FA status is read-only here and requires its verified setup flow."),
]:
    TAB_FUNCTIONS.append(tab("profile", f"Profile — {label}", "Admin > Profile", definition,
        "Current authenticated user profile and security-preference endpoints.",
        "Current credentials/session and fields marked required.",
        "Only the matching Save/Change command writes that section.",
        "Profile changes update the header/user identity; security changes affect future authentication/session behaviour.", filename,
        permission="The signed-in user for their own profile; admin employee access is managed separately."))


for label, filename, definition, impact in [
    ("Supplier register", "suppliers-list.png", "Searches, reviews and opens tenant supplier master records.", "Supplier changes propagate to sourcing, requisitions/POs, agreements, Logistics, AP and documents."),
    ("Supplier — Overview", "supplier-form-overview.png", "Captures the minimum supplier identity/status and summarises completeness.", "Creates the canonical counterparty used across Procurement and AP."),
    ("Supplier — Profile", "supplier-form-profile.png", "Captures legal, registration, tax, address and descriptive profile data.", "Feeds legally complete supplier/customer blocks on governed documents."),
    ("Supplier — Commercial", "supplier-form-commercial.png", "Sets currency, payment terms, Incoterm, tax and commercial defaults.", "Defaults flow into new requisitions/POs/contracts and AP; existing submitted snapshots remain unchanged."),
    ("Supplier — Contacts & Sites", "supplier-form-contacts-sites.png", "Maintains dispatch/invoice contacts and physical/remit-to sites.", "PO emails, delivery, invoice and document addresses use the selected active contact/site."),
    ("Supplier — Contracts", "supplier-form-contracts.png", "Shows governed agreements linked to the supplier.", "Agreement pricing/release availability becomes visible without duplicating the contract master."),
    ("Supplier — History", "supplier-form-history.png", "Shows prior commercial and operational relationship evidence.", "Supports supplier review and risk decisions."),
    ("Supplier — Logistics", "supplier-form-logistics.png", "Sets logistics/carrier capability, lead-time and delivery defaults.", "Feeds PO delivery expectations, shipment assignment and performance."),
    ("Supplier — AP", "supplier-form-ap.png", "Sets AP/remittance and payable-facing defaults within governed banking controls.", "Feeds invoice due/match/payment preparation; direct funds movement is outside this form."),
    ("Supplier — Risk", "supplier-form-risk.png", "Shows/maintains authorised compliance and risk classification.", "May block sourcing/award/PO/payment or raise exceptions according to policy."),
    ("Supplier — Audit", "supplier-form-audit.png", "Shows immutable supplier change/activity evidence.", "Explains who changed supplier identity/defaults and why."),
]:
    TAB_FUNCTIONS.append(tab("supplier", label, "Procurement > Suppliers", definition,
        "Canonical supplier service, Master Data defaults, contacts/sites, contracts, performance, documents and audit.",
        "Supplier permission; create/update needs required legal/name/status fields and valid active Master Data.",
        "Save writes only fields in the active supplier form and invalidates supplier/default contexts.", impact, filename))


TAB_FUNCTIONS.append(tab(
    "barcode", "Barcode scanner — Generate", "Inventory > Barcode scanner > Generate",
    "Generates a printable barcode or QR representation for a selected tenant item. The code is an item identity, not a stock transaction.",
    "The item's server-assigned primary barcode/QR payload and current item identity.",
    "An active item and the appropriate barcode/label access.",
    "Preview/print creates no movement. Reassigning an identity, where permitted, is a separately audited item-master change.",
    "Printed labels resolve back to the item in Scan/Lookup and quotation item selection.",
    "barcode-generate.png",
    optional="Label format, quantity and printer options when shown.",
    evidence="Item/SKU, encoded value, format and any recorded label-generation event.",
))

for label, filename, definition, impact in [
    ("Pending", "reorder-pending.png", "Shows replenishment requests awaiting review or approval.", "Approval makes the request eligible for conversion; it does not itself create a supplier commitment."),
    ("Approved", "reorder-approved.png", "Shows authorised replenishment requests ready for conversion.", "Conversion creates linked requisition/PO evidence according to the configured workflow."),
    ("Rejected", "reorder-rejected.png", "Shows requests rejected with retained decision evidence.", "Rejected demand does not reserve/commit purchasing; correction requires a new or explicitly revised request."),
    ("Converted", "reorder-converted.png", "Shows requests already linked to downstream procurement records.", "The linked requisition/PO becomes authoritative; conversion is not repeated."),
    ("All", "reorder-all.png", "Shows every reorder lifecycle state in the current tenant scope.", "Provides audit/reconciliation visibility without changing request state."),
]:
    TAB_FUNCTIONS.append(tab(
        "reorder", f"Reorder requests — {label}", "Inventory > Reorder requests", definition,
        "Item availability, low-stock/reorder thresholds, demand inputs, supplier/default references and the reorder workflow.",
        "Inventory/reorder read; decisions and conversion require the corresponding permission, approval limit and valid active references.",
        "Only explicit create, decision or conversion actions write data.", impact, filename,
        evidence="Request ID/item/quantity, source calculation, requester, decision/reason, status, downstream link and audit history.",
    ))


ALL_FUNCTIONS = PURCHASE_ORDER_FUNCTIONS + INVENTORY_FUNCTIONS + TAB_FUNCTIONS
