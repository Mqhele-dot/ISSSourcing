# Installable setup — verification log

Use this log to record acceptance for packaged / first-run releases. Automated coverage is expanded via `npm run release:gate` (includes `test:requisitions`, `test:org-api`, smoke `/api/setup/status` shape, `test:installable-complete` for `POST /api/setup/product/complete`, and Playwright `e2e/installable-setup.spec.ts`).

**Local DB prep (if `/api/setup/status` returns 500 or E2E redirects to `/setup`):**

1. `npm run db:ensure-installable-app-settings` — adds `currency_code`, `business_country_code`, `tax_mode`, and product onboarding columns on `app_settings` when missing (non-interactive).
2. `npm run e2e:prep` — marks product onboarding complete for rows still missing `product_onboarding_completed_at` (Playwright `globalSetup` runs this automatically before `npm run test:e2e`).

| Scenario | Automated? | Last result | Notes |
|----------|------------|-------------|-------|
| Fresh org + wizard complete → settings + approval policies | API test (`test:installable-complete`) + manual | Pass | Reversible org-scoped snapshot/restore; UI wizard still optional spot-check. Opt-in empty-DB bootstrap: `RUN_EMPTY_ORG_BOOTSTRAP_TEST=1` + `npm run test:installable-org-bootstrap` (not in release gate). |
| Wizard checkpoint / resume | API test + Playwright + manual | Pass | `npm run test:setup-checkpoint` restores DB; `installable-setup.spec.ts` seeds checkpoint on `app_settings` (org 1), asserts **Resume setup** banner on `/setup`, then restores prior onboarding columns (`e2e/product-onboarding-test-db.ts`). |
| Gate when `/api/setup/status` fails | Playwright (`installable-setup.spec.ts`) | Pass | Simulated fetch failure |
| Diagnostics summary vs JSON + copy | Playwright + manual spot-check | Pass | E2E asserts Summary + Copy button |
| Requisitions `?status=PENDING` | Playwright | Pass | Procurement tab shell + search field |
| Home checklist (approve + AP) | Playwright | Pass | Control Tower links |
| `/api/setup/status` JSON shape | Smoke (`scripts/test-smoke.ts`) | Pass | Onboarding + optional database/build |

**Operator:** _________________ **Date:** _________________ **Commit / tag:** _________________

_Last automated sweep: `npm run release:gate` (includes `test:requisitions`, `test:org-api`, smoke, `test:setup-checkpoint`, `test:installable-complete`, Playwright)._
