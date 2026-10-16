# Branch Truth And Production Readiness Audit

Generated: 2026-06-28

This document answers the branch-truth question before further feature work. It should be read together with [`docs/production-readiness-audit.md`](production-readiness-audit.md), which contains the generated route, API, schema, workflow, MDM, validation, permission, audit-trail, diagnostics, testing, and top-10 production-fix inventories.

## Executive Decision

**Recommended production base branch:** `cursor/project-codespace-compatibility-b14c`

**Release status:** buildable production-base candidate, **not production-approved**. This branch is the correct place to continue stabilisation work, but it must not be treated as production-ready until the full release gate and required GitHub CI checks pass on the release head.

**Why:** PR #4 is the only branch that currently contains the restored full ISSSourcing app snapshot, Codespaces compatibility work, the current MDM/control-centre foundation, AP/procurement/logistics/reporting/mobile/subscription modules, the production readiness audit tooling, and a clean local working tree. GitHub comparison reports it is **266 commits ahead of `main` and 0 commits behind**. `main` is still the empty/deleted-project baseline at `58cd69d`, so it is not the working app.

Do **not** merge PR #3, #7, or #8 blindly. They are useful evidence/backlog inputs, but they target older SHAs and are diverged from the production base. Any useful patch from those PRs must be reviewed, rebased/cherry-picked intentionally, tested through the release gate, and documented in the stale PR decision log.

Any feature marked **Production-ready** must prove all of the following: real data, backend validation, permissions where needed, clear error handling, and tests or explicit verification evidence. Rendering a page, showing seeded/demo data, or passing a cosmetic UI review is not enough.

## 1. Branch And PR Truth Audit

| Branch/PR | Base | Head | Status | Mergeable? | Main Purpose | Key Files Changed | Build Status | Test Status | Keep/Merge/Rebase/Close | Reason |
|---|---|---|---|---|---|---|---|---|---|---|
| `main` | N/A | `58cd69d` | Default branch, not current app | N/A | Empty/deleted baseline | `tsconfig.json` deleted in history; lacks restored app | Not run | Not run | Do not use as production base | GitHub compare shows current app branch is 266 commits ahead of `main`; `main` is not the app truth. |
| PR #4 `cursor/project-codespace-compatibility-b14c` | `main` | `2d9f1cc` | Open, current active branch | GitHub reports mergeable | Restores complete project snapshot, Codespaces compatibility, local testing, MDM/procurement/AP/logistics/reporting/security/mobile work | 815 changed files, including `client/`, `server/`, `shared/schema.ts`, `scripts/`, `.github/`, `docs/`, `package.json` | Passed locally: `npm.cmd run check`, `npm.cmd run lint`, `npm.cmd run build` | Passed generated audit commands; focused tests are available but not all rerun in this audit | **Keep as production base; merge only after CI is green or make it default branch** | This branch is the most complete working app and is the only branch matching current local/Codespaces development. |
| PR #7 `codex/fix-analytics-page-functionality-qoz27m` | `cursor/project-codespace-compatibility-b14c@fd2aeb4` | `ac87806` | Open, diverged | GitHub reports not mergeable | Analytics page, requisition/PO actions, diagnostics, PDFs, export improvements, Codespaces script updates | 22 files: `client/src/pages/analytics.tsx`, `orders.tsx`, `reports.tsx`, `warehouses.tsx`, `server/routes.ts`, `server/storage.ts`, `scripts/codespaces-up.sh`, `shared/schema.ts` | Not run on branch in this workspace | Not run on branch in this workspace | **Rebase/cherry-pick selectively; do not merge directly** | It is 4 commits ahead but 192 commits behind current base. Several concepts are already superseded by current analytics workspace, export centre, MDM, PO/AP modules, and diagnostics. |
| PR #8 `codex/commit-and-push-to-selected-branch` | `cursor/project-codespace-compatibility-b14c@2792d35` | `a92b5e6` | Open, diverged | GitHub reports not mergeable | Domain-wide query invalidation helpers for procurement/master data/supplier/invoice/logistics/reporting flows | 7 files: `client/src/lib/domain-invalidation.ts`, `client/src/lib/query-keys.ts`, PO/requisition/contracts/invoices/master-data call sites | Not run on branch in this workspace | Not run on branch in this workspace | **Close or recreate after verifying deltas** | Current branch already has `client/src/lib/domain-invalidation.ts` and `client/src/lib/query-keys.ts`; PR #8 is likely duplicated/superseded and is 93 commits behind current base. |
| PR #3 `codex/plan-desktop-app-for-supply-chain-control-tower-pad8bi` | `main` | `46f7266` | Open, separate scaffold | GitHub reports mergeable into `main`, not into current app | High-risk FastAPI/SQLite/Tauri SupplyChain Control Tower MVP scaffold | 89 files under `services/api/`, `apps/desktop/`, `packages/shared/`, backend CI, scripts, docs | Not run on branch in this workspace | Not run on branch in this workspace | **Close or recreate as a separate product spike** | It targets empty `main`, introduces a parallel stack, and conflicts architecturally with the restored Node/Express/React app in PR #4. Do not mix into production base. |
| `codex/isssourcing-continuous-app-hardening` | `main` lineage | branch head diverged | Remote branch, diverged | Not assessed as PR | Early hardening/restoration branch | Similar broad app restoration/security changes; compare shows 2 ahead and 266 behind current base | Not run | Not run | Close/rebase only if a missing patch is identified | Mostly superseded by current branch; compare shows it is far behind production base. |
| `codex/fix-incomplete-sections-and-loading-issues` | older current-base lineage | branch head diverged | Remote branch, diverged | Not assessed as PR | Dashboard/reports/warehouse loading fixes | `client/src/pages/dashboard.tsx`, `reports.tsx`, `warehouses.tsx`, `server/operations-core.ts` | Not run | Not run | Cherry-pick only after manual diff review | One commit ahead but 220 behind; likely stale and partially superseded. |
| `codex/fix-analytics-page-functionality` | unknown older branch | remote branch exists | Remote branch | Not assessed | Earlier analytics branch | Not inspected beyond branch presence | Not run | Not run | Close/rebase only if PR owner confirms unique value | Superseded by PR #7 naming and current analytics workspace. |
| `codex/plan-desktop-app-for-supply-chain-control-tower` | unknown older branch | remote branch exists | Remote branch | Not assessed | Earlier desktop control tower branch | Not inspected beyond branch presence | Not run | Not run | Close/rebase only if unique value remains | Superseded by PR #3 branch and not aligned with current app architecture. |
| `codex/develop-freelancer-hiring-app` | unrelated | remote branch exists | Remote branch | Not assessed | Unrelated product work | Not inspected | Not run | Not run | Close/archive | Not relevant to ISSSourcing production readiness. |

## 2. True Production Base

`cursor/project-codespace-compatibility-b14c` currently contains the most complete working version of ISSSourcing.

### Merge/Rebase/Close Recommendation

| Source | Recommendation | Reason |
|---|---|---|
| PR #4 | Keep as production base; merge into `main` only when CI/release gates are green | It restores the full app and is where all current verified work has landed. |
| PR #7 | Rebase or cherry-pick selected ideas only | It is old and not mergeable. Current branch already supersedes parts of analytics, PDFs, exports, diagnostics, and PO/AP flow. |
| PR #8 | Close or recreate only if a diff proves missing invalidation behavior | Current branch already has query-key/domain invalidation files and broader later work. |
| PR #3 | Close or keep as separate architectural spike | It introduces a parallel FastAPI/SQLite/Tauri scaffold and should not be merged into the Node/Express app. |
| Other Codex branches | Close/rebase selectively | They are stale relative to the current production base. |

### Duplicated Or Conflicting Changes

- PR #8 duplicates current query-key/domain invalidation infrastructure: `client/src/lib/query-keys.ts` and `client/src/lib/domain-invalidation.ts` exist on the production base.
- PR #7 overlaps current analytics/reporting/export/PO/diagnostics work, but it uses older files and an older branch point.
- PR #3 conflicts at architecture level: separate FastAPI service, SQLite persistence, Tauri scaffold, and desktop app layout instead of the current Express/Postgres/React/Electron-compatible app.
- `main` conflicts conceptually because it is not the restored app.

## 3. Build And Test Candidate Branches

Only the chosen production base was executed locally in this workspace. Other candidate branches were inspected through GitHub PR/branch metadata and compare results because switching/building each stale branch would require separate worktrees and dependency installs; those branches are already non-mergeable or superseded.

| Branch | Install | Typecheck | Lint | Build | Tests | DB/Migration | App Startup | Result | Blocking Errors |
|---|---|---|---|---|---|---|---|---|---|
| `cursor/project-codespace-compatibility-b14c` | Existing `node_modules` present from prior `npm ci`; local doctor previously passed TypeScript binary/Postgres reachability | Passed: `npm.cmd run check` | Passed: `npm.cmd run lint` | Passed: `npm.cmd run build` | `npm.cmd run audit:production` and `npm.cmd run verify:release` passed on the latest enforcement pass | Migration scripts exist: `db:preflight`, `db:push`, `db:push:force`; release gate starts the local app and waits for `/api/ready` | Release gate starts local app through `scripts/run-local-tests.mjs` | **Chosen base is buildable and release-gated locally, but not production-approved until CI is green on the release head** | No local gate blocker at the latest run. CI remains required before production. |
| `main` | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not production candidate | Empty/deleted baseline, not current app. |
| PR #7 branch | Not run | Not run | Not run | Not run | PR body reports Codespaces bootstrap and smoke checks at time of PR | Not run | Not run | Needs rebase before testing | GitHub says not mergeable; 192 commits behind current base. |
| PR #8 branch | Not run | Not run | Not run | Not run | PR body says no automated tests run | Not run | Not run | Likely superseded | GitHub says not mergeable; 93 commits behind current base. |
| PR #3 branch | Not run | Not run | Not run | Not run | PR contains Python tests but not run here | Not run | Not run | Separate spike only | Parallel stack; not aligned to chosen base. |

## 4. Route Inventory

The full route inventory is generated in [`docs/production-readiness-audit.md`](production-readiness-audit.md). Current generated counts:

| Inventory | Count | Evidence |
|---|---:|---|
| Frontend routes inspected | 76 | `npm.cmd run audit:production` |
| Main status risk | Several routes are still `Cosmetic only`, `Mock/demo only`, or `Partially working` | Route table in `docs/production-readiness-audit.md` |
| Required fix pattern | Connect routes to real APIs, loading/error states, validation, permissions, audit/reporting proof, and focused tests | Route table required-fix column |

## 5. API Inventory

The full API inventory is generated in [`docs/production-readiness-audit.md`](production-readiness-audit.md).

| Inventory | Count | Evidence |
|---|---:|---|
| API endpoints inspected | 373 | `npm.cmd run audit:production` |
| Main status risk | Some endpoints need clearer auth, validation, audit history, frontend usage, and tests | API audit table |
| Required fix pattern | Standardize `ensureAuthenticated`/`ensurePermission`, backend validators, structured errors, audit service calls, and endpoint tests | API audit table gap column |

## 6. Database And Schema Inventory

The full schema inventory is generated in [`docs/production-readiness-audit.md`](production-readiness-audit.md).

| Inventory | Count | Evidence |
|---|---:|---|
| Schema tables inspected | 109 | `shared/schema.ts` via `npm.cmd run audit:production` |
| Main status risk | Some compatibility tables lack full tenant/audit/status lifecycle fields | Schema audit table |
| Required fix pattern | Add explicit lifecycle/status, organization scoping, relations, required fields, and audit fields to production transaction tables | Schema audit table |

## 7. Workflow Connectivity Audit

| From | To | Data That Should Flow | Currently Flows? | Evidence | Gap | Required Fix |
|---|---|---|---|---|---|---|
| Master Data | Requisition | supplier, item, UOM, currency, tax, cost centre, approval route | Partially/yes | MDM defaults APIs and requisition context exist | Need stronger end-to-end proof per transaction | Add integration test from MDM edit to requisition creation and report/diagnostic update. |
| Requisition | Approval | requester, department, local value, policy result | Partially/yes | Requisition and approval policy modules exist | Self-approval/policy edge cases need proof | Add backend policy decision service test and UI evidence. |
| Approval | Purchase Order | approved lines, supplier, item, quantity, delivery need | Partially/yes | Procurement flow tests and PO routes exist | RFQ/quote is not first-class | Add or gate RFQ/quote workflow; prove approved requisition conversion. |
| Purchase Order | Goods Receipt | PO lines, UOM, warehouse/bin, tolerance | Partially/yes | PO receive panel and AP receipt routes exist | Need tolerance/config proof | Add receive-above-tolerance test. |
| Goods Receipt | Inventory | received qty, batch/serial/bin, stock movement | Partially/yes | stock movement and warehouse inventory tables/routes exist | Need transactional evidence | Add DB integration test for receive updates stock and movement. |
| PO/Receipt | Invoice/AP | supplier, PO lines, receipt evidence, tax/currency/totals | Partially/yes | AP workflow routes/tests exist | Tolerance and mismatch coverage needs expansion | Add AP matching tolerance tests. |
| Invoice/AP | Payment | approved invoice, supplier banking, payment controls | Partially/yes | payment batch routes and AP controls exist | Supplier banking protection needs stronger tests | Add role/2FA/audit tests around payment approval/release. |
| Transactions | Reports | spend, stock, logistics, AP, exports | Partially/yes | Export centre and reports exist | Some analytics sections still static/cosmetic | Wire analytics section data feeds or label as demo-only. |
| Sensitive Actions | Audit | old/new values, actor, timestamp, reason | Partial | audit/activity logs exist | Reason and old/new values not universal | Standardize audit service calls for sensitive writes. |

## 8. Master Data Rebuild Alignment

The full MDM domain table is generated in [`docs/production-readiness-audit.md`](production-readiness-audit.md). Current conclusion: the MDM foundation exists, but production readiness requires more domain-specific fields, where-used/dependency checks, and proof that MDM controls all new transactions.

## 9. Mock, Demo, Placeholder, And Static Data Audit

| Inventory | Count | Evidence | Required Fix |
|---|---:|---|---|
| Mock/demo/static risk markers | 580 | `npm.cmd run audit:production` | Review all rows in `docs/production-readiness-audit.md`; connect real data or formally mark demo-only. |

## 10. Validation And Business Rules Audit

The validation table is generated in [`docs/production-readiness-audit.md`](production-readiness-audit.md). Highest-risk rules still requiring hard proof:

| Rule | Current Risk | Required Fix |
|---|---|---|
| PO with blocked/inactive supplier | Invalid supplier may enter PO flow if not uniformly checked | Backend supplier guard with structured error and tests. |
| PO with inactive item/missing UOM/tax/GL/FX | Commercially invalid PO may be approved/sent | Central PO validation before submit/send. |
| Receipt above tolerance/cancelled PO | Inventory can be overstated | Transactional receive guard and tests. |
| Invoice above tolerance/unmatched invoice | AP overpayment risk | AP match state machine tests. |
| Payment of disputed/unmatched invoice | Cash-control failure | Payment release guard, permission/2FA, audit trail. |
| Disabling master data used by open transactions | Referential/business inconsistency | Where-used checks before disable/delete. |
| User self-approval where forbidden | Segregation-of-duties failure | Policy service test plus UI blocked state. |

## 11. Permissions And Security Audit

The role comparison table is generated in [`docs/production-readiness-audit.md`](production-readiness-audit.md). Current conclusion: RBAC/custom roles and `/api/user/permissions` exist, but required production role templates and sensitive-action tests need expansion for supplier banking, payments, approval rules, MDM, user roles, tax, GL, supplier blocking, invoice approval, and payment approval.

## 12. Audit Trail Audit

The audit-trail table is generated in [`docs/production-readiness-audit.md`](production-readiness-audit.md). Current conclusion: activity/audit tables and logs exist, but old/new values, reason capture, and tamper-evident coverage must be made consistent across MDM, supplier, item, requisition, approval, PO, receipt, invoice, payment, role, and settings changes.

## 13. Diagnostics And Error Handling Audit

The diagnostics table is generated in [`docs/production-readiness-audit.md`](production-readiness-audit.md). Current conclusion: health/readiness/system diagnostics exist, but production readiness still needs deep health/migration/deployment evidence wired into release gates and user-facing error/retry states for every core route.

## 14. Testing And Release Gate Audit

| Script/Test | Exists? | Purpose | Passes? | Gap | Required Fix |
|---|---|---|---|---|---|
| `npm run check` | Yes | TypeScript validation | Passed locally via `npm.cmd run check` | Needs CI evidence on PR #4 head | Keep in required gate. |
| `npm run lint` | Yes | ESLint validation | Passed locally via `npm.cmd run lint` | Needs CI evidence on PR #4 head | Keep in required gate. |
| `npm run build` | Yes | Production build | Passed locally via `npm.cmd run build` | Needs CI evidence on PR #4 head | Keep in required gate. |
| `npm run test` | Yes | Generic production-smoke alias | Passed through `npm run test:production-smoke` when run by developers/CI | Requires local app for some downstream focused suites | Keep mapped to production-critical smoke coverage. |
| `npm run verify:release` | Yes | Canonical release gate | Passed locally in latest enforcement pass | Requires local Postgres/app startup | Blocking before production and before merging production-base PR. |
| `npm run test:master-data-propagation` | Yes | MDM dependency/invalidation coverage | Passed inside `npm run verify:release` via `test:local:delta` | Needs CI evidence on release head | Keep in required gate. |
| `npm run test:purchase-order-endpoints` | Yes | PO endpoint coverage | Passed inside `npm run verify:release` via `test:local:delta` | Needs CI evidence on release head | Keep in required gate. |
| `npm run test:ap-workflow` | Yes | AP workflow coverage | Passed inside `npm run verify:release` via `test:local:delta` | Needs CI evidence on release head | Keep in required gate. |
| `npm run test:diagnostics` | Yes | Diagnostics checks | Passed inside `npm run verify:release` via `test:local:delta` | Needs CI evidence on release head | Keep in required gate. |
| `npm run release:gate:delta` | Yes | Focused release gate | Passed inside `npm run verify:release` | Requires local server and seeded demo/admin data | Keep as blocking delta gate. |
| `npm run audit:production` | Yes | Production-readiness map | Passed locally and is part of `verify:release` | Static audit still has false positives by design | Keep blocking and review generated deltas. |

## 15. Top 10 Production Fixes

| Priority | Fix | Module | Reason | Risk if Not Fixed | Estimated Size |
|---|---|---|---|---|---|
| 1 | Declare `cursor/project-codespace-compatibility-b14c` the production base and stop building on `main` | Branch truth | `main` is not the working app; PR #4 is the restored app | Work may keep landing on the wrong branch | S |
| 2 | Close/rebase stale PRs #3, #7, #8 before new feature work | Repo stability | They are diverged or parallel-scaffold branches | Non-mergeable PRs can reintroduce old code and conflicts | M |
| 3 | Keep `npm run test` and `npm run verify:release` wired to focused production checks | Release gates | Generic and canonical release commands now exist | Developers may run incomplete verification if these drift | S |
| 4 | Keep `audit:production` in the release gate and review generated deltas | App truth | The audit is now enforced by `verify:release` | Route/API/schema regressions can ship if audit output is ignored | S |
| 5 | Remove or label degraded/mock/static route behavior | Core app truth | Audit found many risk markers | Users may trust demo or fallback data as real | M |
| 6 | Finish MDM where-used/dependency checks | Master Data | Disable/delete safeguards are incomplete | Open transactions can reference invalid setup data | M |
| 7 | Strengthen PO business validation for supplier/item/UOM/tax/GL/FX | Procurement | Production rules need backend proof | Invalid POs can be approved/sent | M |
| 8 | Prove GRN-to-inventory and AP match flow transactionally | Warehouse/AP | Workflow is partly wired but needs atomic tests | Stock/AP mismatches can occur | M |
| 9 | Expand sensitive-action RBAC/2FA/audit tests | Security/AP/MDM | Supplier banking/payment/role changes need proof | Unauthorized financial/admin actions | M |
| 10 | Add deep health/deployment/migration smoke evidence to CI | Diagnostics | Startup/port failures have been recurring | Codespaces/local may appear alive while backend is unhealthy | S |

## 16. First Build Wave: Repo And App Stabilisation

1. Keep all new work on `cursor/project-codespace-compatibility-b14c`.
2. Use PR #4 as the production-base candidate and get CI green.
3. Do not merge PR #3 into the app; close or keep as a separate spike.
4. Rebase/cherry-pick PR #7 only if a specific missing capability is proven.
5. Close/recreate PR #8 unless a current diff proves missing invalidation behavior.
6. Keep the standard `npm run test` alias and documented `verify:release` command active.
7. Keep `npm run audit:production` in release/CI and reduce false positives without weakening the gate.
8. Label all remaining demo/mock/degraded routes or connect them to real APIs.
9. Add standard API error handling checks to the release gate.
10. Run the full production gate before merging PR #4 to `main`.

## 17. Acceptance Criteria Status

| Criterion | Status |
|---|---|
| `docs/branch-truth-and-production-readiness-audit.md` exists | Complete |
| True production base identified | Complete: `cursor/project-codespace-compatibility-b14c` |
| Open PRs classified | Complete for PR #3, #4, #7, #8 |
| Build/test status documented for chosen branch | Complete for check/lint/build/audit/verify:release; CI on release head remains required |
| Route/API/schema inventory completed | Complete in `docs/production-readiness-audit.md` |
| Workflow connectivity mapped | Complete |
| Mock/demo/static features listed | Complete by generated audit |
| Validation/permission/audit/diagnostics/test gaps listed | Complete |
| Top 10 production fixes ranked | Complete |
| No new feature work started | Complete |

## 18. Non-Negotiable Standard

Do not make the app prettier while leaving it disconnected. A feature is complete only when it uses real data, connects to the workflow, has backend validation, respects permissions, records audit history where needed, handles errors clearly, has tests or verification, and does not break existing modules.
