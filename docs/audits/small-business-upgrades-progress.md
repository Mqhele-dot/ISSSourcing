# Small-business workflow upgrades — implementation status

Updated 2026-10-05. This is a delivery record, not a claim that the release gates are complete.

## Working and verified

- First-run setup guide reads server-derived company, default warehouse, active tax, supplier, and successful CSV-import evidence. Browser check showed four of five complete in the current tenant. Non-admin users can see progress without opening administrator-only steps.
- Requisition and PO repeat actions prefill a new requisition draft. The PO path deliberately re-enters requisition approval. Browser check of a historical PO showed copied supplier/item/quantity/price and blocked Create for missing current Master Data.
- Notifications support read/archive, current-access filtering, active/history Action Inbox, due reminders, opt-in daily email digest, and deduplicated worker delivery. Disposable runtime test covers alert clearing versus task completion, status propagation, tenant isolation, and reminder deduplication.
- Deterministic reorder and slow-moving views use bounded server queries. Creating a reorder request recalculates stock/demand/supply server-side, rejects duplicate pending requests, and appends audit evidence. Disposable runtime test passed; no request was created in the live tenant.
- Supplier detail shows a bounded RFQ/PO/document/contact timeline. New PO dispatch attempts record queued/sent/failed separately; an unconfigured SMTP provider cannot be represented as a successful dispatch. Browser read test passed; no live email was sent.

## Remaining release work

- Expand the Action Inbox beyond notification-backed tasks so assigned work with no notification is included; bind all due dates and manager-specific escalation to authoritative assignment records.
- Make reorder availability quality-aware once canonical quality positions are enabled; current view is explicitly a planning estimate over warehouse totals.
- Add durable RFQ outbound delivery-attempt evidence and document attachment from the supplier contact form.
- Add disposable-browser suites for the full copy/save/submit and supplier-contact mutation flows, and complete broad desktop/mobile release gates.

## Test-data safety finding

`test:purchase-order-endpoints` previously ran `seed:functional-qa` before its disposable-database guard. One invocation on 2026-10-05 completed the idempotent FQA seed against the current local database; the mutation test then stopped. The harness now checks both the test database and running app before any seed. Existing FQA records were not automatically removed or rolled back. Review fixture audit and take a backup before any explicit cleanup.
