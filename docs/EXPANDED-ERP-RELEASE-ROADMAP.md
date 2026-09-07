# Expanded ERP Release Roadmap

## Release Rule

The current branch is an expanded hardening build and is **BLOCKED** for production approval. A module can advance only when evidence is tenant-scoped, repeatable, attached to an immutable SHA, and green in the required release workflow.

Every module needs five evidence classes:

1. Runtime API and database workflow proof.
2. Cross-tenant isolation and ID-substitution proof.
3. Permission, security, and structured-error proof.
4. Actor-attributed audit evidence for sensitive actions.
5. Browser proof for loading, empty, error, denied, validation, and success states.

## Module Evidence

### Inventory Operations

- Runtime API: item create/update, warehouse balances, movements, adjustments, counts, and no fake fallback data.
- Tenant isolation: items, balances, lots/serials, movements, exports, and search cannot cross organizations.
- Permission/security: create, adjust, transfer, count, and export permissions; idempotent writes and plan limits.
- Audit: item changes, adjustments, transfers, count approval/posting, and denied high-risk attempts.
- Browser: inventory list/detail, create item, movement history, count/adjustment controls, pagination, empty/error states.
- Gate decision: **Evidence incomplete** until inventory runtime, isolation, permission, audit, and E2E suites pass.

### Receiving And GRN

- Runtime API: receive PO lines, tolerance checks, partial/final receipt, GRN creation, stock movement, and invalid-state blocking.
- Tenant isolation: PO, warehouse, bin, GRN, attachments, and receipt lookups remain organization-scoped.
- Permission/security: receiver permission, idempotency, no over-receipt, cancelled/closed PO denial.
- Audit: actor, PO/line, quantity, warehouse/bin, GRN reference, old/new received quantity, and reason.
- Browser: desktop/mobile receiving with remaining quantity, warehouse/bin, controlled errors, and success evidence.
- Gate decision: **Workflow-backed** but not production-approved until dedicated isolation and browser gates are attached.

### Logistics And Exceptions

- Runtime API: shipment create/update, supplier/carrier defaults, milestones, ETA risk, event-originated exceptions, ownership, and resolution.
- Tenant isolation: shipments, carriers, events, documents, exceptions, and search/export.
- Permission/security: planner/carrier/manager boundaries, validated state transitions, idempotent events.
- Audit: shipment changes, milestone evidence, exception assignment, resolution reason, and overrides.
- Browser: list/detail, filters, milestones, exception ownership/resolution, empty/error/denied states.
- Gate decision: **Blocked** until mock/demo behavior is removed and route-specific proof exists.

### AP And Invoices

- Runtime API: invoice capture, PO/GRN/service confirmation matching, tolerances, disputes, approval, and payment-ready control.
- Tenant isolation: invoices, PO links, receipts, supplier banks, documents, batches, reports, and downloads.
- Permission/security: AP create/match/approve permissions, segregation of duties, duplicate checks, payment blocking.
- Audit: capture, line changes, match result, dispute, approval, payment block/release, actor and reason.
- Browser: invoice/AP workspace, match evidence, exceptions, disabled payment action with reason, pagination and errors.
- Gate decision: **Workflow-backed**; blocked from production pending full isolation and E2E proof.

### Payment Control

- Runtime API: eligible-invoice batching, approval, payment-ready state, unmatched/disputed denial, no direct bank execution.
- Tenant isolation: batches, invoices, approvals, export files, and payment evidence.
- Permission/security: maker-checker, 2FA, self-approval denial, scoped export token.
- Audit: batch creation, approval, release/readiness, blocked attempt, actor and reason.
- Browser: eligible selection, disabled blocked invoices, approval/denial and setup-required states.
- Gate decision: **Blocked**; direct bank payment remains explicitly excluded.

### Reports And Analytics

- Runtime API: paginated previews, one-row-per-line procurement reports, no-line quality rows, bounded exports, all supported formats.
- Tenant isolation: datasets, filters, saved reports, async jobs, download tokens, and document access.
- Permission/security: report/export permissions, short-lived scoped tokens, size limits, structured failures.
- Audit: generation, download, retry/failure, dataset, format, actor, request ID.
- Browser: preview/filter/pagination, download/retry, expiry recovery, empty/error states and no layout overflow.
- Gate decision: **Evidence incomplete**; Wave 7A adds runtime proof, browser and cross-tenant proof remain blocking.

### Notifications

- Runtime API: pagination, unread count, deduplication, occurrence count, mark read/all read, retention.
- Tenant isolation: organization and user scope on list and every update.
- Permission/security: no client-selected user scope and no cross-user mutation.
- Audit: security-sensitive notification changes and delivery failures where required.
- Browser: capped badge, recent dropdown, full workspace, backlog and empty/error states.
- Gate decision: **Evidence incomplete** pending cross-tenant and browser proof.

### Mobile Warehouse Operations

- Runtime API: assigned work, scan resolution, receive/count lines, submit/recount/approve, offline replay and idempotency.
- Tenant isolation: device, session, warehouse, item, queue, and sync-event scope.
- Permission/security: receiver/counter/approver separation, device/session controls, plan entitlement.
- Audit: scan/count/receive/replay/post events with actor, device, idempotency key, and failure reason.
- Browser: responsive handheld flows, offline/failed/pending sync, camera fallback and keyboard-wedge scan.
- Gate decision: **Blocked** until mobile E2E and offline replay evidence pass.

### Setup And Onboarding

- Runtime API: legal entity, country pack, currency, tax, users, approvals, suppliers, catalogue, and sequence checkpoints.
- Tenant isolation: setup records and progress can only affect the active membership organization.
- Permission/security: owner/admin controls, 2FA for sensitive settings, structured plan-limit errors.
- Audit: settings, membership, role, approval, sequence, and security configuration changes.
- Browser: resumable checklist, precise repair links, loading/error/denied/success states.
- Gate decision: **Evidence incomplete** pending complete checkpoint and browser proof.

### Diagnostics

- Runtime API: summary, categorized findings, safe probes, observed action failures, dedupe and remediation.
- Tenant isolation: business/user events remain tenant-scoped; only approved infrastructure events are global.
- Permission/security: admin-only access, redaction, no secrets/raw stack/database errors.
- Audit: probe execution and diagnostic repair actions where sensitive.
- Browser: URL-addressable workspaces with distinct evidence, honest not-exercised states, retry and repair guidance.
- Gate decision: **Evidence incomplete**; Wave 7A adds runtime workspace proof and source-contract UI proof, browser proof remains required.

## Promotion Sequence

Modules move from `Evidence incomplete` to `Workflow-backed`, then to an immutable release candidate only after all five evidence classes pass. Expanded production approval also requires green `verify:release`, `verify:release:e2e`, `verify:release:secure`, migration rehearsal, backup/restore rehearsal, and human sign-off.
