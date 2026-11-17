# Audit refinement verification — 27 September 2026

## Scope and result

Targeted follow-up to the September 24 read-only route audit. This is not a full ERP release sign-off and does not complete Warehouse Release 1.

### Implemented and browser-verified

| Change | Live evidence |
| --- | --- |
| Control Tower recognizes current and legacy pending requisition statuses | Open requisitions now 59, rather than 0; scope is draft/submitted/pending approval. |
| Procurement overview excludes legacy converted and other terminal requisitions | Open requisitions 84: 59 pending and 25 approved. Different scope from Control Tower is intentional. |
| AP payable query applies existing UI PO/match restrictions before pagination | 0–0 of 0 payable invoices, replacing the misleading 1–3 of 3 with no visible rows. Non-PO payments were already blocked by the UI; this does not enable them. |
| AP approval KPI no longer promises payment readiness | Label is Approved invoices; helper explains balance/match requirements. Empty selection disables batch creation. |
| Compact admin pages no longer redirect automatically | At 635×800, Master Data, Approval Policies and Employee Profiles retain their URLs and offer an explicit mobile-hub link. Desktop editing restriction remains. |
| Stock positions onboarding uses inventory tour | Page says Inventory, not This SKU. |

AP Intake was also retested: 25 of 320 captures now render after starting the current server. The earlier empty inbox was not reproduced. This is not evidence of a dedicated Intake code fix.

## Checks

- TypeScript: passed.
- Focused ESLint on modified TS/TSX: passed.
- Production build: passed (repository's Windows OneDrive server transpilation fallback).
- `node scripts/test-september-audit-refinements.mjs`: passed; source contracts only, not transaction or database integration tests.
- Server `/api/ready`: HTTP 200.
- AP browser warning/error log at verification: empty.
- Screenshot: `screenshots/2026-09-27-payments.png`.
- Temporary compact viewport override reset.

## Remaining failures / limitations

1. Analytics and Procurement overview still sum document-currency values and present them as reporting currency. Requires authoritative conversion/snapshot rules across KPIs, charts and tables; do not rely on these spend figures meanwhile.
2. Analytics inventory health differs from canonical available-stock logic (reservations/holds).
3. Stock positions still returns `POSITION_MIGRATION_REQUIRED`. Release migrations were not applied in this session. Backup, disposable rehearsal and explicit approval remain required.
4. Workflow pending-approval scope needs reconciliation against requisition workflow evidence.
5. Historical fixture records and unavailable demo-document files remain unchanged.
6. Payment creation transaction eligibility/concurrency, independent approval and downstream accounting were not exercised. No batch was created, approved or released.
7. No full mobile, security, cross-tenant or mutation release gate was run.

The local server was initially stopped. It was started with `AUTO_SEED_ON_EMPTY_DB=false`; normal existing development bootstrap ran. No fixture purge or explicit release migration command was executed. Initial browser startup timeouts recovered after startup settled.
