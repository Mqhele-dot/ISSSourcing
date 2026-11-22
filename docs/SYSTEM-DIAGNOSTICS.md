# System Diagnostics

Open **`/admin/system-diagnostics`** as an admin to use the diagnostics command center.

It captures practical runtime signals:

- Frontend runtime errors and React render failures.
- Route/page load warnings, including lazy route failures and slow page markers.
- Failed, timed out, aborted, and slow API requests from the shared request wrappers.
- Console errors and warnings in the current browser session.
- `/api/ready`, setup status, and a safe server diagnostics snapshot.
- Existing diagnostics scan results from `/api/diagnostics/scan`.
- Known calculation/filter self-check failures from shared helper logic.

It does **not** catch every possible bug. It does not replace server logs, database inspection, Playwright traces, or automated test runs.

## Exporting A Report

Use:

- **Export JSON** for structured data.
- **Export Markdown** for a readable report.
- **Copy summary** for quick Cursor/developer handoff.

Reports include generated time, route, user agent, readiness, recent diagnostics events, API failures, console warnings/errors, route issues, scan results, self-checks, and suggested next actions.

## Security And Redaction

Diagnostics redacts sensitive values before local persistence and report export, including:

- Authorization headers
- Cookies
- Tokens
- Passwords
- Session IDs
- API keys
- Secrets

Environment variables in the server snapshot are shown only as configured/not configured booleans.

## Live Diagnostics vs Tests

Live diagnostics show what happened in the current browser/server session. Automated tests prove expected behavior in a controlled run.

Useful commands:

```bash
npm run test:diagnostics
npm run test:functional-audit
npm run test:e2e
npm run test:logistics-filters
npm run test:control-tower-dashboard
npm run verify:core
npm run verify:release
```

`npm run test:diagnostics` includes self-checks for slow-API dedupe keys, `/admin/system-diagnostics` route-contract markers, money/filter invariants, and related shared helpers.

Slow `GET /api/activity` warnings are **deduped** in the client: the diagnostics store coalesces identical slow-API rows (~30s window) using endpoint + method keys, and `queryClient` applies the same ~30s cooldown per path before emitting another **Slow API request** event. Together this keeps exports readable when a page retries or refetches. Route marker checks wait **8s**, then **re-check at 10s**, before emitting a “page may not have rendered” warning (lazy routes such as System Diagnostics).

## Purchase Order action stability (diagnostics perspective)

- PO detail activity uses **entity-scoped** activity queries and cached reads so diagnostics are not flooded by unfiltered `/api/activity` calls.
- **AP payment batch** self-approval is a **403** business rule (`PAYMENT_BATCH_SELF_APPROVAL_BLOCKED`) in the API envelope, not a 500; the client records it as a **warning**-class diagnostics event and avoids spamming the global action-error tray for that code.

When sharing a report, include the user action that triggered the issue and whether the app was running locally, in Codespaces, or in production.
