# Navigation Map

## Canonical structure
- `/` -> home
- `/operations` -> desktop operations overview (hub)
- `/operations/mobile-workflows` -> desktop launcher that links into `/m/*` (explains mode switch)
- `/operations/*` -> operational execution and control tower
- `/inventory/*` -> inventory, warehouses, counts, reorder, scanning
- `/procurement/*` -> purchase orders, requisitions, suppliers, contracts
- `/finance/*` -> AP, invoices, approval policies, billing
- `/analytics/*` -> BI workspace, reports, saved reports, export center
- `/admin/*` -> settings, master data, integrations, audit/admin utilities
- `/m/*` -> compact mobile shell during migration

## Primary navigation
- `Operations`: `Overview`, `Control tower`, `Logistics`, `Exceptions` (mobile shell is **not** a primary tab; use **Mobile workflows launcher** in the command palette or from Operations overview)
- `Inventory`: `Inventory`, `Warehouses`, `Warehouse ops`, `Cycle counts`, `Reorder requests`, `Barcode scanner`
- `Procurement`: `Purchase orders`, `Requisitions`, `Suppliers`, `Contracts`, `Supplier portal`
- `Finance`: `Accounts payable`, `Invoices`, `Approval policies`, `Billing`
- `Analytics`: `Overview`, `Reports`, `Saved reports`, `Export center`
- `Admin`: `Settings`, `Master data`, `Document extractor`, `Integrations`, `Audit logs`

## Legacy route migration
- `/dashboard` -> `/analytics/overview`
- `/analytics` -> `/analytics/overview`
- `/supply-analytics` -> `/analytics/procurement`
- `/reports` -> `/analytics/reports`
- `/control-tower` -> `/operations/control-tower`
- `/purchase` and `/orders` -> `/procurement/orders`
- `/requisitions` and `/purchase/requisitions` -> `/procurement/requisitions`
- `/accounts-payable` -> `/finance/accounts-payable`
- `/invoices` -> `/finance/invoices`
- `/approval-policies` -> `/finance/approval-policies`
- `/mobile/*` -> `/m/*`

## Shell rules
- `/m/*` uses the mobile shell (intentional mode switch; entry via `/operations/mobile-workflows` or direct URL).
- `/operations/mobile-workflows` stays on the **desktop** shell; it only links to `/m/*`.
- Canonical business routes use the desktop shell unless route metadata explicitly says otherwise.
- Desktop-only pages currently include `Master data` and `Document extractor`.
