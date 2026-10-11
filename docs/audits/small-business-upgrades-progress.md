# Small-business workflow upgrades — implementation status

Updated 2026-10-10. This is a delivery record, not a claim that the release gates are complete.

## Release sign-off evidence

- Revision baseline: `88216c882fc37571f18449ff8a6a5671c329b963` (working tree contains uncommitted changes; not a verified release revision).
- 2026-10-07: `npm.cmd run test:e2e:small-business:disposable` passed 7/7 scenarios, including copied requisition and PO repeat drafts saved and submitted, source preservation, approval/Action Inbox propagation, stale-item rejection, and a 390px mobile flow. PO repeat intentionally creates a requisition draft rather than bypassing requisition approval.
- 2026-10-07: `npm.cmd run test:e2e:disposable` passed 89/90. The remaining PO action scenario lacked an applicable approval policy. Database `iss_e2e_test_2673d36244a443568b805b9f5b16faf3` was removed by the runner. This result is not a full pass.
- 2026-10-10: added the missing disposable PO policy, corrected the approval-request counter, and corrected the obsolete expectation that approval alone permits sending without a recipient. Actual provider delivery remains separate mock-transport evidence, not a claim of live delivery.
- Failure traces now use `retain-on-failure`, with failure screenshots. `PLAYWRIGHT_MOBILE_GATE=1` selects a 390x844 Chromium mobile project for the full suite; adding this option is not evidence that it has passed.
- The strict manifest check still requires the eventual committed revision in a clean checkout. No edits were discarded or automatically committed. Earlier code-check passes do not sign off the current dirty revision.
- 2026-10-10: TypeScript (`npm.cmd run check`), lint (`npm.cmd run lint`), runner syntax, and `node scripts/test-e2e-database-guard.mjs` passed. The first focused rerun hit the 120-second server startup limit before browser execution; database `iss_e2e_test_8db111d253b54e9db52b2b38bf957411` was removed. Startup/prerequisite failures now unwind through the owned-server cleanup block instead of bypassing it with `process.exit`.
- The next attempt passed all five pre-browser API gates but could not launch Chromium from the sandbox cache. Database `iss_e2e_test_a4016a4cb199489a9aa07b71b7f86f6f` was removed. A browser-launch preflight now runs before database creation; local verification uses the existing `C:\Users\USER-PC\AppData\Local\ms-playwright` installation via `PLAYWRIGHT_BROWSERS_PATH`, not a download or a change to production configuration.
- Focused PO browser retry passed 1/1 (46.3 seconds), after all five API prerequisite gates passed. Database `iss_e2e_test_c8f86520d2cd481b8074f9241057c05d` was removed. The scenario covers approval, missing-recipient dispatch denial, commercial save, locked PO controls, activity, and diagnostics navigation. It does not claim successful outbound email delivery.
- 2026-10-10: `npm.cmd run build` passed (Windows OneDrive transpiled-server fallback). This is build evidence only, not browser or clean-checkout release evidence.

## Working and verified

- First-run setup guide reads server-derived company, default warehouse, active tax, supplier, and successful CSV-import evidence. Browser check showed four of five complete in the current tenant. Non-admin users can see progress without opening administrator-only steps.
- Requisition and PO repeat actions prefill a new requisition draft. The PO path deliberately re-enters requisition approval. Browser check of a historical PO showed copied supplier/item/quantity/price and blocked Create for missing current Master Data.
- Notifications support read/archive, current-access filtering, active/history Action Inbox, due reminders, opt-in daily email digest, and deduplicated worker delivery. Disposable runtime test covers alert clearing versus task completion, status propagation, tenant isolation, and reminder deduplication.
- Deterministic reorder and slow-moving views use bounded server queries. Creating a reorder request recalculates stock/demand/supply server-side, rejects duplicate pending requests, and appends audit evidence. Disposable runtime test passed; no request was created in the live tenant.
- Supplier detail shows a bounded RFQ/PO/document/contact timeline. New PO dispatch attempts record queued/sent/failed separately; an unconfigured SMTP provider cannot be represented as a successful dispatch. Browser read test passed; no live email was sent.
- Assigned put-away tasks appear in the Action Inbox even without a notification. Completion removes them from active work, and a direct task-number link opens the filtered warehouse queue. Due reminders are deduplicated. Disposable notification runtime passed.
- Supplier contact notes can link an existing, active document from the same supplier and tenant. The timeline displays the relation. A disposable runtime test proves tenant denial, audit logging, and RFQ email-attempt display.
- Published RFQs have an explicit per-supplier Send invitation action. SMTP and a public app URL are prerequisites; attempts are stored as queued, sent, or failed with idempotency and an audit-chain queue event. Publishing or previewing alone never claims delivery. No live supplier email was sent during verification.
- Browser read checks on 2026-10-06 verified the Action Inbox, the supplier timeline and document selector, and an expired RFQ preview with disabled send controls. The console showed no warnings or errors on those pages. TypeScript, lint, production build, migration validation, encoding, onboarding, guided-learning, notification, reorder, and supplier-communication checks passed.
- The Action Inbox also rendered at a 390px mobile viewport without horizontal document overflow; the temporary viewport override was reset afterward.
- The release-gate runner now refuses non-disposable or mismatched `DATABASE_URL`/`TEST_DATABASE_URL` values before starting a server or running mutation tests. A running server must return the matching test-database identity, including when Playwright setup is skipped. CI database names now satisfy the same safety rule. A local disposable-browser command creates a unique database and removes only that exact database after the run.
- On 2026-10-06, the isolated small-business browser suite passed all five scenarios: Action Inbox and reorder API/UI parity, supplier timeline and saved contact-note propagation, company-profile save to setup checklist, PO repeat into a new requisition draft, and 390px mobile layout. The test-owned database was removed after the pass. The pre-browser PO, dashboard, logistics, control-tower, and exception checks also passed on the same disposable run.
- A provider-mocked RFQ delivery runtime test now covers unconfigured SMTP, permission denial, tenant isolation, expired and missing-address invitations, accepted and rejected provider responses, idempotent replay, duplicate send prevention, retry, supplier timeline states, and audit-chain queue events. No external supplier email was sent.
- The first-run checklist refetches on route changes and invalidates immediately after company-profile save. The shared browser login helper now suppresses the current v2 first-run guide when a test is not exercising onboarding.

## Remaining release work

- Expand the Action Inbox to other work types once they acquire explicit assignee records; manager-specific escalation still needs a governed manager relationship (current fallback is an authorized role queue).
- Make reorder availability quality-aware once canonical quality positions are enabled; current view is explicitly a planning estimate over warehouse totals.
- Copied-draft save/submit now has focused browser evidence. A completely passing broader desktop gate, the full 390px mobile gate, and clean-checkout manifest verification on the same committed revision remain required. Live SMTP delivery is outside this milestone.

## Test-data safety finding

`test:purchase-order-endpoints` previously ran `seed:functional-qa` before its disposable-database guard. One invocation on 2026-10-05 completed the idempotent FQA seed against the current local database; the mutation test then stopped. The harness now checks both the test database and running app before any seed. Existing FQA records were not automatically removed or rolled back. Review fixture audit and take a backup before any explicit cleanup.
