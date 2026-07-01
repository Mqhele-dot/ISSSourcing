# Production Release Gate

Use this gate for Wave 1 production stabilisation work on `cursor/project-codespace-compatibility-b14c`.

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

`verify:release:e2e` runs the full release gate plus the procurement/AP browser workflow, role-permission browser workflow, and control-plane browser workflow. This gate is mandatory before a production release candidate can be approved. If the local Windows or Codespaces browser sandbox cannot launch Chromium, run it in GitHub Actions through the Playwright Release Gate workflow and attach the workflow run to the release notes.

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
| Purchase-order endpoints | `npm run test:purchase-order-endpoints` | Yes | Prove PO endpoint behavior, including supplier/contract currency override blocking. | Passing via delta gate | Tests now expect structured `SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED` failures. |
| AP workflow | `npm run test:ap-workflow` | Yes | Prove AP invoice/capture/receipt workflow remains connected. | Passing via delta gate | Expected negative-path errors may appear in logs while assertions pass. |
| Production workflow proof | `npm run test:production-workflow-proof` | Yes | Prove the core Master Data → Requisition → PO → GRN → Inventory → AP chain has route, validation, dependency, receipt, payment, and audit controls wired in source. | Added to delta gate | Source-level proof complements live API tests without depending on the browser bridge. |
| Control-plane screen contracts | `npm run test:control-plane-screen-contracts` | Yes | Prove AP payments, settings, roles, approval policies, and Master Data keep source-level UI evidence for real APIs, permission denials, dependency responses, and payment locks. | Added to delta gate | Source-level proof; live browser proof still comes from the E2E gate. |
| Diagnostics self-checks | `npm run test:diagnostics` | Yes | Prove diagnostic rules and route contracts behave predictably. | Passing via delta gate | Complements system diagnostics UI checks. |
| Focused release gate | `npm run release:gate:delta` | Yes | Run RBAC, requisitions, AP controls, exports, smoke, setup, and installable-complete tests. | Passing via delta gate | Requires live local app from `test:local:delta`. |
| GitHub CI production readiness | `.github/workflows/production-readiness.yml` | Yes before production | Re-run install, typecheck, lint, build, audit, and stable focused tests on GitHub infrastructure. | Workflow exists | CI must pass on the release head before production approval. |
| Formal browser E2E release gate | `npm run verify:release:e2e` | Yes before production approval | Run the release gate plus procurement/AP, permissions, and control-plane Playwright workflows. | Added | Runs in the Playwright Release Gate workflow; local Windows may require an unrestricted browser sandbox. |
| Extended browser E2E | `npm run verify:e2e` | Conditional | Run broader Playwright/E2E coverage when the browser environment is stable. | Available | Broader than the formal release gate and useful for exploratory release hardening. |
| Security supply chain | `npm run security:supply-chain:ci` | Yes before production merge | Enforce package manifest drift, lifecycle scripts, SBOM, audit signatures, and high-vulnerability audit. | Included in Production Readiness CI and `verify:release:secure` | Do not merge to production if this fails. |

## Blockers And Equivalents

- Some focused workflow tests require a live app and database. The safe equivalent is `npm run test:local:delta`, which starts the app and waits for `/api/ready` before executing those tests.
- Browser-driven E2E is mandatory before production approval, but it may need the GitHub Playwright Release Gate workflow when local Windows/Codespaces browser sandboxes reject Chromium launch. Do not fake browser success; keep the workflow run as evidence.
- If a required service is unavailable, document the failure in the PR/check notes and do not mark the gate green.

## Production Approval Rule

A feature or route is not production-ready unless it uses real data, has backend validation, respects permissions where needed, handles errors clearly, and has tests or explicit verification evidence.

Operations logistics and exceptions remain tracked in [Core Route V1 Decision Log](core-route-v1-decision-log.md). Do not treat those routes as production-approved until their route-specific actions are complete.

Remaining marker-level production blockers are tracked in [Core Blocking Risk Register](core-blocking-risk-register.md). The Wave 3B audit reduced the blocker count from 43 to 10 by correcting false positives and surfacing the true residual risks.
