# MDM Secure Architecture

ISSSourcing Master Data & Control Centre is the governed source of truth for procurement, inventory, AP, finance, logistics, approvals, and reporting.

## Architecture

- Typed domain tables remain the persistence model for important domains such as suppliers, items, UOM, tax, FX, warehouses, GL mappings, and approval rules.
- `server/modules/master-data/mdm-domain-registry.ts` defines ownership, stewardship, risk, required fields, unique keys, high-risk fields, permissions, where-used checks, import/export support, and audit requirements.
- Domain adapters expose a standard record lifecycle: `organizationId`, business key/code, name, status, version, effective dates, created/updated/approved actors, source system, external reference, and archive fields.
- The control centre UI consumes health, data-quality, registry, change-request, and where-used APIs.

## Security Controls

- All MDM API reads require an authenticated session.
- All MDM writes require manager/admin role gates and remain backend-authoritative.
- Every MDM query is tenant-scoped by `organization_id`.
- High-risk changes use maker-checker controls; the submitter cannot approve their own change unless an explicit admin override is used and audited.
- Stale updates return `MDM_STALE_VERSION`.
- Unsafe disable/archive paths return `MDM_DEPENDENCY_BLOCKED` with the affected dependencies.
- Supplier bank and tax fields are treated as high risk and must not be logged in plaintext operational diagnostics.

## Runtime Contracts

- `/api/mdm/defaults/requisition-context` must always return a safe context for requisition creation and must not crash on text/integer category mismatches.
- `/api/mdm/domain-registry` exposes the governed domain registry.
- `/api/mdm/change-requests` and `/api/mdm/change-requests/:id/approve` support maker-checker review.
- `/api/mdm/:domain/:id/where-used` exposes dependency usage before disable/archive.
- `/api/mdm/data-quality/issues` and `/api/mdm/data-quality/scan` expose and refresh data-quality issues.

## Release Evidence

Stable gates added in Wave 5A:

- `npm run test:mdm-requisition-context`
- `npm run test:mdm-domain-registry`
- `npm run test:mdm-data-quality`
- `npm run test:mdm-where-used`
- `npm run test:mdm-security`
- `npm run test:mdm-ui-contracts`

