# Master data cross-module integration — Phase 0 evidence (PR paste)

## Locked product decisions (this implementation)

- **Tax:** PO header optional `taxCodeId` (nullable FK); PO lines optional `taxCodeId` for snapshots. Invoice/AP continues to use existing invoice line tax fields where present.
- **GRN / AP receipt idempotency:** One `ap_receipt` per successful operational receive transaction, keyed by deterministic `externalRef` derived from `organizationId`, operational `purchase_orders.id`, and a hash of sorted `(sku,qty)` lines in that receive call — duplicate submits with identical lines no-op; different qty/sku creates a new receipt (cumulative matching uses sum of receipt lines in `evaluateInvoiceMatch`).

## Baseline disconnects (pre-fix)

- `qk.*` roots existed but hooks used raw `/api/...` keys only; `invalidateInventoryDomain` was missing.
- Master Data UI lacked warehouses/carriers tabs; contracts lacked commercial FKs aligned to master tables.
- PO items lacked UoM/commodity/tax snapshot columns; PO header lacked tax FK.
- Shipments table was text carrier + po_number; no optional carrier FK, transport fields, or receive-selected shipment.
- Operational PO receive did not create `ap_receipts`; three-way match often PO-only.
- Reports/analytics used preview caps without consistent server pagination.

See implementation PR for schema deltas, API routes, and test additions.
