# Compliance & permissions (Phase 5–6 checklist)

This document captures **audit hooks and follow-ups** after core contracts, pages, and exports are stable. It is a living checklist—not a full certification.

**API shapes and client normalization** are defined in [`API_CONTRACTS.md`](./API_CONTRACTS.md) — keep that doc in sync when changing list endpoints or envelopes.

## Supplier compliance (planned extensions)

- **Insurance / certification expiry**: surface `insuranceExpiry` from [`shared/schema.ts`](../shared/schema.ts) `suppliers` in dashboards or scheduled jobs (alerts when &lt; 30 days).
- **Documents**: [`EntityDocumentsCard`](../client/src/components/documents/entity-documents-card.tsx) on supplier drawer (Docs tab) — extend with retention labels and required doc types per tenant policy.
- **Contracts**: use [`supplierContracts`](../shared/schema.ts) for master agreements; link from supplier detail when a dedicated route exists.

## Permissions audit

- **Server**: [`server/auth.ts`](../server/auth.ts) — `ensureRole`, `ensureAuthenticated`; verify each mutating route in [`server/routes.ts`](../server/routes.ts) uses the correct middleware chain (especially procurement, exports, master data).
- **Client**: [`Can`](../client/src/components/auth/can.tsx) — ensure destructive actions (delete supplier, warehouse, PO cancel) are wrapped consistently.
- **Storage layer**: confirm [`server/storage.ts`](../server/storage.ts) does not bypass auth for multi-tenant scenarios if introduced later.

## Onboarding & polish (Phase 6)

- Workflow-based tutorials (requisition → PO → receive) after Phase 4 E2E is green.
- Consistent toasts and deep-links from dashboard tiles into filtered report/export URLs.

## Review cadence

Re-run contract scripts after permission changes:

- [`scripts/test-api-contract.ts`](../scripts/test-api-contract.ts)
- [`scripts/test-requisitions.ts`](../scripts/test-requisitions.ts)
- [`scripts/test-procurement-flow.ts`](../scripts/test-procurement-flow.ts)
