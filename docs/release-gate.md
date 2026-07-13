# Production Release Gate

Use this gate for production stabilisation work on `cursor/project-codespace-compatibility-b14c`.

This branch is buildable, not production-approved. Production approval requires the local gate below plus the required GitHub CI checks on the release head.

## Required Commands

Run:

```bash
npm run verify:release
```

`verify:release` runs `verify:production-base`, `check`, `lint`, `build`, `audit:production`, and `test:local:delta`.

Before production merge, run the secure gate:

```bash
npm run verify:release:secure
```

`verify:release:secure` runs the full release gate plus package-manifest, lifecycle, SBOM, audit-signature, and high-vulnerability supply-chain checks.

Before production approval, run the browser E2E gate:

```bash
npm run verify:release:e2e
```

`verify:release:e2e` runs the full release gate plus the procurement/AP browser workflow, role-permission browser workflow, control-plane browser workflow, subscription admin browser workflow, and button/action smoke workflow. This gate is mandatory before a production release candidate can be approved. If the local Windows or Codespaces browser sandbox cannot launch Chromium, run it in GitHub Actions through `.github/workflows/playwright-release-gate.yml` and attach the workflow run to the release notes.

The commercial procurement increment also adds `test:e2e:sourcing` to this gate. It covers supplier quote submission, buyer evaluation, award recommendation, independent planner approval, and award-to-PO conversion. The live `test:sourcing-workflow` gate is part of `release:gate:delta` and proves the same lifecycle against PostgreSQL and HTTP APIs.

`test:local:delta` starts the local app, waits for `/api/ready`, and then runs the focused workflow checks that require a live server, including master-data propagation, master-data integration, purchase-order endpoints, AP workflow, diagnostics, route diagnostics, and `release:gate:delta`.

## Gate Matrix

| Check | Command | Blocking? | Purpose | Current Status | Notes |
|---|---|---:|---|---|---|
| Production branch guard | `npm run verify:production-base` | Yes | Warn if the work is not on/targeting the selected production-base branch. | Passing locally | Current production-base candidate is `cursor/project-codespace-compatibility-b14c`. |
| TypeScript check | `npm run check` | Yes | Catch type, schema, and API contract drift before build. | Passing locally | Also runs inside `test:local:delta` for live-gate evidence. |
| Lint | `npm run lint` | Yes | Catch unsafe or inconsistent code patterns. | Passing locally | Also runs inside `test:local:delta`. |
| Production build | `npm run build` | Yes | Prove the client and server can produce deployable artifacts. | Passing locally | Uses the Windows OneDrive server-build fallback where needed. |
| Production audit | `npm run audit:production` | Yes | Generate route/API/schema/workflow/mock-risk audit with stricter statuses. | Passing locally | Output is `docs/production-readiness-audit.md`; review changed risk counts before release. |
| Generic test alias | `npm run test` | Yes for developer smoke | Provide a standard test entrypoint. | Exists | Maps to `npm run test:production-smoke`. |
| Production smoke | `npm run test:production-smoke` | Yes for smoke runs | Exercise master-data propagation, PO endpoints, AP workflow, and diagnostics. | Available | Uses `scripts/run-local-tests.mjs --production-smoke`; requires a reachable local app unless the runner starts it. |
| Live delta suite | `npm run test:local:delta` | Yes | Start local app and run release-critical tests against a real server. | Passing locally | Serves the built static app for browser route smoke checks. |
| Master data propagation | `npm run test:master-data-propagation` | Yes | Prove supplier/master-data defaults flow into PO, AP, logistics, and diagnostics paths. | Passing via delta gate | Requires live server and seeded admin user. |
| Purchase-order endpoints | `npm run test:purchase-order-endpoints` | Yes | Prove PO endpoint behavior, including supplier/contract currency override blocking. | Passing via delta gate | Tests expect structured supplier/contract currency override failures. |
| AP workflow | `npm run test:ap-workflow` | Yes | Prove AP invoice/capture/receipt workflow remains connected. | Passing via delta gate | Expected negative-path errors may appear in logs while assertions pass. |
| Production workflow proof | `npm run test:production-workflow-proof` | Yes | Prove the core Master Data to Requisition to PO to GRN to Inventory to AP chain has route, validation, dependency, receipt, payment, and audit controls wired in source. | Added to delta gate | Source-level proof complements live API tests without depending on the browser bridge. |
| Commercial procurement foundation | `npm run test:commercial-procurement-foundation` | Yes | Prove fail-closed tenancy, tenant-scoped operational aliases, sourcing persistence, country packs, audit chaining, supplier isolation, governed PO actions, and production boundaries remain wired. | Passing locally (22 controls) | Source contract for the procurement-only commercial release. |
| Live sourcing workflow | `npm run test:sourcing-workflow` | Yes | Prove RFQ publication, mapped supplier quote, FX-normalized comparison, evaluation, self-approval denial, independent award approval, PO conversion, MDM propagation, and audit-chain validity. | Passing locally | Runs with a real local server through `npm run test:local:sourcing`; also included in `release:gate:delta`. |
| Sourcing browser workflow | `npm run test:e2e:sourcing` | Yes before production approval | Prove supplier and buyer sourcing actions through the browser, including independent approval and PO conversion. | Added to formal E2E gate | Run through the Playwright Release Gate when the local Chromium sandbox is unavailable. |
| Control-plane screen contracts | `npm run test:control-plane-screen-contracts` | Yes | Prove AP payments, settings, roles, approval policies, and Master Data keep source-level UI evidence for real APIs, permission denials, dependency responses, and payment locks. | Added to delta gate | Source-level proof; live browser proof still comes from the E2E gate. |
| Final production blockers | `npm run test:final-production-blockers` | Yes | Prevent regression of hardcoded payment actor, fake inventory detail fallback, production demo wording, fallback badge state, and Playwright workflow requirements. | Passing locally | Added to `release:gate:delta` in Wave 3C. |
| Subscription plan catalog | `npm run test:subscription-plans` | Yes | Prove Starter, Standard, Growth, and Enterprise catalog limits, feature groups, labels, support levels, and configurable pricing placeholders are present. | Passing locally | Added to `release:gate:delta` in Wave 4A. |
| Subscription entitlement enforcement | `npm run test:subscription-entitlements` | Yes | Prove backend feature flags and lifecycle decisions block Starter exports/offline sync, expired trials, inactive subscriptions, and plan-limit writes. | Passing locally | Confirms `PLAN_LIMIT_REACHED` and `FEATURE_NOT_INCLUDED` remain the structured errors. |
| Subscription UI contracts | `npm run test:subscription-ui-contracts` | Yes | Prove `/admin/subscription` is routed, uses SaaS subscription APIs, shows locked/upgrade states, and stays separate from `/finance/billing`. | Passing locally | Source-level UI proof for the SaaS billing foundation. |
| Subscription runtime flow | `npm run test:subscription-runtime-flow` | Yes | Prove Starter user/warehouse/SKU/export limits, Standard export unlock, Growth feature unlocks, Enterprise unlimited limits, expired/canceled write blocks, past_due grace, and plan-change audit evidence through the live API. | Added in Wave 4B | Runs inside `release:gate:delta`; snapshots/restores org subscription state and cleans test records. |
| Stripe billing readiness | `npm run test:stripe-billing-readiness` | Yes | Prove checkout/portal missing-provider and missing-price errors, production local-adapter boundary, webhook signature rejection, event id requirement, and documented Stripe env vars. | Added in Wave 4B | Fast source/API-contract guard; does not contact Stripe. |
| Subscription browser E2E | `npm run test:e2e:subscription` | Yes before production approval | Prove `/admin/subscription` renders plan cards, usage, locked features, AP billing separation, admin local plan change, and denied/disabled management for non-admin users. | Added to `verify:release:e2e` | Use GitHub Playwright gate if local Chromium sandbox is blocked. |
| Button/action source contracts | `npm run test:button-action-contracts` | Yes | Prove 43 inventoried core visible actions have real handlers, feedback, invalidation, structured errors, controlled validation classification, and no inert/console-only action wiring. | Passing locally | Added to `release:gate:delta`; inventory is `docs/button-action-inventory.md`. |
| Button/action browser smoke | `npm run test:e2e:button-actions` | Yes before production approval | Click/smoke high-risk action paths for contracts, gas timeout retry, subscription actions, custom-role permission removal, PO commercial validation, AP payment validation, diagnostics, settings, Master Data, and approval policies. | Added to `verify:release:e2e` | 13 action surfaces covered; use GitHub Playwright gate if local Chromium sandbox is blocked. |
| MDM requisition context | `npm run test:mdm-requisition-context` | Yes | Prove `/api/mdm/defaults/requisition-context` cannot regress to the integer/text item-category crash and returns requisition defaults. | Passing locally via `verify:release` | Runtime DB/service proof. |
| MDM domain registry | `npm run test:mdm-domain-registry` | Yes | Prove governed domains, owners, stewards, risk, required fields, high-risk fields, where-used checks, import/export, and audit policy are registered. | Passing locally via `verify:release` | Source contract proof. |
| MDM change requests | `npm run test:mdm-change-requests` | Yes | Prove maker-checker lifecycle routes and services cover create, approve, reject, apply, failed apply, comments, apply-once, and before/after evidence. | Added to `release:gate:delta` | Source contract proof. |
| MDM data quality | `npm run test:mdm-data-quality` | Yes | Prove duplicate, compliance, UOM, item, supplier, tax, warehouse, and finance data-quality checks are catalogued and scanned. | Passing locally via `verify:release` | Source contract proof. |
| MDM where-used | `npm run test:mdm-where-used` | Yes | Prove unsafe archive/deactivate dependency checks are exposed through API and UI. | Passing locally via `verify:release` | Source contract proof. |
| MDM security/UI contracts | `npm run test:mdm-security && npm run test:mdm-ui-contracts` | Yes | Prove tenant scoping, deny-by-default write gates, stale version errors, maker-checker controls, audit hooks, and control-centre UI states. | Passing locally via `verify:release` | Source contract proof. |
| MDM runtime security | `npm run test:mdm-runtime-security` | Yes | Prove DB-backed tenant isolation, low-risk create/audit, high-risk pending approval, self-approval blocking, stale update blocking, comments, apply-once, and failed-apply recording. | Added to `release:gate:delta` | Runtime DB/service proof. |
| MDM API authorization | `npm run test:mdm-api-authorization` | Yes | Prove `/api/mdm/*` write routes use domain registry permissions, return `MDM_PERMISSION_DENIED`, and expose steward workflow UI/browser evidence hooks. | Added to `release:gate:delta` | Route/source contract proof. |
| AP PO-link validation | `npm run test:ap-po-link-validation` | Yes | Prove no-PO match/approval failures return `AP_INVOICE_PO_LINK_REQUIRED` with invoice id and repair hint instead of generic AP errors. | Added to `release:gate:delta` | Source/service contract proof. |
| Diagnostics self-checks | `npm run test:diagnostics` | Yes | Prove diagnostic rules and route contracts behave predictably. | Passing via delta gate | Complements system diagnostics UI checks. |
| Focused release gate | `npm run release:gate:delta` | Yes | Run RBAC, requisitions, AP controls, exports, smoke, setup, and installable-complete tests. | Passing via delta gate | Requires live local app from `test:local:delta`. |
| GitHub CI production readiness | `.github/workflows/production-readiness.yml` | Yes before production | Re-run install, typecheck, lint, build, audit, and stable focused tests on GitHub infrastructure. | Workflow exists | CI must pass on the release head before production approval. |
| Formal browser E2E release gate | `npm run verify:release:e2e` | Yes before production approval | Run the release gate plus procurement/AP, permissions, and control-plane Playwright workflows. | Workflow exists | Runs in `.github/workflows/playwright-release-gate.yml`; local Windows may require an unrestricted browser sandbox. |
| Extended browser E2E | `npm run verify:e2e` | Conditional | Run broader Playwright/E2E coverage when the browser environment is stable. | Available | Broader than the formal release gate and useful for exploratory release hardening. |
| Security supply chain | `npm run security:supply-chain:ci` | Yes before production merge | Enforce package manifest drift, lifecycle scripts, SBOM, audit signatures, and high-vulnerability audit. | Included in Production Readiness CI and `verify:release:secure` | Do not merge to production if this fails. |

## Blockers And Equivalents

- Some focused workflow tests require a live app and database. The safe equivalent is `npm run test:local:delta`, which starts the app and waits for `/api/ready` before executing those tests.
- Browser-driven E2E is mandatory before production approval, but it may need `.github/workflows/playwright-release-gate.yml` when local Windows/Codespaces browser sandboxes reject Chromium launch. Do not fake browser success; keep the workflow run as evidence.
- If a required service is unavailable, document the failure in the PR/check notes and do not mark the gate green.

## Production Approval Rule

A feature or route is not production-ready unless it uses real data, has backend validation, respects permissions where needed, handles errors clearly, and has tests or explicit verification evidence.

The complete procurement-only boundary is defined in [Commercial Procurement Release Boundary](COMMERCIAL-PROCUREMENT-BOUNDARY.md). Receiving, inventory operations, mobile warehouse work, logistics, exceptions, AP, payment control, and their non-procurement analytics remain later-release modules. Production navigation and direct route access must keep these areas gated until their route-specific evidence is complete.

Remaining marker-level production blockers are tracked in [Core Blocking Risk Register](core-blocking-risk-register.md). The current audit reports **0 core blockers**, **0 marker-level blockers**, and **33 procurement-release route exclusions**. Those exclusions are an intentional commercial boundary, not unresolved procurement blockers.

## Latest Commercial Procurement Evidence

| Command | Result | Notes |
|---|---|---|
| `npm run test:commercial-procurement-foundation` | Passed locally | 22 controls cover fail-closed tenancy, supplier isolation, sourcing persistence, governed PO actions, country packs, audit chaining, and the procurement-only production boundary. |
| `npm run test:local:sourcing` | Passed locally | Live PostgreSQL/API proof covers RFQ publication, mapped supplier quote submission, reporting-currency comparison, evaluation, self-approval denial, independent award approval, award-to-PO conversion, and audit-chain verification. |
| `npm run test:subscription-runtime-flow` | Passed locally | Tenant member addition now uses a permission, 2FA, plan-limit, and audit-protected organization membership endpoint; public registration creates a new tenant instead of relying on organization 1. |
| `npm run test:local:delta` | Passed locally | Full live release delta completed after the tenant-membership and legacy test-contract fixes. |
| `npm run build` | Passed locally | Vite built 3,635 modules and the server build completed with the repository's Windows OneDrive fallback. |
| `npm run security:audit` | Passed locally | `npm audit --audit-level=high` reported 0 vulnerabilities. |
| `npm run test:e2e:sourcing` | Blocked locally at Chromium launch | API preflight passed, then the Windows sandbox returned `browserType.launch: spawn EPERM`. `.github/workflows/playwright-release-gate.yml` remains the required browser evidence path. |
| `npm run audit:production` | Passed locally | Latest generated audit reports 0 core blockers, 0 marker-level blockers, and 33 explicitly gated procurement-release exclusions. |

## Latest Wave 3C Evidence

| Command | Result | Notes |
|---|---|---|
| `npm run test:final-production-blockers` | Passed locally | Confirms the 10 previously listed marker blockers were fixed and the requested Playwright workflow file exists. |
| `npm run check` | Passed locally | TypeScript check completed after the Wave 3C source changes. |
| `npm run lint` | Passed locally | ESLint completed across client, server, and shared TypeScript. |
| `npm run build` | Passed locally | Client build completed; server used the existing Windows OneDrive transpiled runtime fallback. |
| `npm run audit:production` | Passed locally | Regenerated `docs/production-readiness-audit.md` with `Core blocking risks: 0`, `Marker-level blockers: 0`, and `Non-production v1 exclusions: 4 routes`. |
| `npm run verify:release` | Passed locally | Full non-browser release gate completed after the master-data propagation receive test was updated to send warehouse aisle/bin context. |
| `npm run verify:release:e2e` | Blocked locally by Windows browser launch | The release pre-gate passed, then Playwright failed at Chromium startup with `browserType.launch: spawn EPERM`; use `.github/workflows/playwright-release-gate.yml` as the required E2E evidence path for this environment. |
| `npm run verify:release:secure` | Passed locally after commit | Re-ran from the committed Wave 3C state; package manifests were clean, lifecycle/SBOM/signature checks passed, and `npm audit --audit-level=high` reported 0 vulnerabilities. |

## Latest Wave 4A Subscription Evidence

| Command | Result | Notes |
|---|---|---|
| `npm run test:subscription-plans` | Passed locally | Confirms the SaaS catalog has all four tiers, plan limits, feature groups, support levels, and configurable pricing labels. |
| `npm run test:subscription-entitlements` | Passed locally | Confirms Starter blocks exports/offline sync, Standard and Growth unlock their tiers, Enterprise limits are unlimited, expired trials block writes, and inactive subscriptions block paid workflow writes. |
| `npm run test:subscription-ui-contracts` | Passed locally | Confirms `/admin/subscription` is routed, calls the SaaS subscription APIs, shows locked-feature/upgrade states, and does not reuse `/finance/billing` for SaaS plan changes. |
| `npm run check` | Passed locally | TypeScript completed after schema, API, and UI subscription changes. |
| `npm run lint` | Passed locally | ESLint completed across client, server, and shared TypeScript after the subscription changes. |
| `npm run build` | Passed locally | Production build completed and emitted the new `subscription` client chunk. |
| `npm run audit:production` | Passed locally | Regenerated the production readiness audit with 78 routes and 378 endpoints inspected after `/admin/subscription` and new subscription APIs were added. |
| `npm run verify:release` | Passed locally | Full non-browser release gate completed, including the live delta suite and the new subscription tests through `release:gate:delta`. |

## Latest Wave 4B Subscription Evidence

| Command | Result | Notes |
|---|---|---|
| `npm run test:subscription-runtime-flow` | Passed locally via `test:local:delta` | Live API proof for Starter user/warehouse/SKU/export limits, Standard export unlock, Growth feature unlocks, Enterprise unlimited limits, expired/canceled write blocks, billing grace, and plan-change audit evidence. |
| `npm run test:stripe-billing-readiness` | Passed locally | Source/API contract guard for Stripe configuration, hosted-billing production boundaries, webhook signature rejection, and required Stripe environment documentation. |
| `npm run verify:release` | Passed locally | Completed on `BASE_URL=http://127.0.0.1:5017`, including the live delta suite and Wave 4B subscription runtime/Stripe checks. |
| `npm run security:supply-chain:ci` | Passed locally after commit | Package manifests were clean, lifecycle enforcement/SBOM/signature checks passed, and `npm audit --audit-level=high` reported 0 vulnerabilities. |
| `npm run test:e2e:subscription` | Blocked locally by Windows browser launch | The server and API preflight completed, then Playwright failed at Chromium startup with `browserType.launch: spawn EPERM`; run `.github/workflows/playwright-release-gate.yml` for required browser evidence in this environment. |

## Latest Wave 4D Button/Action Evidence

| Command | Result | Notes |
|---|---|---|
| `npm run test:button-action-contracts` | Passed locally | 12 contracts and 33 assertions covering 43 inventoried core actions, including reorder conversion, RBAC permission removal, contracts route recovery, PO commercial validation, gas summary timeout, subscription lifecycle buttons, and AP payment batching. |
| `npm run test:live-diagnostics-regressions` | Passed locally | Confirms the live diagnostics fixes for structured reorder errors, idempotent role permission delete, route recovery, gas fallback, branding, and tenant subscription handling remain in place. |
| `npm run check` | Passed locally | TypeScript completed after the PO commercial action-recovery UI and button/action test additions. |
| `npm run lint` | Passed locally | ESLint completed across client, server, and shared TypeScript. |
| `npm run build` | Passed locally | Client and server build completed; server used the existing Windows OneDrive transpiled runtime fallback. |
| `npm run audit:production` | Passed locally | Regenerated `docs/production-readiness-audit.md`; core blocking and marker-level blockers remain separated from non-blocking source markers. |
| `npm run test:e2e:button-actions` | Blocked locally by Windows browser launch | The wrapper started the app and API-backed custom-role permission delete idempotency passed; page-level Playwright cases failed at Chromium startup with `browserType.launch: spawn EPERM`. Use `.github/workflows/playwright-release-gate.yml` for required browser evidence in this environment. |

## Latest Wave 4E Diagnostics/Button Evidence

| Command | Result | Notes |
|---|---|---|
| `npm run test:button-action-contracts` | Passed locally | 12 contracts and 39 assertions; browser smoke coverage inventory increased to 13 action surfaces. |
| `npm run test:live-diagnostics-regressions` | Passed locally | Confirms route recovery, reorder repair guidance, RBAC idempotent delete, gas fallback, ISSSourcing branding, tenant subscription checks, and controlled business-rule diagnostics. |
| `npm run test:subscription-tenant-isolation` | Passed locally | Confirms org-scoped subscription user limit handling remains isolated. |
| `npm run test:subscription-runtime-flow` | Passed locally with temporary server on port 5017 | Live API proof for plan limits, feature gates, lifecycle states, and audit evidence. |
| `npm run check` | Passed locally | TypeScript completed after Wave 4E changes. |
| `npm run lint` | Passed locally | ESLint completed across client, server, and shared TypeScript. |
| `npm run build` | Passed locally | Production build completed with Windows OneDrive server fallback. |
| `npm run audit:production` | Passed locally | Core blocking risks remain 0; marker-level blockers remain 0. |
| `npm run verify:release` | Passed locally | Full non-browser release gate completed, including live local delta suite. |
| `npm run verify:release:secure` | Passed locally | Ran `verify:release` plus package-manifest, lifecycle, SBOM, registry-signature, and high-vulnerability supply-chain checks. |
| `npm run test:e2e:button-actions` | Browser evidence path remains GitHub workflow | Local page-level Chromium launches are blocked by `spawn EPERM`; run `.github/workflows/playwright-release-gate.yml` for production browser evidence. |

## Latest Wave 5B MDM Runtime Evidence

| Command | Result | Notes |
|---|---|---|
| `npm run test:mdm-change-requests` | Passed locally | Confirms governed MDM change requests expose create, approve, reject, apply, failed apply, comments, apply-once, and before/after lifecycle evidence. |
| `npm run test:mdm-runtime-security` | Passed locally | Runtime DB/service proof for tenant isolation, low-risk create audit, high-risk pending approval, self-approval blocking, stale update blocking, comments, apply-once, and failed-apply recording. |
| `npm run test:mdm-api-authorization` | Passed locally | Route-level contract for domain permission enforcement, structured MDM denials, steward workflow UI controls, and AP no-PO browser proof hooks. |
| `npm run test:ap-po-link-validation` | Passed locally | Confirms AP no-PO match/approval failures return `AP_INVOICE_PO_LINK_REQUIRED` with invoice id and repair hint. |
| `npm run test:latest-runtime-failures` | Passed locally | Re-runs MDM requisition-context, MDM runtime security, AP PO-link validation, and live diagnostics regressions. |
| `npm run check` | Passed locally | TypeScript completed after Wave 5B service, route, UI, and test changes. |
| `npm run lint` | Passed locally | ESLint completed across client, server, and shared TypeScript. |
| `npm run build` | Passed locally | Production build completed with the existing Windows OneDrive server fallback. |
| `npm run audit:production` | Passed locally | Core blocking risks remain 0; marker-level blockers remain 0. |
| `npm run verify:release` | Passed locally | Full non-browser release gate completed, including the new MDM change-request, MDM runtime-security, and AP PO-link validation gates in `release:gate:delta`. |
| `npm run verify:release:secure` | Passed locally | Re-ran `verify:release` plus package-manifest cleanliness, lifecycle, SBOM, registry-signature, and high-vulnerability supply-chain checks; `npm audit --audit-level=high` reported 0 vulnerabilities. |

## Latest Wave 5C MDM Authorization Evidence

| Command | Result | Notes |
|---|---|---|
| `npm run test:mdm-api-authorization` | Passed locally | Confirms `/api/mdm/*` write routes use domain permission helpers, target-domain authorization for change-request actions, structured `MDM_PERMISSION_DENIED`, steward UI workflow evidence, and AP no-PO browser proof hooks. |
| `npm run test:mdm-ui-contracts` | Passed locally | Confirms approve, reject, apply, comment, before/after diff, step timeline, failed-apply state, admin override warning, and disabled reasons are present in Master Data. |
| `npm run test:button-action-contracts` | Passed locally | 14 contracts and 43 assertions; AP no-PO invoice match is now covered as controlled validation. |
| `npm run check` | Passed locally | TypeScript completed after MDM API authorization, steward UI, and AP no-PO changes. |
| `npm run lint` | Passed locally | ESLint completed across client, server, and shared TypeScript. |
| `npm run build` | Passed locally | Production build completed with the existing Windows OneDrive server fallback. |
| `npm run audit:production` | Passed locally | Core blocking risks remain 0; marker-level blockers remain 0. |
| `npm run verify:release` | Passed locally | Full non-browser release gate completed, including `test:mdm-api-authorization` in `release:gate:delta`. |
