# Production Release Gate

Use this gate for Wave 1 production stabilisation work on `cursor/project-codespace-compatibility-b14c`.

## Required Local Gate

```bash
npm run verify:release
```

`verify:release` runs:

1. `npm run verify:production-base`
2. `npm run build`
3. `npm run audit:production`
4. `npm run test:local:delta`

The delta runner starts the local app, waits for `/api/ready`, then runs check/lint, diagnostics, route diagnostics, master-data propagation, master-data integration, purchase-order endpoints, AP workflow, and the existing `release:gate:delta` script while the app is still alive.

## Focused Smoke Tests

`npm test` is intentionally mapped to `npm run test:production-smoke` so a plain test command exercises the current production-critical workflows:

- master-data propagation
- purchase-order endpoints
- AP workflow
- diagnostics self-checks

## Extended E2E Gate

The previous broad E2E release command is still available as:

```bash
npm run verify:e2e
```

Use it when the local or Codespaces browser environment is stable and a live app server is available.

## CI

`.github/workflows/production-readiness.yml` runs the same production-readiness sequence with a PostgreSQL service. This gate should fail loudly if type-checking, linting, build output, the production audit, focused smoke tests, or the delta release tests regress.
