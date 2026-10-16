# Organization plans and feature flags

Settings live in `organization_settings` (`plan_tier`, `feature_flags` JSON). The API reads the active org from session / `AsyncLocalStorage` (`server/organization-context.ts`).

## Feature flag keys

| Key | When `false` | Routes / behavior |
|-----|----------------|-------------------|
| `exports` | Disables report downloads | `GET /api/export/:reportType/:format` returns 403 `FEATURE_DISABLED` |
| `offline_sync` | Disables mobile batch sync | `POST` under `/api/sync/*` (see `server/modules/sync/register-sync-routes.ts`) |
| `extensions` | Disables industry extensions APIs | `/api/extensions/projects`, `/api/extensions/assets`, asset events |

Omitted or non-boolean values default to **enabled** (only an explicit JSON `false` turns a flag off). See `server/org-features.ts`.

## Branding fields

- `display_name` — used in PDF export header/footer text when generating documents.
- `report_footer` — legal/footer line on PDF exports.
- `logo_url` — stored for UI; PDF embedding uses vector/header layout in `document-generator-service.ts` (display name + footer are the primary export branding path).

## Support checklist

1. Confirm `organization_settings` row exists for the org (`organization_id` PK).
2. Set `feature_flags` JSON, e.g. `{ "exports": false, "extensions": false }`.
3. Re-test the gated flow (login as that org, hit the route, expect 403 with `FEATURE_DISABLED`).
