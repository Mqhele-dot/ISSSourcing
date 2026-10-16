# Mock, Demo, Static Data, And Placeholder Route Policy

Production screens must not silently depend on mock, demo, sample, static, stub, fake, placeholder, or degraded-only behavior.

## What Counts As Mock/Demo/Static Data

Mock/demo/static data includes:

- hardcoded business records rendered as if they came from the database;
- arrays, objects, totals, charts, or status cards that do not come from a backend API or persisted store;
- fake, sample, fixture, seed-only, or placeholder entities shown in normal production flows;
- `TODO`, `FIXME`, `coming soon`, “would be initiated here”, or similar incomplete action copy;
- silent fallback empty arrays after a failed production read;
- browser-only state such as `localStorage` when it represents production business records;
- degraded responses that hide missing database, integration, permission, or validation behavior.

Seeded development data is acceptable only when it is clearly seeded into the database and the same route still uses the normal backend path.

## Screens That May Remain Demo-Only

The following areas may include demo-only content if visibly labelled:

- learning lessons, tours, and guided walkthroughs;
- onboarding examples and setup helper copy;
- local development diagnostics and fixture pages;
- documentation examples;
- test-only routes, scripts, fixtures, and E2E support pages;
- product previews that are explicitly labelled as examples and cannot create production transactions.

Demo-only screens must not create, approve, receive, invoice, pay, export, or report production business data.

## Core Routes That Must Use Production Data

These routes must use real backend data, backend validation, permissions where needed, clear error handling, and tests or verification evidence:

- Master Data and MDM control centre: `/admin/master-data`
- Suppliers and contracts: `/procurement/suppliers`, `/procurement/contracts`
- Requisitions and purchase orders: `/procurement/requisitions`, `/procurement/orders`
- Inventory and warehouse operations: `/inventory`, `/inventory/warehouse-operations`, `/inventory/cycle-counts`
- Logistics and exceptions: `/operations/logistics`, `/operations/exceptions`
- Accounts payable and invoices: `/finance/accounts-payable`, `/finance/invoices`
- Payments and billing-sensitive finance actions
- Reports, saved reports, and export centre: `/analytics/reports`, `/analytics/export-center`
- User roles, permissions, settings, diagnostics, documents, and audit logs
- Mobile count and sync workflows: `/m/counts`, `/m/scan`, `/m/receive`, `/m/pick`

If one of these routes cannot load real data, it must show a structured error, setup-required state, feature-gated planned state, or diagnostic-backed degraded state. It must not silently render fake data.

## Required Labels For Demo-Only Screens

Demo-only screens must:

- show a visible label such as `Demo`, `Example`, `Training`, `Preview`, or `Local development only`;
- avoid production action verbs such as “approved”, “paid”, “posted”, “sent”, or “exported” unless the action is actually persisted;
- disable or gate write actions that are not backed by real APIs;
- link to the real production route when a real route exists;
- be excluded from production-ready claims in `docs/production-readiness-audit.md`.

## Severity Used By The Audit

`npm run audit:production` ranks mock/demo/static findings as:

- **Critical**: mock/static/placeholder behavior in a core production workflow.
- **High**: demo/degraded/TODO/FIXME behavior that can affect a core workflow.
- **Medium**: local-only or hardcoded behavior that may affect production decisions.
- **Low**: supporting/static behavior outside core transaction paths.
- **False positive**: test, fixture, script, or non-production context that still contains a marker.

## Audit Command

Run:

```bash
npm run audit:production
```

The generated `docs/production-readiness-audit.md` lists mock/demo/static markers, severity, and the required fix path for each finding.
