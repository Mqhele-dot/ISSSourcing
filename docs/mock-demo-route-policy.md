# Mock, Demo, And Placeholder Policy

Production screens must not silently depend on mock, demo, sample, stub, fake, placeholder, or degraded-only behavior.

## Allowed Demo Behavior

Demo behavior is allowed only when it is visibly labelled and isolated from production workflows:

- learning cards and guided lessons
- onboarding walkthroughs
- local development seed data
- demo reset scripts
- examples in documentation
- test-only fixtures under `scripts/`, `e2e/`, or test files

## Production Behavior Rules

- Procurement, AP, logistics, inventory, supplier, master-data, reporting, diagnostics, billing, user, role, and export routes must use real backend data.
- If a dependency is unavailable, show a structured error, setup-required state, or diagnostic finding.
- Do not return silent empty arrays for failed production reads.
- Do not show success messages for actions that were not actually persisted.
- Do not keep placeholder payments, exports, sync, approvals, or master-data actions visible unless they are gated as planned or setup-required.

## Audit Command

Run:

```bash
npm run audit:production
```

The generated `docs/production-readiness-audit.md` lists mock/demo/static markers and the required fix path for each finding.
