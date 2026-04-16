# Finance and reporting — productization changelog

## Reporting currency (org settings)

- **`app_settings.currency_code`:** ISO 4217 code (default `USD`) with shared Zod validation; migration under `migrations/`.
- **API:** `GET` / `PUT` `/api/settings` round-trips `currencyCode`.
- **UI:** General settings includes a reporting currency control (alongside legacy `currencySymbol` for display/PDF until server PDFs are updated).
- **Client:** `useReportingMoney()` and `client/src/lib/format/reporting-money.ts` centralize `Intl` formatting; analytics workspace, AP workspace, and legacy invoice creation use the org code instead of hardcoded `USD`.

## Accounts payable workspace

- **Modules:** `client/src/pages/accounts-payable/` — types, `ap-query-keys.ts`, `use-ap-workspace-queries.ts`, `use-ap-workspace-mutations.ts`, `ap-invalidate.ts` (granular invalidation), `validation.ts` (Zod intake + payment batch), panels (`ap-intake-panel`, `ap-approvals-panel`, `ap-exceptions-panel`, `ap-payments-panel`), `ap-shared.tsx`.
- **Entry:** `client/src/pages/accounts-payable.tsx` re-exports `accounts-payable-workspace.tsx`.
- **Routes:** `/finance/accounts-payable` redirects to `/finance/accounts-payable/intake`; subsections are `intake`, `approvals`, `exceptions`, `payments`. Tabs stay in sync with the URL via `wouter` `setLocation`.
- **Validation:** Client-side Zod + inline error lists for capture intake and payment batch creation before mutations.

## Analytics workspace

- Split under `client/src/pages/analytics-workspace/` with a thin `analytics-workspace.tsx` re-export; finance deep links target AP subsection URLs where appropriate.

## Deferred / follow-up

- **Server PDFs** (`document-generator-service` and related): still may use legacy `$` or symbol-only paths; align exports with `currency_code` for full parity.
