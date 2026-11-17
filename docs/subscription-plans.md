# Subscription Plans

Wave 4A formalizes ISSSourcing SaaS plan management. This page is for the ISSSourcing subscription itself, not supplier/AP billing.

## Source Of Truth

| Layer | Source |
|---|---|
| Plan catalog | `server/subscription-plan-catalog.ts` |
| Feature gates | `server/org-feature-registry.ts` |
| Organization snapshot | `organization_settings` |
| SaaS admin page | `/admin/subscription` |
| Subscription APIs | `/api/subscription/*` |

Pricing labels are configurable with environment variables such as `SUBSCRIPTION_STARTER_MONTHLY_PRICE_LABEL`. The checked-in labels are placeholders and are not final commercial pricing.

## Plan Matrix

| Plan | Ideal customer | Users | Warehouses | SKUs | Included capability groups | Support |
|---|---|---:|---:|---:|---|---|
| Starter | Small teams proving the operating model in one warehouse. | 3 | 1 | 5,000 | Core procurement, inventory, receiving, AP basics, mobile stock counts | Standard product support |
| Standard | Growing operations that need warehouse execution and repeatable exports. | 10 | 3 | 25,000 | Starter plus exports, offline sync, industry extensions, advanced variance approvals | Priority product support |
| Growth | Multi-site teams standardizing finance, procurement, reporting, and integrations. | 50 | 10 | 100,000 | Standard plus analytics, API access, document branding, integration runs | Priority support with implementation guidance |
| Enterprise | Complex or regulated organizations needing bespoke controls and governance. | Unlimited | Unlimited | Unlimited | Growth plus SSO, warehouse limit overrides, custom enterprise controls | Enterprise support and success management |

## Enforced Now

- User creation, warehouse creation, and inventory/SKU creation use backend plan-limit checks.
- Plan-limit failures return `403 PLAN_LIMIT_REACHED` with an upgrade hint.
- Feature-gated routes return `403 FEATURE_NOT_INCLUDED` with the relevant upgrade hint.
- Expired trials return `TRIAL_EXPIRED` and block writes.
- Canceled/inactive hosted subscriptions return `SUBSCRIPTION_INACTIVE` and block paid workflow writes.
- `past_due`/`unpaid` subscriptions remain in billing grace and surface a warning instead of hard-locking immediately.
- Starter blocks exports and offline sync; Standard unlocks exports/offline sync; Growth unlocks analytics/API/document branding; Enterprise has unlimited plan limits.

## Payment Provider Boundary

Stripe is the active hosted billing provider. Local lifecycle actions (`change-plan`, `start-trial`, `cancel`, `resume`) are allowed only outside production unless `SUBSCRIPTION_LOCAL_ADAPTER_ENABLED=true`.

In production, lifecycle mutations must flow through checkout, portal, or verified webhooks. The app must not fake successful payment-provider actions.

Required hosted billing environment variables:

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side Stripe API key for checkout, portal, and webhook verification helpers. |
| `VITE_STRIPE_PUBLIC_KEY` or `STRIPE_PUBLIC_KEY` | Publishable key exposed to client settings/readiness displays. |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures before local entitlements are trusted. |
| `STRIPE_PRICE_STARTER` | Stripe recurring price id for Starter. |
| `STRIPE_PRICE_STANDARD` | Stripe recurring price id for Standard. |
| `STRIPE_PRICE_GROWTH` | Stripe recurring price id for Growth. |
| `STRIPE_PRICE_ENTERPRISE` | Stripe recurring price id for Enterprise or contract checkout placeholder. |

## APIs

| Endpoint | Purpose |
|---|---|
| `GET /api/subscription/plans` | Returns the catalog and configurable pricing labels. |
| `GET /api/subscription/current` | Returns current plan, lifecycle, usage, feature availability, locked features, and provider readiness. |
| `GET /api/subscription/usage` | Returns usage counters for the current billing period. |
| `POST /api/subscription/change-plan` | Local/dev plan update or production provider-required response. |
| `POST /api/subscription/start-trial` | Local/dev trial start or production provider-required response. |
| `POST /api/subscription/cancel` | Local/dev cancel or production provider-required response. |
| `POST /api/subscription/resume` | Local/dev resume or production provider-required response. |
| `POST /api/subscription/billing-portal` | Creates a Stripe billing portal session when provider records exist. |

## Test Commands

```bash
npm run test:subscription-enforcement
npm run test:subscription-plans
npm run test:subscription-entitlements
npm run test:subscription-ui-contracts
npm run test:subscription-runtime-flow
npm run test:stripe-billing-readiness
npm run test:e2e:subscription
```

`test:subscription-runtime-flow` is the live API proof for Starter limits, export entitlement, plan unlocks, lifecycle blocks, billing grace, and local lifecycle audit evidence. `test:stripe-billing-readiness` is the fast release-gate guard for missing Stripe configuration, production local-adapter boundaries, and webhook signature/error handling. `test:e2e:subscription` is the browser proof for `/admin/subscription` permissions and UI behavior.

The non-browser tests are included in `release:gate:delta` from Wave 4B onward. Browser E2E runs through `verify:release:e2e`.
