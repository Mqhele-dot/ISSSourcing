# Core Blocking Risk Register

Generated from `npm run audit:production` during Wave 3C.

## Current Definition

This register tracks **marker-level production blockers**: critical or high-risk mock/demo/static/fake/placeholder markers in production source paths that can cause a core production route or workflow to present false data, unsafe fallback behavior, or an unproven action as production-ready.

The production audit now separates these from:

- **Core route blockers**: route-level readiness gaps such as missing browser proof, missing validation, or missing permissions.
- **Marker-level blockers**: the critical/high source markers tracked here.
- **Non-production v1 exclusions**: routes intentionally excluded from v1 production approval.
- **False positives**: UI placeholders, static route maps, tests, seed fixtures, or development-only tools that do not create production behavior.
- **Test-only markers**: fixtures and assertions inside scripts or E2E tests.

## Current Status

| Category | Count | Source |
|---|---:|---|
| Marker-level blockers | 0 | `docs/production-readiness-audit.md` |
| Core blocking risks | 0 | `docs/production-readiness-audit.md` |
| Non-production v1 exclusions | 4 routes | `/operations/logistics`, `/operations/logistics/:id`, `/operations/exceptions`, `/operations/exceptions/:id` |

## Wave 3C Burn-Down Evidence

| Previous File | Owner | Previous Risk | Resolution |
|---|---|---|---|
| `client/src/components/billing/payment-dialog.tsx` | Finance/AP | Payment receipt used hardcoded `receivedBy: 1`. | Uses the authenticated `useAuth()` user id and fails if no actor is present. |
| `client/src/pages/logistics.tsx` | Operations/Logistics | Outbound logistics disabled placeholder looked like production backlog hidden in UI. | Renamed as an explicit v1 exclusion and kept disabled until route-specific proof exists. |
| `server/storage.ts` | Inventory platform | Requisition detail could manufacture an `Unknown item` fallback. | Throws structured `INVENTORY_ITEM_MISSING` instead of inventing item data. |
| `server/storage.ts` | Inventory platform | PO detail could manufacture an `Unknown item` fallback. | Throws structured `INVENTORY_ITEM_MISSING` instead of inventing item data. |
| `client/src/hooks/use-fallback-state.ts` | Platform reliability | Fallback badge type exposed a demo state. | Badge type now only supports `LIVE` and `DEGRADED`. |
| `client/src/lib/fallback-store.ts` | Platform reliability | System badge could advertise a demo mode. | Store now exposes only production-safe live/degraded states. |
| `client/src/pages/exceptions.tsx` | Operations/Exceptions | Empty state directed users to run a demo. | Empty state now points to real inventory/diagnostics investigation. |
| `client/src/pages/logistics.tsx` | Operations/Logistics | Empty state directed users to run a demo. | Empty state now points to PO, carrier default, and receiving setup. |
| `client/src/pages/logistics.tsx` | Operations/Logistics | Navigation link said `Overview / Demo`. | Link now opens the operations overview without demo wording. |
| `server/modules/operations/operations-core.ts` | Operations workflow | Guided action said `Create demo purchase order`. | Uses guided setup wording and production-safe references. |

## Regression Guard

`npm run test:final-production-blockers` enforces the Wave 3C fixes and is included in `npm run release:gate:delta`.

Production approval still requires `npm run verify:release`, `npm run verify:release:e2e`, and `npm run verify:release:secure`.
