# MDM Governance Workflow

## Change Request Flow

MDM high-risk changes follow:

`draft -> submitted -> validation_passed -> pending_approval -> approved -> applied`

Rejected path:

`draft/submitted -> rejected`

Failure path:

`approved -> failed_to_apply`

## Maker-Checker

- The maker submits the proposed patch and reason.
- The system records domain, entity, action, proposed patch, before state, risk level, target version, submitter, and timestamp.
- A different authorized checker approves or rejects the change.
- The maker cannot approve their own high-risk change.
- Explicit admin override must be audited.

## Data Quality

The data-quality engine checks duplicate suppliers, missing supplier defaults, expired compliance documents, expired/near-expiry contracts, items missing UOM/tax/GL/category mapping, invalid UOM conversions, inactive suppliers or cost centres used by open workflows, tax codes without effective controls, and warehouses without cost-centre setup.

## Where-Used

Before disabling or archiving MDM records, the app checks open requisitions, purchase orders, AP invoices, active contracts, inventory records, warehouse stock, and reporting dependencies where relevant. Unsafe changes return `MDM_DEPENDENCY_BLOCKED`.

## Import Validation

Imports use batches and row-level validation. Invalid rows are not applied silently. Valid low-risk rows may apply directly; high-risk rows create change requests.

