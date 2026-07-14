# Commercial Procurement Release Checklist

Complete this checklist against one immutable candidate source SHA. Link every checked control to command output, a GitHub run, or an audit record.

## Tenant And Identity Controls

- [ ] Tenant context fails closed when organization membership is missing.
- [ ] Inactive or unauthorized organization membership is rejected.
- [ ] Cross-tenant repository and API ID substitution is rejected.
- [ ] Supplier portal identity is derived from the authenticated mapping.
- [ ] A supplier portal user cannot read or submit for another supplier.

Evidence: `npm run test:commercial-procurement-foundation`, `npm run test:sourcing-workflow`, and GitHub sourcing Playwright run.

## Sourcing Lifecycle

- [ ] RFQ draft can be published with an idempotency key.
- [ ] Only invited mapped suppliers can access the RFQ.
- [ ] Supplier quote submission is structured and deadline controlled.
- [ ] Quote versions retain original currency and submitted values.
- [ ] Evaluation criteria and weighted scoring are persisted.
- [ ] Award recommendation records line-level supplier selection and justification.
- [ ] Award approver is independent from the recommender/event owner.
- [ ] Approved award converts to a PO without re-keying MDM and finance fields.
- [ ] PO dispatch uses controlled delivery status and does not falsely mark failed delivery as sent.

Evidence: `npm run test:sourcing-workflow`, `npm run test:e2e:sourcing`, and procurement endpoint tests.

## High-Risk Controls

- [ ] Shared 2FA guard protects award approval, PO approval/dispatch, role changes, supplier banking, MDM approvals, and security settings.
- [ ] Idempotency is enforced for RFQ publication, quote submission, award recommendation, award approval, and award conversion.
- [ ] Segregation of duties prevents self-approval.
- [ ] High-risk actions create actor, tenant, request, reason, before/after, and hash-chain evidence.
- [ ] Audit-chain integrity verification succeeds.
- [ ] Simulated chain tampering creates a critical security diagnostic.

Evidence: `npm run test:commercial-procurement-foundation`, `npm run test:sourcing-workflow`, and `npm run test:audit-chain-integrity`.

## Production Boundary

- [ ] `/api/release-scope` reports `procurement` in production mode.
- [ ] Procurement and sourcing APIs remain available.
- [ ] Inventory mutations are production blocked.
- [ ] Receiving APIs are production blocked.
- [ ] Logistics and exception APIs are production blocked.
- [ ] AP, invoice, billing, and payment APIs are production blocked.
- [ ] Mobile operational APIs are production blocked.
- [ ] Excluded production routes return `FEATURE_NOT_PRODUCTION_APPROVED` with guidance.
- [ ] Excluded modules remain hidden or controlled in production navigation.

Evidence: `npm run test:commercial-production-boundary-runtime` and `npm run test:commercial-procurement-foundation`.

## Migration, Recovery, And Security

- [ ] Commercial procurement tables and columns pass schema preflight.
- [ ] Tenant-scoped unique indexes and append-only audit trigger exist.
- [ ] Every active legacy organization has an active membership.
- [ ] No unapproved destructive commercial migration statement exists.
- [ ] Custom-format PostgreSQL backup succeeds.
- [ ] Backup restores into a distinct disposable database.
- [ ] Restored schema, critical counts, and audit chains match the source.
- [ ] `npm run verify:release` passes for the candidate SHA.
- [ ] `npm run verify:release:secure` passes for the candidate SHA.
- [ ] GitHub required checks are green for the candidate SHA.

Evidence: migration rehearsal, backup/restore rehearsal, secure gate, and candidate commit checks.

## Browser And Approval Evidence

- [ ] GitHub **Playwright Release Gate** completed successfully.
- [ ] The workflow tested the recorded candidate source SHA.
- [ ] `test:e2e:sourcing` passed inside `verify:release:e2e`.
- [ ] Workflow URL is attached to the release evidence document.
- [ ] Release owner signed off.
- [ ] Database/operations owner signed off.
- [ ] Security/technical approver signed off.

## Decision

- [ ] Decision is `BLOCKED` when mandatory evidence is missing or failed.
- [ ] Decision is `CANDIDATE` only after all technical evidence is green.
- [ ] Decision never claims production approval for excluded modules or the full ERP suite.

