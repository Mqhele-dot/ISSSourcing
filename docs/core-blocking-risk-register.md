# Core Blocking Risk Register

Generated from `npm run audit:production` during Wave 3B. The audit now reports **10** core blocking risks after classifying seed fixtures and UI placeholder hints as non-blocking/test-only.

| File | Owner | Risk | Action |
|---|---|---|---|
| `client/src/components/billing/payment-dialog.tsx:178` | Finance/AP | Payment receipt still uses a hardcoded `receivedBy: 1`. | Replace with the authenticated actor from the current user/session and add a payment receipt audit assertion. |
| `client/src/pages/logistics.tsx:1755` | Operations/Logistics | Outbound logistics path is an explicit disabled placeholder. | Either hide behind a v1 feature gate or wire outbound workflow to real shipment/warehouse movement APIs. |
| `server/storage.ts:4225` | Inventory platform | Stock movement detail can fall back to a placeholder inventory item. | Return a structured missing-item response or repair referential integrity; do not manufacture item data. |
| `server/storage.ts:4329` | Inventory platform | Second stock movement/detail path can fall back to a placeholder inventory item. | Apply the same missing-item response/integrity repair as the first placeholder path and add regression coverage. |
| `client/src/hooks/use-fallback-state.ts:9` | Platform reliability | Global fallback state still exposes `DEMO`/`DEGRADED` modes. | Keep only explicit diagnostic/degraded states for production and require a visible banner when degraded data is shown. |
| `client/src/lib/fallback-store.ts:33` | Platform reliability | System badge can report `DEMO` from client fallback storage. | Remove production demo fallback or gate it behind a development-only flag. |
| `client/src/pages/exceptions.tsx:345` | Operations/Exceptions | Empty state still directs users to run the demo. | Replace with real exception setup guidance and a diagnostics/run-checks call-to-action. |
| `client/src/pages/logistics.tsx:1110` | Operations/Logistics | Empty state still says users can run the demo. | Replace with production guidance: create PO, receive shipment, or configure carrier/supplier defaults. |
| `client/src/pages/logistics.tsx:1118` | Operations/Logistics | Breadcrumb/link still references “Overview / Demo”. | Rename to production navigation and remove demo wording. |
| `server/modules/operations/operations-core.ts:3477` | Operations workflow | Server-side learning/action list still exposes “Create demo purchase order”. | Move demo action behind development flag or replace with a production-safe guided setup action. |

These are not blockers to the Wave 3B gate changes, but they remain blockers for declaring the whole app production-approved.
