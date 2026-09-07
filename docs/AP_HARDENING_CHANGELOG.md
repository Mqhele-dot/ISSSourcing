# AP Hardening Changelog

## What changed

- Enforced org-scoped approval policy checks for invoice and payment batch approvals.
- Added segregation-of-duties controls for invoice self-approval, batch self-approve/release, and releaser-vs-approver separation.
- Removed silent actor fallback (`user 1`) from AP mutating flows and payment/invoice persistence paths.
- Added org scoping for `approval_history` writes/reads and migration/DDL support for `organization_id`.
- Added immutable AP audit events (capture create/promote, match, invoice submit/approve/reject, batch create/approve/release) via `audit_logs` with structured details.
- Introduced legal transition guards for invoice and payment batch status changes.
- Hardened payment batch release with transaction boundaries, row lock, idempotent repeat handling, and release-time payable validation.
- Added duplicate invoice ID dedupe and active-unreleased-batch inclusion blocking in batch creation.
- Hardened AP receipt validation for PO org/supplier/line consistency and remaining receivable quantity.
- Improved invoice matching internals (batched receipt-line reads, structured mismatch codes, stable match type labels).
- Added duplicate-capture risk checks and promotion override requirement when risk threshold is exceeded.
- Added AP controls integration test script.

## Endpoint behavior changes

- `POST /api/ap/invoices/:id/approve` now rejects when:
  - invoice is not in `PENDING_APPROVAL`
  - no valid policy approver exists
  - creator attempts self-approval without explicit admin override + reason
- `POST /api/ap/payment-batches/:id/approve` now rejects when:
  - batch is not in an approvable state
  - no valid policy approver exists
  - creator attempts self-approval without explicit admin override + reason
- `POST /api/ap/payment-batches/:id/release` now:
  - requires legal transition from `APPROVED`
  - enforces SoD checks and release-time invoice/payable validations
  - is idempotent for repeated requests against already-released batches
- `POST /api/ap/captures/:id/promote` now blocks high duplicate-risk promotions unless an override reason is provided.
- Approval history API (`GET /api/approval-history/:entityType/:entityId`) now returns org-scoped rows only.
