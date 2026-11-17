# MDM Secure Architecture

ISSSourcing Master Data & Control Centre is the governed source of truth for procurement, inventory, AP, finance, logistics, approvals, and reporting.

## Architecture

- Typed domain tables remain the persistence model for important domains such as suppliers, items, UOM, tax, FX, warehouses, GL mappings, and approval rules.
- `server/modules/master-data/mdm-domain-registry.ts` defines ownership, stewardship, risk, required fields, unique keys, high-risk fields, permissions, where-used checks, import/export support, and audit requirements.
- Domain adapters expose a standard record lifecycle: `organizationId`, business key/code, name, status, version, effective dates, created/updated/approved actors, source system, external reference, and archive fields.
- The control centre UI consumes health, data-quality, registry, change-request, and where-used APIs.

## Security Controls

- All MDM API reads require an authenticated session.
- All MDM writes require `requireMdmPermission(domain, action)` API gates backed by the domain registry's `requiredPermissions`; broad manager/admin role gates are not enough for `/api/mdm/*` writes.
- MDM permission denials return structured `MDM_PERMISSION_DENIED` responses with `domain`, `action`, `requiredPermissions`, and a repair hint.
- The Master Data UI uses `/api/permissions/me` permission/resource/action checks for read-only, steward/manager, approver, and admin-override states; role fallback only mirrors existing backend compatibility.
- Every MDM query is tenant-scoped by `organization_id`.
- High-risk changes use maker-checker controls; the submitter cannot approve their own change unless an explicit admin override is used and audited.
- Approved changes can be applied exactly once. Rejections, comments, failed applies, and admin overrides are recorded as change-request steps.
- Stale updates return `MDM_STALE_VERSION`.
- Unsafe disable/archive paths return `MDM_DEPENDENCY_BLOCKED` with the affected dependencies.
- Supplier bank and tax fields are treated as high risk and must not be logged in plaintext operational diagnostics.

## Runtime Contracts

- `/api/mdm/defaults/requisition-context` must always return a safe context for requisition creation and must not crash on text/integer category mismatches.
- `/api/mdm/domain-registry` exposes the governed domain registry.
- `/api/mdm/change-requests`, `/api/mdm/change-requests/:id`, `/api/mdm/change-requests/:id/approve`, `/api/mdm/change-requests/:id/reject`, `/api/mdm/change-requests/:id/apply`, and `/api/mdm/change-requests/:id/comments` support maker-checker review and lifecycle evidence; action routes resolve the target change request domain before authorization.
- `/api/mdm/:domain/:id/where-used` exposes dependency usage before disable/archive.
- `/api/mdm/data-quality/issues` and `/api/mdm/data-quality/scan` expose and refresh data-quality issues.

## Release Evidence

Stable gates added in Wave 5A:

- `npm run test:mdm-requisition-context`
- `npm run test:mdm-domain-registry`
- `npm run test:mdm-change-requests`
- `npm run test:mdm-data-quality`
- `npm run test:mdm-where-used`
- `npm run test:mdm-security`
- `npm run test:mdm-runtime-security`
- `npm run test:mdm-api-authorization`
- `npm run test:mdm-ui-contracts`
- `npm run test:ap-po-link-validation`

Remaining coverage gaps: domain-permission aliases are mapped to the current RBAC resources until the database enum and custom-role editor can store every granular MDM permission string directly.
