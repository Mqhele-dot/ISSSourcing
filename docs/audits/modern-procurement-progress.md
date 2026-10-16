# Modern procurement roadmap — delivery record

Baseline: `609196f`. Updated 11 October 2026. No release is signed off by this document.

## Source-to-evidence integration — 14 October 2026

- Added organization-scoped source queries for approved orders, remaining open quantities, supplier invoices, invoice-owned payments, and receipt/reversal value evidence. Supplier/date filters are applied before calculation. Queries use fixed-precision arithmetic after casting legacy stored amounts; lost historical precision is not claimed as recovered.
- Receipt values never fall back to editable PO prices. A missing immutable price is excluded explicitly. Linked reversals negate original receipt-price evidence and use their own event date.
- Added a generation service that freezes the exact contribution set used for its summary inside the caller's repeatable-read transaction.
- Registered financial summary and paginated evidence endpoints. Both require report access plus the corresponding purchases/finance read permission. Unknown filters and invalid dates are rejected. Failures return plain-language retry guidance rather than SQL details.
- Disposable runtime tests passed for source filters, tenant ownership, remaining commitments, payment ownership, receipt reversals, missing evidence, summary/drilldown parity, 5,000 contributions, immutable history and rollback. Database `iss_reporting_test_1b202ec27c3c4d008c536d0f565c2b85` was created and removed by that run. No existing business database was modified.
- TypeScript and whitespace checks passed. HTTP-level authorization/browser gates have not yet run for the new routes. No release verification or feature flag was promoted.

### Pending by release

| Release | Remaining work |
| --- | --- |
| 0 / 0B | Review all source-status mappings and source-level access scopes; wire approved FX revisions and receipt/reversal snapshots into production commands; migrate dashboards, explanations, exports and invalidation; complete HTTP, desktop/mobile, build/security and clean-committed-revision gates. Full capability reconciliation also remains. |
| 1 | Smart Intake UI, deterministic routing, preferences/alternatives, revalidation and linked conversion into existing drafts. |
| 2 | Service scope/milestones and accepted service evidence, AP matching, payment-risk reassessment, independent approval and access-conflict analysis. |
| 3 | Spend cube, policy evidence, savings/TCO, agreement obligations, historical Supplier 360 scorecards and optional compliance/ESG/risk adapters. |
| 4 | AP ingestion orchestration, extraction provenance, discounts and cash forecasts, structured invoice validation. |
| 5 | Canonical quality/bin/lot positions, reservations, ASN/HU, offline replay, traceability/recall, impact previews and collaborative planning. |
| 6 | Versioned operational delivery, signed webhooks/replay, partner adapters/PunchOut, OIDC/SAML/SCIM. |
| 7 | Allowlisted AI intents, permission-filtered retrieval, provenance, human confirmation and safety evaluations; provider configuration remains separate. |

Existing modules are foundations, not evidence that these roadmap additions are complete. This increment does not migrate dashboards or claim full Release 0B completion.

## Release 0: in progress

- Capability responses now separate implementation, organization enablement and release verification. Existing status remains a compatibility field. Test-file references never imply a passing release; verification remains unverified.
- Supplier communications and slow-moving reports now have source-backed catalog entries instead of stale missing labels.
- Diagnostics shows implemented entries too, with explicit unverified evidence, rather than hiding them from review.
- Supplier-page performance uses one tenant-scoped SQL aggregation for at most 100 requested supplier IDs instead of loading all suppliers, orders, stock movements and invoices.
- Missing delivery/invoice history returns null metrics and an insufficient-evidence state. Both API versions use the same rate calculation. The compatibility field `priceComplianceRate` is retained, but UI copy accurately calls it the undisputed-invoice rate, not proven contract-price compliance.
- Supplier ratings expose their sample sizes and methodology in a Why this rating disclosure.

## Remaining work (not implemented or enabled by this increment)

0. Shared fixed-precision spend/receipt/invoice/payment measures, FX exclusion evidence, reusable financial explanations, full capability reconciliation, current-revision desktop/mobile and clean-checkout release gates.
1. Guided intake, buying preferences and policy-backed conversion into existing drafts.
2. Service acceptance/AP matching, payment-risk reassessment and role-level SoD analysis.
3. Spend cube, compliance/savings/TCO, obligations, Supplier 360, configurable compliance/ESG/risk adapters.
4. AP ingestion orchestration, discounts, cash visibility and jurisdiction-aware structured invoices.
5. Quality positions, traceability/recall, offline task completion and operational planning.
6. Operational integration delivery, PunchOut, partner document adapters and enterprise identity.
7. Governed AI over validated services; provider configuration remains a separate prerequisite.

## Release 0B backend foundation — 13 October 2026

Implemented, not enabled in production dashboards:

- Shared measure definitions distinguish ordered value, net open commitments, received value, invoiced value and recorded payments (not bank settlement).
- Exact decimal arithmetic, half-away-from-zero contribution rounding, and totals summed from rounded contributions ensure evidence rows reconcile. No binary floating-point arithmetic is used in the new calculation core.
- Dated direct approved-rate selection, tenant isolation, rate-revision observation time, explicit exclusions and complete/partial/unavailable/empty/setup-required states.
- Strict reporting-currency context requires one active tenant-owned currency; no ZAR fallback or unapproved legacy FX inference.
- Additive migration for immutable FX revisions, receipt-value evidence and frozen runs/contributions. No historical values are backfilled. Migration has only been applied to a test-owned database.
- Frozen-run store has tenant-scoped stable pagination, source-identity duplication protection and an evidence hash. Callers must authorize sources and own the surrounding transaction; this module is not a public route.

Still required for Release 0B: authoritative source adapters/status mappings, approval-driven FX revision writes, transactional receipt/reversal capture, public endpoints and RBAC, dashboard/Why-panel wiring, export-run linkage, cross-page invalidation and complete browser/release gates. The existing analytics have not yet been migrated; do not claim mixed-currency dashboards are fixed by these backend modules alone.

Verification commands: `npx tsx scripts/test-dated-reporting-evidence.ts`, `npx tsx scripts/test-financial-reporting-store.ts --local-disposable`, `npm run check`, `npm run lint`, `npm run validate:migrations`. Evidence logs are in `output/modern-procurement-tests`. The store suite exercises 5,000 contributions, exact totals, pagination, foreign-tenant denial, immutable history and rollback. Each run removes only its own database.

No business records, production settings, external providers or feature flags were changed. Mutation verification uses an exact test-owned disposable database. Earlier browser evidence must not be reported as verification of these new changes.

## Verification of this increment

- `npx tsx scripts/test-modern-procurement-foundations.ts`: passed (unknown versus observed rates; implementation/enablement separation).
- `npx tsx scripts/test-warehouse-capability-audit.ts`: passed (existing aliases, partial capabilities, verification timestamps preserved).
- `npx tsx scripts/test-supplier-communications-runtime.ts --local-disposable`: passed after adding the missing supplier-read guard. Covers real SQL, foreign-tenant exclusion, null rates, observed rates, request bounds, permission denial and existing provider-mocked communication workflows. Each attempt removed its own database.
- TypeScript, lint and whitespace checks passed during this increment. Full browser and clean-revision release gates have not been rerun for these changes.
