# Warehouse and logistics completion: source audit and build specification

Date: 15 September 2026. Scope: the supplied ASN, handling-unit, stock-quality and WMS assessment.

## Delivery boundary

This is a source-code audit and implementation sequence, not a passed production audit. No stock was posted, historical records altered, application features enabled or browser transactions executed during this review. The initial changes correct capability classification, retire misleading roadmap authority and stop reporting a procurement-settings modification timestamp as a capability-verification timestamp. The operational releases below are pending implementation.

Do not rebuild existing receipts, batch/serial masters, put-away tasks, returns, stock movements, approvals or exceptions. Integrate the missing controls into those domains. The original 180 checklist entries remain intact; new ASN/handling-unit requirements are an extension backlog, not silently counted as previously audited capabilities.

The executable catalog currently resolves those entries to **172 unique records with eight aliases**, not the previously documented 173/seven. The merges are audit trails, PO approvals, supplier price lists, vendor lead times, stock counts, Mobile WMS, supplier performance/dashboard and AP aging/dashboard. This review preserves those mappings rather than inventing another record to match the old claim. After the five focused status corrections, static totals are 91 implemented, 31 partial and 50 missing. These are catalog classifications, not a new full-app runtime certification; organization feature flags can further disable them.

## 1. Findings and evidence

| Function | Source finding | Completion required |
| --- | --- | --- |
| ASN and handling units | No material ASN/SSCC/nested handling-unit implementation found in inspected server/shared sources. Existing shipments are not an ASN contents ledger. | New inbound advice and HU entities connected to existing PO, shipment and receipt services. |
| GS1 scanning | Existing barcode functions do not establish a validated GS1 supply-chain parser. | Standards-backed parsing, identifier validation, tenant-scoped matching and scan preview before posting. |
| Quality stock | Allocation and batch/serial entities exist in `shared/schema.ts`. Fuel-specific quarantine is not general inventory quality control. | Mutually consistent quality, reservation and custody controls enforced by every stock consumer. |
| Cycle counts | `client/src/pages/cycle-counts.tsx` accepts system quantity and variance from the operator. `server/modules/master-data/register-master-data-routes.ts` registers count lines as generic CRUD and posts client-derived differences. | Server snapshots, tenant-safe child routes, blind count, recount/review, idempotent atomic posting. Critical. |
| Cycle posting | The post handler has no explicit organization predicate, completed-state guard or enclosing transaction. `DatabaseStorage.createStockMovement` in `server/database-storage.ts` inserts a movement; it does not itself update warehouse balances. | Verify any database-trigger effects, then route all changes through one transaction-aware canonical stock service. Prove both quantities and ledger evidence change exactly once. Do not assume that inserting a movement updates stock. |
| Put-away | `server/modules/inventory-flow/register-inventory-flow-routes.ts` has tenant-scoped task transitions and bin checks. Completion selects stock by item/warehouse and updates that balance's location/bin. | Per-position quantities before split put-away. Moving 10 units must not relabel a whole 100-unit balance. |
| Fractional quantities | Put-away movement uses rounding; purchase-return dispatch also rounds requested quantities in `server/modules/procurement-completion/register-procurement-completion-routes.ts`. | Preserve base-UOM precision, reject unsupported fractions explicitly and enforce serial quantities as whole units. Never silently round. |
| Batch/serial | `inventoryBatches` and `inventorySerials`, CRUD registration, warehouse operations and receipt capture already exist. | Preserve masters; add receipt-to-movement genealogy, return/reversal lineage, quality and recall controls. Basic tracking and full traceability are different capabilities. |
| Expiry/FEFO | Expiry fields do not prove dispatch enforcement. | Central eligibility checks, shelf-life rules and FEFO recommendations across all issue/pick/return paths. |
| Item governance | Item creation and stock operations are currently closely coupled. | Separate item-master permission/approval from stock-transaction access, including direct API calls. |
| Locations | Put-away uses warehouse-configured bins and a coarse item/warehouse balance. | Typed tenant-owned location references and per-bin/lot/status positions; retain legacy labels as historical evidence. |
| Purchase returns | V2 create/list/submit/approve/cancel/dispatch and debit-note insertion already exist in procurement completion routes. | Not missing. Complete hold/reservation, acknowledgment, replacement and AP settlement controls; validate fractional stock and returnable receipt quantities. |
| Freight/POD | Existing shipment, carrier and exception functions are foundations, not proof of complete transport management. | Reuse carrier/supplier authority. Audit existing POD/rate fields before extending; do not duplicate supplier master. |
| Valuation | Item costs and movement `unitCost` are not proof of an inventory costing subledger. | Cost layers/weighted-average policy, reversals and GL reconciliation. Reclassified partial. |
| Notifications | Existing central exception and notification services are present. Put-away already creates/resolves exceptions. | Add missing rule producers and durable delivery, not a second notification system. |
| Capability evidence | Capability endpoint used feature-settings `updated_at` as `verifiedAt`. | Corrected: feature enablement does not establish verification. Actual test results remain separately required. |

These findings identify missing explicit controls in the reviewed code; exploitability and trigger behavior require disposable-database tests. No claim is made that all security middleware or deployed migrations were runtime-tested.

## 2. Correct the domain model before adding screens

### Canonical stock positions

Retain one stock ledger. Introduce or extend normalized positions for organization, item, warehouse, bin, lot and quality status; serial identity is linked explicitly for serialized items. Use fixed-precision base-UOM quantities, with original entered quantity, UOM and conversion snapshot retained on documents. Keep warehouse and item totals as reconciled aggregates, not independently editable balances.

Reservations and quality are different dimensions. A unit can be allocated and subsequently put on quality hold; subtracting both without intersection rules double-counts it. Use eligible-position quantities minus active reservations against those same eligible positions. PICKED, RECEIVING and IN_TRANSIT describe custody/process stage, whereas QUARANTINE, INSPECTION, DAMAGED and BLOCKED describe restrictions. RETURN_PENDING must exclude stock from ordinary allocation. Either model these separately or define disjoint buckets with validated transitions.

Projected availability must use dated supply/demand events with unique source identity. A confirmed PO, its ASN and its in-transit shipment describe the same supply, not three receipts. Count it once. Deduplicate outbound reservations and committed demand in the same way. Expose the calculation components and as-of date on Inventory and planning screens.

### Compatibility and migration

Backfill only facts supported by existing records. Unknown bin/lot/quality becomes a clearly labeled unresolved position, never an invented bin or lot. Do not infer that all old stock has passed inspection. Reconcile every warehouse/item quantity before and after migration. Keep existing receipt IDs, movements, return links and audit events unchanged. Compatibility routes call the canonical service; they must not retain a weaker direct-write path.

## 3. Release 0 — Counting and quantity integrity first

1. Replace generic count/line mutations with a domain service. Every header, line, item and warehouse lookup is scoped to the active organization and authorized warehouse. Bound list queries; require a parent count for lines.
2. Define PLANNED, COUNTING, SUBMITTED, RECOUNT_REQUIRED, PENDING_APPROVAL, APPROVED, POSTED and CANCELLED transitions. Preserve historical completed records; never allow them to be reposted or edited.
3. Snapshot expected quantity on the server at count freeze/start. Record the exact position, stock revision, timestamp and actor. Reject client-supplied expected quantities, variances and approval fields.
4. Give the counter item/location and count-entry fields only. Expected values must be absent from the counter's API response, not merely hidden by CSS. Separate reviewer permission from counting permission.
5. Preserve first and subsequent count attempts as evidence. Compute quantity, percentage and value differences on the server. Define zero-expected percentage behavior explicitly; do not divide by zero.
6. Configure recount and independent approval thresholds. The counter cannot approve their own variance. In the absence of approved tolerance policy, fail closed to review rather than auto-posting.
7. Decide the stock-motion policy explicitly. Initially, detect revision changes and require a new count before posting. A hard stock freeze may be offered only if every mutation path enforces it. Never overwrite movements that occurred after the snapshot.
8. Lock count and affected stock positions in stable order inside one transaction; enforce status, unique posting source and idempotency. Update stock, movement, count state and audit/outbox evidence atomically. A retry returns the prior result without another movement.
9. Do not automatically queue a failed posting offline. Queue only supported count-entry intents with revision metadata; validation, permission and conflict errors need operator resolution.
10. Remove fractional rounding from put-away and returns. Use the stock service's exact UOM rules and costs.

Completion evidence: forged expected quantity rejected; blind response contains no expected quantity; foreign parent/item/warehouse denied; repeat/concurrent posting produces one adjustment; forced failure rolls back all writes; post-snapshot movements cause conflict; a 0.25-unit return remains 0.25; stock aggregate and movement totals reconcile.

## 4. Release 1 — Positions, quality, holds and item governance

Build normalized location/position storage and reconciliation before introducing split receiving. Master Data owns site, warehouse, zone and bin definitions; optional aisle/bay/shelf levels depend on the site's layout. All assignments use IDs. Retire free-text assignment while preserving historical display labels.

Add inspection decisions and quality transitions with reason, actor, evidence and approval where required. A hold reduces eligible stock immediately across Inventory, scanner, allocations, picking, dispatch, transfers and returns. Release restores eligibility without creating quantity. Damaged/held goods remain on hand unless physically disposed or returned through an approved transaction.

Inventory exposes Request New Item for operators and Open Item Master for authorized maintainers. Reuse existing governance requests and approvals. Creating the master does not create opening stock. Opening balances use an approved, auditable stock transaction.

Completion evidence: a hold appears consistently on Inventory, Control Tower and pick availability; a direct issue request cannot bypass it; quality changes conserve total quantity; warehouse/bin restrictions apply to both reads and writes.

## 5. Release 2 — ASN, handling units and GS1 receiving

### Data and authority

Add ASN header/lines, ASN-to-PO-line links, handling units, HU contents and append-only scan/receiving events. Headers contain tenant, supplier, internal ASN number, supplier reference, shipment link, destination, dispatch/ETA, carrier/tracking and revision. Lines contain item/GTIN, expected quantities/UOM, lot, serial and expiry. HUs contain type, parent, optional SSCC, weight, dimensions and contents.

Allow multiple POs only when supplier, tenant and receiving destination rules are satisfied. Prevent parent cycles, duplicate serialized contents, overpacking and cross-tenant references. Container, pallet and carton nesting does not imply each unit has a GS1 identifier. Use internal IDs when no valid SSCC is supplied. Do not fabricate GS1 Company Prefixes.

### Workflow and UI

PO -> supplier advice -> validate -> shipment/HU -> arrival scan -> contents/discrepancy preview -> confirmed canonical goods receipt -> inspection/put-away.

Extend Logistics with Inbound Advice and Handling Units views, and Receiving with Scan Handling Unit. Display expected versus observed contents, PO remaining quantity, destination and quality requirements before confirmation. A scan alone never silently posts a receipt. Record partial receipt, missing/excess contents, damage and unknown labels as explicit exceptions.

ASN revisions before receipt are versioned; changes after receipt cannot rewrite received contents. Lock the PO remaining quantity and HU/ASN receipt revision on posting. Use one idempotency key per receiving intent and unique source linkage. Receiving a parent then its child must not receive the same contents twice. Unknown supplier advice is retained for review, not converted into new items automatically.

### GS1 parser

Validate raw scanner data separately from formatted human-readable input. Support symbology identifiers and variable-field separators, identifier length/check digits, AI field boundaries and expiry semantics. Do not assume every numeric barcode is GS1. Preserve raw input and normalized parsing evidence. Resolve identifiers within the tenant's authorized catalogs, and reject ambiguous matches. Quantity AI choice depends on packaging and measurement semantics; quantity is not always one fixed field.

GS1 recommends processing despatch advice before arrival and using SSCC to identify the logistic unit and match its advice. SSCC labels must use legitimately allocated identifiers, not arbitrary sample strings. See [GS1 Logistic Label Guideline](https://www.gs1.org/standards/gs1-logistic-label-guideline/1-3) and [SSCC overview](https://www.gs1.org/standards/id-keys/sscc). Implement parsing against the current GS1 General Specifications and licensed identifier configuration before claiming compliance.

Completion evidence: scan preview maps HU contents to PO lines; unknown/invalid SSCC fails safely; duplicate/parent-child scans cannot overreceive; receipt, quality stock, put-away, AP matching and audit show the same receipt identity and quantities.

## 6. Release 3 — Directed/split put-away, genealogy and FEFO

Extend existing put-away tasks with destination allocations. Each split refers to a canonical position and exact quantity; the total equals the task quantity. Completing one split moves only that quantity and preserves the others. Capacity reservations must be locked to prevent two concurrent tasks overfilling a bin.

A strategy ranks valid bins using configured item defaults, fixed bins, capacity, weight/volume, zone, compatibility, temperature, hazard rules, segregation, velocity and distance. Return reasons and constraints alongside the recommendation. Missing capacity/configuration is unknown, not unlimited. Overrides require a reason and cannot bypass hard safety/access rules.

Attach batch/serial identities to every receipt, split, transfer, issue, return and reversal movement. Add forward/backward trace views showing source supplier/PO/ASN/GRN, HUs, positions, downstream recipients, quantities and exceptions. Recall places affected stock on hold and identifies already-dispatched destinations without rewriting history.

FEFO selects the earliest eligible expiry satisfying shelf-life requirements. Block expired/held stock on the server across every issue path; exceptions for products legitimately usable after a best-before date require a distinct configured policy. Use warehouse-local business date rules consistently.

Completion evidence: 100 units split 60/40 reconcile across bins; capacity conflicts are safe; trace quantity reconciles to movement history; a held/expired lot cannot be scanned around the policy; a recall identifies both remaining and dispatched goods.

## 7. Release 4 — Reverse logistics, freight and durable exceptions

Extend existing purchase returns: link discrepancy and return authorization, reserve RETURN_PENDING quantities, preserve lot/serial provenance, approve, dispatch, receive supplier acknowledgment, settle debit/credit adjustment and track replacement supply. Cancellation releases the hold once. Reversal cannot make more quantity returnable than the original accepted receipt minus prior returns/reversals.

AP must distinguish a debit-note record from a posted/allocated credit. Display unresolved financial adjustments and prevent payment of disputed quantities according to policy. Do not silently mark an invoice paid or reduce its balance when return stock moves.

Reuse carrier-linked suppliers for service level, contract/rate, lane, estimate versus actual freight, Incoterm, milestones, POD, claims and carrier performance. Implement minimum costing/POD evidence first; tendering and advanced routing follow later. POD belongs to a delivery, not simply an uploaded generic file.

Add producers for missing ASN, changed ETA, discrepancy, overdue put-away/quality review, count variance, expiry and delayed transfers to central Exceptions. Deduplicate on tenant/entity/rule; resolution preserves history. Notify authorized recipients through the existing durable outbox and configured channels. A toast is not delivery evidence, and unconfigured email must not be reported as sent.

## 8. Release 5 — Valuation and optional cross-docking

For native accounting, valuation is a release prerequisite for financially posted stock, not a cosmetic report. Choose and version costing policy per allowed accounting configuration. Preserve movement unit cost, extended cost, cost layer/reference, document/reporting currency and rate snapshot. Apply returns/reversals against original cost provenance. Use idempotent GL posting and subledger/control-account reconciliation. Do not synthesize historical journals; use verified opening balances.

Cross-docking comes after reliable positions, holds, reservations and outbound demand. Recommend only eligible inbound supply against real demand; confirm staging moves explicitly. It must not bypass inspection, traceability or allocation controls. This phase does not introduce a second receipt or dispatch ledger.

## 9. Proposed contracts (not currently available endpoints)

| Extension | Contract direction |
| --- | --- |
| Cycle counts | Dedicated `/api/v2/inventory/cycle-counts` with start, count-entry, submit, recount, approve, post and cancel; compatibility paths use the same service. |
| Stock positions | `/api/v2/inventory/positions`, availability summaries and governed quality transitions. |
| Inbound advice | `/api/v2/logistics/asns` with lines, revisions and transitions; supplier-portal access scoped to represented supplier. |
| Handling units | `/api/v2/logistics/handling-units`, contents/packing and label preview. |
| Scanning | Server parse/resolve/preview contract; separate confirmed receiving command through the existing goods-receipt service. |
| Put-away | Extend existing `/api/v2/inventory/put-away` with splits and recommendations. |
| Traceability | Tenant/permission-scoped item, lot, serial and HU trace enquiry with bounded movement history. |

Lists default to 25 and allow 50/100; validated filters and stable sorting apply after tenant/access scope. Mutations use revision and idempotency contracts. Business errors distinguish invalid barcode, unknown HU, stale count, duplicate receipt, quality hold, insufficient eligible stock, quantity precision and denied location. No error path should return fabricated successful quantities.

## 10. Cross-page verification and rollout

Each release is independently gated; readiness is not inferred from a feature toggle. Prove these propagation paths against disposable records before enabling:

- Master Data item/UOM/bin -> ASN/receipt selectors -> put-away -> inventory enquiries.
- Count approval/post -> bin and warehouse balance -> stock history -> valuation -> audit/exception views.
- HU receipt -> PO progress -> canonical GRN -> inspection/available quantity -> AP matching.
- Hold/expiry/recall -> Inventory -> scanner -> pick/dispatch denial -> Control Tower/notifications.
- Return dispatch -> returnable quantity -> stock/trace -> AP credit review -> replacement inbound.
- Freight/POD -> shipment status -> exceptions -> carrier analytics without duplicate deliveries.

Run negative permission/cross-tenant, forced rollback, concurrent quantity, replay and migration-reconciliation cases. Verify desktop/mobile, keyboard use, bounded tables, error/retry behavior and print labels. Preserve a dated verification artifact for each capability. A source path or a settings save is not evidence that these checks passed.
