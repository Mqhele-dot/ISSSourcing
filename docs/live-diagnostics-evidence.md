# Live Diagnostics Evidence

Updated: 2026-07-05

## Run Context

| Field | Value |
|---|---|
| Branch | `cursor/project-codespace-compatibility-b14c` |
| Base commit before Wave 4E changes | `3e8de5e` |
| Environment | Local Windows repo, PowerShell, PostgreSQL-backed local app where server-backed tests run |
| Browser evidence path | Local Chromium page launch is blocked by `browserType.launch: spawn EPERM`; use `.github/workflows/playwright-release-gate.yml` for required browser evidence |
| Decision | Clean for source/runtime diagnostics; browser evidence remains delegated to GitHub Playwright Release Gate because local Chromium launch is blocked |

## Routes And Actions Covered

| Area | Route / Action | Evidence |
|---|---|---|
| Contracts | `/procurement/contracts` route marker and lazy chunk recovery | Source contract and route diagnostics regression |
| Reorder | Convert missing linked item | Structured `REORDER_ITEM_MISSING` details plus UI repair guidance |
| User roles | Repeated custom-role permission delete | Backend returns `alreadyRemoved=true`; UI invalidates permission list |
| Purchase orders | Commercial terms supplier/contract currency override | Controlled validation banner with Use contract currency and Clear contract actions |
| Control Tower | Gas dashboard timeout | Bounded timeout and unavailable/retry state |
| Subscription | Plan cards, locked features, lifecycle buttons | Source/runtime subscription tests and browser test added to release gate |
| Diagnostics | Run scan, export JSON/Markdown, clear events | Browser smoke cases added; local page launch blocked by Chromium sandbox |
| Branding | Production-facing labels | Manifest, desktop shell labels, subscription/docs/default settings use ISSSourcing |

## Diagnostics Summary

| Metric | Result | Notes |
|---|---:|---|
| criticalIssues | 0 expected | Source/runtime diagnostics guards keep previous critical action failures closed. |
| errors | 0 unresolved expected from controlled business-rule actions | Expected validation codes are classified as controlled info diagnostics. |
| warnings | Acceptable with notes | Slow/browser sandbox warnings are environment-specific, not app action failures. |
| slowRequests | Not manually sampled in browser in this local run | Server-backed tests exercise readiness and API paths. |
| unresolvedEvents | 0 expected from Wave 4C/4D failure list | Business-rule mutations no longer enter the unresolved action drawer when handled. |

## Controlled Business Rules

The shared client transport classifies these expected responses as controlled validation/info diagnostics instead of unresolved app failures:

- `SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED`
- `REORDER_ITEM_MISSING`
- `PLAN_LIMIT_REACHED`
- `FEATURE_NOT_INCLUDED`
- `SUBSCRIPTION_INACTIVE`
- `TRIAL_EXPIRED`
- `PAYMENT_BATCH_SELF_APPROVAL_BLOCKED`
- idempotent custom-role permission delete responses with `alreadyRemoved=true`

## Commands Run In Wave 4E

| Command | Result | Notes |
|---|---|---|
| `npm run test:live-diagnostics-regressions` | Passed locally | Includes branding, route recovery, reorder, RBAC, gas timeout, controlled business-rule classification, and tenant subscription checks. |
| `npm run test:button-action-contracts` | Passed locally | 12 contracts and 39 assertions, including 13 browser-covered action surfaces and controlled business-rule diagnostics. |
| `npm run check` | Passed locally | TypeScript completed after diagnostics classifier, branding, and E2E smoke expansion. |
| `npm run lint` | Passed locally | ESLint completed across client, server, and shared TypeScript. |
| `npm run build` | Passed locally | Client/server build completed; Windows OneDrive server-build fallback remained successful. |
| `npm run test:subscription-tenant-isolation` | Passed locally | Confirms subscription limits remain tenant-scoped. |
| `npm run test:subscription-runtime-flow` | Passed locally with temporary server on port 5017 | Proves Starter/Standard/Growth/Enterprise entitlements and lifecycle controls through live API. |
| `npm run audit:production` | Passed locally | Core blocking risks remain 0 and marker-level blockers remain 0. |
| `npm run verify:release` | Passed locally | Full non-browser release gate completed, including live local delta suite. |
| `npm run verify:release:secure` | Passed locally | Re-ran `verify:release` and supply-chain CI checks. |
| `npm run test:e2e:button-actions` | Local browser blocked | The wrapper started the app and API-backed preflight/actions ran, but page-level Chromium launches still fail with `spawn EPERM`; use GitHub Playwright Release Gate for browser evidence. |

## Remaining Notes

- Internal compatibility names such as `X-InvTrack-Fallback`, `X-InvTrack-Endpoint`, `InvTrackMeta`, and legacy test/script names remain intentionally unchanged because they are protocol or historical identifiers, not production-facing UI.
- Operations logistics and exceptions remain non-production v1 unless their route-specific proof is completed.
