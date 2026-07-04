# Production Approval Evidence

Generated for Wave 3D and extended by Waves 4A-4B on `cursor/project-codespace-compatibility-b14c`.

## Decision

**Final decision:** ISSSourcing is a production approval candidate for the proven core procurement, receiving, inventory, AP, master-data, settings, roles, and approval-policy workflows. It is **not** full-suite production-approved for routes explicitly excluded from v1.

## Production Base

| Field | Value |
|---|---|
| Production base branch | `cursor/project-codespace-compatibility-b14c` |
| Current evidence commit | Updated by Wave 3D evidence pack |
| Production approval status | Candidate, pending required release gates and branch-protection checks |

## Current Blockers

| Category | Count | Evidence |
|---|---:|---|
| Core blocking risks | 0 | `docs/production-readiness-audit.md` |
| Marker-level blockers | 0 | `docs/production-readiness-audit.md` and `docs/core-blocking-risk-register.md` |
| Non-production v1 exclusions | 4 routes | `docs/core-route-v1-decision-log.md` |

## Non-Production V1 Exclusions

These routes are intentionally excluded from v1 production approval until route-specific real-data, permission, audit, and browser proof is complete:

| Route | Status |
|---|---|
| `/operations/logistics` | Non-production v1 |
| `/operations/logistics/:id` | Non-production v1 |
| `/operations/exceptions` | Non-production v1 |
| `/operations/exceptions/:id` | Non-production v1 |

The pages are also visibly labelled in-app as non-production v1 routes so production users do not mistake them for approved workflows.

## Required Release Gates

| Gate | Command or workflow | Required before production approval |
|---|---|---|
| Non-browser release gate | `npm run verify:release` | Yes |
| Browser E2E release gate | `npm run verify:release:e2e` | Yes |
| Secure release gate | `npm run verify:release:secure` | Yes |
| GitHub Playwright release gate | `.github/workflows/playwright-release-gate.yml` | Yes when local Chromium launch is blocked |
| Final audit pass | `npm run audit:production` | Yes |
| Subscription foundation tests | `npm run test:subscription-plans && npm run test:subscription-entitlements && npm run test:subscription-ui-contracts` | Yes after Wave 4A |
| Subscription runtime proof | `npm run test:subscription-runtime-flow` | Yes after Wave 4B |
| Stripe readiness proof | `npm run test:stripe-billing-readiness` | Yes after Wave 4B |
| Subscription browser proof | `npm run test:e2e:subscription` | Yes in browser E2E gate |

## Workflow Proof Summary

The branch has runtime/API proof for:

- Master Data to requisition to approval to purchase order metadata propagation.
- Purchase order receiving to GRN evidence, stock movement, warehouse inventory quantity, and PO line received quantity.
- AP invoice matching against PO and receipt evidence.
- Above-tolerance and exception invoice payment blocking.
- MDM dependency blocking for used UOM conversions and GL mappings.
- Payment-control and AP segregation negative paths.

Primary evidence commands:

- `npm run test:requisition-line-mdm-flow`
- `npm run test:mdm-dependency-runtime`
- `npm run test:po-receiving-inventory-flow`
- `npm run test:ap-po-grn-matching-flow`
- `npm run test:core-screen-workflow-contracts`

## Control-Plane Proof Summary

The branch has runtime, source-contract, and browser-test evidence for the production control plane:

- `/admin/settings`
- `/admin/settings/:section`
- `/admin/user-roles`
- `/finance/approval-policies`
- `/admin/master-data`
- `/admin/master-data/:section`

Primary evidence commands:

- `npm run test:control-plane-runtime`
- `npm run test:control-plane-screen-contracts`
- `npm run test:e2e:control-plane`

## Security And Supply-Chain Proof Summary

The secure release gate verifies:

- package manifests remain clean after install;
- lifecycle scripts are enumerated and enforced;
- SBOM generation completes;
- npm registry signatures and attestations are checked;
- high-severity npm audit is clean.

Primary evidence command:

- `npm run verify:release:secure`

## Subscription And SaaS Billing Proof Summary

Waves 4A-4B add a production-safe SaaS subscription foundation and runtime proof without changing the AP/customer billing workspace.

Implemented evidence:

- Plan catalog source of truth in `server/subscription-plan-catalog.ts`.
- Organization subscription lifecycle fields persisted in `organization_settings`.
- `/api/subscription/plans`, `/current`, `/usage`, `/change-plan`, `/start-trial`, `/cancel`, `/resume`, and `/billing-portal`.
- Dedicated SaaS page at `/admin/subscription`.
- Permission-aware management controls requiring `settings:configure`.
- Backend plan-limit and feature-entitlement errors: `PLAN_LIMIT_REACHED`, `FEATURE_NOT_INCLUDED`, `TRIAL_EXPIRED`, and `SUBSCRIPTION_INACTIVE`.
- Production guard that prevents local lifecycle endpoints from faking successful hosted billing actions.
- Stripe readiness guard for missing provider config, missing price IDs, production local-adapter boundaries, invalid webhook signatures, and missing webhook event IDs.

Primary evidence commands:

- `npm run test:subscription-enforcement`
- `npm run test:subscription-plans`
- `npm run test:subscription-entitlements`
- `npm run test:subscription-ui-contracts`
- `npm run test:subscription-runtime-flow`
- `npm run test:stripe-billing-readiness`
- `npm run test:e2e:subscription`

Remaining provider setup:

- Stripe price IDs, portal/customer records, and webhook secrets must be configured in the deployment environment before hosted checkout/portal actions become live.
- Pricing labels remain configurable placeholders until commercial pricing is approved.

Required hosted billing environment:

- `STRIPE_SECRET_KEY`
- `VITE_STRIPE_PUBLIC_KEY` or `STRIPE_PUBLIC_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_STANDARD`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_ENTERPRISE`

## Browser E2E Evidence

Playwright workflow name: **Playwright Release Gate**

Workflow file: `.github/workflows/playwright-release-gate.yml`

The workflow runs:

- `npm ci`
- `npm run verify:package-manifests`
- `npm run verify:production-base`
- `npm run build`
- `npx playwright install --with-deps chromium`
- `npm run verify:release:e2e`

`verify:release:e2e` includes `npm run test:e2e:subscription` from Wave 4B onward.

If local Windows or Codespaces Chromium launch fails with sandbox/permission errors, attach the GitHub Actions Playwright Release Gate run as the production browser evidence.

## Latest Local Gate Results

| Command | Result | Notes |
|---|---|---|
| `npm run verify:release` | Passed locally | `verify:production-base`, TypeScript, lint, build, production audit, and live delta suite completed. |
| `npm run verify:release:e2e` | Blocked locally in Playwright phase | The command completed the full `verify:release` pre-gate, then failed in the browser phase with the same local Chromium launch restriction tracked by test id `cc280d92bc59b2ee6bff-99ef022bf30a937aa8ca`. Use the GitHub Playwright Release Gate workflow as the required browser evidence for this environment. |
| `npm run verify:release:secure` | Passed locally | `verify:release` plus package-manifest cleanliness, lifecycle enforcement, SBOM generation, registry signature audit, and high-severity npm audit completed; `npm audit --audit-level=high` reported 0 vulnerabilities. |
| `npm run audit:production` | Passed locally | Final Wave 3D audit pass kept `Core blocking risks: 0`, `Marker-level blockers: 0`, and `Non-production v1 exclusions: 4 routes`. |
