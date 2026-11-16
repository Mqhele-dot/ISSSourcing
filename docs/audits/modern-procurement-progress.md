# Modern procurement roadmap — delivery record

Baseline: `609196f`. Updated 11 October 2026. No release is signed off by this document.

## Build 2 — evidence coverage, obligation calendar and owner discovery, 14 November 2026

Maverick Spend now filters by PO date, supplier and missing evidence family, while retaining exactly one canonical original-currency contribution per order. The 5,002-order pagination and organization-local obligation-date cases passed in the 21/21 desktop and 390px gates, and the same package passed production smoke. PostgreSQL confirmed the exact disposable database names absent. Action Inbox owner discovery and exact agreement/obligation links are implemented and in guarded verification. See STATUS for all candidate identities and retained failures. No business migration or activation.

The closeout source audit found two unresolved trust boundaries. Requisition approval differs across the compatibility and v2 paths: compatibility accepts a body-supplied approver, exempts administrators from requester self-approval denial, and writes level history after changing the requisition; v2 locks the requisition and records the budget decision atomically, but does not apply the configured levels and limits from the canonical workflow service. Generic requisition create/edit also parses lifecycle and actor fields via the insertion schema. These are source findings awaiting guarded reproduction, not evidence of an incident on business data. The legacy PO creation path accepts requisition association without the canonical conversion lock. Separately, the Maverick report binds immutable budget evidence to live approval/exception fields; the three governed conversion paths carry reservation transfers without the original decision key. Do not claim historical parity until exact per-order binding and denial of borrowed proof pass. The closeout sequence and affected files/tests are listed in NEXT.

## Build 2 — linked RFQ draft withdrawal, 14 November 2026

The new sourcing command uses the original approved requisition fingerprint and approval reference, retains prior evidence and the original budget reservation, and commits withdrawal with the canonical audit and retry record. Found and closed unpublished/cancelled RFQ visibility in supplier portal reads and clarification writes. Static gates and 19/19 each on desktop/390px passed; unchanged production smoke passed in 13,733 ms. All exact test databases/uploads removed, temporary cache discarded, and artifacts retained. Earlier failed runs remain in STATUS. No business migration or activation.

## Build 2 — atomic linked RFQ creation, 13–14 November 2026

Both linked RFQ entry points now commit draft lines, invitations, requisition state, retry and audit together. Failures roll back and competing RFQ/PO commands cannot both convert the same requisition. Standalone RFQs remain supported. Same-candidate desktop and 390px passed 18/18 and production smoke passed in 44,384 ms. Exact disposable databases/uploads removed; no business migration. Governed withdrawal of unused linked drafts remains open.

## Build 2 — AP Aging and atomic award submission, 13 November 2026

The hidden AP Aging 503 reproduced as a missing relation when the disposable runner omitted AP History. The runner now verifies the existing migration, the route correlates sanitized failures, and the UI retains a request ID with retry. Guarded AP history passed frozen 5,000-invoice parity. Award submission subsequently gained an owned RFQ lock, verified quote lines, atomic audit and bound retry, with UI rollback and replay exercised through independent approval and PO creation. Final same-candidate desktop and 390px each passed 17/17, and production smoke passed. Exact disposable databases/uploads removed. Earlier failed runs and the slow response are retained in STATUS. Atomic linked RFQ creation and business activation remain pending.

## Build 2 — sourcing award atomicity, 13 November 2026

Award approval and conversion now commit their audit and retry evidence with the state change and generated orders. Linked single-PO conversion preserves the existing reservation; reserved split awards are blocked without changes. Desktop and mobile Playwright assertions each passed 13/13, including induced failures, replay, tenant/source denial, reporting evidence and one winner in a competing conversion. Production smoke passed on the same fingerprint. Mobile had a separate unexpected AP Aging 503, so the clean gate remains open; exact request identity and artifacts are in STATUS. Test databases/uploads/cache removed; no business activation or commit.

## Build 2 — supplier command guard and budget reservation, 13 November 2026

The `LOGIC-007` regression review identified a real gap behind the stale assertion: compatibility supplier commands could still accept legacy bank fields. The shared profile boundary and public routes now reject them, including aliases. Guarded HTTP/storage denial, onboarding rollback, and unchanged foreign records passed. Agreement releases now preserve the existing budget reservation in a linked PO commitment and expose that decision in new release evidence. Static contract tests passed after following the shared helper. The first browser run was interrupted before Playwright, and its exact database, uploads and lock were cleaned with evidence retained; see STATUS for the final rerun. Award approval/conversion atomicity remains the next slice.

Final unchanged candidate `ccb101a` / `92ad642ef5f9dbe08cae25079b1a50886185fc2f325ed319edfa1190fba6e658`: 12/12 desktop and 12/12 at 390px, no skips/flakes, with four deliberately failed audit writes verified per viewport. Production smoke passed (16,523 ms, 45 assets). Exact disposable databases and uploads were removed and independently verified. This does not close the sourcing atomicity gap or authorize business activation.

## Build 2 — atomic requisition conversion, 12 November 2026

Canonical conversion now commits requisition status, PO/lines, budget reservation transfer, actual sourcing decision, audit and idempotency together. The connected gate passed 11/11 desktop and 11/11 at 390px, plus same-candidate production smoke (18,569 ms, 45 assets). Deliberately failed audit writes were tested for rollback. All three disposable databases and test uploads were removed. Cross-path `LOGIC-007` failed because it asserted the retired supplier writer. See STATUS for exact identities and subsequent remediation. No business data, schema or feature flags changed.

## Build 2 — canonical PO submission evidence, 12 November 2026

PO submission now records its dated Master Data readiness and competition decisions in the existing canonical audit event. Submission, workflow history and retry record commit with the event or roll back together. Maverick Spend exposes one historical submission result per eligible PO, not a verdict on later edits. Requisition conversion still needs a shared transaction before its policy decision can be verified.

Candidate `ccb101a` / `b1943107b0dc2fced5c7607168532694e1ac73ca7006fc002776dab2ed01e45d` passed 7/7 desktop, 7/7 mobile at 390px and production smoke (17,333 ms; 45 assets). All three disposable databases and temporary test files were removed. No business mutation, new migration or commit. See STATUS and NEXT.

## Build 2 — agreement release provenance, 12 November 2026

Agreement releases now preserve the pre-commit agreement version, supplier state, final release approval policy and exact resolved line prices with the PO and canonical audit event. The agreement history and Maverick Spend expose that snapshot; old releases without it remain unverified. The immutable migration is pending separate business approval. General catalogue/preferred-supplier mandates were not inferred; existing competition threshold and general PO readiness decisions are the next dated evidence sources.

Candidate `ccb101a` / `cceddab46742bba6878228c656e4d0695ccca14f7fb3af468c16a45144e2c6ee` passed 6/6 desktop, 6/6 mobile at 390px and production smoke (16,527 ms; 45 assets). Test-only migration ordering failure was retained, then fixed by installing canonical release tables before the new FK. All four disposable databases and their temporary files were removed; reports remain available. No business mutation or commit.

## Build 2 — obligations and purchase-policy evidence, 9 November 2026

Contracts now hold immutable owned obligations with due dates and exact verified document completion; each revision and canonical audit entry commit together. Requisition approval captures the linked budget decision in its transaction. Independently approved sourcing overrides require exact award and PO conversion audit proof. A PO with both reasons has one canonical ordered-value contribution. Missing history stays unverified; blanket releases do not currently retain the applicable agreement version, and catalogue/supplier policy coverage remains open.

Unchanged candidate `ccb101a` / `1b6ff38ad5baa0a2cb943f16909a596b2a2b5b2a745493fccd06dbd2ebd5c325`: 4/4 desktop, 4/4 at 390px and production smoke (18,428 ms; 45 assets). Each browser report contains one deliberately induced audit failure with verified rollback; no unexpected server 5xx. All six test DB identities absent; exact generated caches removed; earlier failed fixtures and final reports retained. No business migration or commit. See programme STATUS and NEXT for the remainder of Build 2.

## Supplier 360 — Build 1 disposable acceptance, 8 November 2026

Closed caller-controlled supplier ownership and approval writes; supplier, carrier and audit now commit together. Existing Master Data governance independently reviews and publishes dated compliance evidence tied to verified document revisions. Onboarding rechecks the reviewed profile revision and active evidence. Explicit delivery capture saves an immutable observation that can be reproduced without recalculating live sources and requires current access when reopened.

The unchanged `ccb101a` candidate, fingerprint `7a9b7d6da3c71e2afd55a875ec380f9d7db3405fd84a684c870ed7dd45d0cd0a`, passed guarded runtime, 11/11 desktop, 11/11 at 390px and exact-candidate production smoke (19,468 ms; 45 assets). No skipped/flaky tests or observed server 5xx in the final browser reports. Prior failed attempts are retained. All 19 recorded test DB identities are absent and the test port, lock and exact generated caches were cleared. See programme STATUS for commands and exact evidence. The business migration was not applied; Build 2 and the separate release gates remain pending.

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

## Modern Procurement Programme checkpoint — 3 November 2026

Earlier entries remain dated evidence, not current release status. The requested programme-control files were missing and are now established under `docs/modern-procurement/` from user requirements and source audit.

Supplier 360 now extends the existing supplier profile with a live dated accepted-receipt observation, samples/exclusions, bounded evidence and canonical PO links. It reuses PO/AP-receipt evidence and existing shared finance/AP panels; it is not historical scoring or a new financial measure. Cache scope/invalidation and expansion persistence are tested. Legacy/v2 combined ratings share bounded SQL and supplier/purchase/inventory/Finance authorization; unbounded legacy reads return guidance. Remaining bank/document/compliance visibility and historical-scorecard work is explicitly pending.

Candidate `ccb101a` + fingerprint `e2bbcdcda6777f729645da505b6aab63e35b13744ee9df135eba5901a37e8dfc`: both 5,000-record runtime suites, 4 desktop + 4 mobile browser cases (with financial-consumer regressions), TypeScript/full lint/encoding/migration/build and production smoke passed. Keyboard navigation verifies the actual PO title. Smoke took 16,739 ms. Exact DB/uploads and validated generated cache were removed; artifacts retained. No business DB/history/provider/enablement changed and no commit created. A prior pre-browser login ECONNRESET remains an unproven stability issue, not hidden by the passing rerun. Full Supplier 360, programme, Phase 1 and clean-commit sign-off remain pending; see STATUS/NEXT for exact continuation.

## Supplier 360 general-profile privacy checkpoint — 3 November 2026

Source audit found missing explicit supplier-read guards on legacy profile reads and bank name/account/SWIFT in general profiles/new exports, despite an existing governed Supplier Banks workflow. A shared non-mutating outbound projection now withholds these fields for every role across legacy/v2 profile and mutation responses and generic supplier exports. UI/PDF explain the authorized Master Data workflow and disclaim payment authority. Internal rows, approved bank controls and historical evidence were not rewritten. Independent PDF extraction and visual QA also found/fixed the profile header overlap; the latest synthetic render is retained.

Candidate `ccb101a` + fingerprint `ff48b798367b7195cd5a1b6b0ecc85e73375c70fbdbe128b9b31320d252cf84e` (1,161 inputs): 5 desktop + 5 at 390px passed, zero unexpected/flaky/skipped and zero backend HTTP 5xx. Tests verify 5,000 unchanged supplier rows, tenant isolation, permission revocation, blocked direct bank edits, steward/ordinary navigation and real generated PDF. Pure 5,000-projection/CSV/XLSX/DOCX/PDF tests, both 5,000-record delivery/communications regressions, cache/contract regressions, TypeScript/full lint/encoding/migration/build and production smoke passed. Production smoke: 19,102 ms, 45 assets, unchanged 120,000 ms budget. This is functional evidence, not resolution of earlier startup variability.

All eight exact DB identities inspected for this slice are absent, runner DB/uploads cleanup passed, port 5094 is free, lock absent. Removed only the validated generated cache (552 entries; no active users/links/unknown children), retained test evidence. No business DB migration/data correction, enablement, external delivery or automatic commit. An earlier desktop run invalidated by a mid-run source edit stays failed, not passed. Missing independent PDF tooling initially failed explicitly and was replaced with pypdf validation without weakening assertions.

Retained old supplier artifacts have no reliable disclosure-policy provenance; document/timeline/portal-user permissions and bounded queries need further work. Historical Supplier 360 observations, dated compliance, full capability acceptance and the remaining nine dependencies remain pending. See `docs/modern-procurement/STATUS.md`, `NEXT.md` and `artifacts/release-runs/supplier-profile-privacy-checkpoint-20261103.json` for exact commands, identities and continuation. No full programme/Phase 1 sign-off is claimed.

## Retained supplier export checkpoint — 3 November 2026

The next audited gap is closed in code and isolated runtime: new standard supplier files publish immutable policy/hash/size/path evidence atomically with success and the existing audit ledger. Membership/source access is rechecked; exact saved bytes are checked through the same open file descriptor before delivery. Old unverifiable files remain in history but cannot download or renew a token. No read silently regenerates or certifies history. Export Center gives plain-language guidance and a keyboard-tested existing supplier workflow link. An additional audit found development/test static file serving bypassed those APIs; the export-only path guard now refuses plain/encoded/case/Windows aliases in all profiles, preserving other public assets. Document source authorization remains separate work.

Final candidate `ccb101a` + `bd1a73f1072b6b3cc48e459c343816f540256495122119ddf6edf130c15cceb9` (1,166 inputs): 6 desktop + 6 mobile cases passed, zero unexpected/flaky/skipped and zero backend HTTP 5xx. Real worker publication, original-byte preservation, tamper/refusal, invalid IDs/selections, source revocation and actual keyboard navigation passed. Production package smoke passed in 17,964 ms with 45 assets; budget remains 120,000 ms. Current TypeScript/full lint/encoding/migration/build, 5,000-job publication runtime, streaming/retention, source mappings, packaging, rate-limit and paired-file regressions passed. Earlier API-only candidate is retained as supporting evidence, not a bypass-protection sign-off. The initial stream test's Windows sandbox-TEMP rename failure is recorded; controlled workspace TEMP passed unchanged assertions, not a hidden skip or production code workaround.

Ten exact browser/runtime database identities were checked absent. Exact DB/uploads cleanup passed, port 5094 is free, lock absent; removed only two validated generated cache directories (558 and 465 entries), retaining reports/traces/logs/screenshots. No business data, historical file, provider, flag or commit changed. The new `20261103160000_supplier_export_publication.sql` is a separate approval boundary; local application requires verified backup/rehearsal and explicit approval. No local migration was applied. See `artifacts/release-runs/supplier-retained-checkpoint-20261103.json` and programme STATUS/NEXT. Document/compliance/portal-user access, historical Supplier 360 and all later dependencies/full release gates remain incomplete.

## Supplier document/source security checkpoint — 4 November 2026 local

Audit exposed authentication-only document reads, direct private-file static access, broad in-memory paging, supplier timeline/portal identity source leaks and an unscoped retention UPDATE. The existing APIs/register/audit ledger now provide current tenant/source/member permissions, conservative location denial, bounded cursor/page observations, private audited UUID uploads and exact-byte downloads. Legacy metadata paths stay unverified; reconciliation cannot certify/rewrite history. Supplier history and portal identities are source-scoped. Explicit retention archives only authorized current-tenant records and commits existing audit atomically; files are not deleted. No parallel ledger or business reconstruction.

Candidate `ccb101a` + fingerprint `94f315f2e03acfc654a700a21b4c8d53d23010f5511c173de3b7fbed04bb246e` (1,170 inputs): 8 desktop + 8 at 390px passed unchanged, zero unexpected/flaky/skipped and independently counted server HTTP 5xx. Mobile visual inspection caught action clipping missed by a page-width assertion; wrapping, visible keyboard focus and individual-control bounds now pass. The original document-hardening command uses guarded disposable uploads and retains lifecycle/search/version assertions rather than skipping absent servers or registering arbitrary paths. Its 5,000-document suite passed (13 cursor queries), as did 5,000-supplier communications/mock delivery, 5,000-order delivery, invalidation, TypeScript/full production lint/encoding/migrations/static guards and both current-source builds. Production package passed in 18,238 ms under unchanged 120,000 ms readiness budget, with 45 assets. No performance/stability fix is inferred.

Retained failures include duplicate/incorrect fixture grants and a 30-second full cold-workflow timeout. The trace measured about 19 seconds cold authentication/navigation and completed archive assertions around 33 seconds; a bounded 60-second workflow allowance was applied without changing assertions or server readiness. The entire selected desktop/mobile/package gate was rerun, not just the failed case. Earlier transport/startup/helper warnings remain open.

All 23 recorded DB identities are absent, exact DB/uploads cleanup passed, port 5094 is free, lock absent and no process referenced the generated cache roots. Only the two validated regenerable roots were removed (1,619/561 entries; no links/unknown children); artifacts retained. No business DB migration/data, provider, flag or commit changed. Source security is a verified atomic checkpoint, not full Supplier 360: paginated document choices/deep links, dated compliance/atomic onboarding, historical observations and full acceptance remain pending, followed by the other nine programme capabilities and broader release gates. See STATUS/NEXT and `supplier-document-source-checkpoint-20261104.json`; no workers or partial migration remain in flight at this context checkpoint.

## Supplier document selection/navigation — implemented, regression blocked, 4 November 2026

Audit found availability filtering after a 100-row cap and generic library links that lost supplier/document context. The existing strict API now supports exact IDs with tenant/source predicates before counts; a shared client/server contract rejects invalid/ambiguous filters. Supplier choices search available active records before bounded paging, pin an explicit choice across searches, preserve the draft on failure and require retry or explicit clearing. Existing note, document and audit authorities are reused; no schema or financial service was duplicated. Source/exact links preserve context and focus through direct entry, back/forward and archived review.

Candidate `ccb101a` + `c79ffa492868e5c164a08c0181a9dbffb751b2e72c93d2329d26ae70d76cb63f` (1,172 inputs): all three document cases passed on desktop and 390px, including 125 real synthetic available files, actual POST/persisted association, failure/retry, source navigation and unchanged metadata. Serial 5,000-document (13 cursor queries), 5,000-supplier/mock communications, type/full lint/encoding/migrations/cache/private-file gates passed. Delivery's original five-second aggregate failed once; unchanged isolated 5,000-order recheck passed. That failure remains performance evidence, not a fix. Test assertions were strengthened after a wrong timeline-text assumption and viewer-load race; exact text/5-second assertions/overall/readiness budgets were not weakened.

The complete selected regression is **NOT accepted**: desktop 8/9, mobile 9/9; zero flaky/skipped and independently counted server HTTP 5xx, unchanged source. Desktop's legacy Analytics case shows a real timeout/Retry and unavailable financial requests, not merely an absent selector. One procurement request took 11,546 ms against the 12-second client budget. Retained trace/snapshot and exact files/commands in NEXT prioritize stage-level performance diagnosis, not retrying away the failure or increasing the limit. Current source build passed. Independent package smoke passed in 46,338 ms under the original 120,000 ms budget with 45 assets; no functional regression or performance sign-off is inferred.

All 18 recorded test DB names were independently checked absent; preflight-only database never created. Exact DB/uploads cleanup completed; the escaped async-runtime failure's leftover DB/upload was separately ownership-verified before removal. Removed only two validated, unused, non-linked generated roots (1,617/578 entries); artifacts retained. Port 5094 free, lock absent, no worker/migration in flight. No business data, local migration, history, provider/flag or commit changed. Compact Excel stays disabled/separate. Evidence: `artifacts/release-runs/supplier-document-navigation-checkpoint-20261104.json` and programme STATUS/TEST-MATRIX/NEXT.

Next audit confirms mutable compliance history, inconsistent registry alias risk lookup, caller override handling/source-link approval gaps and non-atomic supplier/carrier/audit writes. No half migration was started at this context checkpoint. Resolve Analytics regression and harness/stability issues, then implement dated compliance/atomic onboarding and historical observations through canonical governance. Full Supplier 360, the other nine capabilities and broader Phase 1/clean-commit release gates remain pending.

## Analytics performance, complete risk counts and dates — verified focused slice, 4 November 2026

Correlated the retained failed browser trace without printing authentication arguments/headers: browser procurement/financial requests aborted, separate API response 12,467 ms and service metadata 9,255 ms. A guarded 5,000-principal-record-per-module reproduction then isolated SQL execution: logistics and supplier-risk each hit unchanged 10-second limits, pool wait 0–1 ms; EXPLAIN found nested loops with repeated correlated PO scans and costs about 3.4 billion. The top-100 risk list was also incorrectly used as a total, and a new executable date assertion reproduced `Thu Oct 01` instead of ISO dates. Baseline and date failures remain retained.

Reused canonical set-wise shipment-candidate joins, preserving current tenant/canonical-ID/global legacy ambiguity rules. Full risk/unrated/late totals now precede attention limits; unknown ratings are not cleared. ISO dates are explicitly projected. Internal source timings use the existing logger and bounded sanitized evidence; no SQL/parameters/source records or new ordinary API technical details. No index, migration, concurrency or timeout change. Final 5,000-source observation 2,152 ms, no degraded feeds; source execution 112/77 ms, EXPLAIN ANALYZE 52.221/82.490 ms, no nested loops and max actual loops 1.

Expanded runtime verified complete counts with 25 attention rows, decimal quantities, ISO dates, foreign/canonical/ambiguous links, unknown ratings, warehouse evidence gaps, denied sources, injected failure, concurrency and unchanged business-row hashes. Redaction/source access/financial safety/integration/link parity, unguarded refusal, TypeScript/full lint/encoding/migrations/diff checks passed. Current candidate `ccb101a` + `408d814b033541f1859f67ecf004d50bb0c781ef1a9532448432f951b2300033` (1,173 inputs): complete selected desktop and 390px each 9/9, zero unexpected/flaky/skipped or independently counted server HTTP 5xx, unchanged source. Previously failing Analytics case passed without modifying its assertions; procurement requests 480/638 ms desktop and 570/534 ms mobile. Package smoke passed in 15,673 ms under the original 120,000 ms budget, 45 assets, unchanged verified build. Not a startup-variability/full-system/security/clean-commit sign-off.

All nine recorded DB identities checked absent; exact DB/uploads cleanup passed, port 5094 free and lock absent. Verified both generated cache roots unused, non-linked, contained with known children; removed only 1,564/576 regenerable entries. Reports, traces, logs and journals retained. No business data, local migration, historical reconstruction, external delivery, provider/capability enablement or commit changed. Evidence: `artifacts/release-runs/analytics-observation-checkpoint-20261104.json`; STATUS/NEXT contain exact commands, remaining failures and continuation.

The tested Analytics blocker is closed by implementation plus complete selected regression, not repeated green retries or larger budgets. Runtime async-error cleanup, separate startup/transport/delivery/helper stability, dated compliance/atomic onboarding, historical observations, KPI/worklist/location scope and full Supplier 360 acceptance remain; then the other nine programme capabilities in order. Broader Phase 1 and separate local-migration/intentional-commit gates remain pending; Compact Excel remains disabled/separate. No new partial migration or worker remains in flight at this safe context checkpoint.

## Document failure cleanup and supplier carrier projection — 4 November 2026 local

The next audited test-foundation gap is closed for controlled failures: async membership/permission errors now reach a sanitized, request-correlated HTTP boundary rather than escaping Express 4. The guarded harness publishes exact identity before setup and attempts each cleanup stage independently while preserving the original failure. A parent suite verifies controlled connection rejection, actual missing-column membership/permission queries, post-close cleanup failure and a deliberately terminated test child. Failed children stay nonzero. Hard-stop rescue requires matching filesystem and database run tokens; mismatched proof refuses and unrelated evidence survives. This is not guaranteed cleanup during a database/machine outage. The initial parent stderr-parser failure stays retained; corrected final-source five-scenario and original 5,000-document lifecycle gates passed.

Reproduced the non-carrier/no-linked-carrier TypeError in real PostgreSQL before fixing it. The existing projection is shared by create/update/approval through `carrier-profile.ts`; absent non-carrier links are a no-op, not an invented carrier. Regression passed activation/deactivation/normalization/sequential reuse and existing legacy adoption/collision behavior with 5,000 foreign-tenant rows unchanged. Actual goods/service/contractor/fuel POST/PATCH requests, prospective status, no carrier, existing creation audit and revised profile navigation passed in both browser sizes. This does not make supplier/carrier/audit writes atomic or establish dated compliance.

Candidate `ccb101a` + fingerprint `290cd4ca4a820aa7fe0a63a279f8634e87ede5f435b0883fb5ae2f0e11196097` (1,176 inputs): complete selected desktop and 390px each 10 expected, zero unexpected/flaky/skipped, zero independently counted server HTTP 5xx, unchanged candidate and exact DB/upload cleanup. New screenshots visually inspected. Serial carrier/fault/document/communications/delivery runtime, TypeScript/full lint/encoding/migration/diff checks passed. Build `build-11a9c3a6-71ea-423e-84b4-549e735a3e96.json` unchanged; exact-source-matched production smoke passed in 21,317 ms, original 120,000 ms budget, 45 assets. No startup-variability/full-system/security/clean-commit sign-off inferred.

Independent catalog check: all 24 recorded test DB names absent. Test port free, actual workspace lock absent, no cache users or links; removed only two exact contained generated roots (1,608/577 entries). Retained reports, traces, logs, ownership/sentinel evidence and original failures. No business database/migration/history/provider/enablement/real delivery or automatic commit changed; no partial schema change or worker remains. Evidence: `artifacts/release-runs/document-carrier-checkpoint-20261104.json` and programme control files.

Next priority from read-only source audit: caller-controlled supplier organization/maker/approval provenance needs an HTTP reproduction and deny-without-mutation fix. Then atomic independent onboarding, immutable dated compliance, historical Supplier 360 and remaining source/location/worklist/method/invalidation acceptance. Full Supplier 360 and the remaining nine capabilities, broader Phase 1/local-migration approvals and intentional clean-committed-revision gates stay pending. Current slices are safely checkpointed before the larger governed change; no half migration was started.
