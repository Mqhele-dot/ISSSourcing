# Production Release Gate

Use this gate for Wave 1 production stabilisation work on `cursor/project-codespace-compatibility-b14c`.

This branch is buildable, not production-approved. Production approval requires the local gate below plus the required GitHub CI checks on the release head.

## Required Commands

Run:

```bash
npm run verify:release
```

`verify:release` runs `verify:production-base`, `check`, `lint`, `build`, `audit:production`, and `test:local:delta`.

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
| Diagnostics self-checks | `npm run test:diagnostics` | Yes | Prove diagnostic rules and route contracts behave predictably. | Passing via delta gate | Complements system diagnostics UI checks. |
| Focused release gate | `npm run release:gate:delta` | Yes | Run RBAC, requisitions, AP controls, exports, smoke, setup, and installable-complete tests. | Passing via delta gate | Requires live local app from `test:local:delta`. |
| GitHub CI production readiness | `.github/workflows/production-readiness.yml` | Yes before production | Re-run install, typecheck, lint, build, audit, and stable focused tests on GitHub infrastructure. | Workflow exists | CI must pass on the release head before production approval. |
| Extended browser E2E | `npm run verify:e2e` | Conditional | Run broader Playwright/E2E coverage when the browser environment is stable. | Available | Not the default release gate because local/Codespaces browser bridges have been flaky. |
| Security supply chain | `npm run security:supply-chain` | Yes where configured by CI/security gate | Enforce lifecycle scripts, SBOM, audit signatures, and high-vulnerability audit. | Available | Run separately when touching dependencies or security-sensitive code. |

## Blockers And Equivalents

- Some focused workflow tests require a live app and database. The safe equivalent is `npm run test:local:delta`, which starts the app and waits for `/api/ready` before executing those tests.
- Browser-driven E2E remains conditional because local/Codespaces browser bridges have been unstable. Do not fake browser success; use `verify:e2e` only when the environment is healthy.
- If a required service is unavailable, document the failure in the PR/check notes and do not mark the gate green.

## Production Approval Rule

A feature or route is not production-ready unless it uses real data, has backend validation, respects permissions where needed, handles errors clearly, and has tests or explicit verification evidence.
