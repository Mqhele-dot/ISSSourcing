# Commercial Procurement Release Checklist

Candidate source: `b8164e178126dc8c8943b165e1f95a06d47bb9a5`

Hosted evidence: [Playwright Release Gate run 29383670960](https://github.com/Mqhele-dot/ISSSourcing/actions/runs/29383670960)

## Tenant And Identity Controls

- [x] Tenant context fails closed when organization membership is missing.
- [x] Inactive or unauthorized organization membership is rejected.
- [x] Cross-tenant repository and API ID substitution is rejected.
- [x] Supplier portal identity is derived from the authenticated mapping.
- [x] A supplier portal user cannot read or submit for another supplier.

Evidence: `test:commercial-procurement-foundation`, `test:sourcing-workflow`, and hosted sourcing Playwright proof.

## Sourcing Lifecycle

- [x] RFQ publication requires an idempotency key.
- [x] Only invited mapped suppliers can access the RFQ.
- [x] Supplier quote submission is structured and deadline controlled.
- [x] Quote versions retain submitted currency and original values.
- [x] Evaluation criteria and weighted scoring are persisted.
- [x] Award recommendation records line-level selection and justification.
- [x] Award approval is independent from the recommender/event owner.
- [x] Approved award converts to a PO without re-keying mapped item/commercial evidence.
- [x] PO dispatch uses controlled delivery status and does not falsely mark failed delivery as sent.

Evidence: `test:sourcing-workflow`, `test:e2e:sourcing`, procurement endpoint tests, and Playwright run 29383670960.

## High-Risk Controls

- [x] Shared 2FA guards cover award approval, PO approval/dispatch, role changes, supplier banking, MDM approvals, and security settings.
- [x] Idempotency covers RFQ publication, quote submission, award recommendation, award approval, and award conversion.
- [x] Segregation of duties prevents self-approval.
- [x] High-risk actions create actor, tenant, request, reason, before/after, and hash-chain evidence.
- [x] Audit-chain integrity verification succeeds.
- [x] Simulated chain tampering creates a critical security diagnostic.

Evidence: `test:commercial-procurement-foundation`, `test:sourcing-workflow`, and `test:audit-chain-integrity`.

## Production Boundary

- [x] `/api/release-scope` reports `procurement` in production mode.
- [x] Procurement and sourcing APIs remain available.
- [x] Inventory mutations are production blocked.
- [x] Receiving APIs are production blocked.
- [x] Logistics and exception APIs are production blocked.
- [x] AP, invoice, billing, and payment APIs are production blocked.
- [x] Mobile operational APIs are production blocked.
- [x] Excluded routes return `FEATURE_NOT_PRODUCTION_APPROVED` with controlled guidance.
- [x] Excluded modules remain hidden or controlled in production navigation.

Evidence: `test:commercial-production-boundary-runtime`, `test:commercial-procurement-foundation`, and the 33 exclusions in the generated production audit.

## Migration, Recovery, And Security

- [x] Commercial procurement tables and columns pass schema preflight.
- [x] Tenant-scoped unique indexes and append-only audit protection exist.
- [x] Every active legacy organization has an active membership.
- [x] No unapproved destructive commercial migration statement exists.
- [x] Custom-format PostgreSQL backup succeeds.
- [x] Backup restores into a distinct disposable database.
- [x] Restored schema, critical counts, and audit chains match the source.
- [x] `npm run verify:release` passes for the candidate SHA.
- [x] `npm run verify:release:secure` passes for the candidate SHA.
- [x] GitHub CI, Codespaces, security, and Playwright checks are green for the candidate source head.

Evidence: local exact-SHA secure gate and GitHub runs 29383670960, 29383670968, 29383670958, and 29383670961.

## Browser And Approval Evidence

- [x] GitHub **Playwright Release Gate** completed successfully.
- [x] The PR merge run explicitly incorporates the recorded candidate source SHA.
- [x] `test:e2e:sourcing` passed inside `verify:release:e2e`.
- [x] Workflow URL is attached to the release evidence document.
- [ ] Release owner signed off.
- [ ] Database/operations owner signed off.
- [ ] Security/technical approver signed off.

## Decision

- [x] Technical decision is `CANDIDATE` because mandatory automated evidence is green.
- [ ] Human decision is `APPROVED`.
- [x] Decision does not approve excluded modules or claim full ERP production readiness.

The unchecked human controls are the only remaining approval steps. Until they are signed, deployers must treat the branch as a candidate rather than an approved production release.
