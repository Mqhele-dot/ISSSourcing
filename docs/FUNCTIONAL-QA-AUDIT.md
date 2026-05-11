# InvTrack — Functional QA audit

**Last updated:** 2026-05-10  

**Business correctness confidence (0–3)**  
0 = shell visible only · 1 = one filter/action · 2 = several paths or API checks · 3 = **exact** FQA numbers, row sets, or CSV parity proven against **`seed:functional-qa`** (`SKU-A`–`D`, `PO-FQA-*`, `INV-FQA-*`, `REQ-FQA-001`).

**Pass rule:** A module is **pass** in the matrix only where the **Pass criteria** column is satisfied by current automation. Otherwise **partial** or **not covered**.

**Commands**

- `npm run verify:core` — **`check`** + **`test:stabilization-client`** + **`test:diagnostics`** + **`test:route-diagnostics`** + **`test:po-print-html`** + **`test:purchase-order-status`** + **`test:functional-audit`** + **`test:e2e`** (local “core” verification; needs DB + Playwright where applicable). The **`test:e2e`** wrapper brings up (or reuses) the dev server, runs **`test:purchase-order-endpoints`** immediately before the Playwright suite, then executes browser E2E.
- `npm run verify:release` — **`verify:core`** plus **`test:purchase-order-actions-e2e`** (serial PO approve/send/commercial/activity proof).
- `npm run test:diagnostics` — lightweight shared calculation/filter self-checks surfaced in **System Diagnostics**; not a substitute for the full FQA seed or E2E suite.
- `npm run test:functional-audit` — runs `test:functional-calculations`, `test:functional-filters`, and **`test:functional-e2e`** so the functional audit includes browser-level Inventory and Purchase Order behavior, not just pure logic checks.
- E2E: `e2e/global-setup.ts` runs **`seed:functional-qa`** after `e2e:prep` unless **`SKIP_E2E_FUNCTIONAL_QA_SEED=1`**.
- Local explicit: **`npm run test:functional-e2e`** = `PLAYWRIGHT_REUSE_EXISTING_SERVER=1 npx playwright test e2e/functional-audit.spec.ts` (via `cross-env`; global setup seeds FQA data unless disabled).

---

## Deliverables (this audit revision)

| Area | Finding |
|------|---------|
| **Inventory UX fixed** | Inventory now has operational KPI cards, table/card views, client-side sorting, active filter chips, row preview, full-item navigation, honest empty-state guidance, and visible negative availability. Functional E2E verifies the FQA rows, stock attributes, filter chips, card preview, and full-item path. |
| **PO workspace fixed** | Purchase Orders now have KPI cards, status select, client-side sorting, active filter chips, total column, row preview, full-PO navigation, signable PDF actions, detail test IDs, safe quick print, and inline receive validation. Functional E2E verifies FQA filters, totals, preview, detail navigation, receive validation, and print output does not hardcode `$`. |
| **Wrong calculations found** | Inventory detail availability now preserves explicit negative availability instead of falling back or clamping. PO quick print uses the configured reporting money formatter. **Remaining product gap:** analytics `/api/reports/analytics` spend still uses **Number** sums on PO totals (cent drift risk) — date-window test asserts **zero spend** for a far-future window, not cent parity. |
| **Pages that do not function** | None observed in **`verify:core`** for routes exercised; partial modules may still hide defects outside smoke/deep-smoke actions. |
| **Filter behavior fixed** | Inventory search/location/category/low-stock filters are enforced in the UI over the current result set so users see correct rows even if an API returns extra rows. PO search/supplier/status filters have visible chips and can clear one filter at a time. |
| **Procurement/AP build increment** | Requisitions now expose workbench controls and edit-mode line revisions; supplier portal invoices are submitted from assigned POs; diagnostics route checks require route-specific markers; AP blocks duplicate supplier invoice numbers, creates match cases for PO-linked invoices, and posts an invoice-approved subledger event/journal slice. |
| **Tests added** | Expanded **`e2e/functional-audit.spec.ts`** for Inventory workspace controls and PO workspace/detail behavior. Extended targeted API checks for supplier invoices and AP duplicate controls. Existing pure checks still cover deterministic calculations and filters. |
| **Remaining partial / unverified** | Operations / Control Tower, mobile scan UX, every **reports tab** export job → download → parse, **Export Center** job lifecycle, warehouse/project dimensions beyond current Inventory filters, multi-org isolation, supplier portal ASN/messaging, and full workflow-engine orchestration. |

---

## Module confidence (quick matrix)

| # | Module | Route(s) | Confidence | Pass criteria in automation |
|---|--------|----------|------------|-----------------------------|
| 1 | Operations / Control Tower | `/operations`, `/operations/control-tower` | 1 | `product-architecture` / load only |
| 2 | Inventory | `/inventory` | 3 | `functional-audit`: KPI cards, sort, card view, preview, full item open, exact **`FQA_INVENTORY_MASTER`** attrs on rows; FQA-visible filters; low-stock CSV **FQA subset** `{B,D}`; `test-functional-inventory-api` |
| 3 | Warehouses | `/inventory/warehouses` | 1 | `module-deep-smoke` |
| 4 | Warehouse Operations | `/inventory/warehouse-operations` | 1 | `module-deep-smoke` |
| 5 | Cycle Counts | `/inventory/cycle-counts` | 1 | `module-deep-smoke` |
| 6 | Reorder | `/inventory/reorder` | 1 | `module-deep-smoke` |
| 7 | Barcodes | `/inventory/barcodes` | 1 | `module-deep-smoke` |
| 8 | Purchase Orders | `/procurement/orders` | 3 | `functional-audit`: KPI cards, status select filters, total column/card, preview, full PO open, receive validation, quick-print currency check; line sum = header; **sum(PO-FQA totals)=4000** |
| 9 | Requisitions | `/procurement/requisitions` | 2 | `functional-audit`: `REQ-FQA-001`, tabs, back/forward, new/cancel; UI now includes status filter, KPIs, preview, and edit-mode lines |
| 10 | Suppliers | `/procurement/suppliers` | 1 | `module-deep-smoke` |
| 11 | Contracts | `/procurement/contracts` | 1 | `module-deep-smoke` |
| 12 | Accounts Payable | `/finance/accounts-payable/...` | 3 | `functional-audit`: **125000 / 155000** cents; toggle; empty batch; `/api/ap/invoices` FQA sum **1550**; `test:ap-controls` covers duplicate controls and approval/payment gates |
| 13 | Billing | `/finance/billing` | 1 | `module-deep-smoke` |
| 14 | Invoices | `/finance/invoices` | 1 | `module-deep-smoke` |
| 15 | Analytics | `/analytics/...` | 3 | `functional-audit`: `/api/analytics/inventory-value` FQA **4** rows, totals **70 / 100** by category, full value **170**; `/api/reports/analytics` far-future **maxSpend=0** |
| 16 | Reports | `/analytics/reports` | 3 | Inventory tab: **category filter** updates preview; CSV `category=id` FQA subset **A+B** |
| 17 | Export Center | `/analytics/export-center` | 1 | Shell visible (`functional-audit`); job pipeline not proven |
| 18 | Admin Settings | `/admin/settings/...` | 1 | `module-deep-smoke` |
| 19 | Master Data | `/admin/master-data` | 1 | `module-deep-smoke` |
| 20 | System Diagnostics | `/admin/system-diagnostics` | 1 | `module-deep-smoke` + installable E2E |
| 21 | Get Educated | `/get-educated` | 2 | `functional-audit` AP lesson |

---

## Known broken / product inconsistencies

1. **Operational list vs stats KPIs:** Inventory **page** uses **available ≤ threshold** (operational). **`/api/inventory/stats`** low-stock / value uses **master** semantics. Tests target operational list + master-based **`inventory-value`** explicitly; do not assume they agree.
2. **Reports async export:** Toolbar export uses **export jobs** + polling; **`functional-audit`** proves **direct** `/api/export/inventory/csv` parity for inventory with category — not the full job queue → download path for every format.
3. **PO / procurement analytics:** `GET /api/reports/analytics` aggregates with **naive Number**; only coarse behavior (e.g. empty date window) is asserted.
4. **Org 1 + demo data:** Full-table “only FQA rows” is not claimed where demo shares categories. Inventory **low-stock export** asserts **FQA SKU subset** exactly `{SKU-B, SKU-D}`.

---

## Not tested yet

- **Export Center:** job **queued → succeeded**, download, failure/retry.
- **Reports:** PO / requisition / shipments tabs — **filter → preview → export job → file parse**.
- **Every partial module:** business rules (only **h1 + one safe action** in `module-deep-smoke`).
- **Multi-org** with FQA seed (seed assumes **org 1**).

---

## Deterministic QA seed

```bash
npm run seed:functional-qa
```

Idempotent for FQA prefixes. See **`shared/functional-qa-constants.ts`** and **`server/seed-functional-qa.ts`**.

---

## Automated checks (no browser)

| Script | Command |
|--------|---------|
| Math / money | `npm run test:functional-calculations` |
| Pure filter predicates | `npm run test:functional-filters` |
| Operational inventory API parity (needs DB) | `tsx scripts/test-functional-inventory-api.ts` |
| **Full audit chain** | `npm run test:functional-audit` |
| **PO status rules (shared)** | `npm run test:purchase-order-status` |
| **PO API contract (needs running server)** | `npm run test:purchase-order-endpoints` (also run automatically before Playwright in `npm run test:e2e`) |

---

## Purchase Order action stability

- **Lifecycle:** Shared rules in `shared/purchase-order-status.ts` include **`partially_received`** and **`closed`** where the backend exposes them; transitions match operations (`open` → `approved` → `sent` → `partially_received` / `received` → `closed`). Approve/send remain role-gated (`manager`, `planner`, `admin`) on operations routes.
- **Commercial terms:** `PUT /api/purchase-orders/:id` accepts only `departmentId`, `contractId`, `paymentTermsId`, `incotermId` (camelCase), validates org/supplier FKs, and returns **409** `PO_COMMERCIAL_UPDATE_LOCKED` when the PO is no longer editable (e.g. sent/received). UI disables save with copy: “Commercial terms can only be updated before the PO is sent.”
- **Activity panel:** Entity activity uses `GET /api/activity?entity_type=...&entity_id=...&limit=...` with SQL-side filters on `ops_activity`, default limit **50**, max **100**, index **`idx_ops_activity_entity_created`**, TanStack Query **`staleTime`** and **no window-focus refetch**, avoiding unfiltered history pulls and `useAsyncResource` fetcher churn on PO detail.
- **Automation:** `npm run test:purchase-order-status`; **`npm run test:purchase-order-endpoints`** (seed + approve/send/commercial/activity contract); `npm run test:e2e` runs that script once the dev server is ready; **`npm run test:purchase-order-actions-e2e`** re-seeds FQA in **`beforeAll`** then exercises approve/send UI, commercial save/lock, activity panel, and rejects **5xx** on PO/activity APIs.
- **Limitations:** Full ERP-style partial receiving and GRN-centric accounting are not fully modeled; receiving may advance PO progress without full three-way inventory settlement. Other `PUT` shapes on `/api/purchase-orders/:id` are no longer accepted (commercial-only contract). Multi-org FQA coverage unchanged.

---

## Playwright

| File | Role |
|------|------|
| `e2e/functional-audit.spec.ts` | **Serial business audit:** inventory, AP, PO, requisitions, analytics, reports inventory preview + CSV, export center shell, Get Educated |
| `e2e/purchase-order-actions.spec.ts` | PO approve/send (button gating), commercial save on **PO-FQA-002**, locked terms on **PO-FQA-003**, activity panel mount, **`beforeAll`** `seed:functional-qa`, no `useAsyncResource` / unstable-fetcher warnings; fails on **5xx** for `/api/purchase/*`, `/api/purchase-orders/*`, `/api/activity`; `/admin/system-diagnostics` marker |
| `e2e/module-deep-smoke.spec.ts` | Partial modules: shell + one interaction |
| `e2e/module-smoke.spec.ts` | Fast route load list |
| Other `e2e/*.spec.ts` | Product routing, installable setup, reports redirect, settings |

---

## Verification

```bash
npm run check
npm run test:functional-calculations
npm run test:functional-filters
npm run test:functional-audit
npm run test:purchase-order-status
npm run test:stabilization-client
npm run test:e2e
npm run verify:core
```

`verify:core` runs those checks in order, including **`test:purchase-order-status`**, **`test:functional-audit`** (calculations + filters + functional E2E), and full **`test:e2e`** (all Playwright specs).
