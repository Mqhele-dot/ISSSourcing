# Commercial Procurement Release Boundary

## Decision

The first commercial release is procurement-only. It is a production approval candidate only after the required release, browser, security, migration, and recovery evidence is green on the exact release commit.

Approved functional boundary:

`Master Data -> Supplier onboarding -> Requisition -> Approval -> RFQ and quotes -> Evaluation -> Award -> Purchase Order -> Contract oversight`

Receiving, inventory operations, mobile warehouse work, logistics, AP, and payment control remain in the repository for later evidence waves. They are not approved production workflows in this release.

## Enforced Controls

- Requests derive a fail-closed tenant context from an active organization membership. Client-selected organization or supplier IDs do not establish authority.
- Suppliers, SKUs, requisitions, RFQs, quotes, and purchase orders use organization-scoped identity or uniqueness controls.
- Buyer sourcing and supplier-portal sourcing use persisted tenant-scoped records, backend lifecycle validation, permissions, idempotency keys, and append-only audit events.
- Supplier portal quote actions derive the supplier from the authenticated user mapping. A supplier user cannot submit as another supplier.
- RFQ evaluation retains original quote currency and an event-locked reporting-currency FX snapshot.
- Award recommendation supports line-level supplier selection. Approval is independent and blocks self-approval.
- Award-to-PO conversion carries supplier, item, quantity, price, UOM, tax, cost centre, GL mapping, currency, and award evidence without re-keying.
- High-risk role, MDM, FX, supplier bank, award, and PO approval controls require the shared 2FA guard where enabled.
- Audit events include tenant, actor or system identity, request ID, before and after data, reason, source metadata, previous hash, and event hash. A scheduled integrity check raises a critical diagnostic on chain failure.
- Structured errors use a stable code, message, hint or details when applicable, and request ID. Database errors and stacks are not returned to users.

## Country And Currency Model

The initial country-pack registry supports ZA, GB, and US organization defaults. ZA remains seeded with ZAR, while transaction and approval values resolve from the legal entity or organization reporting currency.

FX rates retain source, effective date, import history, manual-override controls, and transaction snapshots. Historical approved records are not silently recalculated when current master data or FX changes.

## Production Gating

`PRODUCTION_RELEASE_SCOPE` defaults to `procurement` in production. `full` is an explicit later-release override and must not be used until the excluded modules pass their evidence gates.

Server gates return `FEATURE_NOT_PRODUCTION_APPROVED` for excluded operational and finance APIs. Client navigation hides excluded sections in production, and direct bookmarked routes show a controlled boundary state. Development exposes those modules with a visible preview warning.

Procurement reference reads required for supplier, item, currency, tax, UOM, legal-entity, and delivery-site selection remain available. Inventory mutations and operational warehouse APIs remain gated.

## Release Evidence

Required focused evidence:

```bash
npm run test:commercial-procurement-foundation
npm run test:local:sourcing
npm run test:e2e:sourcing
```

Required release evidence:

```bash
npm run verify:release
npm run verify:release:e2e
npm run verify:release:secure
```

The sourcing runtime test proves publication, supplier isolation, quote submission, weighted evaluation, self-approval denial, independent approval, award conversion, MDM field propagation, and audit-chain validity. The Playwright test proves the same buyer and supplier workflow through the user interface. If local Chromium cannot launch, the required browser evidence comes from `.github/workflows/playwright-release-gate.yml`.

## Explicit Exclusions

- Direct bank payment initiation is not part of this product program.
- Tax filing is not implemented; country packs provide operational tax terminology and configurable tax codes.
- Anonymous supplier quote links are excluded. Supplier RFQ access requires an authenticated mapped portal account.
- Logistics and exception handling are not production-enabled by implication from procurement sourcing.
- Existing historical approved, sent, received, invoiced, or posted documents are not rewritten by this upgrade.

## Operational Approval

Before enabling production, attach green GitHub CI, Playwright evidence, migration rehearsal, backup and restore rehearsal, audit-chain verification, and zero unresolved critical or high security findings to the release record. A successful local build alone is not production approval.
