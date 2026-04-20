# Production stabilization checklist (repeatable)

Run after significant client/server changes or before a release candidate.

## Automated (local)

```bash
npm run check
npm run test:stabilization-client
```

Optional broader API smoke (requires running server + seeded DB as appropriate for your environment):

```bash
npm run test:smoke
```

`test:smoke` asserts `GET /api/setup/status` returns **200** with `setupStatusHealth` (`ok` | `degraded`), consistent `issues` (when degraded, non-empty `{ code, message }[]`), and the existing onboarding/database/build shape.

## Manual browser (core shell)

1. Log in; confirm **no** “Could not load product setup status” during normal boot after session is established.
2. Open **System diagnostics** — verify summary JSON, **server-reported setup issues** (if any), and **Copy diagnostics JSON** includes `clientReadiness`.
3. Trigger a **failed auxiliary** request if possible (e.g. block network to a non-critical endpoint) — confirm **global error FAB** does not appear for background GETs; local panel errors show **Retry** where implemented.

## Route smoke (canonical paths)

Prefer links from the sidebar; spot-check: **Control tower**, **Logistics**, **Exceptions**, **Inventory**, **Warehouses**, **Warehouse operations**, **Cycle counts**, **Reorder**, **Purchase orders**, **Requisitions**, **Suppliers** + **supplier detail**, **Contracts**, **Accounts payable** tabs, **Invoices**, **Reports / Export center**, **Settings**, **Master data**.

## Finance / currency

With a non-USD org currency in settings, open analytics **Inventory value** and finance surfaces — amounts should follow org reporting currency (no stray hardcoded USD in business UI).
