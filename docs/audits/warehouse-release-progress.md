# Warehouse completion release progress

Updated 15 September 2026. This file distinguishes delivered code from production readiness.

## Implemented in this increment

- Dedicated V2 and legacy-parent cycle-count handlers; removed the unsafe generic count mutations and legacy posting loop.
- Warehouse ownership/assigned-warehouse checks, blind responses, server quantity/revision snapshots, preserved count attempts, independent variance approval and explicit lifecycle actions.
- Serializable posting transaction updates stock and movement evidence with audit-chain and outbox records; posting keys prevent replay.
- Revision trigger detects warehouse balance updates even when quantity later returns to the original amount.
- Paginated counting screen with error/retry states and no offline posting fallback.
- Whole-unit validation prevents put-away/return dispatch silently rounding quantities. Partial-position put-away fails explicitly instead of relabeling an entire balance.

## Verification performed

- Count contract checks: strict inputs, invalid paging/quantity, immutable states and self-approval denial.
- Dedicated disposable PostgreSQL database: migration applied twice, route/SQL integration, tenant denial, blind review, stale revisions, forced rollback, inventory propagation, movement deduplication, concurrent/zero-variance posting and 5,000-record pagination. Test-owned database removed afterward.
- This small integration fixture does not constitute a full production-schema migration rehearsal or full RBAC/browser release gate.

## Migration

The application database has not been migrated by these test runs. Deploy the code and additive migration together after backup/rehearsal:

```powershell
node scripts/apply-sql-migration.mjs 20260915120000_cycle_count_integrity.sql
```

Existing completed counts and old lines remain stored and are not reposted. Unfinished legacy counts require a fresh snapshot. Legacy child CRUD now returns a structured error directing callers to parent-scoped V2 count entries; its old unsafe payload is intentionally not supported.

## Remaining release work

- Release 0 is not fully released: complete mobile-count convergence, historical-attempt review UI, full warehouse/bin effective-access integration, approved notification delivery, full-schema/browser gates, and decimal-quantity migration across every stock writer. Current count entry is whole-unit only.
- Release 1: canonical bin/lot/quality positions, reservations/availability, inspection rules, legacy reconciliation and item governance.
- Release 2: ASN, nested handling units, GS1 parsing, label generation and canonical receipt integration.
- Release 3: split/directed put-away, traceability/recall and FEFO.
- Release 4: return settlement/replacement, freight/POD extensions and additional durable exception producers.
- Release 5: weighted-average valuation/GL reconciliation and cross-docking.

## Release 1 foundation increment

Implemented a Stock positions workspace at `/inventory/positions`, registered in navigation access and guided learning. It reuses `mdm_sites` (not the construction-project `sites` table), adds normalized warehouse/site links, zones and bin IDs, and reads quantities from the existing warehouse balance. There is no second quantity ledger.

Warehouse maintainers can register locations; inventory approvers can verify a whole balance's location using a source revision and reason. Verification updates the compatibility location/bin fields used by existing Inventory and put-away, without changing quantity. Existing bin metadata is preserved on import; contradictory aisle/shelf definitions are rejected. Every verification produces immutable evidence and a hash-chained audit event. Later stock changes invalidate the snapshot. History is paginated and remains queryable if the original position is removed.

The API explicitly reports `qualityHolds: false` and `splitPositions: false`; the UI explains that this is location reconciliation, not inspection, quality release or per-bin quantity splitting. No quality-aware availability or projected supply is claimed.

Additional migration, after the counting migration:

```powershell
node scripts/apply-sql-migration.mjs 20260915160000_warehouse_position_foundation.sql
```

Verification command (creates and removes only its own local disposable database):

```powershell
npm.cmd run test:warehouse-position-runtime -- --local-disposable
```

Validated: both additive migrations are re-runnable; bounded searches and lists; tenant and permission denial; existing bin compatibility; whole-balance location propagation with unchanged stock; immutable reconciliation history; stale revisions; forced audit failure rollback; 5,000-position pagination. This does not substitute for full production-schema rehearsal or desktop/mobile browser validation.

Still outstanding in Release 1: quantity-specific bin/lot positions, quality/custody/reservation enforcement across all stock writers, item/supplier inspection rules, quality-aware availability/projected supply, full bin access scopes, and item-master governance separation. No organization has been enabled for those unfinished capabilities.

Do not mark these releases implemented or enable them merely because their endpoints or plans exist. See the completion plan for acceptance criteria.

## 2026-09-16: Item-wide safety-hold increment

Added apply/release/history controls to Stock positions. These are explicitly item-wide across all warehouses, not per-bin or per-lot classifications. Both mutations require inventory approval permission and an unrestricted warehouse scope. Release must be performed by someone other than the hold creator. Each hold and release is append-only, with transactional hash-chained audit and outbox evidence. Outbox insertion is not a claim that an email was delivered.

The additive `20260916090000_item_safety_holds.sql` migration adds database guards on item/warehouse decreases and deletes, outgoing movement inserts, and new reservations. Receipts may increase stock but do not clear holds. Multiple holds must each be released. The guard flag is recomputed from evidence rather than trusting a submitted boolean. Creation checks item/warehouse balance agreement, refusing unresolved aggregates. Mutations temporarily serialize against legacy stock writers using table locks with a three-second timeout; this is a conservative bridge, not the final high-volume position ledger.

Main v2 inventory availability, operational inventory list/detail and Control Tower's available-stock category calculation now treat held items as unavailable without changing on-hand quantity or double-subtracting reservations. Location evidence continues to be independent of safety status. Existing `qualityHolds: false` still denotes the unfinished normalized position-level quality capability.

Verification: TypeScript and focused production-code ESLint; disposable database count/location/hold suite including 5,000-position pagination, denied tenants/permissions, independent release, receipts remaining held, blocked direct decrements/deletes/movements/reservations, multiple holds, idempotency/concurrent retries, immutable evidence, mismatched balance denial and forced audit rollback. The runtime test script is outside the repository ESLint configuration. Production build checked separately. No desktop/mobile browser verification or full production-schema migration rehearsal has been performed for this increment.

```powershell
npm.cmd run test:cycle-count-runtime -- --local-disposable --positions --holds
# After backup and migration rehearsal, in addition to earlier migrations:
node scripts/apply-sql-migration.mjs 20260916090000_item_safety_holds.sql
```

Application data was not migrated or altered by the tests. Release 1 remains partial: all legacy multi-write business workflows still need atomicity review and consistent hold-specific error presentation; automatic inspection rules, split-bin/lot positions, custody, FEFO/expiry, projected supply, location access scopes and item-master governance remain outstanding. Do not treat this bridge as approval to enable the complete WMS release.

## 2026-09-17: Atomic stock commands and canonical PO receiving

Replaced the HTTP receipt/issue/transfer implementations with a shared transactional stock-command service. It validates tenant/warehouse scope and eligible unreserved quantity, locks stock, updates item/warehouse quantities, writes one movement plus audit/outbox evidence, and records an idempotency response. The UI retains a retry key after errors. Scanner mutations now serialize retry keys, recheck stock under a row lock, validate warehouse scope, reject consuming reservations and update the item aggregate. Item-master creation rejects nonzero opening stock; the item edit form omits quantity from its update payload.

The receiving audit exposed duplicate warehouse increments and an AP bridge that could fail after stock had already changed. The replacement Goods Receipt service commits PO-line progress, stock, AP receipt/lines, lot/serial evidence, put-away tasks, audit and outbox together. It preserves distinct equal-sized partial receipts, rejects duplicate serials without rewriting them, uses the authenticated actor and does not mark unrelated shipments delivered. AP matching reads the same posted receipt evidence; automatic re-evaluation/notification delivery is not proven merely by the outbox record and remains part of cross-workspace acceptance work.

Receipt, issue, transfer and operational PO-receive HTTP commands now require an `Idempotency-Key`; shipped form clients send it. Integrations must retain a key for retries and use a new key for a new business operation. The whole-unit restriction remains explicit until the fixed-precision stock migration is complete.

Direct `POST /api/stock-movements` now returns structured `409 STOCK_COMMAND_REQUIRED`; clients cannot write ledger evidence separately from a governed stock command. Existing list routes remain available. Integration callers of the old insertion API must move to the appropriate command.

Verified on disposable data: cycle counts, normalized location history, 5,000-position pagination, holds, atomic stock commands, and goods receiving. Receiving tests prove one quantity increase/movement, AP totals, put-away creation, lot/serial scope, independent partial receipts, unchanged shipment status, cross-tenant denial, over-receipt concurrency, replay and audit-failure rollback. TypeScript, focused lint and production build passed before the final presentational tweaks.

Playwright tested the production Stock positions component with real HTTP handlers and a disposable minimal database (not a full signed-in application deployment). Verified search, required reason, hold creation and propagation to both warehouse rows with unchanged quantities, and zero browser errors. The mobile check identified cramped columns/form labels; the table now has a readable minimum width, an accessible scroll region and a small-screen scroll hint, and the hold labels stack vertically. The test harness uses an explicit finish endpoint to close Vite and remove its owned database normally. Earlier interrupted test runs may have left disposable test databases; no broad cleanup was performed.

Release 1 remains **partial**, not enabled in the application database. Outstanding acceptance work includes normalized bin/lot quality/custody, automatic inspection rules, projected supply/demand, full warehouse/bin scopes and item-request/master-maintainer separation, remaining legacy stock paths, full-schema rehearsal, and full desktop/mobile application flows. This record does not declare those capabilities implemented.

Final browser retest (390×844) confirmed the horizontal-scroll hint/region and filtered positions. The desktop hold test changed both warehouse rows to held while quantities stayed 14 and 3. Browser console: zero errors, zero warnings. Snapshot artifacts are under `output/playwright/`. The final fixture was closed through its finish endpoint and its uniquely owned database was dropped successfully. TypeScript and focused lint passed after the presentation adjustments; the preceding production build passed with the existing Vite plugin-timing advisory.

## Receipt-to-AP matching continuation

Fixed matching that pooled receipt quantities by item across different PO lines. Match evaluation now resolves accepted receipt quantities by the exact PO line. Legacy item-only links are used only when unambiguous; unknown/contradictory links cannot satisfy a line. PO received-quantity fallback remains only when there are no receipt lines. Zero accepted quantity remains zero even when received quantity is positive. This does not implement automatic post-receipt rematching or cross-invoice quantity allocation.

Verification: `npm run test:receipt-match-evidence`, TypeScript and focused AP ESLint passed. The complete disposable cycle-count/location/hold/stock-command/goods-receipt suite passed again, including 5,000 positions, concurrency and rollback. Its database was removed and application data remained unchanged. No new full-app browser or full-schema AP test is claimed for this matching increment.

## Opt-in PO receipt inspection increment

Added item/supplier inspection rules with tenant ownership, inventory-approval and all-warehouse authority, revision checks, required change reasons and transactional audit. Editors are available in Stock positions → Safety holds and Supplier detail. They fail closed on loading/errors. The shared rule lock serializes policy changes against canonical PO receipts, including creation of previously absent rules.

Either required rule creates immutable receipt-line inspection evidence and an item-wide INSPECTION hold in the same receipt transaction. Replay does not duplicate holds. Disabling the rule affects future receipts only. Clearance uses the existing independent-approver hold release. AP match evaluation excludes unresolved inspection lines and cannot substitute PO aggregate quantities for them. It does not automatically re-run a stored match result after release.

This is explicitly conservative, opt-in **PO receipt** inspection, not completed position-level quality. It holds existing stock in all warehouses as well as the receipt. Generic receipts, scanner-IN, legacy receiving and other entry paths still require convergence before the full rule capability can be enabled. Quantity-specific acceptance/rejection, bin/lot quality, custody, scoped release, projected supply and item-request governance remain outstanding. Existing accepted/rejected receipt evidence is not rewritten by this overlay.

Deployment prerequisite: rehearse and apply `20260917190000_receipt_inspection_rules.sql` after AP receipts and the safety-hold migration. The new Goods Receipt and AP match code requires those tables and does not silently bypass an absent migration. No application migration or policy enablement was performed in this development run.

Tests passed: repeatable additive migration, item/supplier OR rules, held availability, replay, immutable evidence, disabling without releasing, outbound denial, full receipt/hold audit rollback, rule API tenant/permission denial, stale revisions, rule audit rollback, independent release and preservation of other open inspections. All prior disposable warehouse suites, matching helper tests, TypeScript and focused lint passed. Disposable database cleanup completed successfully. Full-schema integration and browser verification of the new editor remain outstanding.

## 2026-09-20 continuation: entry guards and item requests

Legacy AP receipt creation now delegates to canonical Goods Receipt, requires an explicit warehouse and retry key, and no longer rounds stock quantities or maintains its own inventory posting loop. Explicit PO-line IDs support repeated SKUs without pooling their evidence. Unsupported partial rejection payloads return a conflict rather than silently changing receipt semantics. This wrapper still needs full-schema HTTP rehearsal; the canonical service and repeated-SKU behavior passed disposable runtime tests.

`20260917200000_inspection_entry_guards.sql` adds a shared policy check for generic receipts, scanner-IN and positive ad-hoc adjustments. Where item inspection is required, or supplier inspection cannot be decided without supplier provenance, these commands require canonical PO receiving instead of bypassing inspection. This is intentionally conservative: a required supplier policy blocks unlinked incoming stock until provenance can be supplied. Dedicated counts are not reclassified as incoming receipts. Scanner retries now validate the current operator's warehouse authority and original posting actor.

Inventory now separates **Request New Item** (stock-operation permission) from **Open Item Master** (inventory-create permission). Request input accepts only SKU/name/reason and a retry key. Requests enter the existing MDM queue for independent approval; duplicate pending SKUs and changed-key payloads are refused. Reviewers use existing MDM approval controls. The maintainer creates the requested SKU/name through the existing item-master workflow with zero opening quantity, then applies the approved request to link that item. No new approval queue, parallel item register, warehouse balance or stock movement is created. A missing item does not destroy approved request state. Users receive a paginated list of their own requests only. Full Master Data field completion remains the maintainer's task, not inferred defaults from the operator request.

Verified: strict/forged input, permission and tenant/requester denial, retry replay, independent approval, missing-master response, maintained-item linkage, concurrent completion, hash-audit rollback and zero stock creation. Prior warehouse and matching suites passed, including 5,000 positions. TypeScript, focused lint and production build passed. Playwright verified the production request dialog against real handlers in a disposable component fixture: required fields, successful submission, pending-approval status, existing applied request linkage, 390×844 scrollable layout, zero console errors/warnings. It is not a full signed-in app release test. The browser fixture closed through its finish endpoint and its database was removed successfully; application data was unchanged.

Still not complete: quantity-specific bin/lot quality and custody positions, reservation/availability enforcement across every legacy stock writer, projected supply/demand, full warehouse/bin scopes, automatic AP rematching, migration rehearsal against the full schema and full-app desktop/mobile release gates. The full Release 1 capability remains disabled/unverified; these increments must not be relabelled as completion.

## 2026-09-24: Bounded availability enquiry and cache propagation

Added organization-scoped availability evidence under Stock positions → Safety holds → Availability and inbound evidence. The read-only repeatable-read endpoint reports warehouse on-hand, active reservations, unassigned aggregate differences, dated and undated open approved PO supply, inspection exclusions and a limited projected balance. ASN/shipment mirrors are not additional supply. Holds override availability without subtracting reservations twice; unreconciled aggregates suppress the projection. Organization-wide access is required. This is not the final dated demand or bin/lot eligibility engine and must not be used to authorize stock issues.

PO evidence is paginated (25/50/100 at the API, 25 in the panel), tenant-filtered and stably ordered. The panel links to canonical PO routes and explains the calculation limitations. Blank dates now prompt for a date instead of displaying an indefinite loading state, and a refresh control is available. Connection failures are caught inside the route and return a structured error.

Fixed stale availability caches after stock/hold and PO changes through shared domain invalidation. Saving either an item or supplier inspection rule also invalidates all affected enquiry caches. In the browser fixture, changing an item inspection rule updated the open panel's excluded inbound from 5 to 5,012 without reloading, while on-hand/reservations were preserved. These are generated volume-test quantities, not application data.

Verification: complete disposable warehouse suite passed again, including 5,000 positions and 5,004 PO lines, tenant/scope/date denial, deduplicated supply, conservative inspection exclusions, held stock and aggregate mismatches. `npx tsx scripts/test-availability-invalidation.ts` passed for all dates/pages/items and preservation of unrelated editor state. TypeScript, focused lint and production build passed during this increment. Browser testing used production components and real handlers in the minimal disposable fixture, not the full signed-in application. Console: zero errors/warnings. The 390×844 screenshot verifies the containing stock/hold layout; it does not capture the whole expanded availability panel. Final blank-date/refresh presentational changes were type/lint checked, not fully browser re-audited.

Both test-owned databases from this run were removed normally. Application data, release flags and schema were not changed. Full Release 1 remains partial for the outstanding controls above. Local startup and ordered migration prerequisites are documented in `docs/LOCAL-RUN-WAREHOUSE.md`.

## 2026-10-03: Review of the 30 September advanced WMS audit

The stock-position list's older notice incorrectly said projected availability was not implemented. Its notice now distinguishes the existing limited, read-only availability enquiry from the missing bin/lot-level allocation authority. The `qualityHolds: false` and `splitPositions: false` capability flags remain accurate: item-wide safety holds and PO-receipt inspection rules do not classify or release a particular bin, lot or quantity.

The next build must establish tenant-scoped quantity conservation across item, warehouse, bin, lot, quality and custody before introducing a generic warehouse-work executor. Existing `warehouse_inventory` balances, count revisions and stock movements are the reconciliation baseline; they must not be silently duplicated into a second authoritative stock ledger. Unresolved historical locations or lot provenance must remain explicit and ineligible for directed operations until verified.

The same review found receipt reversal rounding accepted quantities before posting its compensating movement. Reversal now accepts zero or validates a nonzero quantity with the existing whole-unit guard; fractional or malformed historical evidence fails closed until the fixed-precision migration is available. It does not rewrite the receipt or synthesize a rounded reversal.

Receipt reversal and purchase-return dispatch also now check active warehouse/global reservations under the stock-row lock before decreasing a balance, matching the existing stock-command eligibility predicate. This prevents those two paths from consuming already reserved units in the ordinary serialized case. It is not yet proof that every legacy allocation and stock writer shares one lock protocol; concurrent reservation creation and the complete position-level eligibility model remain release gates.

Suggested gated order after that foundation: (1) position-level quality and reservations across every stock writer; (2) a reusable, idempotent work/task service; (3) directed and split put-away; (4) pick-face replenishment; (5) picking strategies; (6) wave planning. ASN/handling-unit receiving, dock scheduling, slotting and labor optimization depend on these controls. Existing domain-specific tasks remain authoritative until each type is migrated and cross-workspace effects are verified. None of these stages is implemented merely by this review.
