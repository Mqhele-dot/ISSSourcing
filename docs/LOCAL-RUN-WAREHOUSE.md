# Local startup and warehouse migration prerequisites

Release 1 is still partial. Starting the app does not certify the complete WMS release. Keep the full release disabled until reconciliation and release gates pass. The latest evidence and remaining gaps are in `docs/audits/warehouse-release-progress.md`.

## Normal startup — Windows PowerShell

```powershell
Set-Location -LiteralPath "C:\Users\USER-PC\OneDrive\Documents\GITHUB REPO\ISSSourcing"
Get-Service postgresql-x64-18
npm.cmd run local:up
```

If PostgreSQL says **Running**, do not start it again. If it says **Stopped**, open a separate PowerShell window as Administrator and run `Start-Service postgresql-x64-18`, then confirm `Get-Service postgresql-x64-18` says Running. The administrator window can then close. Run the app in ordinary PowerShell, not as administrator.

Keep the app terminal open. Open http://127.0.0.1:5000 (or the port printed by the runner). Ctrl+C stops the app, not the PostgreSQL service. Do not start a second runner on an occupied port.

Retain the existing `.env`; it contains database configuration. Do not paste it into chat, delete it, or replace it with example credentials. `local:up` is a development runner, not a production deployment command. Existing dependencies do not need reinstalling on every run; on a new checkout install the lockfile dependencies with `npm.cmd ci` first.

## New warehouse code requires additive migrations

The runner does **not** apply these SQL migrations. Missing tables/functions can prevent receipt, scan, hold and availability operations. Do not bypass these checks or enable inspection rules before the schema is ready.

Before applying to an existing database:

1. Stop the app and other writers.
2. Identify the actual database configured in `.env` without publishing its credentials.
3. Take a PostgreSQL backup and verify that it restores to a separate disposable database.
4. Rehearse these migrations against that restored full schema. The automated minimal-schema test is not a substitute for this rehearsal.
5. Only after successful rehearsal, apply to the intended database. The helper reads `.env`; inherited connection environment variables can override it, so verify the target first.

Apply in this order, stopping immediately if a command fails:

```powershell
node scripts/apply-sql-migration.mjs 20260915120000_cycle_count_integrity.sql
node scripts/apply-sql-migration.mjs 20260915160000_warehouse_position_foundation.sql
node scripts/apply-sql-migration.mjs 20260916090000_item_safety_holds.sql
node scripts/apply-sql-migration.mjs 20260917190000_receipt_inspection_rules.sql
node scripts/apply-sql-migration.mjs 20260917200000_inspection_entry_guards.sql
```

These are additions to the existing application schema, not a fresh-database installation sequence. Existing AP receipts, inventory, users, warehouses and Master Data tables must already exist. Each file runs in a transaction; an error rolls that file back. Do not use seed/reset commands to fix migration failures. Preserve historical stock, count and inspection evidence.

Restart with `npm.cmd run local:up` after successful migration. Check Stock positions, Safety holds, item requests, PO receiving and AP receipt evidence using authorized accounts. Inspection is currently conservative and item-wide: it can hold existing stock in all warehouses. It is not bin/lot-specific quality management.

## Non-production verification

```powershell
npm.cmd run check
npm.cmd run test:receipt-match-evidence
npm.cmd run test:cycle-count-runtime -- --local-disposable --positions --holds
npm.cmd run build
```

The runtime suite requires a local PostgreSQL login permitted to create a disposable database. It creates a uniquely named test database and removes that owned database on normal completion. It does not migrate or clean the application database. Avoid interrupting it; interrupted runs may need explicitly targeted cleanup after ownership is verified.

For startup errors, retain the first error message, redact credentials, and investigate it before retrying. A running web server alone is not evidence of a successful database migration or completed release.
