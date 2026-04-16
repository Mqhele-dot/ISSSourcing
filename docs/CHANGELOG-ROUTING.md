# Routing and procurement UI — changelog (canonical architecture)

## Registry

- **Canonical paths:** [`client/src/lib/routes/app-routes.ts`](../client/src/lib/routes/app-routes.ts) (`APP_ROUTES`, `LEGACY_ROUTE_REDIRECTS`).
- **Legacy HTTP redirects:** [`client/src/lib/routes/legacy-redirects.ts`](../client/src/lib/routes/legacy-redirects.ts) — static, parametric, and kebab-key rules consumed by [`client/src/router.tsx`](../client/src/router.tsx).

## Retained behavior

- **Analytics hub:** [`AnalyticsWorkspacePage`](../client/src/pages/analytics-workspace.tsx) under `/analytics/*` (overview, inventory, procurement, finance, logistics, reports, saved reports, export center).
- **Reports:** [`reports.tsx`](../client/src/pages/reports.tsx) at `/analytics/reports` and `/analytics/reports/:tab`.
- **Legacy paths:** `/dashboard`, `/analytics`, `/purchase/*`, `/orders/*`, `/requisitions/*`, `/supply-analytics`, kebab admin paths, etc. still redirect to canonical targets (no removal of compatibility in this pass).

## Removed / absent (no standalone pages in repo)

- **Dashboard.tsx, Analytics.tsx, SupplyAnalytics.tsx:** not present as route components; legacy names redirect only.
- **Requisitions as a top-level route component:** list lives in [`requisitions.tsx`](../client/src/pages/requisitions.tsx), embedded under [`purchase-page.tsx`](../client/src/pages/purchase-page.tsx); form is [`requisition-form.tsx`](../client/src/pages/requisition-form.tsx).

## Merged / ownership

| Surface | Owner |
|--------|--------|
| Procurement tab shell (Orders \| Requisitions) | `PurchasePage` only for `/procurement/orders` and `/procurement/requisitions` |
| PO list | `PurchaseOrdersList` in `orders.tsx` |
| PO detail | `PurchaseOrderDetailView` in `orders.tsx` |
| Requisition list (embedded) | `RequisitionsPage` with `embedded` + `basePath` |
| Requisition create/edit | `RequisitionFormPage` + `use-requisition-form-route.ts` (canonical + legacy prefixes) |

## Fixes in this cleanup

- **`/procurement/orders/:po`** recognized for PO detail; list navigation uses **`APP_ROUTES.procurement.order`**.
- **No nested tabs** on `/procurement/orders` when embedded inside `PurchasePage` (`OrdersPage embedded`).
- **Requisition form** resolves **`/procurement/requisitions/new`** and **`/procurement/requisitions/:id`**.
- **Tutorial** start routes and page detection updated for canonical analytics/procurement paths (legacy URLs still redirect).

## App shell

- **Bootstrap split:** [`client/src/app/`](../client/src/app/) — `app-error-boundary`, `app-readiness-banner`, `app-providers`, `app-shell-layout`; thin [`App.tsx`](../client/src/App.tsx).
